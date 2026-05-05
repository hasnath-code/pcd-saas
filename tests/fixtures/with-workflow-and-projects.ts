import { v7 as uuidv7 } from 'uuid';
import { createTwoOrgFixture, type TwoOrgFixture } from './two-orgs';

export interface WorkflowProjectExtras {
  systemTemplate: { id: string; stageIds: string[] };
  orgAWorkflow: { id: string; firstStageId: string };
  orgBWorkflow: { id: string; firstStageId: string };
  orgAClient: { id: string; membershipId: string };
  orgBClient: { id: string; membershipId: string };
  orgAProject: { id: string; projectNumber: string };
  orgBProject: { id: string; projectNumber: string };
}

export interface WorkflowProjectFixture extends TwoOrgFixture {
  extras: WorkflowProjectExtras;
}

// Extends createTwoOrgFixture by additionally seeding (via service role):
// - the "Simple" system template id + stage ids (verifies the seed migration ran)
// - one cloned non-template workflow per org (mirrors createOrganization's clone)
// - one client per org with a client_org_memberships row
// - one project per org, attached to the cloned workflow's first stage
//
// Cleanup is layered: extras' cleanup runs first, then the underlying two-org
// fixture cleanup (org cascade handles workflow/stages/projects via FK ON
// DELETE CASCADE for workflow_id, but explicit deletes keep test isolation
// tight regardless of FK rules).
export async function createWorkflowProjectFixture(): Promise<WorkflowProjectFixture> {
  const f = await createTwoOrgFixture();
  const ts = Date.now();

  // 1. Resolve system template + its stages.
  const { data: sysWf } = await f.service
    .from('workflows')
    .select('id')
    .eq('slug', 'simple')
    .eq('is_system_template', true)
    .single();
  if (!sysWf) {
    throw new Error('fixture: Simple system template missing — migration 0009 not applied');
  }
  const { data: sysStages } = await f.service
    .from('workflow_stages')
    .select('id, slug, name, position, is_terminal, color')
    .eq('workflow_id', sysWf.id)
    .order('position');
  if (!sysStages || sysStages.length !== 5) {
    throw new Error('fixture: Simple template stages incomplete');
  }

  // 2. Clone the template into both orgs.
  async function cloneWorkflowFor(orgId: string) {
    const newWfId = uuidv7();
    await f.service.from('workflows').insert({
      id: newWfId,
      org_id: orgId,
      slug: 'simple',
      name: 'Simple',
      description: 'Cloned for fixture',
      is_system_template: false,
      is_default: true,
    });
    const newStages = sysStages!.map((s) => ({
      id: uuidv7(),
      workflow_id: newWfId,
      slug: s.slug,
      name: s.name,
      position: s.position,
      is_terminal: s.is_terminal,
      requires_action: false,
      color: s.color,
    }));
    await f.service.from('workflow_stages').insert(newStages);
    return {
      id: newWfId,
      firstStageId: newStages.find((s) => s.position === 1)!.id,
    };
  }
  const orgAWorkflow = await cloneWorkflowFor(f.orgA.id);
  const orgBWorkflow = await cloneWorkflowFor(f.orgB.id);

  // 3. Create one client + membership per org.
  async function makeClient(orgId: string, label: string) {
    const clientId = uuidv7();
    const membershipId = uuidv7();
    const { error: clientErr } = await f.service.from('clients').insert({
      id: clientId,
      email: `client-${label}-${ts}-${uuidv7().slice(0, 8)}@test.local`,
      name: `Client ${label}`,
    });
    if (clientErr) throw new Error(`fixture: client insert: ${clientErr.message}`);
    const { error: memErr } = await f.service.from('client_org_memberships').insert({
      id: membershipId,
      client_id: clientId,
      org_id: orgId,
    });
    if (memErr) throw new Error(`fixture: membership insert: ${memErr.message}`);
    return { id: clientId, membershipId };
  }
  const orgAClient = await makeClient(f.orgA.id, 'A');
  const orgBClient = await makeClient(f.orgB.id, 'B');

  // 4. Create one project per org.
  async function makeProject(
    orgId: string,
    workflowId: string,
    firstStageId: string,
    creatorUserId: string,
    label: string,
  ) {
    const projectId = uuidv7();
    const projectNumber = `P-${label}-${ts}`;
    const { error } = await f.service.from('projects').insert({
      id: projectId,
      org_id: orgId,
      project_number: projectNumber,
      site_address: `${label} Test Lane, Anytown`,
      workflow_id: workflowId,
      current_stage_id: firstStageId,
      created_by: creatorUserId,
    });
    if (error) throw new Error(`fixture: project insert: ${error.message}`);
    return { id: projectId, projectNumber };
  }
  const orgAProject = await makeProject(
    f.orgA.id,
    orgAWorkflow.id,
    orgAWorkflow.firstStageId,
    f.userA.userId,
    'A',
  );
  const orgBProject = await makeProject(
    f.orgB.id,
    orgBWorkflow.id,
    orgBWorkflow.firstStageId,
    f.userB.userId,
    'B',
  );

  const extras: WorkflowProjectExtras = {
    systemTemplate: { id: sysWf.id, stageIds: sysStages.map((s) => s.id) },
    orgAWorkflow,
    orgBWorkflow,
    orgAClient,
    orgBClient,
    orgAProject,
    orgBProject,
  };

  const originalCleanup = f.cleanup;
  const cleanup = async () => {
    // Extras first; org cleanup handles cascading FKs but explicit deletes
    // keep the test ledger clean.
    await f.service
      .from('projects')
      .delete()
      .in('id', [orgAProject.id, orgBProject.id]);
    await f.service
      .from('client_org_memberships')
      .delete()
      .in('id', [orgAClient.membershipId, orgBClient.membershipId]);
    await f.service
      .from('clients')
      .delete()
      .in('id', [orgAClient.id, orgBClient.id]);
    // workflow_stages cascade with workflow.
    await f.service
      .from('workflows')
      .delete()
      .in('id', [orgAWorkflow.id, orgBWorkflow.id]);
    await originalCleanup();
  };

  return { ...f, extras, cleanup };
}
