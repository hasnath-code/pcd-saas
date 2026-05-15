import 'server-only';
import { and, desc, eq, isNotNull, isNull, sum } from 'drizzle-orm';
import { db } from '@/db';
import {
  clients,
  documents,
  payments,
  projectStakeholders,
  users,
} from '@/db/schema';
import {
  derivePaymentStatus,
  type PaymentStatus,
} from '@/lib/documents/payment-status';

// Phase 2 §2.3 / Session 13 — payments read surface.
//
// Server-side visibility filter (mirrors DEBT-059 / db/queries/files.ts /
// db/queries/documents.ts):
// `db` is the Drizzle pooler client (postgres role) which BYPASSES RLS.
// `visibleOnly` is REQUIRED on stakeholder-reachable queries — the policies
// from 0025 are the DB-boundary gate when the query is routed through the
// Supabase REST client, but org-side queries via the pooler must replicate
// the gate explicitly. For payments the "visible to stakeholder" branch is
// project_stakeholders.can_view_financials.
//
// Session 14: visibleOnly=true is wired. Caller must also pass
// stakeholderAuthUserId; the query verifies financial-stakeholder access
// before returning rows. Without auth user, returns []/0 (safe S13 default).

export interface PaymentRow {
  id: string;
  orgId: string;
  projectId: string;
  amount: number;
  recordedBy: string;
  recordedByName: string | null;
  recordedAt: Date;
  correctionLogPayload: unknown[];
  createdAt: Date;
}

function toPaymentRow(r: Record<string, unknown>): PaymentRow {
  return {
    id: r.id as string,
    orgId: r.orgId as string,
    projectId: r.projectId as string,
    amount: Number(r.amount),
    recordedBy: r.recordedBy as string,
    recordedByName: (r.recordedByName as string | null) ?? null,
    recordedAt: r.recordedAt as Date,
    correctionLogPayload: Array.isArray(r.correctionLogPayload)
      ? (r.correctionLogPayload as unknown[])
      : [],
    createdAt: r.createdAt as Date,
  };
}

/**
 * Defense-in-depth: same shape as db/queries/documents.ts:hasStakeholderFinancialAccess
 * — keep both call sites consistent. Returns true iff the auth user is an
 * accepted stakeholder of the project with can_view_financials=true.
 */
async function hasStakeholderFinancialAccess(opts: {
  projectId: string;
  authUserId: string;
}): Promise<boolean> {
  const rows = await db
    .select({ id: projectStakeholders.id })
    .from(projectStakeholders)
    .innerJoin(clients, eq(clients.id, projectStakeholders.clientId))
    .where(
      and(
        eq(projectStakeholders.projectId, opts.projectId),
        eq(clients.authUserId, opts.authUserId),
        eq(projectStakeholders.canViewFinancials, true),
        isNotNull(projectStakeholders.acceptedAt),
        isNull(projectStakeholders.deletedAt),
        isNull(clients.deletedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * List payments for a project (newest first) + the running SUM. Soft-deleted
 * rows excluded from both.
 *
 * `visibleOnly=true` requires `stakeholderAuthUserId` for defense-in-depth
 * gating. Without auth user → []/0 (safe S13 default). With auth user → real
 * rows when financial-stakeholder access is granted, else []/0.
 */
export async function getPaymentsForProject(opts: {
  projectId: string;
  visibleOnly: boolean;
  stakeholderAuthUserId?: string;
}): Promise<{ rows: PaymentRow[]; runningTotal: number }> {
  if (opts.visibleOnly) {
    if (!opts.stakeholderAuthUserId) return { rows: [], runningTotal: 0 };
    const ok = await hasStakeholderFinancialAccess({
      projectId: opts.projectId,
      authUserId: opts.stakeholderAuthUserId,
    });
    if (!ok) return { rows: [], runningTotal: 0 };
  }

  const rows = await db
    .select({
      id: payments.id,
      orgId: payments.orgId,
      projectId: payments.projectId,
      amount: payments.amount,
      recordedBy: payments.recordedBy,
      recordedByName: users.name,
      recordedAt: payments.recordedAt,
      correctionLogPayload: payments.correctionLogPayload,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .leftJoin(users, eq(users.id, payments.recordedBy))
    .where(
      and(eq(payments.projectId, opts.projectId), isNull(payments.deletedAt)),
    )
    .orderBy(desc(payments.recordedAt));

  const totalRows = await db
    .select({ total: sum(payments.amount) })
    .from(payments)
    .where(
      and(eq(payments.projectId, opts.projectId), isNull(payments.deletedAt)),
    );

  const runningTotal = Number(totalRows[0]?.total ?? 0);

  return {
    rows: rows.map((r) => toPaymentRow(r as Record<string, unknown>)),
    runningTotal,
  };
}

/**
 * Phase 2 §4 — primitives needed by lib/documents/payment-status.ts:
 * derivePaymentStatus. One SQL roundtrip aggregates the four signals; the
 * pure function then derives the label.
 *
 * Returns the snapshot AND the derived status — callers typically want both.
 */
export interface ProjectPaymentSnapshot {
  acceptedQuoteTotal: number | null;
  hasAnyQuoteSent: boolean;
  hasInitialInvoiceSent: boolean;
  hasFinalInvoiceSent: boolean;
  paymentsTotal: number;
  status: PaymentStatus;
}

export async function getProjectPaymentSnapshot(
  projectId: string,
): Promise<ProjectPaymentSnapshot> {
  // Accepted-quote total: most-recently-accepted quote wins if multiple.
  const acceptedQuoteRows = await db
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
  let acceptedQuoteTotal: number | null = null;
  if (acceptedQuoteRows.length > 0) {
    const sorted = [...acceptedQuoteRows].sort((a, b) => {
      const at = a.acceptedAt ? a.acceptedAt.getTime() : 0;
      const bt = b.acceptedAt ? b.acceptedAt.getTime() : 0;
      return bt - at;
    });
    acceptedQuoteTotal = Number(sorted[0].total);
  }

  // hasAnyQuoteSent: at least one quote currently in status='sent'.
  const sentQuoteRows = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.projectId, projectId),
        eq(documents.type, 'quote'),
        eq(documents.status, 'sent'),
        isNull(documents.deletedAt),
      ),
    )
    .limit(1);

  // Invoice subtypes — one query, two flags.
  const sentInvoiceRows = await db
    .select({ invoiceSubtype: documents.invoiceSubtype })
    .from(documents)
    .where(
      and(
        eq(documents.projectId, projectId),
        eq(documents.type, 'invoice'),
        eq(documents.status, 'sent'),
        isNull(documents.deletedAt),
      ),
    );
  const hasInitialInvoiceSent = sentInvoiceRows.some(
    (r) => r.invoiceSubtype === 'initial',
  );
  const hasFinalInvoiceSent = sentInvoiceRows.some(
    (r) => r.invoiceSubtype === 'final',
  );

  // Payments running total.
  const paymentsTotalRows = await db
    .select({ total: sum(payments.amount) })
    .from(payments)
    .where(and(eq(payments.projectId, projectId), isNull(payments.deletedAt)));
  const paymentsTotal = Number(paymentsTotalRows[0]?.total ?? 0);

  const status = derivePaymentStatus({
    hasAnyQuoteSent: sentQuoteRows.length > 0,
    acceptedQuoteTotal,
    hasInitialInvoiceSent,
    hasFinalInvoiceSent,
    paymentsTotal,
  });

  return {
    acceptedQuoteTotal,
    hasAnyQuoteSent: sentQuoteRows.length > 0,
    hasInitialInvoiceSent,
    hasFinalInvoiceSent,
    paymentsTotal,
    status,
  };
}
