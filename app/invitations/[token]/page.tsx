import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getInvitationByToken } from '@/db/queries/invitations';

const ROLE_LABEL = {
  owner: 'owner',
  admin: 'admin',
  member: 'member',
} as const;

const STAKEHOLDER_ROLE_LABEL = {
  primary_client: 'the primary client',
  collaborator: 'a collaborator',
  observer: 'an observer',
  billing_contact: 'the billing contact',
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

  const { invitation, orgName, inviterName, projectNumber } = result;
  const inviter = inviterName ?? 'A teammate';

  // Session 5: cancelled invitations get a distinct, accurate message
  // instead of conflating with "not found".
  if (invitation.deletedAt !== null) {
    return (
      <CardShell
        title="Invitation cancelled"
        body="This invitation was cancelled by the organization and is no longer valid. Contact your team if you believe this is a mistake."
      />
    );
  }

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

  const acceptHref = `/invitations/${token}/accept`;
  const signupHref = `/signup?invitation=${encodeURIComponent(token)}`;
  const loginHref = `/login?invitation=${encodeURIComponent(token)}`;

  // Phase 1b Session 6: branch the CTA copy on invitation_type. The
  // signup/signin/accept flow is identical (token preserved through to the
  // accept route, which dispatches to acceptStakeholderInvitation when the
  // invitation_type='stakeholder'). Both branches use the same CardShell-style
  // wrapper with two CTAs + a "Already signed in?" link.
  if (invitation.invitationType === 'stakeholder') {
    const roleLabel =
      invitation.stakeholderRole && invitation.stakeholderRole in STAKEHOLDER_ROLE_LABEL
        ? STAKEHOLDER_ROLE_LABEL[
            invitation.stakeholderRole as keyof typeof STAKEHOLDER_ROLE_LABEL
          ]
        : 'a stakeholder';
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md">
          <Card>
            <CardHeader>
              <CardTitle>You&apos;ve been invited to a project</CardTitle>
              <CardDescription>
                {inviter} from <strong>{orgName}</strong> has invited you to follow
                {projectNumber ? (
                  <>
                    {' '}project <strong>{projectNumber}</strong>
                  </>
                ) : (
                  <> a project</>
                )}{' '}
                as <strong>{roleLabel}</strong>.
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

  if (invitation.invitationType !== 'team_member') {
    return (
      <CardShell
        title="Invitation type unrecognized"
        body="Contact your team — this invitation type isn't recognized."
      />
    );
  }

  const roleLabel = invitation.role && invitation.role in ROLE_LABEL
    ? ROLE_LABEL[invitation.role as keyof typeof ROLE_LABEL]
    : 'team member';

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
