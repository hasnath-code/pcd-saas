'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import * as Sentry from '@sentry/nextjs';
import {
  AuthError,
  requireOrgUser,
  type ServerActionErrorCode,
} from '@/lib/auth/requireAuth';
import { db } from '@/db';
import {
  clients,
  documentTokens,
  documents,
  payments,
  projectStakeholders,
  projects,
  users,
} from '@/db/schema';
import { logActivityTx } from '@/lib/activity/log';
import { logAudit } from '@/lib/audit/log';
import { dispatchNotification } from '@/lib/notifications/dispatch';
import { allocateDocumentNumber } from '@/lib/documents/numbering';
import { invalidateDocumentPdfCache } from '@/actions/document-pdf';

// Phase 2 §2.3 / Session 13 — payment lifecycle server actions.
//
// recordPayment: every payment is its own row; the running total is a SUM
// (see db/queries/payments.ts:getPaymentsForProject). Amount > 0 is enforced
// at the DB CHECK + the Zod schema. Session 14: ALSO mints a `documents` row
// of type='receipt' linked via payment_id, plus a document_tokens row, all
// in the same transaction — one payment, one receipt, atomic. The receipt's
// recipient_name is snapshotted from the project's primary client at this
// moment so reviseReceipt can edit it independently.
//
// correctPayment: amount is mutable. A correction mutates `amount` in place
// and appends one entry to correction_log_payload:
//   { previous_amount, new_amount, corrected_at, corrected_by, reason }
// `audit_logs` is the system-of-record (Hard Rule 4); the JSON column is the
// denormalized read-side convenience for the UI. Session 14: ALSO updates
// the linked receipt's subtotal/total in lockstep (Plan Q2 — snapshot kept
// consistent so the receipt PDF/page renders straight from the documents row
// with no JOIN). The cached PDF (if any) is soft-deleted so the next
// download regenerates from the corrected total.
//
// Decision (four-decision table Q2 from S13): correctPayment dispatches
// payment.corrected to ORG MEMBERS ONLY — no stakeholders, no client email.
// Corrections are administrative bookkeeping. Activity row is
// visible_to_stakeholders=false (Q3) so the org-side timeline shows the
// correction but the portal timeline does not.

export type PaymentActionResult<T = void> =
  | (T extends void ? { success: true } : { success: true; data: T })
  | { error: ServerActionErrorCode; reason?: string };

const RecordPaymentInput = z.object({
  projectId: z.string().uuid(),
  // multipleOf 0.01 enforces 2dp at input — matches the DB numeric(12,2) precision.
  amount: z.number().positive().multipleOf(0.01),
});

const CorrectPaymentInput = z.object({
  paymentId: z.string().uuid(),
  newAmount: z.number().positive().multipleOf(0.01),
  reason: z.string().trim().min(1).max(500),
});

function formatGBP(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// ────────────────────────────────────────────────────────────────────────────
// recordPayment — insert a payments row + post-commit dispatch.

export async function recordPayment(
  input: unknown,
): Promise<PaymentActionResult<{ paymentId: string; receiptId: string }>> {
  let ctx: Awaited<ReturnType<typeof requireOrgUser>>;
  try {
    ctx = await requireOrgUser();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = RecordPaymentInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { projectId, amount } = parsed.data;

  // Project resolution: org-scoped, not soft-deleted.
  const projectRows = await db
    .select({ orgId: projects.orgId, projectNumber: projects.projectNumber })
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  if (projectRows.length === 0 || projectRows[0].orgId !== ctx.orgId) {
    return { error: 'not_found', reason: 'project' };
  }
  const projectNumber = projectRows[0].projectNumber;

  // Session 14: snapshot the recipient name from the project's primary
  // client. Same lookup shape as sendInvoice (actions/documents.ts:1053).
  // If there's no primary client (edge case — project created without one,
  // or stakeholder removed), we leave recipientName=null; reviseReceipt can
  // populate it later.
  const recipientRows = await db
    .select({ name: clients.name })
    .from(projectStakeholders)
    .innerJoin(clients, eq(clients.id, projectStakeholders.clientId))
    .where(
      and(
        eq(projectStakeholders.projectId, projectId),
        eq(projectStakeholders.role, 'primary_client'),
        isNotNull(projectStakeholders.acceptedAt),
        isNull(projectStakeholders.deletedAt),
        isNull(clients.deletedAt),
      ),
    )
    .limit(1);
  const recipientName: string | null = recipientRows[0]?.name ?? null;

  const paymentId = uuidv7();
  const receiptId = uuidv7();
  let receiptDocumentNumber = '';
  try {
    await db.transaction(async (tx) => {
      // 1. Insert payments row.
      await tx.insert(payments).values({
        id: paymentId,
        orgId: ctx.orgId,
        projectId,
        amount,
        recordedBy: ctx.userId,
      });

      // 2. Allocate the receipt's project-scoped sequence + format
      //    {projectNumber}-R{n}. SELECT FOR UPDATE on the projects row inside
      //    the same tx serializes concurrent receipt allocations.
      const allocated = await allocateDocumentNumber({
        tx,
        projectId,
        type: 'receipt',
      });
      receiptDocumentNumber = allocated.documentNumber;

      // 3. Insert the receipt as a documents row. Money columns snapshot to
      //    payment.amount; correctPayment keeps them in lockstep (Plan Q2).
      //    Receipts have no VAT / discount — they record what was received.
      await tx.insert(documents).values({
        id: receiptId,
        orgId: ctx.orgId,
        projectId,
        type: 'receipt',
        status: 'sent',
        documentNumber: allocated.documentNumber,
        sequence: allocated.sequence,
        lineItems: [
          { description: `Payment received`, quantity: 1, unitPrice: amount, category: 'payment' },
        ],
        discountPct: 0,
        vatApplicable: false,
        subtotal: amount,
        vatAmount: 0,
        total: amount,
        currency: 'GBP',
        sentAt: new Date(),
        paymentId,
        recipientName,
        createdBy: ctx.userId,
      });

      // 4. Mint the receipt's public token (uuid v4 default per §25). Cross-
      //    type tokens 404 at the route level; the document_type column makes
      //    the (token, document_type) match a single index probe.
      await tx.insert(documentTokens).values({
        id: uuidv7(),
        documentId: receiptId,
        documentType: 'receipt',
      });

      // 5. Activity rows. Two events: payment.recorded (already logged) +
      //    receipt.generated (the receipt as a distinct artifact in the
      //    timeline, so the client sees "Receipt R1 issued" alongside
      //    "Payment received"). Both visible to stakeholders.
      await logActivityTx(tx, {
        projectId,
        actorType: 'user',
        actorId: ctx.userId,
        eventType: 'payment.recorded',
        payload: {
          projectId,
          projectNumber,
          paymentId,
          amount,
          amountFormatted: formatGBP(amount),
          receiptId,
          receiptNumber: allocated.documentNumber,
        },
        visibleToStakeholders: true,
      });
      await logActivityTx(tx, {
        projectId,
        actorType: 'user',
        actorId: ctx.userId,
        eventType: 'receipt.generated',
        payload: {
          projectId,
          projectNumber,
          receiptId,
          receiptNumber: allocated.documentNumber,
          paymentId,
          amount,
          amountFormatted: formatGBP(amount),
        },
        visibleToStakeholders: true,
      });
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { error: 'internal_error', reason: `record_payment:${reason}` };
  }

  // Post-commit dispatch — org members + accepted financial-visible
  // stakeholders. Same fan-out shape as dispatchQuoteOrInvoiceNotification
  // in actions/documents.ts. Per-recipient try/catch → Sentry, never
  // re-throws (ADR-033).
  //
  // Note (Session 14): we deliberately do NOT add a separate notification
  // dispatch for receipt.generated. The recipients are the same as
  // payment.recorded with the same payload context (the dispatch payload
  // already carries receiptId + receiptNumber); a second fan-out would be
  // notification spam. The receipt.generated event lives in the activity
  // timeline only.
  const dispatchPayload = {
    projectId,
    projectNumber,
    paymentId,
    amount,
    amountFormatted: formatGBP(amount),
    receiptId,
    receiptNumber: receiptDocumentNumber,
  };
  await dispatchPaymentNotification({
    eventType: 'payment.recorded',
    orgId: ctx.orgId,
    projectId,
    actionName: 'recordPayment',
    payload: dispatchPayload,
    includeFinancialStakeholders: true,
  });

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action: 'create',
    resourceType: 'payment',
    resourceId: paymentId,
    metadata: {
      project_id: projectId,
      amount,
      receipt_id: receiptId,
      receipt_number: receiptDocumentNumber,
    },
  });
  // Audit the receipt creation as a separate document.create row — the
  // receipt is a first-class artifact and audit_logs is system-of-record.
  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action: 'create',
    resourceType: 'document',
    resourceId: receiptId,
    metadata: {
      project_id: projectId,
      document_type: 'receipt',
      document_number: receiptDocumentNumber,
      payment_id: paymentId,
      amount,
    },
  });

  revalidatePath(`/dashboard/projects/${projectId}`, 'layout');
  revalidatePath(`/portal/projects/${projectId}`, 'layout');
  return { success: true, data: { paymentId, receiptId } };
}

// ────────────────────────────────────────────────────────────────────────────
// correctPayment — mutate amount in place + append correction_log_payload entry.

export async function correctPayment(
  input: unknown,
): Promise<PaymentActionResult> {
  let ctx: Awaited<ReturnType<typeof requireOrgUser>>;
  try {
    ctx = await requireOrgUser();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = CorrectPaymentInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { paymentId, newAmount, reason } = parsed.data;

  const rows = await db
    .select({
      id: payments.id,
      orgId: payments.orgId,
      projectId: payments.projectId,
      amount: payments.amount,
      correctionLog: payments.correctionLogPayload,
    })
    .from(payments)
    .where(and(eq(payments.id, paymentId), isNull(payments.deletedAt)))
    .limit(1);

  if (rows.length === 0 || rows[0].orgId !== ctx.orgId) {
    return { error: 'not_found', reason: 'payment' };
  }
  const row = rows[0];
  const previousAmount = Number(row.amount);

  // No-op guard: numeric equality at 2dp tolerance.
  if (Math.abs(previousAmount - newAmount) < 0.005) {
    return { error: 'conflict', reason: 'no_change' };
  }

  const projectRows = await db
    .select({ projectNumber: projects.projectNumber })
    .from(projects)
    .where(eq(projects.id, row.projectId))
    .limit(1);
  const projectNumber = projectRows[0]?.projectNumber ?? '';

  const correctionEntry = {
    previous_amount: previousAmount,
    new_amount: newAmount,
    corrected_at: new Date().toISOString(),
    corrected_by: ctx.userId,
    reason,
  };
  const existingLog = Array.isArray(row.correctionLog)
    ? (row.correctionLog as unknown[])
    : [];
  const nextLog = [...existingLog, correctionEntry];

  // Find the linked receipt's id outside the tx — read-only lookup, single
  // row, indexed via idx_documents_payment_id (Session 13 migration 0026).
  const receiptRows = await db
    .select({ id: documents.id, number: documents.documentNumber })
    .from(documents)
    .where(
      and(
        eq(documents.paymentId, paymentId),
        eq(documents.type, 'receipt'),
        isNull(documents.deletedAt),
      ),
    )
    .limit(1);
  const receiptIdToUpdate: string | null = receiptRows[0]?.id ?? null;
  const receiptNumberToReport: string = receiptRows[0]?.number ?? '';

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(payments)
        .set({ amount: newAmount, correctionLogPayload: nextLog })
        .where(eq(payments.id, paymentId));

      // Session 14 (Plan Q2): keep the linked receipt's amount in lockstep.
      // The receipt PDF/page reads straight from the documents row — no
      // JOIN — so updating both atomically keeps the user-visible total
      // correct without read-time recomputation.
      if (receiptIdToUpdate) {
        await tx
          .update(documents)
          .set({
            subtotal: newAmount,
            total: newAmount,
            lineItems: [
              {
                description: 'Payment received',
                quantity: 1,
                unitPrice: newAmount,
                category: 'payment',
              },
            ],
          })
          .where(eq(documents.id, receiptIdToUpdate));
      }

      await logActivityTx(tx, {
        projectId: row.projectId,
        actorType: 'user',
        actorId: ctx.userId,
        eventType: 'payment.corrected',
        payload: {
          projectId: row.projectId,
          projectNumber,
          paymentId,
          previousAmount,
          newAmount,
          previousAmountFormatted: formatGBP(previousAmount),
          newAmountFormatted: formatGBP(newAmount),
          reason,
          receiptId: receiptIdToUpdate,
          receiptNumber: receiptNumberToReport,
        },
        // Q3 decision: payment.corrected is org-internal.
        visibleToStakeholders: false,
      });
    });
  } catch (e) {
    const errReason = e instanceof Error ? e.message : String(e);
    return { error: 'internal_error', reason: `correct_payment:${errReason}` };
  }

  // Post-commit: invalidate the cached PDF on the linked receipt so the
  // next download regenerates from the corrected total. Soft-delete only,
  // outside the tx (the action's truth is committed; this is best-effort
  // cleanup that should never roll back the correction).
  if (receiptIdToUpdate) {
    try {
      await invalidateDocumentPdfCache(receiptIdToUpdate);
    } catch (err) {
      Sentry.captureException(err, {
        tags: { scope: 'pdf_cache_invalidate', action: 'correctPayment' },
        extra: { paymentId, receiptId: receiptIdToUpdate },
      });
    }
  }

  // Q2 decision: dispatch to ORG MEMBERS ONLY — no stakeholders, no client
  // email. Corrections are administrative.
  const dispatchPayload = {
    projectId: row.projectId,
    projectNumber,
    paymentId,
    previousAmount,
    newAmount,
    previousAmountFormatted: formatGBP(previousAmount),
    newAmountFormatted: formatGBP(newAmount),
    reason,
  };
  await dispatchPaymentNotification({
    eventType: 'payment.corrected',
    orgId: ctx.orgId,
    projectId: row.projectId,
    actionName: 'correctPayment',
    payload: dispatchPayload,
    includeFinancialStakeholders: false,
  });

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action: 'update',
    resourceType: 'payment',
    resourceId: paymentId,
    metadata: {
      project_id: row.projectId,
      correction: {
        previous_amount: previousAmount,
        new_amount: newAmount,
        reason,
      },
    },
  });

  revalidatePath(`/dashboard/projects/${row.projectId}`, 'layout');
  revalidatePath(`/portal/projects/${row.projectId}`, 'layout');
  return { success: true };
}

// ────────────────────────────────────────────────────────────────────────────
// Internal dispatch helper. The `includeFinancialStakeholders` flag is the
// payment.recorded vs payment.corrected switch — recipient resolution is the
// only difference between the two events at the dispatch layer.

async function dispatchPaymentNotification(opts: {
  eventType: 'payment.recorded' | 'payment.corrected';
  orgId: string;
  projectId: string;
  actionName: string;
  payload: Record<string, unknown>;
  includeFinancialStakeholders: boolean;
}): Promise<void> {
  const { eventType, orgId, projectId, actionName, payload } = opts;

  const orgMembers = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.orgId, orgId), isNull(users.deletedAt)));

  for (const u of orgMembers) {
    try {
      await dispatchNotification({
        recipientType: 'user',
        recipientId: u.id,
        eventType,
        payload,
      });
    } catch (err) {
      Sentry.captureException(err, {
        tags: {
          scope: 'notification_dispatch',
          action: actionName,
          event_type: eventType,
          org_id: orgId,
        },
        extra: { recipientUserId: u.id, projectId },
      });
    }
  }

  if (!opts.includeFinancialStakeholders) return;

  const financialStakeholders = await db
    .select({ clientId: projectStakeholders.clientId })
    .from(projectStakeholders)
    .where(
      and(
        eq(projectStakeholders.projectId, projectId),
        eq(projectStakeholders.canViewFinancials, true),
        isNotNull(projectStakeholders.acceptedAt),
        isNull(projectStakeholders.deletedAt),
      ),
    );

  for (const s of financialStakeholders) {
    try {
      await dispatchNotification({
        recipientType: 'client',
        recipientId: s.clientId,
        eventType,
        payload,
      });
    } catch (err) {
      Sentry.captureException(err, {
        tags: {
          scope: 'notification_dispatch',
          action: actionName,
          event_type: eventType,
          org_id: orgId,
        },
        extra: { recipientClientId: s.clientId, projectId },
      });
    }
  }
}
