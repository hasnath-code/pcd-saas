import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import {
  createWorkflowProjectFixture,
  type WorkflowProjectFixture,
} from '../fixtures/with-workflow-and-projects';
import { asOrgUserContext } from '../helpers/sign-in-fixture';

vi.mock('@/lib/auth/requireAuth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/auth/requireAuth')>();
  return {
    ...original,
    requireAuth: vi.fn(),
    requireOrgUser: vi.fn(),
    requireOrgAdmin: vi.fn(),
  };
});

import { findOrCreateClient, updateClient } from '@/actions/clients';
import * as auth from '@/lib/auth/requireAuth';

describe('findOrCreateClient', () => {
  let f: WorkflowProjectFixture;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
  });
  afterAll(async () => {
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireOrgUser).mockResolvedValue(
      asOrgUserContext(f.userA, f.orgA.id, 'owner'),
    );
  });

  test('first call creates client + membership; second call returns same id', async () => {
    const email = `idempotent-${uuidv7()}@test.local`;

    const first = await findOrCreateClient({
      email,
      name: 'First Client',
    });
    expect('error' in first).toBe(false);
    if ('error' in first) return;
    expect(first.data.created).toBe(true);
    const firstId = first.data.clientId;

    const second = await findOrCreateClient({
      email,
      name: 'Second Client',
    });
    expect('error' in second).toBe(false);
    if ('error' in second) return;
    expect(second.data.created).toBe(false);
    expect(second.data.clientId).toBe(firstId);

    // Cleanup.
    await f.service.from('client_org_memberships').delete().eq('client_id', firstId);
    await f.service.from('clients').delete().eq('id', firstId);
  });

  test('validation: bad email → validation_error', async () => {
    const result = await findOrCreateClient({
      email: 'not-an-email',
      name: 'X',
    });
    expect(result).toMatchObject({ error: 'validation_error' });
  });
});

describe('updateClient', () => {
  let f: WorkflowProjectFixture;

  beforeAll(async () => {
    f = await createWorkflowProjectFixture();
  });
  afterAll(async () => {
    await f.cleanup();
  });
  beforeEach(() => {
    vi.mocked(auth.requireOrgUser).mockResolvedValue(
      asOrgUserContext(f.userA, f.orgA.id, 'owner'),
    );
  });

  test('happy path: update own org client', async () => {
    const result = await updateClient({
      clientId: f.extras.orgAClient.id,
      name: 'Renamed',
      phone: '07900 000000',
    });
    expect(result).toEqual({ success: true });

    const { data } = await f.service
      .from('clients')
      .select('name, phone')
      .eq('id', f.extras.orgAClient.id)
      .single();
    expect(data?.name).toBe('Renamed');
    expect(data?.phone).toBe('07900 000000');
  });

  test('cross-org client → not_found (no leak)', async () => {
    const result = await updateClient({
      clientId: f.extras.orgBClient.id,
      name: 'PWNED',
    });
    expect(result).toEqual({ error: 'not_found', reason: 'client' });
  });
});
