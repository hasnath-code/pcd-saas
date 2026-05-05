import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/server';
import { acceptInvitation } from '@/actions/users';

const ERROR_MESSAGES: Record<string, { title: string; body: string }> = {
  invalid: {
    title: 'Invitation not found',
    body: 'This invitation link is invalid or has been revoked.',
  },
  expired: {
    title: 'Invitation expired',
    body: 'This invitation has expired. Ask the person who invited you to send a new one.',
  },
  already_accepted: {
    title: 'Invitation already used',
    body: 'This invitation has already been accepted. Sign in to continue.',
  },
  email_mismatch: {
    title: 'Wrong account',
    body: "This invitation was sent to a different email address. Sign out and sign in with the email it was sent to.",
  },
  multi_org_not_yet_supported: {
    title: 'Multi-org membership coming soon',
    body: "You're already a member of another organization. Contact support@plancraftdaily.com if you need access to this invitation right now.",
  },
};

function ErrorCard({ title, body }: { title: string; body: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{body}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/dashboard">Go to dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Page-level auth check — middleware leaves /invitations/ public so the
  // landing page is reachable without auth, but the accept route needs the
  // user signed in to attribute the new users row.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?invitation=${encodeURIComponent(token)}`);
  }

  const result = await acceptInvitation({ token });
  if ('success' in result) {
    redirect('/dashboard');
  }

  const reason = result.reason ?? result.error;
  const copy =
    ERROR_MESSAGES[reason] ??
    ERROR_MESSAGES[result.error] ??
    {
      title: "Couldn't accept invitation",
      body: `Something went wrong: ${reason}`,
    };
  return <ErrorCard title={copy.title} body={copy.body} />;
}
