import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AuthError, requireOrgUser } from '@/lib/auth/requireAuth';
import { getProjectByIdForOrg } from '@/db/queries/projects';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { QuoteFormClient } from '@/components/quotes/QuoteFormClient';

// Phase 2 — create-quote page. Server component shell wraps the client-side
// dynamic-line-items form. Org-only; stakeholders cannot reach this route
// (auth.uid() resolves to a clients-row identity, requireOrgUser throws).

export default async function NewQuotePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  let ctx;
  try {
    ctx = await requireOrgUser();
  } catch (e) {
    if (e instanceof AuthError) redirect('/onboarding');
    throw e;
  }

  const { projectId } = await params;
  const project = await getProjectByIdForOrg(projectId, ctx.orgId);
  if (!project) notFound();

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          <Link
            href={`/dashboard/projects/${projectId}`}
            className="hover:underline"
          >
            ← {project.projectNumber}
          </Link>
        </p>
        <h1 className="text-2xl font-semibold">New quote</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quote details</CardTitle>
          <CardDescription>
            Drafts are private until sent. Creating saves a draft you can keep
            editing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <QuoteFormClient mode={{ kind: 'create', projectId }} />
        </CardContent>
      </Card>
    </main>
  );
}
