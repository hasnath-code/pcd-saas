import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { asUser } from '../helpers/as-user';
import { createTwoOrgFixture, type TwoOrgFixture } from '../fixtures/two-orgs';

describe('email_events RLS', () => {
  let f: TwoOrgFixture;
  let webhookId: string;
  let evAId: string;
  let evBId: string;

  beforeAll(async () => {
    f = await createTwoOrgFixture();

    // Need a webhook_events row first (FK from email_events.webhook_event_id)
    webhookId = uuidv7();
    await f.service.from('webhook_events').insert({
      id: webhookId,
      source: 'resend',
      event_type: 'email.sent',
      external_event_id: `evt-${webhookId}`,
      payload: { test: true },
      signature_verified: true,
    });

    evAId = uuidv7();
    evBId = uuidv7();
    await f.service.from('email_events').insert([
      {
        id: evAId,
        webhook_event_id: webhookId,
        org_id: f.orgA.id,
        message_id: `msg-a-${webhookId}`,
        recipient: 'a@test.local',
        event_type: 'sent',
        occurred_at: new Date().toISOString(),
      },
      {
        id: evBId,
        webhook_event_id: webhookId,
        org_id: f.orgB.id,
        message_id: `msg-b-${webhookId}`,
        recipient: 'b@test.local',
        event_type: 'sent',
        occurred_at: new Date().toISOString(),
      },
    ]);
  });
  afterAll(async () => {
    await f.service.from('email_events').delete().in('id', [evAId, evBId]);
    await f.service.from('webhook_events').delete().eq('id', webhookId);
    await f.cleanup();
  });

  test('User A (admin) can SELECT Org A email events', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data, error } = await c.from('email_events').select('id').eq('id', evAId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  test('User A cannot SELECT Org B email events', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { data } = await c.from('email_events').select('id').eq('id', evBId);
    expect(data ?? []).toEqual([]);
  });

  test('User A cannot INSERT email_events (no INSERT policy for users)', async () => {
    const c = await asUser(f.userA.email, f.userA.password);
    const { error } = await c.from('email_events').insert({
      id: uuidv7(),
      webhook_event_id: webhookId,
      org_id: f.orgA.id,
      message_id: `msg-pwn-${uuidv7()}`,
      recipient: 'pwn@test.local',
      event_type: 'sent',
      occurred_at: new Date().toISOString(),
    });
    expect(error).not.toBeNull();
  });
});
