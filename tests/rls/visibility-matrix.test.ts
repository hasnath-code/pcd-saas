import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import {
  buildAcceptedStakeholderFixture,
  type StakeholderFixture,
} from '../fixtures/stakeholder-fixtures';
import {
  applyVisibilityProfile,
  type VisibilityFlags,
  type VisibilityProfile,
} from '@/lib/visibility-profiles';
import { assertNotVisible, assertVisibleIds, assertWriteDenied } from './_helpers';

// Phase B matrix: 5 visibility profiles × 3 currently-protected tables × 4
// operations (SELECT projects, SELECT project_milestones, INSERT/UPDATE/
// DELETE on each of the 3 tables). Parameterized via describe.each + it.each.
//
// Every assertion reaches behavior through auth_user_stakeholder_project_visibility(uuid)
// — the canonical SECURITY DEFINER gate per ARCHITECTURE-saas §14. Tests do
// NOT query project_stakeholders directly to "check what flags are set"; the
// helper function is the contract.
//
// Flags for the 4 named presets are derived from applyVisibilityProfile (the
// single source of truth in lib/visibility-profiles.ts). The 'custom' row uses
// an arbitrary mix that exercises both yes-flag and no-flag paths.
const profiles: Array<{ profile: VisibilityProfile; flags: VisibilityFlags }> = [
  { profile: 'full', flags: applyVisibilityProfile('full') },
  { profile: 'progress_only', flags: applyVisibilityProfile('progress_only') },
  { profile: 'documents_only', flags: applyVisibilityProfile('documents_only') },
  { profile: 'schedule_only', flags: applyVisibilityProfile('schedule_only') },
  {
    profile: 'custom',
    flags: {
      canViewFinancials: true,
      canViewDrawings: false,
      canViewSchedule: false,
      canMessage: true,
      canUploadFiles: false,
    },
  },
];

const TABLES = ['projects', 'project_milestones', 'project_stakeholders'] as const;
type ProtectedTable = (typeof TABLES)[number];

describe.each(profiles)(
  'visibility matrix RLS — $profile profile',
  ({ profile, flags }) => {
    let f: StakeholderFixture;
    let visibleMilestoneId: string;
    let hiddenMilestoneId: string;

    beforeAll(async () => {
      f = await buildAcceptedStakeholderFixture(
        profile,
        profile === 'custom' ? flags : undefined,
      );

      // Two milestones on the project: one explicitly visible to stakeholders,
      // one hidden (visible_to_stakeholders=false). Hidden is invisible to ALL
      // stakeholder profiles, regardless of can_view_schedule.
      visibleMilestoneId = uuidv7();
      hiddenMilestoneId = uuidv7();
      const { error } = await f.service.from('project_milestones').insert([
        {
          id: visibleMilestoneId,
          project_id: f.projectId,
          label: 'Visible to stakeholders',
          visible_to_stakeholders: true,
        },
        {
          id: hiddenMilestoneId,
          project_id: f.projectId,
          label: 'Hidden internal',
          visible_to_stakeholders: false,
        },
      ]);
      if (error) throw new Error(`milestones seed: ${error.message}`);
    });

    afterAll(async () => {
      await f.service
        .from('project_milestones')
        .delete()
        .in('id', [visibleMilestoneId, hiddenMilestoneId]);
      await f.cleanup();
    });

    // ─── SELECT projects ─────────────────────────────────────────────────
    // All 5 profiles see their project — project row visibility is gated by
    // auth_user_stakeholder_projects(), not by sub-resource flags.
    it('stakeholder SELECTs the project they are attached to', async () => {
      if (!f.stakeholderAuth) throw new Error('fixture missing stakeholderAuth');
      await assertVisibleIds(
        f.stakeholderAuth,
        'projects',
        { column: 'id', values: [f.projectId] },
        [f.projectId],
        `${profile}/SELECT projects`,
      );
    });

    // ─── SELECT project_milestones ───────────────────────────────────────
    // Visible milestone: gated by can_view_schedule via the helper.
    it(`stakeholder ${
      flags.canViewSchedule ? 'SELECTs' : 'cannot SELECT'
    } visible milestone (can_view_schedule=${flags.canViewSchedule})`, async () => {
      if (!f.stakeholderAuth) throw new Error('fixture missing stakeholderAuth');
      if (flags.canViewSchedule) {
        await assertVisibleIds(
          f.stakeholderAuth,
          'project_milestones',
          { column: 'id', values: [visibleMilestoneId] },
          [visibleMilestoneId],
          `${profile}/visible milestone visible`,
        );
      } else {
        await assertNotVisible(
          f.stakeholderAuth,
          'project_milestones',
          visibleMilestoneId,
          `${profile}/visible milestone hidden by flag`,
        );
      }
    });

    // Hidden milestone: invisible to ALL stakeholder profiles.
    it('stakeholder cannot SELECT milestone with visible_to_stakeholders=false', async () => {
      if (!f.stakeholderAuth) throw new Error('fixture missing stakeholderAuth');
      await assertNotVisible(
        f.stakeholderAuth,
        'project_milestones',
        hiddenMilestoneId,
        `${profile}/hidden milestone always hidden`,
      );
    });

    // ─── INSERT denial ───────────────────────────────────────────────────
    it.each(TABLES)(
      'stakeholder cannot INSERT into %s',
      async (table: ProtectedTable) => {
        if (!f.stakeholderAuth) throw new Error('fixture missing stakeholderAuth');
        const rowId = uuidv7();
        const minimal: Record<ProtectedTable, Record<string, unknown>> = {
          projects: {
            id: rowId,
            org_id: f.orgId,
            project_number: `P-X-${rowId.slice(0, 6)}`,
            site_address: '1 Test St',
            workflow_id: f.base.extras.orgAWorkflow.id,
            current_stage_id: f.base.extras.orgAWorkflow.firstStageId,
            created_by: f.base.userA.userId,
          },
          project_milestones: {
            id: rowId,
            project_id: f.projectId,
            label: 'Should not insert',
          },
          project_stakeholders: {
            id: rowId,
            project_id: f.projectId,
            client_id: f.clientId,
            role: 'collaborator',
            visibility_profile: 'full',
          },
        };
        // Don't care about the immediate response shape — RLS may surface as
        // either an error or an empty insert. Verify via service-role re-read
        // that no row landed.
        await f.stakeholderAuth.from(table).insert(minimal[table]);
        const { data: verify } = await f.service.from(table).select('id').eq('id', rowId);
        expect(verify ?? [], `${profile}/${table}/INSERT denied verify`).toEqual([]);
      },
    );

    // ─── UPDATE denial ───────────────────────────────────────────────────
    it.each(TABLES)(
      'stakeholder cannot UPDATE in %s',
      async (table: ProtectedTable) => {
        if (!f.stakeholderAuth) throw new Error('fixture missing stakeholderAuth');
        const update: Record<ProtectedTable, Record<string, unknown>> = {
          projects: { site_address: 'HIJACKED' },
          project_milestones: { label: 'HIJACKED' },
          project_stakeholders: { can_view_financials: !flags.canViewFinancials },
        };
        const targetId: Record<ProtectedTable, string> = {
          projects: f.projectId,
          project_milestones: visibleMilestoneId,
          project_stakeholders: f.stakeholderId,
        };
        await assertWriteDenied(
          () =>
            f.stakeholderAuth!
              .from(table)
              .update(update[table])
              .eq('id', targetId[table])
              .select(),
          `${profile}/${table}/UPDATE denied`,
        );
      },
    );

    // ─── DELETE denial ───────────────────────────────────────────────────
    it.each(TABLES)(
      'stakeholder cannot DELETE from %s',
      async (table: ProtectedTable) => {
        if (!f.stakeholderAuth) throw new Error('fixture missing stakeholderAuth');
        // For project_milestones, target the hidden one — preserves the
        // visible milestone for any later assertions.
        const targetId: Record<ProtectedTable, string> = {
          projects: f.projectId,
          project_milestones: hiddenMilestoneId,
          project_stakeholders: f.stakeholderId,
        };
        await assertWriteDenied(
          () => f.stakeholderAuth!.from(table).delete().eq('id', targetId[table]).select(),
          `${profile}/${table}/DELETE denied`,
        );
      },
    );
  },
);
