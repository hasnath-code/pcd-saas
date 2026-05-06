import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';

vi.mock('@/lib/auth/requireAuth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/auth/requireAuth')>();
  return { ...original, requireAuth: vi.fn(), requireOrgUser: vi.fn() };
});
vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn().mockResolvedValue({ messageId: 'mocked-msg', emailEventId: null }),
}));
vi.mock('@sentry/nextjs', () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  setTag: vi.fn(),
  setContext: vi.fn(),
}));
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: vi.fn().mockResolvedValue({ limited: false, retryAfterSec: 0 }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { updateStakeholder } from '@/actions/stakeholders';
import * as auth from '@/lib/auth/requireAuth';
import {
  createWorkflowProjectFixture,
  type WorkflowProjectFixture,
} from '../fixtures/with-workflow-and-projects';
import { asOrgUserContext } from '../helpers/sign-in-fixture';

// Per ARCHITECTURE-saas §14, the visibility_profile column is documentation
// of which preset was selected at invite time. Individual flag changes after
// invite auto-flip the profile to 'custom'. This file covers the runtime
// override paths in updateStakeholder that the matrix tests don't reach.
describe('updateStakeholder runtime override matrix', () => {
  let f: WorkflowProjectFixture;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
  });
  afterAll(async () => {
    await f.service
      .from('project_stakeholders')
      .delete()
      .in('project_id', [f.extras.orgAProject.id, f.extras.orgBProject.id]);
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireOrgUser).mockResolvedValue(
      asOrgUserContext(f.userA, f.orgA.id, 'owner'),
    );
  });

  // Each test seeds its own stakeholder so they don't interfere with each
  // other (some tests modify the row's flags + profile fields).
  async function seedStakeholder(): Promise<{ stakeholderId: string; clientId: string }> {
    const clientId = uuidv7();
    await f.service.from('clients').insert({
      id: clientId,
      email: `runtime-${uuidv7()}@test.local`,
      name: 'Runtime Override',
    });
    await f.service.from('client_org_memberships').insert({
      id: uuidv7(),
      client_id: clientId,
      org_id: f.orgA.id,
    });
    const stakeholderId = uuidv7();
    await f.service.from('project_stakeholders').insert({
      id: stakeholderId,
      project_id: f.extras.orgAProject.id,
      client_id: clientId,
      role: 'collaborator',
      visibility_profile: 'full',
      can_view_financials: true,
      can_view_drawings: true,
      can_view_schedule: true,
      can_message: true,
      can_upload_files: true,
      invited_by: f.userA.userId,
      accepted_at: new Date().toISOString(),
    });
    return { stakeholderId, clientId };
  }

  test("visibilityProfile='progress_only' overrides customFlags (preset wins)", async () => {
    const { stakeholderId } = await seedStakeholder();
    const result = await updateStakeholder({
      stakeholderId,
      visibilityProfile: 'progress_only',
      // customFlags here should be ignored — preset wins.
      customFlags: {
        canViewFinancials: true,
        canViewDrawings: false,
        canViewSchedule: false,
        canMessage: false,
        canUploadFiles: false,
      },
    });
    expect(result).toMatchObject({ success: true });

    const { data } = await f.service
      .from('project_stakeholders')
      .select(
        'visibility_profile, can_view_financials, can_view_drawings, can_view_schedule, can_message, can_upload_files',
      )
      .eq('id', stakeholderId)
      .single();
    // progress_only preset: financials=false, drawings/schedule/message/upload=true.
    expect(data?.visibility_profile).toBe('progress_only');
    expect(data?.can_view_financials).toBe(false);
    expect(data?.can_view_drawings).toBe(true);
    expect(data?.can_view_schedule).toBe(true);
    expect(data?.can_message).toBe(true);
    expect(data?.can_upload_files).toBe(true);
  });

  test('individual customFlags without visibilityProfile flips profile to custom', async () => {
    const { stakeholderId } = await seedStakeholder();
    const result = await updateStakeholder({
      stakeholderId,
      customFlags: { canViewFinancials: false }, // single flag toggle
    });
    expect(result).toMatchObject({ success: true });

    const { data } = await f.service
      .from('project_stakeholders')
      .select('visibility_profile, can_view_financials, can_view_drawings')
      .eq('id', stakeholderId)
      .single();
    expect(data?.visibility_profile).toBe('custom');
    expect(data?.can_view_financials).toBe(false);
    // Other flags untouched (still 'full' values from seed).
    expect(data?.can_view_drawings).toBe(true);
  });

  test("visibilityProfile='custom' explicit + complete customFlags writes them directly", async () => {
    const { stakeholderId } = await seedStakeholder();
    const result = await updateStakeholder({
      stakeholderId,
      visibilityProfile: 'custom',
      customFlags: {
        canViewFinancials: true,
        canViewDrawings: false,
        canViewSchedule: true,
        canMessage: false,
        canUploadFiles: true,
      },
    });
    expect(result).toMatchObject({ success: true });

    const { data } = await f.service
      .from('project_stakeholders')
      .select(
        'visibility_profile, can_view_financials, can_view_drawings, can_view_schedule, can_message, can_upload_files',
      )
      .eq('id', stakeholderId)
      .single();
    expect(data?.visibility_profile).toBe('custom');
    expect(data?.can_view_financials).toBe(true);
    expect(data?.can_view_drawings).toBe(false);
    expect(data?.can_view_schedule).toBe(true);
    expect(data?.can_message).toBe(false);
    expect(data?.can_upload_files).toBe(true);
  });

  test("visibilityProfile='full' overrides contradicting customFlags (preset wins, even when customFlags arg is partial)", async () => {
    const { stakeholderId } = await seedStakeholder();
    // Seed at progress_only first so 'full' is a meaningful flip.
    await f.service
      .from('project_stakeholders')
      .update({
        visibility_profile: 'progress_only',
        can_view_financials: false,
      })
      .eq('id', stakeholderId);

    const result = await updateStakeholder({
      stakeholderId,
      visibilityProfile: 'full',
      // The customFlags would set financials=false, but the preset overrides.
      customFlags: { canViewFinancials: false },
    });
    expect(result).toMatchObject({ success: true });

    const { data } = await f.service
      .from('project_stakeholders')
      .select('visibility_profile, can_view_financials')
      .eq('id', stakeholderId)
      .single();
    expect(data?.visibility_profile).toBe('full');
    expect(data?.can_view_financials).toBe(true); // preset value, not customFlags value
  });

  test('audit log captures profile_flipped_to_custom=true on individual flag change', async () => {
    const { stakeholderId } = await seedStakeholder();
    const result = await updateStakeholder({
      stakeholderId,
      customFlags: { canMessage: false },
    });
    expect(result).toMatchObject({ success: true });

    const { data: audit } = await f.service
      .from('audit_logs')
      .select('action, resource_type, metadata')
      .eq('resource_id', stakeholderId)
      .eq('resource_type', 'project_stakeholder')
      .eq('action', 'update');
    expect(audit?.length ?? 0).toBeGreaterThan(0);
    const latest = audit![audit!.length - 1];
    expect((latest.metadata as Record<string, unknown>).profile_flipped_to_custom).toBe(true);
  });
});
