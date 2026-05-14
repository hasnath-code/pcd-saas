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
  payments,
  projectStakeholders,
  projects,
  users,
} from '@/db/schema';
import { logActivityTx } from '@/lib/activity/log';
import { logAudit } from '@/lib/audit/log';
import { dispatchNotification } from '@/lib/notifications/dispatch';

// Phase 2 §2.3 / Session 13 — payment lifecycle server actions.
//
// recordPayment: every payment is its own row; the running total is a SUM
// (see db/queries/payments.ts:getPaymentsForProject). Amount > 0 is enforced
// at the DB CHECK + the Zod schema.
//
// correctPayment: amount is mutable. A correction mutates `amount` in place
// and appends one entry to correction_log_payload:
//   { previous_amount, new_amount, corrected_at, corrected_by, reason }
// `audit_logs` is the system-of-record (Hard Rule 4); the JSON column is the
// denormalized read-side convenience for the UI.
//
// Decision (four-decision table Q2): correctPayment dispatches payment.corrected
// to ORG MEMBERS ONLY — no stakeholders, no client email. Corrections are
// administrative bookkeeping. Activity row is visible_to_stakeholders=false
// (Q3) so the org-side timeline shows the correction but the portal timeline
// does not.

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
): Promise<PaymentActionResult<{ paymentId: string }>> {
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

  const paymentId = uuidv7();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(payments).values({
        id: paymentId,
        orgId: ctx.orgId,
        projectId,
        amount,
        recordedBy: ctx.userId,
      });

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
        },
        // Q3 decision: payment.recorded is client-visible (the running total
        // surfaces on the portal payment-status badge anyway, so an explicit
        // "payment received" entry on the timeline is consistent).
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
  const dispatchPayload = {
    projectId,
    projectNumber,
    paymentId,
    amount,
    amountFormatted: formatGBP(amount),
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
    },
  });

  revalidatePath(`/dashboard/projects/${projectId}`, 'layout');
  revalidatePath(`/portal/projects/${projectId}`, 'layout');
  return { success: true, data: { paymentId } };
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

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(payments)
        .set({ amount: newAmount, correctionLogPayload: nextLog })
        .where(eq(payments.id, paymentId));

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
        },
        // Q3 decision: payment.corrected is org-internal.
        visibleToStakeholders: false,
      });
    });
  } catch (e) {
    const errReason = e instanceof Error ? e.message : String(e);
    return { error: 'internal_error', reason: `correct_payment:${errReason}` };
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
