'use server';

import { headers } from 'next/headers';
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
  projectStakeholders,
  projects,
  users,
} from '@/db/schema';
import { logActivityTx } from '@/lib/activity/log';
import { logAudit } from '@/lib/audit/log';
import { sendEmail } from '@/lib/email/send';
import { getAppUrl } from '@/lib/get-app-url';
import { rateLimit } from '@/lib/ratelimit';
import { allocateDocumentNumber } from '@/lib/documents/numbering';
import { calculateTotals, type LineItem } from '@/lib/documents/vat';
import { diffInvoiceFields } from '@/lib/documents/revise-diff';
import { dispatchNotification } from '@/lib/notifications/dispatch';
import { quoteSentEmail } from '@/lib/email/templates/quote-sent';
import { invoiceSentEmail } from '@/lib/email/templates/invoice-sent';
import { invalidateDocumentPdfCache } from '@/lib/pdf/cache';

// Phase 2 §2 — quote lifecycle server actions. createQuote / updateQuoteDraft
// / sendQuote follow ARCHITECTURE-saas.md §20 (requireOrgUser + Zod + tx +
// audit). acceptQuote is the new token-authorized public-write pattern —
// see ADR-034.

export type DocumentActionResult<T = void> =
  | (T extends void ? { success: true } : { success: true; data: T })
  | { error: ServerActionErrorCode; reason?: string };

// ────────────────────────────────────────────────────────────────────────────
// Shared input shapes

const LineItemSchema = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.number().nonnegative(),
  unitPrice: z.number(),
  category: z.string().trim().max(100).optional(),
});

const CreateQuoteInput = z.object({
  projectId: z.string().uuid(),
  lineItems: z.array(LineItemSchema).min(1),
  discountPct: z.number().min(0).max(100).default(0),
  vatApplicable: z.boolean().default(false),
});

const UpdateQuoteDraftInput = z.object({
  documentId: z.string().uuid(),
  lineItems: z.array(LineItemSchema).min(1).optional(),
  discountPct: z.number().min(0).max(100).optional(),
  vatApplicable: z.boolean().optional(),
});

const DocumentIdInput = z.object({ documentId: z.string().uuid() });

const AcceptQuoteInput = z.object({
  token: z.string().uuid(),
  acceptedByName: z.string().trim().min(1).max(200),
});

// ────────────────────────────────────────────────────────────────────────────
// createQuote — surveyor drafts a quote on a project.

export async function createQuote(
  input: unknown,
): Promise<DocumentActionResult<{ documentId: string; documentNumber: string }>> {
  let ctx: Awaited<ReturnType<typeof requireOrgUser>>;
  try {
    ctx = await requireOrgUser();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = CreateQuoteInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { projectId, lineItems, discountPct, vatApplicable } = parsed.data;

  // Project resolution: must exist, must be in the caller's org, must not be
  // soft-deleted.
  const projectRows = await db
    .select({ orgId: projects.orgId })
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  if (projectRows.length === 0 || projectRows[0].orgId !== ctx.orgId) {
    return { error: 'not_found', reason: 'project' };
  }

  const totals = calculateTotals({
    lineItems: lineItems as LineItem[],
    discountPct,
    vatApplicable,
  });

  const documentId = uuidv7();
  let documentNumber: string;
  try {
    const result = await db.transaction(async (tx) => {
      const allocated = await allocateDocumentNumber({
        tx,
        projectId,
        type: 'quote',
      });

      await tx.insert(documents).values({
        id: documentId,
        orgId: ctx.orgId,
        projectId,
        type: 'quote',
        status: 'draft',
        documentNumber: allocated.documentNumber,
        sequence: allocated.sequence,
        lineItems: lineItems as LineItem[],
        discountPct,
        vatApplicable,
        subtotal: totals.subtotal,
        vatAmount: totals.vatAmount,
        total: totals.total,
        createdBy: ctx.userId,
      });

      return { documentNumber: allocated.documentNumber };
    });
    documentNumber = result.documentNumber;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { error: 'internal_error', reason: `create_quote:${reason}` };
  }

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action: 'create',
    resourceType: 'document',
    resourceId: documentId,
    metadata: {
      project_id: projectId,
      type: 'quote',
      document_number: documentNumber,
      total: totals.total,
    },
  });

  revalidatePath(`/dashboard/projects/${projectId}`, 'layout');
  return { success: true, data: { documentId, documentNumber } };
}

// ────────────────────────────────────────────────────────────────────────────
// updateQuoteDraft — surveyor edits a draft quote. Rejects non-draft.

export async function updateQuoteDraft(
  input: unknown,
): Promise<DocumentActionResult> {
  let ctx: Awaited<ReturnType<typeof requireOrgUser>>;
  try {
    ctx = await requireOrgUser();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = UpdateQuoteDraftInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { documentId, lineItems, discountPct, vatApplicable } = parsed.data;

  const rows = await db
    .select({
      id: documents.id,
      projectId: documents.projectId,
      orgId: documents.orgId,
      status: documents.status,
      type: documents.type,
      currentLineItems: documents.lineItems,
      currentDiscountPct: documents.discountPct,
      currentVatApplicable: documents.vatApplicable,
    })
    .from(documents)
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
    .limit(1);

  if (rows.length === 0 || rows[0].orgId !== ctx.orgId) {
    return { error: 'not_found', reason: 'document' };
  }
  const row = rows[0];
  if (row.type !== 'quote') {
    return { error: 'conflict', reason: 'not_a_quote' };
  }
  if (row.status !== 'draft') {
    return { error: 'conflict', reason: 'not_draft' };
  }

  // Merge: only patch fields that were provided. Recompute totals from the
  // post-merge values so the row stays internally consistent.
  const nextLineItems =
    lineItems !== undefined ? (lineItems as LineItem[]) : (row.currentLineItems as LineItem[]);
  const nextDiscountPct =
    discountPct !== undefined ? discountPct : Number(row.currentDiscountPct);
  const nextVatApplicable =
    vatApplicable !== undefined ? vatApplicable : row.currentVatApplicable;

  const totals = calculateTotals({
    lineItems: nextLineItems,
    discountPct: nextDiscountPct,
    vatApplicable: nextVatApplicable,
  });

  await db
    .update(documents)
    .set({
      lineItems: nextLineItems,
      discountPct: nextDiscountPct,
      vatApplicable: nextVatApplicable,
      subtotal: totals.subtotal,
      vatAmount: totals.vatAmount,
      total: totals.total,
    })
    .where(eq(documents.id, documentId));

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action: 'update',
    resourceType: 'document',
    resourceId: documentId,
    metadata: {
      project_id: row.projectId,
      total: totals.total,
      fields: ['line_items', 'discount_pct', 'vat_applicable', 'subtotal', 'vat_amount', 'total'],
    },
  });

  revalidatePath(`/dashboard/projects/${row.projectId}`, 'layout');
  return { success: true };
}

// ────────────────────────────────────────────────────────────────────────────
// sendQuote — flip draft → sent + mint token + post-commit email to client.

export async function sendQuote(
  input: unknown,
): Promise<DocumentActionResult<{ token: string }>> {
  let ctx: Awaited<ReturnType<typeof requireOrgUser>>;
  try {
    ctx = await requireOrgUser();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = DocumentIdInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { documentId } = parsed.data;

  const docRows = await db
    .select({
      id: documents.id,
      orgId: documents.orgId,
      projectId: documents.projectId,
      status: documents.status,
      type: documents.type,
      documentNumber: documents.documentNumber,
      total: documents.total,
    })
    .from(documents)
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
    .limit(1);

  if (docRows.length === 0 || docRows[0].orgId !== ctx.orgId) {
    return { error: 'not_found', reason: 'document' };
  }
  const doc = docRows[0];
  if (doc.type !== 'quote') return { error: 'conflict', reason: 'not_a_quote' };
  if (doc.status !== 'draft') return { error: 'conflict', reason: 'not_draft' };

  const projectRows = await db
    .select({ projectNumber: projects.projectNumber })
    .from(projects)
    .where(eq(projects.id, doc.projectId))
    .limit(1);
  const projectNumber = projectRows[0]?.projectNumber ?? '';

  // Tx: flip status, mint token, log activity. Email send is post-commit per
  // ADR-033 / Hard Rule 27.
  const tokenId = uuidv7();
  let mintedToken: string;
  try {
    const result = await db.transaction(async (tx) => {
      await tx
        .update(documents)
        .set({ status: 'sent', sentAt: new Date() })
        .where(eq(documents.id, documentId));

      // Insert the token row and read back the DB-generated `token` value
      // (gen_random_uuid()) so we can build the public URL.
      const [insertedToken] = await tx
        .insert(documentTokens)
        .values({ id: tokenId, documentId, documentType: 'quote' })
        .returning({ token: documentTokens.token });

      await logActivityTx(tx, {
        projectId: doc.projectId,
        actorType: 'user',
        actorId: ctx.userId,
        eventType: 'quote.sent',
        payload: {
          projectId: doc.projectId,
          projectNumber,
          documentId,
          documentNumber: doc.documentNumber,
          total: Number(doc.total),
        },
        visibleToStakeholders: true,
      });

      return { token: insertedToken.token };
    });
    mintedToken = result.token;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { error: 'internal_error', reason: `send_quote:${reason}` };
  }

  // Post-commit: resolve the primary client's email, render template, send.
  // Per-recipient failure → Sentry isolation, never re-throws (ADR-033).
  try {
    const recipientRows = await db
      .select({ email: clients.email, name: clients.name })
      .from(projectStakeholders)
      .innerJoin(clients, eq(clients.id, projectStakeholders.clientId))
      .where(
        and(
          eq(projectStakeholders.projectId, doc.projectId),
          eq(projectStakeholders.role, 'primary_client'),
          isNotNull(projectStakeholders.acceptedAt),
          isNull(projectStakeholders.deletedAt),
          isNull(clients.deletedAt),
        ),
      )
      .limit(1);

    if (recipientRows.length > 0) {
      const recipient = recipientRows[0];
      const viewUrl = `${getAppUrl()}/q/${mintedToken}`;
      const rendered = quoteSentEmail({
        quoteNumber: doc.documentNumber,
        total: Number(doc.total),
        viewUrl,
      });
      await sendEmail({
        to: recipient.email,
        subject: rendered.subject,
        html: rendered.html,
        template: 'quote-sent',
        orgId: ctx.orgId,
      });
    }
  } catch (err) {
    Sentry.captureException(err, {
      tags: {
        scope: 'notification_dispatch',
        action: 'sendQuote',
        event_type: 'quote.sent',
        org_id: ctx.orgId,
      },
      extra: { documentId, projectId: doc.projectId },
    });
  }

  // DEBT-064: post-commit dispatchNotification fan-out for quote.sent.
  // Recipients: org members + accepted stakeholders with
  // can_view_financials=true. Composes with the direct client email above;
  // dispatchNotification populates the in-app inbox + drives email reminders
  // for any other financial-visible stakeholders beyond the primary client.
  // Per-recipient try/catch → Sentry, never re-throws (ADR-033).
  await dispatchQuoteOrInvoiceNotification({
    eventType: 'quote.sent',
    orgId: ctx.orgId,
    projectId: doc.projectId,
    actionName: 'sendQuote',
    payload: {
      projectId: doc.projectId,
      projectNumber,
      documentId,
      documentNumber: doc.documentNumber,
      total: Number(doc.total),
    },
  });

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action: 'update',
    resourceType: 'document',
    resourceId: documentId,
    metadata: {
      project_id: doc.projectId,
      transition: 'draft_to_sent',
      document_number: doc.documentNumber,
    },
  });

  revalidatePath(`/dashboard/projects/${doc.projectId}`, 'layout');
  return { success: true, data: { token: mintedToken } };
}

// ────────────────────────────────────────────────────────────────────────────
// acceptQuote — token-authorized public write (ADR-034).
//
// No requireOrgUser. The token is the gate. The action runs through the
// Drizzle pooler (postgres role bypasses RLS); the documents_update_org_members
// policy doesn't apply. Idempotent: a second accept on the same already-
// accepted quote returns success without modifying the row.

export async function acceptQuote(
  input: unknown,
): Promise<DocumentActionResult<{ documentId: string; alreadyAccepted: boolean }>> {
  const parsed = AcceptQuoteInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { token, acceptedByName } = parsed.data;

  // Rate limit by IP via the publicDoc limiter (lib/ratelimit.ts). Falls back
  // to a per-token bucket if the IP header is missing (e.g. test contexts).
  try {
    const h = await headers();
    const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? `token:${token}`;
    const rl = await rateLimit('publicDoc', ip);
    if (rl.limited) {
      return { error: 'rate_limited', reason: `retry_after_${rl.retryAfterSec}s` };
    }
  } catch {
    // `headers()` can throw if invoked outside a request context (e.g. unit
    // tests). Skip rate-limiting in that case — the test harness drives
    // controlled inputs.
  }

  // Resolve token. Must exist AND match document_type='quote'. The pooler
  // bypasses RLS so an unauthenticated public-route caller resolves correctly.
  const tokenRows = await db
    .select({
      tokenId: documentTokens.id,
      documentId: documentTokens.documentId,
      documentType: documentTokens.documentType,
    })
    .from(documentTokens)
    .where(eq(documentTokens.token, token))
    .limit(1);
  if (tokenRows.length === 0 || tokenRows[0].documentType !== 'quote') {
    return { error: 'not_found', reason: 'token' };
  }
  const documentId = tokenRows[0].documentId;

  const docRows = await db
    .select({
      id: documents.id,
      orgId: documents.orgId,
      projectId: documents.projectId,
      status: documents.status,
      acceptedAt: documents.acceptedAt,
      documentNumber: documents.documentNumber,
    })
    .from(documents)
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
    .limit(1);
  if (docRows.length === 0) return { error: 'not_found', reason: 'document' };
  const doc = docRows[0];

  if (doc.status === 'draft' || doc.status === 'void') {
    return { error: 'conflict', reason: `cannot_accept_${doc.status}` };
  }

  // Idempotent no-op: already accepted → return success without mutation.
  if (doc.acceptedAt !== null) {
    return { success: true, data: { documentId, alreadyAccepted: true } };
  }

  const projectRows = await db
    .select({ projectNumber: projects.projectNumber })
    .from(projects)
    .where(eq(projects.id, doc.projectId))
    .limit(1);
  const projectNumber = projectRows[0]?.projectNumber ?? '';

  try {
    await db.transaction(async (tx) => {
      // Belt-and-braces idempotency: WHERE accepted_at IS NULL. If a parallel
      // request snuck through between the check above and this UPDATE, the
      // second writer's UPDATE affects 0 rows and we return alreadyAccepted.
      await tx
        .update(documents)
        .set({ acceptedAt: new Date(), acceptedByName })
        .where(and(eq(documents.id, documentId), isNull(documents.acceptedAt)));

      await logActivityTx(tx, {
        projectId: doc.projectId,
        actorType: 'client', // ADR-034 — token-authorized, no auth.uid identity
        actorId: null,
        eventType: 'quote.accepted',
        payload: {
          projectId: doc.projectId,
          projectNumber,
          documentId,
          documentNumber: doc.documentNumber,
          acceptedByName,
        },
        visibleToStakeholders: true,
      });
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { error: 'internal_error', reason: `accept_quote:${reason}` };
  }

  // DEBT-064: post-commit dispatchNotification for quote.accepted. The
  // accepting client is identified only by `accepted_by_name` (no auth.uid
  // per ADR-034) — recipient fan-out is org members + accepted financial-
  // visible stakeholders. The latter may include the client who just hit
  // Accept (we can't exclude them — there's no actor_id); the dispatcher
  // doesn't double-count rows and the redundancy is acceptable.
  await dispatchQuoteOrInvoiceNotification({
    eventType: 'quote.accepted',
    orgId: doc.orgId,
    projectId: doc.projectId,
    actionName: 'acceptQuote',
    payload: {
      projectId: doc.projectId,
      projectNumber,
      documentId,
      documentNumber: doc.documentNumber,
      acceptedByName,
    },
  });

  await logAudit({
    orgId: doc.orgId,
    // No userId — actor is the token-bearing public caller. Per ADR-034 the
    // accepted_by_name on the document row is the durable identity record.
    action: 'update',
    resourceType: 'document',
    resourceId: documentId,
    metadata: {
      project_id: doc.projectId,
      transition: 'accepted',
      accepted_by_name: acceptedByName,
      via: 'public_token',
    },
  });

  revalidatePath(`/dashboard/projects/${doc.projectId}`, 'layout');
  revalidatePath(`/q/${token}`, 'page');
  return { success: true, data: { documentId, alreadyAccepted: false } };
}

// ────────────────────────────────────────────────────────────────────────────
// Shared post-commit dispatch helper for quote/invoice events. Reused by
// sendQuote / acceptQuote (DEBT-064 wiring) and sendInvoice. Recipients are
// org members + accepted stakeholders with can_view_financials=true (the §14
// gate). Per-recipient try/catch → Sentry, never re-throws (ADR-033).
//
// Not exported — these actions are the only callers; widening the surface
// would invite drift. recordPayment / correctPayment use a slightly different
// shape (correctPayment is org-only) and inline their own resolution.

async function dispatchQuoteOrInvoiceNotification(opts: {
  eventType: 'quote.sent' | 'quote.accepted' | 'invoice.sent' | 'invoice.revised';
  orgId: string;
  projectId: string;
  actionName: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const { eventType, orgId, projectId, actionName, payload } = opts;

  const orgMembers = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.orgId, orgId), isNull(users.deletedAt)));

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

// ────────────────────────────────────────────────────────────────────────────
// Phase 2 Session 13 — invoice lifecycle. createInvoice / updateInvoiceDraft /
// sendInvoice mirror the Session 12 quote pattern. reviseInvoice ports V1's
// "mutable row + revision log" approach: status stays at 'sent', the row
// mutates in place, and revision_log_payload appends one entry per call.
//
// Key decision (locked in the four-decision table, Q1):
//   - createInvoice with subtype='initial' allows NO accepted quote (deposit
//     / mobilisation flow).
//   - createInvoice with subtype='final'  REQUIRES an accepted quote;
//     otherwise returns {error:'conflict', reason:'no_accepted_quote'}.
//
// reviseInvoice uses semantic diff (lib/documents/revise-diff.ts) — a no-op
// resave returns {error:'conflict', reason:'no_changes'} rather than logging
// a phantom revision.

const InvoiceSubtypeSchema = z.enum(['initial', 'final']);

const CreateInvoiceInput = z.object({
  projectId: z.string().uuid(),
  subtype: InvoiceSubtypeSchema,
  lineItems: z.array(LineItemSchema).min(1),
  discountPct: z.number().min(0).max(100).default(0),
  vatApplicable: z.boolean().default(false),
});

const UpdateInvoiceDraftInput = z.object({
  documentId: z.string().uuid(),
  subtype: InvoiceSubtypeSchema.optional(),
  lineItems: z.array(LineItemSchema).min(1).optional(),
  discountPct: z.number().min(0).max(100).optional(),
  vatApplicable: z.boolean().optional(),
});

const ReviseInvoiceInput = z.object({
  documentId: z.string().uuid(),
  subtype: InvoiceSubtypeSchema.optional(),
  lineItems: z.array(LineItemSchema).min(1).optional(),
  discountPct: z.number().min(0).max(100).optional(),
  vatApplicable: z.boolean().optional(),
  reason: z.string().trim().min(1).max(500),
});

// Helper — fetch the latest accepted quote's total for a project. Returns
// null when no accepted quote exists. Used by createInvoice's final-subtype
// precondition. Reads through the pooler (RLS bypass — caller is already
// org-authenticated via requireOrgUser).
async function getProjectAcceptedQuoteTotal(
  projectId: string,
): Promise<number | null> {
  const rows = await db
    .select({ total: documents.total, acceptedAt: documents.acceptedAt })
    .from(documents)
    .where(
      and(
        eq(documents.projectId, projectId),
        eq(documents.type, 'quote'),
        isNotNull(documents.acceptedAt),
        isNull(documents.deletedAt),
      ),
    );
  if (rows.length === 0) return null;
  // Most-recently-accepted wins if there are multiple (revised quote chain).
  rows.sort((a, b) => {
    const at = a.acceptedAt ? a.acceptedAt.getTime() : 0;
    const bt = b.acceptedAt ? b.acceptedAt.getTime() : 0;
    return bt - at;
  });
  return Number(rows[0].total);
}

// ────────────────────────────────────────────────────────────────────────────
// createInvoice — surveyor drafts an invoice (initial or final).

export async function createInvoice(
  input: unknown,
): Promise<
  DocumentActionResult<{ documentId: string; documentNumber: string }>
> {
  let ctx: Awaited<ReturnType<typeof requireOrgUser>>;
  try {
    ctx = await requireOrgUser();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = CreateInvoiceInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { projectId, subtype, lineItems, discountPct, vatApplicable } = parsed.data;

  // Project resolution: org-scoped, not soft-deleted.
  const projectRows = await db
    .select({ orgId: projects.orgId })
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  if (projectRows.length === 0 || projectRows[0].orgId !== ctx.orgId) {
    return { error: 'not_found', reason: 'project' };
  }

  // Decision Q1 — final invoices require an accepted quote; initial doesn't.
  if (subtype === 'final') {
    const acceptedTotal = await getProjectAcceptedQuoteTotal(projectId);
    if (acceptedTotal === null) {
      return { error: 'conflict', reason: 'no_accepted_quote' };
    }
  }

  const totals = calculateTotals({
    lineItems: lineItems as LineItem[],
    discountPct,
    vatApplicable,
  });

  const documentId = uuidv7();
  let documentNumber: string;
  try {
    const result = await db.transaction(async (tx) => {
      const allocated = await allocateDocumentNumber({
        tx,
        projectId,
        type: 'invoice',
      });

      await tx.insert(documents).values({
        id: documentId,
        orgId: ctx.orgId,
        projectId,
        type: 'invoice',
        invoiceSubtype: subtype,
        status: 'draft',
        documentNumber: allocated.documentNumber,
        sequence: allocated.sequence,
        lineItems: lineItems as LineItem[],
        discountPct,
        vatApplicable,
        subtotal: totals.subtotal,
        vatAmount: totals.vatAmount,
        total: totals.total,
        createdBy: ctx.userId,
      });

      return { documentNumber: allocated.documentNumber };
    });
    documentNumber = result.documentNumber;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { error: 'internal_error', reason: `create_invoice:${reason}` };
  }

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action: 'create',
    resourceType: 'document',
    resourceId: documentId,
    metadata: {
      project_id: projectId,
      type: 'invoice',
      invoice_subtype: subtype,
      document_number: documentNumber,
      total: totals.total,
    },
  });

  revalidatePath(`/dashboard/projects/${projectId}`, 'layout');
  return { success: true, data: { documentId, documentNumber } };
}

// ────────────────────────────────────────────────────────────────────────────
// updateInvoiceDraft — surveyor edits a draft invoice.

export async function updateInvoiceDraft(
  input: unknown,
): Promise<DocumentActionResult> {
  let ctx: Awaited<ReturnType<typeof requireOrgUser>>;
  try {
    ctx = await requireOrgUser();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = UpdateInvoiceDraftInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { documentId, subtype, lineItems, discountPct, vatApplicable } = parsed.data;

  const rows = await db
    .select({
      id: documents.id,
      projectId: documents.projectId,
      orgId: documents.orgId,
      status: documents.status,
      type: documents.type,
      currentInvoiceSubtype: documents.invoiceSubtype,
      currentLineItems: documents.lineItems,
      currentDiscountPct: documents.discountPct,
      currentVatApplicable: documents.vatApplicable,
    })
    .from(documents)
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
    .limit(1);

  if (rows.length === 0 || rows[0].orgId !== ctx.orgId) {
    return { error: 'not_found', reason: 'document' };
  }
  const row = rows[0];
  if (row.type !== 'invoice') {
    return { error: 'conflict', reason: 'not_an_invoice' };
  }
  if (row.status !== 'draft') {
    return { error: 'conflict', reason: 'not_draft' };
  }

  // If subtype is changing to 'final', enforce the accepted-quote precondition
  // (mirrors createInvoice's Q1 decision).
  if (subtype === 'final' && row.currentInvoiceSubtype !== 'final') {
    const acceptedTotal = await getProjectAcceptedQuoteTotal(row.projectId);
    if (acceptedTotal === null) {
      return { error: 'conflict', reason: 'no_accepted_quote' };
    }
  }

  const nextSubtype =
    subtype !== undefined ? subtype : (row.currentInvoiceSubtype as 'initial' | 'final' | null);
  const nextLineItems =
    lineItems !== undefined
      ? (lineItems as LineItem[])
      : (row.currentLineItems as LineItem[]);
  const nextDiscountPct =
    discountPct !== undefined ? discountPct : Number(row.currentDiscountPct);
  const nextVatApplicable =
    vatApplicable !== undefined ? vatApplicable : row.currentVatApplicable;

  const totals = calculateTotals({
    lineItems: nextLineItems,
    discountPct: nextDiscountPct,
    vatApplicable: nextVatApplicable,
  });

  await db
    .update(documents)
    .set({
      invoiceSubtype: nextSubtype,
      lineItems: nextLineItems,
      discountPct: nextDiscountPct,
      vatApplicable: nextVatApplicable,
      subtotal: totals.subtotal,
      vatAmount: totals.vatAmount,
      total: totals.total,
    })
    .where(eq(documents.id, documentId));

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action: 'update',
    resourceType: 'document',
    resourceId: documentId,
    metadata: {
      project_id: row.projectId,
      total: totals.total,
      fields: [
        'invoice_subtype',
        'line_items',
        'discount_pct',
        'vat_applicable',
        'subtotal',
        'vat_amount',
        'total',
      ],
    },
  });

  revalidatePath(`/dashboard/projects/${row.projectId}`, 'layout');
  return { success: true };
}

// ────────────────────────────────────────────────────────────────────────────
// sendInvoice — draft → sent, mint token, email client, dispatch notifications.

export async function sendInvoice(
  input: unknown,
): Promise<DocumentActionResult<{ token: string }>> {
  let ctx: Awaited<ReturnType<typeof requireOrgUser>>;
  try {
    ctx = await requireOrgUser();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = DocumentIdInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { documentId } = parsed.data;

  const docRows = await db
    .select({
      id: documents.id,
      orgId: documents.orgId,
      projectId: documents.projectId,
      status: documents.status,
      type: documents.type,
      invoiceSubtype: documents.invoiceSubtype,
      documentNumber: documents.documentNumber,
      total: documents.total,
    })
    .from(documents)
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
    .limit(1);

  if (docRows.length === 0 || docRows[0].orgId !== ctx.orgId) {
    return { error: 'not_found', reason: 'document' };
  }
  const doc = docRows[0];
  if (doc.type !== 'invoice') return { error: 'conflict', reason: 'not_an_invoice' };
  if (doc.status !== 'draft') return { error: 'conflict', reason: 'not_draft' };
  if (doc.invoiceSubtype !== 'initial' && doc.invoiceSubtype !== 'final') {
    // Defensive — createInvoice forces a subtype, but reject if drift sneaks in.
    return { error: 'conflict', reason: 'invoice_subtype_missing' };
  }

  const projectRows = await db
    .select({ projectNumber: projects.projectNumber })
    .from(projects)
    .where(eq(projects.id, doc.projectId))
    .limit(1);
  const projectNumber = projectRows[0]?.projectNumber ?? '';

  const tokenId = uuidv7();
  let mintedToken: string;
  try {
    const result = await db.transaction(async (tx) => {
      await tx
        .update(documents)
        .set({ status: 'sent', sentAt: new Date() })
        .where(eq(documents.id, documentId));

      const [insertedToken] = await tx
        .insert(documentTokens)
        .values({ id: tokenId, documentId, documentType: 'invoice' })
        .returning({ token: documentTokens.token });

      await logActivityTx(tx, {
        projectId: doc.projectId,
        actorType: 'user',
        actorId: ctx.userId,
        eventType: 'invoice.sent',
        payload: {
          projectId: doc.projectId,
          projectNumber,
          documentId,
          documentNumber: doc.documentNumber,
          invoiceSubtype: doc.invoiceSubtype,
          total: Number(doc.total),
        },
        visibleToStakeholders: true,
      });

      return { token: insertedToken.token };
    });
    mintedToken = result.token;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { error: 'internal_error', reason: `send_invoice:${reason}` };
  }

  // Post-commit: direct Resend email to the primary client. Same shape as
  // sendQuote — sees the /i/[token] public link in the email.
  try {
    const recipientRows = await db
      .select({ email: clients.email, name: clients.name })
      .from(projectStakeholders)
      .innerJoin(clients, eq(clients.id, projectStakeholders.clientId))
      .where(
        and(
          eq(projectStakeholders.projectId, doc.projectId),
          eq(projectStakeholders.role, 'primary_client'),
          isNotNull(projectStakeholders.acceptedAt),
          isNull(projectStakeholders.deletedAt),
          isNull(clients.deletedAt),
        ),
      )
      .limit(1);

    if (recipientRows.length > 0) {
      const recipient = recipientRows[0];
      const viewUrl = `${getAppUrl()}/i/${mintedToken}`;
      const rendered = invoiceSentEmail({
        invoiceNumber: doc.documentNumber,
        subtype: doc.invoiceSubtype as 'initial' | 'final',
        total: Number(doc.total),
        viewUrl,
      });
      await sendEmail({
        to: recipient.email,
        subject: rendered.subject,
        html: rendered.html,
        template: 'invoice-sent',
        orgId: ctx.orgId,
      });
    }
  } catch (err) {
    Sentry.captureException(err, {
      tags: {
        scope: 'notification_dispatch',
        action: 'sendInvoice',
        event_type: 'invoice.sent',
        org_id: ctx.orgId,
      },
      extra: { documentId, projectId: doc.projectId },
    });
  }

  // Post-commit: dispatchNotification fan-out (org + financial-visible
  // stakeholders) per ADR-033.
  await dispatchQuoteOrInvoiceNotification({
    eventType: 'invoice.sent',
    orgId: ctx.orgId,
    projectId: doc.projectId,
    actionName: 'sendInvoice',
    payload: {
      projectId: doc.projectId,
      projectNumber,
      documentId,
      documentNumber: doc.documentNumber,
      invoiceSubtype: doc.invoiceSubtype,
      total: Number(doc.total),
    },
  });

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action: 'update',
    resourceType: 'document',
    resourceId: documentId,
    metadata: {
      project_id: doc.projectId,
      transition: 'draft_to_sent',
      document_number: doc.documentNumber,
      invoice_subtype: doc.invoiceSubtype,
    },
  });

  revalidatePath(`/dashboard/projects/${doc.projectId}`, 'layout');
  return { success: true, data: { token: mintedToken } };
}

// ────────────────────────────────────────────────────────────────────────────
// reviseInvoice — V1 port. Mutates a SENT invoice in place; appends a
// revision_log_payload entry. Drafts are edited via updateInvoiceDraft;
// reviseInvoice rejects non-sent statuses with {conflict, not_sent}.
//
// Semantic diff (lib/documents/revise-diff.ts) prevents phantom log entries
// from no-op resaves. If nothing actually changed, returns
// {error:'conflict', reason:'no_changes'}.

export async function reviseInvoice(
  input: unknown,
): Promise<DocumentActionResult<{ revisionNumber: number; fieldsChanged: string[] }>> {
  let ctx: Awaited<ReturnType<typeof requireOrgUser>>;
  try {
    ctx = await requireOrgUser();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = ReviseInvoiceInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { documentId, subtype, lineItems, discountPct, vatApplicable, reason } = parsed.data;

  const rows = await db
    .select({
      id: documents.id,
      orgId: documents.orgId,
      projectId: documents.projectId,
      status: documents.status,
      type: documents.type,
      currentInvoiceSubtype: documents.invoiceSubtype,
      currentLineItems: documents.lineItems,
      currentDiscountPct: documents.discountPct,
      currentVatApplicable: documents.vatApplicable,
      currentTotal: documents.total,
      currentRevisionNumber: documents.revisionNumber,
      currentRevisionLog: documents.revisionLogPayload,
      documentNumber: documents.documentNumber,
    })
    .from(documents)
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
    .limit(1);

  if (rows.length === 0 || rows[0].orgId !== ctx.orgId) {
    return { error: 'not_found', reason: 'document' };
  }
  const row = rows[0];
  if (row.type !== 'invoice') return { error: 'conflict', reason: 'not_an_invoice' };
  if (row.status !== 'sent') return { error: 'conflict', reason: 'not_sent' };

  const prevSubtype =
    (row.currentInvoiceSubtype as 'initial' | 'final' | null) ?? null;
  const nextSubtype =
    subtype !== undefined ? subtype : prevSubtype;
  const nextLineItems =
    lineItems !== undefined
      ? (lineItems as LineItem[])
      : (row.currentLineItems as LineItem[]);
  const nextDiscountPct =
    discountPct !== undefined ? discountPct : Number(row.currentDiscountPct);
  const nextVatApplicable =
    vatApplicable !== undefined ? vatApplicable : row.currentVatApplicable;

  // Final-subtype guard: if revising INTO 'final', the project must have an
  // accepted quote (mirrors createInvoice / updateInvoiceDraft).
  if (nextSubtype === 'final' && prevSubtype !== 'final') {
    const acceptedTotal = await getProjectAcceptedQuoteTotal(row.projectId);
    if (acceptedTotal === null) {
      return { error: 'conflict', reason: 'no_accepted_quote' };
    }
  }

  // Semantic diff — see lib/documents/revise-diff.ts. A no-op resave (same
  // semantic content as the current row, possibly with re-serialised JSONB)
  // rejects with conflict/no_changes rather than incrementing revision_number.
  const diff = diffInvoiceFields(
    {
      lineItems: row.currentLineItems as LineItem[],
      discountPct: Number(row.currentDiscountPct),
      vatApplicable: row.currentVatApplicable,
      invoiceSubtype: prevSubtype,
    },
    {
      lineItems: nextLineItems,
      discountPct: nextDiscountPct,
      vatApplicable: nextVatApplicable,
      invoiceSubtype: nextSubtype,
    },
  );
  if (!diff.hasChanges) {
    return { error: 'conflict', reason: 'no_changes' };
  }

  const totals = calculateTotals({
    lineItems: nextLineItems,
    discountPct: nextDiscountPct,
    vatApplicable: nextVatApplicable,
  });

  const newRevisionNumber = Number(row.currentRevisionNumber) + 1;
  const previousTotal = Number(row.currentTotal);
  const revisionEntry = {
    rev: newRevisionNumber,
    previous_amount: previousTotal,
    new_amount: totals.total,
    fields_changed: diff.fieldsChanged,
    reason,
    revised_at: new Date().toISOString(),
    revised_by: ctx.userId,
  };
  const existingLog = Array.isArray(row.currentRevisionLog)
    ? (row.currentRevisionLog as unknown[])
    : [];
  const nextLog = [...existingLog, revisionEntry];

  const projectRows = await db
    .select({ projectNumber: projects.projectNumber })
    .from(projects)
    .where(eq(projects.id, row.projectId))
    .limit(1);
  const projectNumber = projectRows[0]?.projectNumber ?? '';

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(documents)
        .set({
          invoiceSubtype: nextSubtype,
          lineItems: nextLineItems,
          discountPct: nextDiscountPct,
          vatApplicable: nextVatApplicable,
          subtotal: totals.subtotal,
          vatAmount: totals.vatAmount,
          total: totals.total,
          revisionNumber: newRevisionNumber,
          revisionLogPayload: nextLog,
        })
        .where(eq(documents.id, documentId));

      await logActivityTx(tx, {
        projectId: row.projectId,
        actorType: 'user',
        actorId: ctx.userId,
        eventType: 'invoice.revised',
        payload: {
          projectId: row.projectId,
          projectNumber,
          documentId,
          documentNumber: row.documentNumber,
          revisionNumber: newRevisionNumber,
          previousAmount: previousTotal,
          newAmount: totals.total,
          fieldsChanged: diff.fieldsChanged,
          reason,
        },
        visibleToStakeholders: true,
      });
    });
  } catch (e) {
    const errReason = e instanceof Error ? e.message : String(e);
    return { error: 'internal_error', reason: `revise_invoice:${errReason}` };
  }

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action: 'update',
    resourceType: 'document',
    resourceId: documentId,
    metadata: {
      project_id: row.projectId,
      revise: {
        rev: newRevisionNumber,
        previous_amount: previousTotal,
        new_amount: totals.total,
        fields_changed: diff.fieldsChanged,
        reason,
      },
    },
  });

  // Note: no notification dispatch on revise this session. The activity row
  // is the canonical record; future UX may opt in to a per-org "notify clients
  // on invoice revision" toggle, at which point a dispatchQuoteOrInvoiceNotification
  // call goes here.

  // Session 14: invalidate the cached PDF so the next download regenerates
  // from the post-revise state. Soft-delete only, post-commit, best-effort.
  try {
    await invalidateDocumentPdfCache(documentId);
  } catch (err) {
    Sentry.captureException(err, {
      tags: { scope: 'pdf_cache_invalidate', action: 'reviseInvoice' },
      extra: { documentId },
    });
  }

  revalidatePath(`/dashboard/projects/${row.projectId}`, 'layout');
  return {
    success: true,
    data: { revisionNumber: newRevisionNumber, fieldsChanged: diff.fieldsChanged },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// reviseReceipt — Phase 2 Session 14.
//
// Receipts have a narrower revise surface than invoices: the only mutable
// field is `recipient_name`. Money values mirror the linked payment in
// lockstep (correctPayment is the canonical path for changing an amount).
//
// Mirrors reviseInvoice's revision-log mechanism — one entry appended per
// call: { rev, previous_amount, new_amount, fields_changed, reason,
// revised_at, revised_by }. previous_amount/new_amount are unchanged for a
// recipient-only revise; the "field changed" is `recipient_name`. Diff is
// computed inline (no need for the full diffInvoiceFields machinery).
//
// Like reviseInvoice: status='sent' precondition. No-op rejection (same
// recipient text) returns conflict/no_changes. PDF cache invalidated post-
// commit.

const ReviseReceiptInput = z.object({
  documentId: z.string().uuid(),
  recipientName: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(1).max(500),
});

export async function reviseReceipt(
  input: unknown,
): Promise<DocumentActionResult<{ revisionNumber: number; fieldsChanged: string[] }>> {
  let ctx: Awaited<ReturnType<typeof requireOrgUser>>;
  try {
    ctx = await requireOrgUser();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = ReviseReceiptInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { documentId, recipientName, reason } = parsed.data;

  const rows = await db
    .select({
      id: documents.id,
      orgId: documents.orgId,
      projectId: documents.projectId,
      status: documents.status,
      type: documents.type,
      currentRecipientName: documents.recipientName,
      currentTotal: documents.total,
      currentRevisionNumber: documents.revisionNumber,
      currentRevisionLog: documents.revisionLogPayload,
      documentNumber: documents.documentNumber,
    })
    .from(documents)
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
    .limit(1);

  if (rows.length === 0 || rows[0].orgId !== ctx.orgId) {
    return { error: 'not_found', reason: 'document' };
  }
  const row = rows[0];
  if (row.type !== 'receipt') return { error: 'conflict', reason: 'not_a_receipt' };
  if (row.status !== 'sent') return { error: 'conflict', reason: 'not_sent' };

  const prevRecipient = row.currentRecipientName?.trim() ?? '';
  const nextRecipient = recipientName.trim();
  if (prevRecipient === nextRecipient) {
    return { error: 'conflict', reason: 'no_changes' };
  }

  const newRevisionNumber = Number(row.currentRevisionNumber) + 1;
  const previousTotal = Number(row.currentTotal);
  const revisionEntry = {
    rev: newRevisionNumber,
    previous_amount: previousTotal,
    new_amount: previousTotal,
    fields_changed: ['recipientName'],
    reason,
    revised_at: new Date().toISOString(),
    revised_by: ctx.userId,
    previous_recipient_name: prevRecipient || null,
    new_recipient_name: nextRecipient,
  };
  const existingLog = Array.isArray(row.currentRevisionLog)
    ? (row.currentRevisionLog as unknown[])
    : [];
  const nextLog = [...existingLog, revisionEntry];

  const projectRows = await db
    .select({ projectNumber: projects.projectNumber })
    .from(projects)
    .where(eq(projects.id, row.projectId))
    .limit(1);
  const projectNumber = projectRows[0]?.projectNumber ?? '';

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(documents)
        .set({
          recipientName: nextRecipient,
          revisionNumber: newRevisionNumber,
          revisionLogPayload: nextLog,
        })
        .where(eq(documents.id, documentId));

      await logActivityTx(tx, {
        projectId: row.projectId,
        actorType: 'user',
        actorId: ctx.userId,
        eventType: 'receipt.revised',
        payload: {
          projectId: row.projectId,
          projectNumber,
          receiptId: documentId,
          receiptNumber: row.documentNumber,
          revisionNumber: newRevisionNumber,
          fieldsChanged: ['recipientName'],
          reason,
        },
        // Per Q3 pattern: org-internal change. The receipt's amount didn't
        // change; only the recipient label. Leave portal timeline quiet.
        visibleToStakeholders: false,
      });
    });
  } catch (e) {
    const errReason = e instanceof Error ? e.message : String(e);
    return { error: 'internal_error', reason: `revise_receipt:${errReason}` };
  }

  await logAudit({
    orgId: ctx.orgId,
    userId: ctx.userId,
    action: 'update',
    resourceType: 'document',
    resourceId: documentId,
    metadata: {
      project_id: row.projectId,
      revise: {
        rev: newRevisionNumber,
        fields_changed: ['recipientName'],
        previous_recipient_name: prevRecipient || null,
        new_recipient_name: nextRecipient,
        reason,
      },
    },
  });

  // Invalidate cached PDF so the next download reflects the new recipient.
  try {
    await invalidateDocumentPdfCache(documentId);
  } catch (err) {
    Sentry.captureException(err, {
      tags: { scope: 'pdf_cache_invalidate', action: 'reviseReceipt' },
      extra: { documentId },
    });
  }

  revalidatePath(`/dashboard/projects/${row.projectId}`, 'layout');
  return {
    success: true,
    data: { revisionNumber: newRevisionNumber, fieldsChanged: ['recipientName'] },
  };
}
