// Standalone, idempotent seeder for the "PCD Surveyor" 8-stage workflow on
// Hasnath's org. Per ARCHITECTURE-saas.md §13 + Session 5 plan, this template
// is NOT a system template (would clone for every new org incorrectly). It's
// org-specific, seeded post-signup once Hasnath has registered his org and
// entered his Companies House number in settings.
//
// Storage shape (verified via grep on lib/settings/keys.ts:10 + actions/
// settings.ts:23-50): `org_settings` rows have key = 'company.company_number'
// and value (jsonb) = the raw string, e.g. "16240187".
//
// USAGE (from repo root):
//   Local target:       npm run db:seed-pcd-surveyor
//   Cloud target:       NEXT_PUBLIC_SUPABASE_URL=$CLOUD_URL \
//                       SUPABASE_SERVICE_ROLE_KEY=$CLOUD_KEY \
//                       npm run db:seed-pcd-surveyor
//
// Idempotent: re-running after success exits cleanly without inserting
// duplicate rows.

import { createClient } from '@supabase/supabase-js';
import { v7 as uuidv7 } from 'uuid';

const TARGET_COMPANY_NUMBER = '16240187';
const WORKFLOW_SLUG = 'pcd_surveyor';

// Color palette (Session 5 plan §7 step 5): cool → neutral → warm → green
// progression. Documented verbatim in SESSION-5-HANDOVER so future sessions
// don't re-litigate.
const STAGES: Array<{
  slug: string;
  name: string;
  position: number;
  is_terminal: boolean;
  color: string;
}> = [
  { slug: 'quoted',              name: 'Quoted',              position: 1, is_terminal: false, color: '#94a3b8' }, // slate
  { slug: 'quote_accepted',      name: 'Quote Accepted',      position: 2, is_terminal: false, color: '#06b6d4' }, // cyan
  { slug: 'invoice_sent',        name: 'Invoice Sent',        position: 3, is_terminal: false, color: '#3b82f6' }, // blue
  { slug: 'confirmed',           name: 'Confirmed',           position: 4, is_terminal: false, color: '#8b5cf6' }, // violet
  { slug: 'survey_booked',       name: 'Survey Booked',       position: 5, is_terminal: false, color: '#a855f7' }, // purple
  { slug: 'drawing_in_progress', name: 'Drawing In Progress', position: 6, is_terminal: false, color: '#f59e0b' }, // amber
  { slug: 'qa',                  name: 'QA',                  position: 7, is_terminal: false, color: '#fb923c' }, // orange
  { slug: 'completed',           name: 'Completed',           position: 8, is_terminal: true,  color: '#10b981' }, // emerald
];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
}
const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log(`[seed-hasnath-pcd-surveyor] target: ${url}`);

  // 1. Locate Hasnath's org via org_settings (key=company.company_number,
  //    value=jsonb string literal "16240187"). Compare jsonb to text via
  //    the ->> operator (extracts the value as text), wrapping the lookup
  //    in PostgREST's filter syntax.
  const { data: matches, error: matchErr } = await supabase
    .from('org_settings')
    .select('org_id, value')
    .eq('key', 'company.company_number')
    .is('deleted_at', null);
  if (matchErr) throw matchErr;

  // value is jsonb — could be a JSON string literal "16240187" (preferred)
  // or a quoted/unquoted variant if pasted oddly. Normalize before compare.
  const normalize = (v: unknown): string => {
    if (typeof v === 'string') return v.trim();
    if (v == null) return '';
    return String(v).trim();
  };
  const target = (matches ?? []).filter(
    (row) => normalize(row.value) === TARGET_COMPANY_NUMBER,
  );

  if (target.length === 0) {
    console.log(
      `[seed-hasnath-pcd-surveyor] no org found with company_number="${TARGET_COMPANY_NUMBER}" — exiting cleanly.`,
    );
    return;
  }
  if (target.length > 1) {
    console.error(
      `[seed-hasnath-pcd-surveyor] multiple orgs match company_number="${TARGET_COMPANY_NUMBER}": ${target
        .map((r) => r.org_id)
        .join(', ')}. Aborting — resolve manually.`,
    );
    process.exit(1);
  }
  const orgId = target[0].org_id;
  console.log(`[seed-hasnath-pcd-surveyor] target org: ${orgId}`);

  // 2. Idempotency check: already seeded?
  const { data: existing, error: existingErr } = await supabase
    .from('workflows')
    .select('id')
    .eq('org_id', orgId)
    .eq('slug', WORKFLOW_SLUG)
    .limit(1);
  if (existingErr) throw existingErr;
  if (existing && existing.length > 0) {
    console.log(
      `[seed-hasnath-pcd-surveyor] org ${orgId} already has the "${WORKFLOW_SLUG}" workflow (${existing[0].id}). No-op.`,
    );
    return;
  }

  // 3. Insert workflow + 8 stages.
  const workflowId = uuidv7();
  const { error: wfErr } = await supabase.from('workflows').insert({
    id: workflowId,
    org_id: orgId,
    org_type_id: null,
    slug: WORKFLOW_SLUG,
    name: 'PCD Surveyor',
    description: '8-stage surveyor workflow (quote → invoice → survey → drawing → QA → completed)',
    is_system_template: false,
    is_default: false,
  });
  if (wfErr) throw wfErr;

  const { error: stagesErr } = await supabase.from('workflow_stages').insert(
    STAGES.map((s) => ({
      id: uuidv7(),
      workflow_id: workflowId,
      slug: s.slug,
      name: s.name,
      position: s.position,
      is_terminal: s.is_terminal,
      requires_action: false,
      color: s.color,
    })),
  );
  if (stagesErr) throw stagesErr;

  console.log(
    `[seed-hasnath-pcd-surveyor] inserted workflow ${workflowId} + ${STAGES.length} stages.`,
  );

  // 4. Audit row.
  const { error: auditErr } = await supabase.from('audit_logs').insert({
    id: uuidv7(),
    org_id: orgId,
    user_id: null,
    action: 'create',
    resource_type: 'workflow',
    resource_id: workflowId,
    metadata: {
      source: 'hasnath_seed_script',
      slug: WORKFLOW_SLUG,
      stage_count: STAGES.length,
      ran_at: new Date().toISOString(),
    },
  });
  if (auditErr) throw auditErr;

  console.log('[seed-hasnath-pcd-surveyor] audit row written. done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
