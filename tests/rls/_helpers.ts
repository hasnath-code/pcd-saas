import { expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// Shared assertion helpers for RLS test files. Existing convention: RLS-denied
// reads return `(data, error)` where `data` is an empty array (or array
// missing the filtered row) and `error` is null. RLS-denied writes also
// return data=[] (no row matched after policy filter), not an error. Helpers
// match this convention.

/**
 * Assert that an RLS-bound SELECT on `table` filtering `column IN (values)`
 * returns exactly the expected IDs.
 */
export async function assertVisibleIds(
  client: SupabaseClient,
  table: string,
  filter: { column: string; values: string[] },
  expectedIds: string[],
  testName?: string,
): Promise<void> {
  const { data, error } = await client
    .from(table)
    .select('id')
    .in(filter.column, filter.values);
  expect(error, testName ? `${testName}: select error` : 'select error').toBeNull();
  expect(
    (data ?? []).map((r) => (r as { id: string }).id).sort(),
    testName ? `${testName}: visible ids` : 'visible ids',
  ).toEqual([...expectedIds].sort());
}

/** Assert that a single-row SELECT on `table` for `id=rowId` returns no rows. */
export async function assertNotVisible(
  client: SupabaseClient,
  table: string,
  rowId: string,
  testName?: string,
): Promise<void> {
  const { data } = await client.from(table).select('id').eq('id', rowId);
  expect(data ?? [], testName ?? `${table}.${rowId} not visible`).toEqual([]);
}

/**
 * Run an INSERT/UPDATE/DELETE against an RLS-bound client and assert the
 * resulting data array is empty (RLS filtered the row). Pass `verify` to
 * service-role re-check that no underlying write occurred.
 */
export async function assertWriteDenied<T extends { id?: string } = { id?: string }>(
  fn: () => PromiseLike<{ data: T[] | null; error: unknown }>,
  testName?: string,
  verify?: () => Promise<void>,
): Promise<void> {
  const { data } = await fn();
  expect(data ?? [], testName ?? 'write denied').toEqual([]);
  if (verify) await verify();
}

/**
 * Call a SECURITY DEFINER RPC with the given args and assert the return
 * matches `expected`. Used by helper-function regression tests.
 */
export async function assertRpcReturns<T>(
  client: SupabaseClient,
  rpcName: string,
  args: Record<string, unknown>,
  expected: T,
  testName?: string,
): Promise<void> {
  const { data, error } = await client.rpc(rpcName, args);
  expect(error, testName ? `${testName}: rpc error` : 'rpc error').toBeNull();
  expect(data, testName ?? `${rpcName} return`).toEqual(expected);
}
