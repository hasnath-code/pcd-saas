import 'server-only';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import {
  documentTokens,
  documents,
  organizations,
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
// can_view_financials=true (this session does not yet wire a portal-side
// caller, but the flag is in the signature from day one for Session 13/14).
//
// Org-side callers pass `visibleOnly: false`.

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
    createdBy: r.createdBy as string,
    createdByName: (r.createdByName as string | null) ?? null,
    createdAt: r.createdAt as Date,
  };
}

/**
 * List quotes for a project, newest first, soft-deleted rows excluded.
 * `visibleOnly` is REQUIRED — see file header for why.
 *
 * When `visibleOnly=true`, callers must also pass an authenticated stakeholder
 * context — but no portal-side caller exists yet (Phase 2 Session 12 ships
 * only the org-side list). The flag stays in the signature for forward
 * compatibility; when `true`, the query short-circuits to `[]` until a
 * portal-side caller wires the stakeholder identity check (Session 13/14).
 */
export async function listQuotesForProject(opts: {
  projectId: string;
  visibleOnly: boolean;
}): Promise<DocumentRow[]> {
  if (opts.visibleOnly) {
    // Portal-side surface not yet built. Returning [] is a safe default —
    // a future caller will pass identity and unlock the can_view_financials
    // branch.
    return [];
  }

  const rows = await db
    .select(documentColumns)
    .from(documents)
    .leftJoin(users, eq(users.id, documents.createdBy))
    .where(
      and(
        eq(documents.projectId, opts.projectId),
        eq(documents.type, 'quote'),
        isNull(documents.deletedAt),
      ),
    )
    .orderBy(desc(documents.createdAt));

  return rows.map((r) => toDocumentRow(r as Record<string, unknown>));
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
