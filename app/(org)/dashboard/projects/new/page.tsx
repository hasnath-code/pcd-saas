import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthError, requireOrgUser } from '@/lib/auth/requireAuth';
import { listOrgWorkflows } from '@/db/queries/workflows';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ProjectCreateForm } from '@/components/projects/ProjectCreateForm';

export default async function NewProjectPage() {
  let ctx;
  try {
    ctx = await requireOrgUser();
  } catch (e) {
    if (e instanceof AuthError) redirect('/onboarding');
    throw e;
  }

  const workflows = await listOrgWorkflows(ctx.orgId);

  if (workflows.length === 0) {
    // Shouldn't happen post-Session-5 (createOrganization atomically clones
    // Simple) but guard for defensive completeness.
    return (
      <main className="mx-auto max-w-2xl space-y-4 p-8">
        <Card>
          <CardHeader>
            <CardTitle>No workflows available</CardTitle>
            <CardDescription>
              Your organization doesn&apos;t have any workflows yet. Contact
              support if you see this — every org should automatically receive
              the default workflow on signup.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/dashboard/projects">Back to projects</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">New project</h1>
          <p className="text-sm text-muted-foreground">
            Add a project to your firm&apos;s workspace.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/projects">Cancel</Link>
        </Button>
      </div>
      <ProjectCreateForm workflows={workflows} />
    </main>
  );
}
