import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { db } from '@/db';
import { documents } from '@/db/schema';
import { allocateDocumentNumber } from '@/lib/documents/numbering';
import {
  createWorkflowProjectFixture,
  type WorkflowProjectFixture,
} from '../fixtures/with-workflow-and-projects';

// Tests the allocator's correctness under both serial and concurrent
// invocation. The Drizzle pooler is configured with max: 1 (db/index.ts), so
// Promise.all of two db.transaction calls is queued on a single connection —
// the SELECT FOR UPDATE lock is exercised in the lock acquisition order
// (test harness limitation; production has many connections in the pool and
// the lock genuinely serializes parallel writers).
//
// Per kickoff guidance: assert b - a === 1 first. If that ever flakes the
// fallback is "both in {1,2}" — but the harness's serial-via-pool-of-1
// shape means b - a === 1 is the stable expectation.

describe('allocateDocumentNumber', () => {
  let f: WorkflowProjectFixture;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
  });
  afterAll(async () => {
    await f.service
      .from('documents')
      .delete()
      .in('project_id', [f.extras.orgAProject.id, f.extras.orgBProject.id]);
    await f.cleanup();
  });

  // Helper: allocate + insert in the same tx — the helper's contract assumes
  // the caller inserts before commit (otherwise the next allocator sees the
  // same count and reuses the sequence). createQuote follows this pattern.
  async function allocateAndInsert(projectId: string, orgId: string, type: 'quote' | 'invoice' = 'quote') {
    return db.transaction(async (tx) => {
      const allocated = await allocateDocumentNumber({ tx, projectId, type });
      await tx.insert(documents).values({
        id: uuidv7(),
        orgId,
        projectId,
        type,
        documentNumber: allocated.documentNumber,
        sequence: allocated.sequence,
        createdBy: f.userA.userId,
      });
      return allocated;
    });
  }

  test('serial allocations on the same project produce sequential numbers', async () => {
    const a = await allocateAndInsert(f.extras.orgAProject.id, f.orgA.id);
    const b = await allocateAndInsert(f.extras.orgAProject.id, f.orgA.id);

    expect(b.sequence - a.sequence).toBe(1);
    expect(a.documentNumber).toBe(`${f.extras.orgAProject.projectNumber}-Q1`);
    expect(b.documentNumber).toBe(`${f.extras.orgAProject.projectNumber}-Q2`);
  });

  test('concurrent allocations on the same project produce distinct sequential numbers (Promise.all)', async () => {
    // Two allocator+insert calls fired concurrently. Under max:1 pool the
    // postgres-js library serializes them; the FOR UPDATE lock is the
    // safety net if pool sizing ever changes. After the prior serial test
    // the project has docs 1 + 2; the next two allocations must return 3 + 4.
    const [a, b] = await Promise.all([
      allocateAndInsert(f.extras.orgAProject.id, f.orgA.id),
      allocateAndInsert(f.extras.orgAProject.id, f.orgA.id),
    ]);

    // Whichever wins the lock first gets the lower sequence — assert the
    // difference, not the absolute values.
    const lo = Math.min(a.sequence, b.sequence);
    const hi = Math.max(a.sequence, b.sequence);
    expect(hi - lo).toBe(1);
    expect(new Set([a.documentNumber, b.documentNumber]).size).toBe(2);
  });

  test('different projects allocate independently', async () => {
    const a = await allocateAndInsert(f.extras.orgBProject.id, f.orgB.id);
    // Org B's first quote is sequence 1 — independent of org A's run.
    expect(a.sequence).toBe(1);
    expect(a.documentNumber).toBe(`${f.extras.orgBProject.projectNumber}-Q1`);
  });

  test('different types on the same project allocate independently', async () => {
    // After 4 quotes on org A's project, an invoice allocation starts at 1.
    const inv = await allocateAndInsert(f.extras.orgAProject.id, f.orgA.id, 'invoice');
    expect(inv.sequence).toBe(1);
    expect(inv.documentNumber).toBe(`${f.extras.orgAProject.projectNumber}-I1`);
  });

  test('missing project throws', async () => {
    await expect(
      db.transaction((tx) =>
        allocateDocumentNumber({ tx, projectId: uuidv7(), type: 'quote' }),
      ),
    ).rejects.toThrow(/not found/);
  });
});
