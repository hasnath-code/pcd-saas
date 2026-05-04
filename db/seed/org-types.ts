import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { v7 as uuidv7 } from 'uuid';

// Phase 1a reference data: 2 rows. SQL CHECK constraint pins slugs to these.
const orgTypeRows = [
  { slug: 'surveyor', name: 'Surveyor Firm', default_workflow_slug: 'simple' },
  { slug: 'architect', name: 'Architect Firm', default_workflow_slug: 'simple' },
];

export async function seedOrgTypes(supabase: SupabaseClient): Promise<void> {
  const { data: existing, error: readErr } = await supabase
    .from('org_types')
    .select('slug');
  if (readErr) throw new Error(`seed org_types: read failed: ${readErr.message}`);

  const existingSlugs = new Set((existing ?? []).map((r) => r.slug));
  const toInsert = orgTypeRows
    .filter((r) => !existingSlugs.has(r.slug))
    .map((r) => ({ id: uuidv7(), ...r }));

  if (toInsert.length === 0) {
    console.log(`[seed] org_types: ${existing?.length ?? 0} rows already present, no new inserts`);
    return;
  }

  const { error: insErr } = await supabase.from('org_types').insert(toInsert);
  if (insErr) throw new Error(`seed org_types: insert failed: ${insErr.message}`);

  console.log(
    `[seed] org_types: inserted ${toInsert.length} new rows (${existing?.length ?? 0} were already present)`,
  );
}
