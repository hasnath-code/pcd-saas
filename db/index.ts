import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '@/env';
import * as schema from './schema';

// Runtime client targets DATABASE_URL (Supabase pooler, transaction mode, port 6543).
// max: 1     — Vercel serverless functions are single-threaded; one connection per invocation.
// prepare: false — required by transaction-mode pooler (PgBouncer doesn't support prepared statements
//                  across queries since each query may use a different backend connection).
// See ARCHITECTURE-saas.md §28 (Connection Pooling).
const queryClient = postgres(env.DATABASE_URL, {
  max: 1,
  prepare: false,
});

export const db = drizzle(queryClient, { schema });

// Helper type for functions that accept either the top-level db or a tx client
// inside db.transaction(async (tx) => ...). Used by findOrCreateClientTx
// (actions/clients.ts) and similar tx-friendly helpers composed inside outer
// transactions (Rule 19 in SKILL.md v3.2). Derived from the callback signature
// so it covers both PgDatabase and PgTransaction shapes.
export type DbOrTx = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;
