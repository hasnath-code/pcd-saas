import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { v7 as uuidv7 } from 'uuid';

// 8 plan rows: 4 tiers × 2 org types. Pricing per ARCHITECTURE-saas.md §10.2,
// in pence (£22.00/mo = 2200). feature_flags are placeholders for Phase 1a;
// real values land in Phase 6 when Stripe wiring goes in.
//
// Session 10 (Phase 1c) extends each row with `max_storage_bytes` (total org
// storage cap, null = unlimited) and `max_upload_size_bytes` (per-file cap,
// null = unlimited). Tier values per ARCHITECTURE-saas §18 + ADR-029.
type PlanSeed = {
  org_type_slug: 'surveyor' | 'architect';
  slug: string;
  name: string;
  price_monthly_pence: number;
  feature_flags: Record<string, unknown>;
};

// Quota constants — keep in sync with lib/features.ts FEATURES.
const MB = 1_000_000;
const GB = 1_000_000_000;

const planRows: PlanSeed[] = [
  // Surveyor
  { org_type_slug: 'surveyor', slug: 'solo_free', name: 'Solo Free', price_monthly_pence: 0,
    feature_flags: { max_projects: 3, max_storage_bytes: 100 * MB, max_upload_size_bytes: 25 * MB } },
  { org_type_slug: 'surveyor', slug: 'studio', name: 'Studio', price_monthly_pence: 2200,
    feature_flags: { max_projects: 50, max_storage_bytes: 5 * GB, max_upload_size_bytes: 100 * MB } },
  { org_type_slug: 'surveyor', slug: 'practice', name: 'Practice', price_monthly_pence: 3800,
    feature_flags: { max_projects: null, max_storage_bytes: 50 * GB, max_upload_size_bytes: 500 * MB, dual_org_type: true } },
  { org_type_slug: 'surveyor', slug: 'enterprise', name: 'Enterprise', price_monthly_pence: 5500,
    feature_flags: { max_projects: null, max_storage_bytes: null, max_upload_size_bytes: 1 * GB, dual_org_type: true, custom_email_domain: true } },
  // Architect
  { org_type_slug: 'architect', slug: 'solo_free', name: 'Solo Free', price_monthly_pence: 0,
    feature_flags: { max_projects: 3, max_storage_bytes: 100 * MB, max_upload_size_bytes: 25 * MB } },
  { org_type_slug: 'architect', slug: 'studio', name: 'Studio', price_monthly_pence: 3500,
    feature_flags: { max_projects: 25, max_storage_bytes: 5 * GB, max_upload_size_bytes: 100 * MB } },
  { org_type_slug: 'architect', slug: 'practice', name: 'Practice', price_monthly_pence: 5800,
    feature_flags: { max_projects: null, max_storage_bytes: 50 * GB, max_upload_size_bytes: 500 * MB, dual_org_type: true } },
  { org_type_slug: 'architect', slug: 'enterprise', name: 'Enterprise', price_monthly_pence: 8500,
    feature_flags: { max_projects: null, max_storage_bytes: null, max_upload_size_bytes: 1 * GB, dual_org_type: true, custom_email_domain: true } },
];

export async function seedPlans(supabase: SupabaseClient): Promise<void> {
  const { data: types, error: typeErr } = await supabase
    .from('org_types')
    .select('id, slug');
  if (typeErr) throw new Error(`seed plans: read org_types failed: ${typeErr.message}`);
  if (!types || types.length === 0)
    throw new Error('seed plans: no org_types found — run seedOrgTypes first');

  const slugToId = new Map(types.map((t) => [t.slug, t.id as string]));

  // Read existing rows so we keep their `id` (referenced by organizations.plan_id)
  // — only INSERT a new uuidv7 for genuinely new rows.
  const { data: existing, error: readErr } = await supabase
    .from('plans')
    .select('id, org_type_id, slug');
  if (readErr) throw new Error(`seed plans: read failed: ${readErr.message}`);

  const existingByKey = new Map(
    (existing ?? []).map((r) => [`${r.org_type_id}::${r.slug}`, r.id as string]),
  );

  // Upsert by (org_type_id, slug) — refreshes name / price / feature_flags on
  // every run so plan-shape changes (Session 10 added max_storage_bytes,
  // max_upload_size_bytes) propagate to environments where rows already exist.
  // Preserves the existing row id where present so FKs from `organizations`
  // stay intact.
  const upsertRows = planRows.map((row) => {
    const orgTypeId = slugToId.get(row.org_type_slug);
    if (!orgTypeId) throw new Error(`seed plans: org_type slug '${row.org_type_slug}' missing`);
    const key = `${orgTypeId}::${row.slug}`;
    return {
      id: existingByKey.get(key) ?? uuidv7(),
      org_type_id: orgTypeId,
      slug: row.slug,
      name: row.name,
      price_monthly_pence: row.price_monthly_pence,
      feature_flags: row.feature_flags,
    };
  });

  const { error: upErr } = await supabase
    .from('plans')
    .upsert(upsertRows, { onConflict: 'org_type_id,slug' });
  if (upErr) throw new Error(`seed plans: upsert failed: ${upErr.message}`);

  const newCount = upsertRows.filter((r) => !existingByKey.has(`${r.org_type_id}::${r.slug}`)).length;
  const refreshedCount = upsertRows.length - newCount;
  console.log(
    `[seed] plans: upserted ${upsertRows.length} rows (${newCount} new, ${refreshedCount} refreshed)`,
  );
}
