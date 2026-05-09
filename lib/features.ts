import 'server-only';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { organizations, plans, projectFiles, projects } from '@/db/schema';

// ARCHITECTURE-saas.md §21 — feature flag helper. Reads
// organizations.plan_id → plans.feature_flags JSONB and answers a typed
// allowed/denied result.
//
// Keep MB/GB definitions in sync with db/seed/plans.ts. Using SI (1_000_000)
// rather than IEC (1_048_576) so user-facing copy ("100 MB") matches the
// underlying byte count without rounding.

const MB = 1_000_000;
const GB = 1_000_000_000;

// All known flags + their type. Boolean flags are absent/false vs true;
// quota flags hold an integer cap or null=unlimited; per-call flags hold a
// per-call cap or null=unlimited.
export const FEATURES = {
  max_projects: { kind: 'quota_count' },
  max_storage_bytes: { kind: 'quota_bytes' },
  max_upload_size_bytes: { kind: 'per_call_bytes' },
  dual_org_type: { kind: 'boolean' },
  custom_email_domain: { kind: 'boolean' },
  custom_workflows: { kind: 'boolean' },
} as const;

export type FeatureFlag = keyof typeof FEATURES;

// Compound flags evaluated by checkFeature even though they aren't direct
// keys in plans.feature_flags. Each compound is implemented in terms of one
// or more concrete FEATURES.
//
// 'upload_file' is the Session 10 file-upload gate. Combines the per-file
// cap (max_upload_size_bytes) with the running org-total cap
// (max_storage_bytes). Both must pass.
export type CompoundFlag = 'upload_file';

// Discriminated result. `allowed` is the only field consumers must check;
// the others give the upload UI enough state to render a sensible message
// or upgrade prompt.
export type FeatureCheck =
  | { allowed: true; details?: UploadDetails }
  | {
      allowed: false;
      reason:
        | 'plan_required'
        | 'quota_exceeded'
        | 'file_too_large'
        | 'no_org'
        | 'unknown_flag';
      perFileLimitBytes?: number | null;
      totalLimitBytes?: number | null;
      currentUsageBytes?: number;
      requestedBytes?: number;
      upgradeTo?: string;
    };

export type UploadDetails = {
  perFileLimitBytes: number | null;
  totalLimitBytes: number | null;
  currentUsageBytes: number;
};

// Single org+plan resolution helper. One DB round-trip; reused by every
// checkFeature call. Returns null if the org is missing or its plan row
// can't be resolved (defensive — the FK is restrict, so this should never
// happen in practice).
async function resolveOrgPlan(
  orgId: string,
): Promise<{ planSlug: string; flags: Record<string, unknown> } | null> {
  const rows = await db
    .select({
      planSlug: plans.slug,
      featureFlags: plans.featureFlags,
    })
    .from(organizations)
    .innerJoin(plans, eq(plans.id, organizations.planId))
    .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    planSlug: r.planSlug,
    flags: (r.featureFlags as Record<string, unknown>) ?? {},
  };
}

// Total bytes used across all non-deleted files in non-deleted projects of
// the org. Single indexed scan via idx_project_files_project — small N at
// Phase 1c scale; revisit with a cached counter on organizations once
// EXPLAIN ANALYZE on real data shows the SUM dominating upload latency
// (Phase 6 / pre-launch perf pass).
async function sumStorageBytesForOrg(orgId: string): Promise<number> {
  const rows = await db
    .select({
      total: sql<number>`COALESCE(SUM(${projectFiles.sizeBytes}), 0)::bigint`,
    })
    .from(projectFiles)
    .innerJoin(projects, eq(projects.id, projectFiles.projectId))
    .where(
      and(
        eq(projects.orgId, orgId),
        isNull(projects.deletedAt),
        isNull(projectFiles.deletedAt),
      ),
    );
  // Postgres bigint → Drizzle returns it as string in some configurations and
  // as number in others; coerce defensively to avoid the DEBT-027 class of
  // type-honesty bug. Number(string) handles both.
  return Number(rows[0]?.total ?? 0);
}

function suggestUpgrade(currentSlug: string): string | undefined {
  // Linear progression: free → studio → practice → enterprise. Same path
  // for both org_types — quota structure is identical at each tier even
  // though pricing differs.
  switch (currentSlug) {
    case 'solo_free':
      return 'studio';
    case 'studio':
      return 'practice';
    case 'practice':
      return 'enterprise';
    default:
      return undefined;
  }
}

// checkFeature — boolean / quota / per-call flags.
export async function checkFeature(
  orgId: string,
  flag: 'max_projects',
  ctx: { count: number },
): Promise<FeatureCheck>;
export async function checkFeature(
  orgId: string,
  flag: 'max_storage_bytes',
  ctx: { totalBytes: number },
): Promise<FeatureCheck>;
export async function checkFeature(
  orgId: string,
  flag: 'max_upload_size_bytes',
  ctx: { sizeBytes: number },
): Promise<FeatureCheck>;
export async function checkFeature(
  orgId: string,
  flag: 'dual_org_type' | 'custom_email_domain' | 'custom_workflows',
): Promise<FeatureCheck>;
export async function checkFeature(
  orgId: string,
  flag: CompoundFlag,
  ctx: { sizeBytes: number },
): Promise<FeatureCheck>;
export async function checkFeature(
  orgId: string,
  flag: FeatureFlag | CompoundFlag,
  ctx?: { count?: number; totalBytes?: number; sizeBytes?: number },
): Promise<FeatureCheck> {
  const resolved = await resolveOrgPlan(orgId);
  if (!resolved) return { allowed: false, reason: 'no_org' };
  const { planSlug, flags } = resolved;

  if (flag === 'upload_file') {
    if (ctx?.sizeBytes === undefined) {
      throw new Error("checkFeature('upload_file'): ctx.sizeBytes required");
    }
    const perFileLimit = (flags.max_upload_size_bytes ?? null) as number | null;
    const totalLimit = (flags.max_storage_bytes ?? null) as number | null;

    if (perFileLimit !== null && ctx.sizeBytes > perFileLimit) {
      return {
        allowed: false,
        reason: 'file_too_large',
        perFileLimitBytes: perFileLimit,
        totalLimitBytes: totalLimit,
        requestedBytes: ctx.sizeBytes,
        upgradeTo: suggestUpgrade(planSlug),
      };
    }

    const currentUsageBytes = await sumStorageBytesForOrg(orgId);
    if (
      totalLimit !== null &&
      currentUsageBytes + ctx.sizeBytes > totalLimit
    ) {
      return {
        allowed: false,
        reason: 'quota_exceeded',
        perFileLimitBytes: perFileLimit,
        totalLimitBytes: totalLimit,
        currentUsageBytes,
        requestedBytes: ctx.sizeBytes,
        upgradeTo: suggestUpgrade(planSlug),
      };
    }

    return {
      allowed: true,
      details: { perFileLimitBytes: perFileLimit, totalLimitBytes: totalLimit, currentUsageBytes },
    };
  }

  const meta = FEATURES[flag as FeatureFlag];
  if (!meta) return { allowed: false, reason: 'unknown_flag' };

  if (meta.kind === 'boolean') {
    return flags[flag] === true
      ? { allowed: true }
      : {
          allowed: false,
          reason: 'plan_required',
          upgradeTo: suggestUpgrade(planSlug),
        };
  }

  const value = (flags[flag] ?? null) as number | null;

  if (meta.kind === 'quota_count') {
    if (value === null) return { allowed: true };
    if (ctx?.count === undefined)
      throw new Error(`checkFeature('${flag}'): ctx.count required`);
    return ctx.count < value
      ? { allowed: true }
      : {
          allowed: false,
          reason: 'quota_exceeded',
          upgradeTo: suggestUpgrade(planSlug),
        };
  }

  if (meta.kind === 'quota_bytes') {
    if (value === null) return { allowed: true };
    if (ctx?.totalBytes === undefined)
      throw new Error(`checkFeature('${flag}'): ctx.totalBytes required`);
    return ctx.totalBytes <= value
      ? { allowed: true }
      : {
          allowed: false,
          reason: 'quota_exceeded',
          totalLimitBytes: value,
          currentUsageBytes: ctx.totalBytes,
          upgradeTo: suggestUpgrade(planSlug),
        };
  }

  if (meta.kind === 'per_call_bytes') {
    if (value === null) return { allowed: true };
    if (ctx?.sizeBytes === undefined)
      throw new Error(`checkFeature('${flag}'): ctx.sizeBytes required`);
    return ctx.sizeBytes <= value
      ? { allowed: true }
      : {
          allowed: false,
          reason: 'file_too_large',
          perFileLimitBytes: value,
          requestedBytes: ctx.sizeBytes,
          upgradeTo: suggestUpgrade(planSlug),
        };
  }

  return { allowed: false, reason: 'unknown_flag' };
}

// Friendly byte-count formatter for upgrade prompts and toast copy.
// Re-exported from lib/utils so client components can format bytes without
// importing the server-only features module.
export { formatBytes } from './utils';
