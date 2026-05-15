import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { projectFiles } from '@/db/schema';

// Phase 2 Session 14 — cache invalidation helper for generated document PDFs.
//
// Lives in a leaf module (no imports of @react-pdf/renderer or the JSX
// template) so other server actions can soft-delete a stale cached PDF
// without pulling the renderer into their import chain. Used by:
//   - actions/payments.ts:correctPayment    — receipt total changed
//   - actions/documents.ts:reviseInvoice    — invoice mutated
//   - actions/documents.ts:reviseReceipt    — receipt recipient mutated
//   - actions/document-pdf.ts (re-exports for back-compat)
//
// Soft-delete via deleted_at — the storage object stays for the retention
// worker to reap. The next generateDocumentPdf call sees no active row and
// regenerates from the post-mutation state.

export async function invalidateDocumentPdfCache(documentId: string): Promise<void> {
  await db
    .update(projectFiles)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(projectFiles.sourceDocumentId, documentId),
        eq(projectFiles.source, 'document_artifact'),
        isNull(projectFiles.deletedAt),
      ),
    );
}
