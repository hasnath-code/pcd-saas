import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireAuthOrRedirect } from '@/lib/auth/requireAuth';
import { getMyOrg } from '@/db/queries/orgs';
import { listTeamMembers } from '@/db/queries/team';
import { listPendingInvitations } from '@/db/queries/invitations';
import { TeamMemberList } from '@/components/team/TeamMemberList';
import { PendingInvitationsList } from '@/components/team/PendingInvitationsList';
import { InviteForm } from '@/components/team/InviteForm';

export default async function TeamSettingsPage() {
  const authUser = await requireAuthOrRedirect();
  const myOrg = await getMyOrg(authUser.id);
  if (!myOrg) redirect('/onboarding');

  const canManage = myOrg.role === 'owner' || myOrg.role === 'admin';
  const [members, pending] = await Promise.all([
    listTeamMembers(myOrg.orgId),
    listPendingInvitations(myOrg.orgId),
  ]);

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-8">
      <div className="space-y-2">
        <p className="text-sm">
          <Link href="/dashboard" className="text-muted-foreground hover:underline">
            ← Back to dashboard
          </Link>
        </p>
        <h1 className="text-3xl font-semibold">Team</h1>
        <p className="text-muted-foreground">
          Anyone here can sign in and use {myOrg.orgName}.
        </p>
      </div>

      <TeamMemberList members={members} currentUserId={myOrg.userId} />

      <PendingInvitationsList invitations={pending} />

      {canManage && <InviteForm />}
    </main>
  );
}
