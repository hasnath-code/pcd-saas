import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getInvitationByToken } from '@/db/queries/invitations';

const ROLE_LABEL = {
  owner: 'owner',
  admin: 'admin',
  member: 'member',
} as const;

function CardShell({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{body}</CardDescription>
          </CardHeader>
          {cta && <CardContent>{cta}</CardContent>}
        </Card>
      </div>
    </main>
  );
}

export default async function InvitationLandingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await getInvitationByToken(token);

  if (!result) {
    return (
      <CardShell
        title="Invitation not found"
        body="This invitation link is invalid or has been revoked."
      />
    );
  }

  const { invitation, orgName, inviterName } = result;
  const inviter = inviterName ?? 'A teammate';

  if (invitation.acceptedAt !== null) {
    return (
      <CardShell
        title="Invitation already used"
        body="This invitation has already been accepted. Sign in to your account to continue."
        cta={
          <div className="flex justify-center">
            <Button asChild>
              <Link href="/login">Sign in</Link>
            </Button>
          </div>
        }
      />
    );
  }

  if (invitation.expiresAt.getTime() < Date.now()) {
    return (
      <CardShell
        title="Invitation expired"
        body={`This invitation expired on ${invitation.expiresAt.toLocaleDateString('en-GB')}. Ask ${inviter} to send a new one.`}
      />
    );
  }

  if (invitation.invitationType !== 'team_member') {
    return (
      <CardShell
        title="Invitation not supported yet"
        body="Stakeholder invitations land in Phase 1b. Contact your team for a different invitation."
      />
    );
  }

  const roleLabel = invitation.role && invitation.role in ROLE_LABEL
    ? ROLE_LABEL[invitation.role as keyof typeof ROLE_LABEL]
    : 'team member';
  const acceptHref = `/invitations/${token}/accept`;
  const signupHref = `/signup?invitation=${encodeURIComponent(token)}`;
  const loginHref = `/login?invitation=${encodeURIComponent(token)}`;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>You&apos;ve been invited</CardTitle>
            <CardDescription>
              {inviter} has invited you to join <strong>{orgName}</strong> as a{' '}
              <strong>{roleLabel}</strong>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Button asChild>
                <Link href={signupHref}>Sign up</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={loginHref}>Sign in</Link>
              </Button>
            </div>
            <p className="text-center text-xs text-muted-foreground">
              Already signed in?{' '}
              <Link href={acceptHref} className="underline">
                Accept invitation
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
