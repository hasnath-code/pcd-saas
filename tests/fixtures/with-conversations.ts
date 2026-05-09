import { v7 as uuidv7 } from 'uuid';
import {
  createWorkflowProjectFixture,
  type WorkflowProjectFixture,
} from './with-workflow-and-projects';

export interface ConversationFixtureExtras {
  // One project-tied group conversation per org with the org's user as a
  // participant. Used for the bulk of cross-org isolation assertions.
  orgAConversation: { id: string; participantId: string };
  orgBConversation: { id: string; participantId: string };
  // The Org A client (from base fixture) is a stakeholder participant in
  // orgAConversation. Used for stakeholder-vs-org-user RLS assertions.
  orgAClientParticipantId: string;
  // Auth user backing orgAClient for sign-in tests (signed up via service-role
  // admin.createUser; clients.auth_user_id linked).
  orgAClientAuth: { authUserId: string; email: string; password: string };
  // One sample message in each conversation, sent by the org user, so SELECT
  // tests have something to read.
  orgAMessage: { id: string };
  orgBMessage: { id: string };
}

export interface ConversationsFixture extends WorkflowProjectFixture {
  ext: ConversationFixtureExtras;
}

// Builds on createWorkflowProjectFixture by additionally seeding (via service
// role):
//   - One 'group' conversation per org tied to that org's project
//   - The org's user added as a 'user' participant
//   - The org A client added as a 'client' participant in orgAConversation
//     (with project_stakeholders.can_message=true so message INSERT tests can
//     succeed for the stakeholder branch); a project_stakeholders row + a
//     fresh auth user for clients.auth_user_id
//   - One sample message per conversation
//
// Cleanup is layered: ext cleanup first, base WorkflowProjectFixture cleanup
// after. cascade ON DELETE on the conversation FK handles participants +
// messages on hard-delete of conversations.
export async function createConversationFixture(): Promise<ConversationsFixture> {
  const f = await createWorkflowProjectFixture();
  const ts = Date.now();
  const rnd = Math.random().toString(36).slice(2, 8);

  // 1. Sign up an auth user for orgAClient so the stakeholder-side branch of
  //    the auth_user_conversation_ids() helper has something to match.
  const clientAEmail = `convA-${ts}-${rnd}@test.local`;
  const clientAPassword = `pwClientA-${ts}-${rnd}-x9X`;
  const { data: authDat, error: authErr } = await f.service.auth.admin.createUser({
    email: clientAEmail,
    password: clientAPassword,
    email_confirm: true,
  });
  if (authErr || !authDat?.user) {
    throw new Error(`fixture: clientA auth user: ${authErr?.message ?? 'no user'}`);
  }
  const clientAuthUserId = authDat.user.id;

  // 2. Backfill clients.auth_user_id + email so requireStakeholder() resolves.
  await f.service
    .from('clients')
    .update({
      auth_user_id: clientAuthUserId,
      email: clientAEmail,
    })
    .eq('id', f.extras.orgAClient.id);

  // 3. Create project_stakeholders row so messages_insert_participants
  //    (can_message branch) and visibility helpers resolve.
  const stakeholderId = uuidv7();
  await f.service.from('project_stakeholders').insert({
    id: stakeholderId,
    project_id: f.extras.orgAProject.id,
    client_id: f.extras.orgAClient.id,
    role: 'primary_client',
    visibility_profile: 'full',
    can_message: true,
    invited_by: f.userA.userId,
    accepted_at: new Date().toISOString(),
  });

  // 4. Conversations + participants.
  const orgAConvId = uuidv7();
  const orgBConvId = uuidv7();
  await f.service.from('conversations').insert([
    {
      id: orgAConvId,
      org_id: f.orgA.id,
      project_id: f.extras.orgAProject.id,
      type: 'group',
      name: 'Org A group thread',
      created_by: f.userA.userId,
    },
    {
      id: orgBConvId,
      org_id: f.orgB.id,
      project_id: f.extras.orgBProject.id,
      type: 'group',
      name: 'Org B group thread',
      created_by: f.userB.userId,
    },
  ]);

  const orgAUserParticipantId = uuidv7();
  const orgBUserParticipantId = uuidv7();
  const orgAClientParticipantId = uuidv7();
  await f.service.from('conversation_participants').insert([
    {
      id: orgAUserParticipantId,
      conversation_id: orgAConvId,
      participant_type: 'user',
      participant_id: f.userA.userId,
    },
    {
      id: orgAClientParticipantId,
      conversation_id: orgAConvId,
      participant_type: 'client',
      participant_id: f.extras.orgAClient.id,
    },
    {
      id: orgBUserParticipantId,
      conversation_id: orgBConvId,
      participant_type: 'user',
      participant_id: f.userB.userId,
    },
  ]);

  // 5. One message per conversation, sent by the org user.
  const orgAMessageId = uuidv7();
  const orgBMessageId = uuidv7();
  await f.service.from('messages').insert([
    {
      id: orgAMessageId,
      conversation_id: orgAConvId,
      sender_type: 'user',
      sender_id: f.userA.userId,
      body: 'Hello from Org A',
    },
    {
      id: orgBMessageId,
      conversation_id: orgBConvId,
      sender_type: 'user',
      sender_id: f.userB.userId,
      body: 'Hello from Org B',
    },
  ]);

  const ext: ConversationFixtureExtras = {
    orgAConversation: {
      id: orgAConvId,
      participantId: orgAUserParticipantId,
    },
    orgBConversation: {
      id: orgBConvId,
      participantId: orgBUserParticipantId,
    },
    orgAClientParticipantId,
    orgAClientAuth: {
      authUserId: clientAuthUserId,
      email: clientAEmail,
      password: clientAPassword,
    },
    orgAMessage: { id: orgAMessageId },
    orgBMessage: { id: orgBMessageId },
  };

  const originalCleanup = f.cleanup;
  const cleanup = async () => {
    // ON DELETE CASCADE on conversation_id handles participants + messages.
    await f.service
      .from('conversations')
      .delete()
      .in('id', [orgAConvId, orgBConvId]);
    await f.service.from('project_stakeholders').delete().eq('id', stakeholderId);
    // Detach client.auth_user_id before base cleanup deletes the auth user.
    await f.service
      .from('clients')
      .update({ auth_user_id: null })
      .eq('id', f.extras.orgAClient.id);
    await f.service.auth.admin.deleteUser(clientAuthUserId);
    await originalCleanup();
  };

  return { ...f, ext, cleanup };
}
