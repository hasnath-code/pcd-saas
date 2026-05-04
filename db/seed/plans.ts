import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { v7 as uuidv7 } from 'uuid';

// 8 plan rows: 4 tiers × 2 org types. Pricing per ARCHITECTURE-saas.md §10.2,
// in pence (£22.00/mo = 2200). feature_flags are placeholders for Phase 1a;
// real values land in Phase 6 when Stripe wiring goes in.
type PlanSeed = {
  org_type_slug: 'surveyor' | 'architect';
  slug: string;
  name: string;
  price_monthly_pence: number;
  feature_flags: Record<string, unknown>;
};

const planRows: PlanSeed[] = [
  // Surveyor
  { org_type_slug: 'surveyor', slug: 'solo_free', name: 'Solo Free', price_monthly_pence: 0, feature_flags: { max_projects: 3 } },
  { org_type_slug: 'surveyor', slug: 'studio', name: 'Studio', price_monthly_pence: 2200, feature_flags: { max_projects: 50 } },
  { org_type_slug: 'surveyor', slug: 'practice', name: 'Practice', price_monthly_pence: 3800, feature_flags: { max_projects: null, dual_org_type: true } },
  { org_type_slug: 'surveyor', slug: 'enterprise', name: 'Enterprise', price_monthly_pence: 5500, feature_flags: { max_projects: null, dual_org_type: true, custom_email_domain: true } },
  // Architect
  { org_type_slug: 'architect', slug: 'solo_free', name: 'Solo Free', price_monthly_pence: 0, feature_flags: { max_projects: 3 } },
  { org_type_slug: 'architect', slug: 'studio', name: 'Studio', price_monthly_pence: 3500, feature_flags: { max_projects: 25 } },
  { org_type_slug: 'architect', slug: 'practice', name: 'Practice', price_monthly_pence: 5800, feature_flags: { max_projects: null, dual_org_type: true } },
  { org_type_slug: 'architect', slug: 'enterprise', name: 'Enterprise', price_monthly_pence: 8500, feature_flags: { max_projects: null, dual_org_type: true, custom_email_domain: true } },
];

export async function seedPlans(supabase: SupabaseClient): Promise<void> {
  const { data: types, error: typeErr } = await supabase
    .from('org_types')
    .select('id, slug');
  if (typeErr) throw new Error(`seed plans: read org_types failed: ${typeErr.message}`);
  if (!types || types.length === 0)
    throw new Error('seed plans: no org_types found — run seedOrgTypes first');

  const slugToId = new Map(types.map((t) => [t.slug, t.id as string]));

  const { data: existing, error: readErr } = await supabase
    .from('plans')
    .select('org_type_id, slug');
  if (readErr) throw new Error(`seed plans: read failed: ${readErr.message}`);

  const existingKeys = new Set(
    (existing ?? []).map((r) => `${r.org_type_id}::${r.slug}`),
  );

  const toInsert = planRows
    .map((row) => {
      const orgTypeId = slugToId.get(row.org_type_slug);
      if (!orgTypeId) throw new Error(`seed plans: org_type slug '${row.org_type_slug}' missing`);
      return {
        id: uuidv7(),
        org_type_id: orgTypeId,
        slug: row.slug,
        name: row.name,
        price_monthly_pence: row.price_monthly_pence,
        feature_flags: row.feature_flags,
      };
    })
    .filter((r) => !existingKeys.has(`${r.org_type_id}::${r.slug}`));

  if (toInsert.length === 0) {
    console.log(`[seed] plans: ${existing?.length ?? 0} rows already present, no new inserts`);
    return;
  }

  const { error: insErr } = await supabase.from('plans').insert(toInsert);
  if (insErr) throw new Error(`seed plans: insert failed: ${insErr.message}`);

  console.log(
    `[seed] plans: inserted ${toInsert.length} new rows (${existing?.length ?? 0} were already present)`,
  );
}
