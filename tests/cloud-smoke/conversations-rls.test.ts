import { describe, expect, test } from 'vitest';

// Cloud-smoke check: anon GET on Phase 1c tables must return empty datasets
// (RLS enforces that authenticated reads require a matching identity).
// Mirrors tests/cloud-smoke/projects-rls.test.ts pattern.
//
// Skipped unless CLOUD_SMOKE=1 is set in env (matches the npm run test:cloud-smoke
// gate). The CI workflow .github/workflows/rls-gate.yml sets this.

const CLOUD_SUPABASE_URL = process.env.CLOUD_SUPABASE_URL;
const CLOUD_SUPABASE_ANON_KEY = process.env.CLOUD_SUPABASE_ANON_KEY;

const skip = process.env.CLOUD_SMOKE !== '1' || !CLOUD_SUPABASE_URL || !CLOUD_SUPABASE_ANON_KEY;

const describeOrSkip = skip ? describe.skip : describe;

describeOrSkip('Phase 1c cloud RLS (anon)', () => {
  async function anonGet(table: string): Promise<Response> {
    return fetch(`${CLOUD_SUPABASE_URL}/rest/v1/${table}?select=id&limit=1`, {
      headers: {
        apikey: CLOUD_SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${CLOUD_SUPABASE_ANON_KEY}`,
      },
    });
  }

  test('anon GET /rest/v1/conversations returns empty array', async () => {
    const res = await anonGet('conversations');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toEqual([]);
  });

  test('anon GET /rest/v1/conversation_participants returns empty array', async () => {
    const res = await anonGet('conversation_participants');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toEqual([]);
  });

  test('anon GET /rest/v1/messages returns empty array', async () => {
    const res = await anonGet('messages');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toEqual([]);
  });
});
