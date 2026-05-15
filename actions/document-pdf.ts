'use server';

import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { and, desc, eq, isNull } from 'drizzle-orm';
import * as Sentry from '@sentry/nextjs';
import {
  AuthError,
  requireOrgUser,
  type ServerActionErrorCode,
} from '@/lib/auth/requireAuth';
import { db } from '@/db';
import {
  documentTokens,
  documents,
  organizations,
  payments,
  projectFiles,
  projects,
} from '@/db/schema';
import { logAudit } from '@/lib/audit/log';
import { createServiceClient } from '@/lib/supabase/service';
import { renderDocumentPdf } from '@/lib/pdf/render';
import type { DocumentPdfData } from '@/lib/pdf/document-template';
import type { LineItem } from '@/lib/documents/vat';
import { rateLimit } from '@/lib/ratelimit';
import { invalidateDocumentPdfCache } from '@/lib/pdf/cache';

// Re-export so existing callers (actions/payments.ts, actions/documents.ts
// imported it from this module before Session 14 split it out) keep working.
export { invalidateDocumentPdfCache };

// Phase 2 Session 14 — generate-and-sign PDF for any documents row.
//
// Two callable surfaces share the find-or-create core:
//   1. generateDocumentPdf({ documentId })          — org-side, requireOrgUser
//   2. generateDocumentPdfFromToken({ token })      — public-side, token-gated
//      (matches the ADR-034 envelope: rate-limited, no auth, type-cross-check)
//
// Find-or-create model:
//   - Look up project_files WHERE source_document_id=docId AND deleted_at IS NULL.
//   - If found: sign a fresh download URL (1-hour TTL via createSignedUrl).
//   - If not: render the PDF to a Buffer, upload to org-files bucket, INSERT
//     project_files row with source='document_artifact' + source_document_id,
//     sign + return the URL.
//
// Cache invalidation: reviseInvoice / reviseReceipt / correctPayment soft-
// delete the cached row so the next call regenerates from the post-revise
// state. See invalidateDocumentPdfCacheTx in lib/pdf/cache.ts.
//
// Storage path: org/{orgId}/projects/{projectId}/documents/{fileId}.pdf
// Mirrors actions/files.ts:buildStoragePath shape so storage RLS in 0019
// remains the single gate.

const BUCKET = 'org-files';
const DOWNLOAD_TTL_SECONDS = 60 * 60; // 1 hour, matches actions/files.ts:DOWNLOAD_TTL_SECONDS

export type DocumentPdfResult =
  | {
      success: true;
      data: {
        downloadUrl: string;
        filename: string;
        mimeType: 'application/pdf';
        expiresInSeconds: number;
      };
    }
  | { error: ServerActionErrorCode; reason?: string };

const GenerateInput = z.object({
  documentId: z.string().uuid(),
});

const GenerateFromTokenInput = z.object({
  token: z.string().uuid(),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Org-side action ────────────────────────────────────────────────────────

export async function generateDocumentPdf(
  input: unknown,
): Promise<DocumentPdfResult> {
  let ctx: Awaited<ReturnType<typeof requireOrgUser>>;
  try {
    ctx = await requireOrgUser();
  } catch (e) {
    if (e instanceof AuthError) return { error: e.code, reason: e.message };
    throw e;
  }

  const parsed = GenerateInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { documentId } = parsed.data;

  // Org-scoped document lookup — cross-org returns not_found per the §20
  // not-leak-which-resources-exist convention.
  const docContext = await loadDocumentContext(documentId);
  if (!docContext || docContext.document.orgId !== ctx.orgId) {
    return { error: 'not_found', reason: 'document' };
  }

  return findOrCreatePdf(docContext, {
    audit: {
      orgId: ctx.orgId,
      userId: ctx.userId,
    },
  });
}

// ─── Public token-gated action (ADR-034 envelope) ──────────────────────────

export async function generateDocumentPdfFromToken(
  input: unknown,
): Promise<DocumentPdfResult> {
  const parsed = GenerateFromTokenInput.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'validation_error',
      reason: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { token } = parsed.data;
  if (!UUID_RE.test(token)) return { error: 'not_found', reason: 'token' };

  // Public rate-limit per the same publicDoc bucket as /q/ /i/ /r/. Keyed
  // by token because we don't have a request-IP context in a server action.
  try {
    const rl = await rateLimit('publicDoc', `pdf:${token}`);
    if (rl.limited) return { error: 'rate_limited', reason: 'rate_limited' };
  } catch {
    // No upstash context — proceed (matches /q/[token]'s tolerant fallback).
  }

  const tokenRows = await db
    .select({ documentId: documentTokens.documentId })
    .from(documentTokens)
    .where(eq(documentTokens.token, token))
    .limit(1);
  if (tokenRows.length === 0) return { error: 'not_found', reason: 'token' };

  const docContext = await loadDocumentContext(tokenRows[0].documentId);
  if (!docContext) return { error: 'not_found', reason: 'document' };
  if (
    docContext.document.status === 'draft' ||
    docContext.document.status === 'void'
  ) {
    return { error: 'not_found', reason: 'document_state' };
  }

  return findOrCreatePdf(docContext, {
    // Token-context: audit log records org_id but no user/client identity
    // (matches acceptQuote's `metadata.via='public_token'` pattern).
    audit: {
      orgId: docContext.document.orgId,
      via: 'public_token',
    },
  });
}

// ─── Internal: shared find-or-create core ──────────────────────────────────

interface DocumentContext {
  document: {
    id: string;
    orgId: string;
    projectId: string;
    type: 'quote' | 'invoice' | 'receipt';
    status: 'draft' | 'sent' | 'superseded' | 'void';
    documentNumber: string;
    invoiceSubtype: 'initial' | 'final' | null;
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
    revisionNumber: number;
    recipientName: string | null;
    paymentId: string | null;
  };
  projectNumber: string;
  orgName: string;
  paymentRecordedAt: Date | null;
}

async function loadDocumentContext(
  documentId: string,
): Promise<DocumentContext | null> {
  const rows = await db
    .select({
      // documents
      id: documents.id,
      orgId: documents.orgId,
      projectId: documents.projectId,
      type: documents.type,
      status: documents.status,
      documentNumber: documents.documentNumber,
      invoiceSubtype: documents.invoiceSubtype,
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
      revisionNumber: documents.revisionNumber,
      recipientName: documents.recipientName,
      paymentId: documents.paymentId,
      // project / org
      projectNumber: projects.projectNumber,
      orgName: organizations.name,
    })
    .from(documents)
    .innerJoin(projects, eq(projects.id, documents.projectId))
    .innerJoin(organizations, eq(organizations.id, documents.orgId))
    .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
    .limit(1);

  if (rows.length === 0) return null;
  const r = rows[0];

  // Receipts (and any document with a payment_id) read the linked payment's
  // recorded_at for the issue date. correctPayment doesn't change recorded_at,
  // so this is stable across corrections.
  let paymentRecordedAt: Date | null = null;
  if (r.paymentId) {
    const payRows = await db
      .select({ recordedAt: payments.recordedAt })
      .from(payments)
      .where(and(eq(payments.id, r.paymentId), isNull(payments.deletedAt)))
      .limit(1);
    paymentRecordedAt = payRows[0]?.recordedAt ?? null;
  }

  return {
    document: {
      id: r.id,
      orgId: r.orgId,
      projectId: r.projectId,
      type: r.type as 'quote' | 'invoice' | 'receipt',
      status: r.status as 'draft' | 'sent' | 'superseded' | 'void',
      documentNumber: r.documentNumber,
      invoiceSubtype: (r.invoiceSubtype as 'initial' | 'final' | null) ?? null,
      lineItems: (r.lineItems as LineItem[]) ?? [],
      discountPct: Number(r.discountPct),
      vatApplicable: r.vatApplicable,
      subtotal: Number(r.subtotal),
      vatAmount: Number(r.vatAmount),
      total: Number(r.total),
      currency: r.currency,
      sentAt: r.sentAt,
      acceptedAt: r.acceptedAt,
      acceptedByName: r.acceptedByName,
      revisionNumber: r.revisionNumber,
      recipientName: r.recipientName,
      paymentId: r.paymentId,
    },
    projectNumber: r.projectNumber,
    orgName: r.orgName,
    paymentRecordedAt,
  };
}

interface FindOrCreateOpts {
  audit:
    | { orgId: string; userId: string }
    | { orgId: string; via: 'public_token' };
}

async function findOrCreatePdf(
  ctx: DocumentContext,
  opts: FindOrCreateOpts,
): Promise<DocumentPdfResult> {
  const { document, projectNumber, orgName, paymentRecordedAt } = ctx;
  const filename = `${document.documentNumber}.pdf`;
  const supabase = createServiceClient();

  // Step 1 — find existing cached PDF row.
  const cached = await db
    .select({
      id: projectFiles.id,
      storagePath: projectFiles.storagePath,
      originalFilename: projectFiles.originalFilename,
    })
    .from(projectFiles)
    .where(
      and(
        eq(projectFiles.sourceDocumentId, document.id),
        eq(projectFiles.source, 'document_artifact'),
        isNull(projectFiles.deletedAt),
      ),
    )
    .orderBy(desc(projectFiles.createdAt))
    .limit(1);

  if (cached.length > 0) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(cached[0].storagePath, DOWNLOAD_TTL_SECONDS, {
        download: cached[0].originalFilename,
      });
    if (error || !data) {
      // Storage object missing (rare — e.g. retention worker raced ahead). Fall
      // through to regenerate by soft-deleting the orphan row.
      await db
        .update(projectFiles)
        .set({ deletedAt: new Date() })
        .where(eq(projectFiles.id, cached[0].id));
    } else {
      return {
        success: true,
        data: {
          downloadUrl: data.signedUrl,
          filename: cached[0].originalFilename,
          mimeType: 'application/pdf',
          expiresInSeconds: DOWNLOAD_TTL_SECONDS,
        },
      };
    }
  }

  // Step 2 — render PDF to Buffer.
  let rendered: Awaited<ReturnType<typeof renderDocumentPdf>>;
  try {
    const data: DocumentPdfData = {
      type: document.type,
      documentNumber: document.documentNumber,
      invoiceSubtype: document.invoiceSubtype,
      status: document.status,
      orgName,
      projectNumber,
      recipientName: document.recipientName,
      lineItems: document.lineItems,
      subtotal: document.subtotal,
      discountPct: document.discountPct,
      vatApplicable: document.vatApplicable,
      vatAmount: document.vatAmount,
      total: document.total,
      currency: document.currency,
      sentAt: document.sentAt,
      acceptedAt: document.acceptedAt,
      acceptedByName: document.acceptedByName,
      revisionNumber: document.revisionNumber,
      paymentRecordedAt,
    };
    rendered = await renderDocumentPdf(data);
  } catch (err) {
    Sentry.captureException(err, {
      tags: { scope: 'pdf_render', document_type: document.type },
      extra: { documentId: document.id, orgId: document.orgId },
    });
    const reason = err instanceof Error ? err.message : String(err);
    return { error: 'internal_error', reason: `pdf_render:${reason}` };
  }

  // Step 3 — upload to storage. Path mirrors actions/files.ts shape:
  // org/{orgId}/projects/{projectId}/documents/{fileId}.pdf
  const fileId = uuidv7();
  const storagePath = `org/${document.orgId}/projects/${document.projectId}/documents/${fileId}.pdf`;
  const uploadResult = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, rendered.buffer, {
      contentType: rendered.mimeType,
      upsert: false,
    });
  if (uploadResult.error) {
    Sentry.captureException(uploadResult.error, {
      tags: { scope: 'pdf_upload' },
      extra: { documentId: document.id, storagePath },
    });
    return {
      error: 'internal_error',
      reason: `pdf_upload:${uploadResult.error.message}`,
    };
  }

  // Step 4 — insert project_files row.
  // uploaded_by_type/_id: 'user' + the auditing user id when available;
  // for token context use the document.created_by user (the document's
  // creator owns the artifact).
  const uploaderUserId =
    'userId' in opts.audit
      ? opts.audit.userId
      : await pickDocumentCreator(document.id);

  try {
    await db.insert(projectFiles).values({
      id: fileId,
      projectId: document.projectId,
      uploadedByType: 'user',
      uploadedById: uploaderUserId,
      storagePath,
      originalFilename: filename,
      mimeType: rendered.mimeType,
      sizeBytes: rendered.sizeBytes,
      source: 'document_artifact',
      // Receipts are a peer financial document — gate visibility on the
      // financial branch, not the drawings branch. visibility='org_only'
      // keeps the artifact off the stakeholder file-list (where it would
      // confuse — these aren't drawings). The download URL itself is the
      // share mechanism, gated by document_tokens.
      visibility: 'org_only',
      sourceDocumentId: document.id,
    });
  } catch (err) {
    // Best-effort cleanup of the just-uploaded object so we don't accumulate
    // orphan bytes against the bucket.
    await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => {});
    const reason = err instanceof Error ? err.message : String(err);
    return { error: 'internal_error', reason: `pdf_row_insert:${reason}` };
  }

  // Audit
  await logAudit({
    orgId: opts.audit.orgId,
    userId: 'userId' in opts.audit ? opts.audit.userId : undefined,
    action: 'create',
    resourceType: 'project_file',
    resourceId: fileId,
    metadata: {
      project_id: document.projectId,
      source_document_id: document.id,
      document_type: document.type,
      mime_type: rendered.mimeType,
      size_bytes: rendered.sizeBytes,
      via: 'via' in opts.audit ? opts.audit.via : undefined,
    },
  });

  // Step 5 — sign + return.
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, DOWNLOAD_TTL_SECONDS, {
      download: filename,
    });
  if (error || !data) {
    return {
      error: 'internal_error',
      reason: `pdf_sign:${error?.message ?? 'sign_failed'}`,
    };
  }

  return {
    success: true,
    data: {
      downloadUrl: data.signedUrl,
      filename,
      mimeType: 'application/pdf',
      expiresInSeconds: DOWNLOAD_TTL_SECONDS,
    },
  };
}

// Picks a "uploaded_by user id" for token-context PDF generations. Uses the
// document's original creator — they're guaranteed to be a valid users.id and
// belong to the same org. Avoids minting orphan/null uploader fields.
async function pickDocumentCreator(documentId: string): Promise<string> {
  const rows = await db
    .select({ createdBy: documents.createdBy })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  if (rows.length === 0) {
    // Should be unreachable — caller always resolves the document first.
    throw new Error(`pickDocumentCreator: document ${documentId} not found`);
  }
  return rows[0].createdBy;
}

// invalidateDocumentPdfCache lives in @/lib/pdf/cache (decoupled from the
// JSX template chain so callers don't pull @react-pdf/renderer into test
// import graphs that don't need it).

