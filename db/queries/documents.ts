import 'server-only';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { db } from '@/db';
import {
  clients,
  documentTokens,
  documents,
  organizations,
  projectStakeholders,
  projects,
  users,
} from '@/db/schema';
import type { LineItem } from '@/lib/documents/vat';

// Phase 2 §2 — SSR data fetches for documents.
//
// Server-side visibility filter (mirrors DEBT-059 / db/queries/files.ts /
// db/queries/project-activity.ts):
// ==================================================================
// `db` is the Drizzle pooler client (postgres role) which BYPASSES RLS.
// `visibleOnly` is REQUIRED on stakeholder-reachable queries — the RLS
// policy from 0023 is still the canonical DB-boundary gate when the query
// is routed through the Supabase REST client, but org-side queries via the
// pooler must replicate the gate explicitly.
//
// For documents the "visible to stakeholder" branch is gated by
// project_stakeholders.can_view_financials. When `visibleOnly=true` the
// query verifies the caller is an accepted stakeholder with
// can_view_financials=true (Session 14: wired). The portal-side page
// gates UI on view.flags.canViewFinancials and only calls these queries
// when true; the query layer enforces defense-in-depth via
// hasStakeholderFinancialAccess so a buggy caller can't leak rows.
//
// Org-side callers pass `visibleOnly: false`. Portal-side callers pass
// `visibleOnly: true` AND `stakeholderAuthUserId` (the auth.uid() of the
// caller). When visibleOnly=true and the auth user is not a financial-
// visible stakeholder, the query returns []. Without stakeholderAuthUserId
// the query returns [] (safe default — the S13 short-circuit behavior).

export type DocumentStatus = 'draft' | 'sent' | 'superseded' | 'void';
export type DocumentType = 'quote' | 'invoice' | 'receipt';

export interface DocumentRow {
  id: string;
  orgId: string;
  projectId: string;
  type: DocumentType;
  status: DocumentStatus;
  documentNumber: string;
  sequence: number;
  lineItems: LineItem[];
  discountPct: number;
  vatApplicable: boolean;
  subtotal: number;
  vatAmount: number;
  total: number;
  currency: string;
  sentAt: Date | null;
  acceptedAt: Date | null;
  acceptedByName: string | null;
  supersedesDocumentId: string | null;
  // Phase 2 Session 13 additive columns. Always present in the row shape
  // since the query columns include them; quote rows carry invoiceSubtype=null
  // and revisionNumber=0 / revisionLogPayload=[].
  invoiceSubtype: 'initial' | 'final' | null;
  revisionNumber: number;
  revisionLogPayload: unknown[];
  paymentId: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: Date;
}

const documentColumns = {
  id: documents.id,
  orgId: documents.orgId,
  projectId: documents.projectId,
  type: documents.type,
  status: documents.status,
  documentNumber: documents.documentNumber,
  sequence: documents.sequence,
  lineItems: documents.lineItems,
  discountPct: documents.discountPct,
  vatApplicable: documents.vatApplicable,
  subtotal: documents.subtotal,
  vatAmount: documents.vatAmount,
  total: documents.total,
  currency: documents.currency,
  sentAt: documents.sentAt,
  acceptedAt: documents.acceptedAt,
  acceptedByName: documents.acceptedByName,
  supersedesDocumentId: documents.supersedesDocumentId,
  invoiceSubtype: documents.invoiceSubtype,
  revisionNumber: documents.revisionNumber,
  revisionLogPayload: documents.revisionLogPayload,
  paymentId: documents.paymentId,
  createdBy: documents.createdBy,
  createdByName: users.name,
  createdAt: documents.createdAt,
};

function toDocumentRow(r: Record<string, unknown>): DocumentRow {
  return {
    id: r.id as string,
    orgId: r.orgId as string,
    projectId: r.projectId as string,
    type: r.type as DocumentType,
    status: r.status as DocumentStatus,
    documentNumber: r.documentNumber as string,
    sequence: r.sequence as number,
    lineItems: (r.lineItems as LineItem[]) ?? [],
    discountPct: Number(r.discountPct),
    vatApplicable: r.vatApplicable as boolean,
    subtotal: Number(r.subtotal),
    vatAmount: Number(r.vatAmount),
    total: Number(r.total),
    currency: r.currency as string,
    sentAt: (r.sentAt as Date | null) ?? null,
    acceptedAt: (r.acceptedAt as Date | null) ?? null,
    acceptedByName: (r.acceptedByName as string | null) ?? null,
    supersedesDocumentId: (r.supersedesDocumentId as string | null) ?? null,
    invoiceSubtype:
      (r.invoiceSubtype as 'initial' | 'final' | null | undefined) ?? null,
    revisionNumber: Number(r.revisionNumber ?? 0),
    revisionLogPayload: Array.isArray(r.revisionLogPayload)
      ? (r.revisionLogPayload as unknown[])
      : [],
    paymentId: (r.paymentId as string | null) ?? null,
    createdBy: r.createdBy as string,
    createdByName: (r.createdByName as string | null) ?? null,
    createdAt: r.createdAt as Date,
  };
}

/**
 * Defense-in-depth check: does the caller have can_view_financials access
 * to this project as an accepted stakeholder? Drizzle pooler bypasses RLS
 * (DEBT-059 pattern), so this query layer enforces the §14 financial-
 * visibility gate explicitly. Returns false for non-stakeholders.
 *
 * This mirrors the SECURITY DEFINER helper auth_user_stakeholder_project_visibility(uuid).
 */
export async function hasStakeholderFinancialAccess(opts: {
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

interface ListByTypeOpts {
  projectId: string;
  visibleOnly: boolean;
  /** Required when `visibleOnly: true` — the calling stakeholder's auth.uid(). */
  stakeholderAuthUserId?: string;
}

async function listDocumentsByType(
  opts: ListByTypeOpts & { type: DocumentType },
): Promise<DocumentRow[]> {
  if (opts.visibleOnly) {
    // Defense-in-depth gate. The portal page should already check the flag
    // before calling, but the query layer enforces independently.
    if (!opts.stakeholderAuthUserId) return [];
    const ok = await hasStakeholderFinancialAccess({
      projectId: opts.projectId,
      authUserId: opts.stakeholderAuthUserId,
    });
    if (!ok) return [];
  }

  const whereClauses = [
    eq(documents.projectId, opts.projectId),
    eq(documents.type, opts.type),
    isNull(documents.deletedAt),
  ];
  // For stakeholders we hide draft+void rows — those are org-internal; only
  // sent / superseded receipts/invoices/quotes are part of the client-facing
  // record. Org-side keeps drafts visible (they're how surveyors compose).
  if (opts.visibleOnly) {
    whereClauses.push(
      // sent OR superseded — using OR via inArray-like construct
      // would inflate the SQL; explicit NOT IN (draft, void) is shortest.
      // Drizzle doesn't have a direct notIn helper for two values, so
      // chain isNotNull-like with raw is awkward — use sentAt IS NOT NULL
      // which equivalently means "has been sent at some point".
      isNotNull(documents.sentAt),
    );
  }

  const rows = await db
    .select(documentColumns)
    .from(documents)
    .leftJoin(users, eq(users.id, documents.createdBy))
    .where(and(...whereClauses))
    .orderBy(desc(documents.createdAt));

  return rows.map((r) => toDocumentRow(r as Record<string, unknown>));
}

/**
 * List quotes for a project, newest first, soft-deleted rows excluded.
 * `visibleOnly` is REQUIRED — see file header for why.
 */
export async function listQuotesForProject(
  opts: ListByTypeOpts,
): Promise<DocumentRow[]> {
  return listDocumentsByType({ ...opts, type: 'quote' });
}

/**
 * Phase 2 Session 13 — list invoices for a project, newest first. Mirrors
 * listQuotesForProject. The DocumentRow shape already carries
 * invoiceSubtype / revisionNumber / revisionLogPayload (additive Session 13
 * columns); InvoiceRow is just a semantic alias for callers that want to be
 * explicit about the doc type.
 */
export type InvoiceRow = DocumentRow;

export async function listInvoicesForProject(
  opts: ListByTypeOpts,
): Promise<InvoiceRow[]> {
  return listDocumentsByType({ ...opts, type: 'invoice' });
}

/**
 * Phase 2 Session 14 — list receipts for a project, newest first. Receipts
 * carry paymentId (non-null) so callers can join back to the linked payment
 * for the bidirectional UI link. Mirrors listInvoicesForProject's shape +
 * visibleOnly semantics.
 */
export type ReceiptRow = DocumentRow;

export async function listReceiptsForProject(
  opts: ListByTypeOpts,
): Promise<ReceiptRow[]> {
  return listDocumentsByType({ ...opts, type: 'receipt' });
}

/** Single-doc fetch for the org-side view. Returns null when soft-deleted or missing. */
export async function getDocumentById(
  id: string,
  opts?: { orgId?: string },
): Promise<DocumentRow | null> {
  const whereClauses = [eq(documents.id, id), isNull(documents.deletedAt)];
  if (opts?.orgId) whereClauses.push(eq(documents.orgId, opts.orgId));

  const rows = await db
    .select(documentColumns)
    .from(documents)
    .leftJoin(users, eq(users.id, documents.createdBy))
    .where(and(...whereClauses))
    .limit(1);

  return rows[0] ? toDocumentRow(rows[0] as Record<string, unknown>) : null;
}

/** Public-route fetch by token. No auth, no visibleOnly — the token IS the gate. */
export async function getDocumentByToken(
  token: string,
): Promise<{ document: DocumentRow; orgName: string; tokenDocumentType: string } | null> {
  // Join document_tokens → documents → projects → organizations to render
  // the public page in one query. Service-role would also work but the
  // pooler is sufficient (RLS bypass on this connection by design).
  const rows = await db
    .select({
      ...documentColumns,
      tokenDocumentType: documentTokens.documentType,
      // Avoid pulling the whole organizations row — the public page just
      // needs the display name. Could fetch full branding (logo, address)
      // later when the public template grows.
      projectOrgId: projects.orgId,
    })
    .from(documentTokens)
    .innerJoin(documents, eq(documents.id, documentTokens.documentId))
    .innerJoin(projects, eq(projects.id, documents.projectId))
    .leftJoin(users, eq(users.id, documents.createdBy))
    .where(and(eq(documentTokens.token, token), isNull(documents.deletedAt)))
    .limit(1);

  if (rows.length === 0) return null;

  const r = rows[0] as Record<string, unknown>;
  const tokenDocumentType = r.tokenDocumentType as string;

  // Resolve org name in a second query (small, one row, indexed PK lookup).
  const orgRows = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, r.orgId as string))
    .limit(1);

  return {
    document: toDocumentRow(r),
    orgName: orgRows[0]?.name ?? '',
    tokenDocumentType,
  };
}
