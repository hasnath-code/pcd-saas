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
import { InvoiceFormClient } from '@/components/invoices/InvoiceFormClient';

// Phase 2 Session 13 — create-invoice page. Mirrors quotes/new. Server
// component shell wraps the dynamic-line-items client form.

export default async function NewInvoicePage({
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
        <h1 className="text-2xl font-semibold">New invoice</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoice details</CardTitle>
          <CardDescription>
            Drafts are private until sent. Final invoices require an accepted
            quote on the project.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InvoiceFormClient mode={{ kind: 'create', projectId }} />
        </CardContent>
      </Card>
    </main>
  );
}
