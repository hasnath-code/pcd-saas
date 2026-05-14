import 'server-only';
import { and, count, eq } from 'drizzle-orm';
import type { DbOrTx } from '@/db';
import { documents, projects } from '@/db/schema';

// Phase 2 §2 — project-scoped human-readable document numbering. Format:
// `{projectNumber}-{TYPE_CHAR}{sequence}` where TYPE_CHAR is Q (quote), I
// (invoice), or R (receipt). V2's `code + '-INV-' + typeChar + seq` is
// simplified — the type char alone disambiguates, no need for the -INV-
// infix.
//
// Race protection: SELECT FOR UPDATE on the projects row inside the caller's
// transaction. Concurrent createQuote calls on the same project serialize
// behind that lock; creates on different projects don't block each other.
// The UNIQUE (project_id, type, sequence) constraint on documents is the
// belt-and-braces — if the lock is ever bypassed (e.g. a future caller
// allocates outside a tx), the DB still rejects duplicate sequences.
//
// Soft-deleted documents count toward the sequence. We don't recycle numbers
// — auditability matters more than tight numbering. A surveyor who deletes
// quote #3 sees the next quote numbered #4, not a re-used #3.

export type DocumentType = 'quote' | 'invoice' | 'receipt';

const TYPE_CHARS: Record<DocumentType, string> = {
  quote: 'Q',
  invoice: 'I',
  receipt: 'R',
};

export interface AllocateOpts {
  tx: DbOrTx;
  projectId: string;
  type: DocumentType;
}

export interface AllocateResult {
  documentNumber: string;
  sequence: number;
}

export async function allocateDocumentNumber(
  opts: AllocateOpts,
): Promise<AllocateResult> {
  const { tx, projectId, type } = opts;

  // 1. Lock the project row. Concurrent allocations on the same project wait
  //    here; allocations on different projects pass through.
  const projectRows = await tx
    .select({ projectNumber: projects.projectNumber })
    .from(projects)
    .where(eq(projects.id, projectId))
    .for('update');

  if (projectRows.length === 0) {
    throw new Error(`allocateDocumentNumber: project ${projectId} not found`);
  }
  const projectNumber = projectRows[0].projectNumber;

  // 2. Count existing documents of this type on this project (soft-deleted
  //    rows included — see header comment for why).
  const [{ existing }] = await tx
    .select({ existing: count() })
    .from(documents)
    .where(and(eq(documents.projectId, projectId), eq(documents.type, type)));

  const sequence = Number(existing) + 1;
  const documentNumber = `${projectNumber}-${TYPE_CHARS[type]}${sequence}`;

  return { documentNumber, sequence };
}
