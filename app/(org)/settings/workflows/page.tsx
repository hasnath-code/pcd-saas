import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAuthOrRedirect } from '@/lib/auth/requireAuth';
import { getMyOrg } from '@/db/queries/orgs';
import {
  countActiveProjectsByWorkflow,
  listOrgWorkflows,
} from '@/db/queries/workflows';
import { CreateWorkflowDialog } from '@/components/workflows/CreateWorkflowDialog';
import { WorkflowsList } from '@/components/workflows/WorkflowsList';

// Org owners + admins manage their custom workflows here. The system "Simple"
// template is cloned per-org at signup so every org has at least one workflow;
// this page lets them tweak that clone or add brand-new pipelines (e.g. the
// PCD Surveyor 10-stage workflow).
//
// Members see the list but the Create/Edit/Delete affordances are gated on
// admin role server-side via the actions themselves; we hide the buttons too
// for cleanliness.
export default async function WorkflowsSettingsPage() {
  const authUser = await requireAuthOrRedirect();
  const myOrg = await getMyOrg(authUser.id);
  if (!myOrg) redirect('/onboarding');

  const canManage = myOrg.role === 'owner' || myOrg.role === 'admin';
  const [workflows, projectCounts] = await Promise.all([
    listOrgWorkflows(myOrg.orgId),
    countActiveProjectsByWorkflow(myOrg.orgId),
  ]);

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-8">
      <div className="space-y-2">
        <p className="text-sm">
          <Link href="/settings" className="text-muted-foreground hover:underline">
            ← Back to settings
          </Link>
        </p>
        <h1 className="text-3xl font-semibold">Workflows</h1>
        <p className="text-muted-foreground">
          A workflow is the ordered set of stages your projects move through.
          Every project is assigned exactly one workflow at creation.
        </p>
        {!canManage && (
          <p className="rounded-md border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            You have read-only access. Only owners and admins can change
            workflows.
          </p>
        )}
      </div>

      <WorkflowsList
        workflows={workflows.map((w) => ({
          workflowId: w.workflowId,
          workflowName: w.workflowName,
          isDefault: w.isDefault,
          stageCount: w.stages.length,
          projectCount: projectCounts.get(w.workflowId) ?? 0,
        }))}
        canManage={canManage}
      />

      {canManage && <CreateWorkflowDialog />}
    </main>
  );
}
