import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { orgSettings } from '@/db/schema';

// Flatten the org_settings rows for an org into a key→value record. The value
// column is jsonb so values are typed as `unknown`; consumers are expected to
// know the shape per key (validated server-side at write time).
//
// Soft-deleted rows are filtered out — a cleared setting that was later
// restored should re-appear via the same shape.
export async function getOrgSettings(orgId: string): Promise<Record<string, unknown>> {
  const rows = await db
    .select({ key: orgSettings.key, value: orgSettings.value })
    .from(orgSettings)
    .where(and(eq(orgSettings.orgId, orgId), isNull(orgSettings.deletedAt)));
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
