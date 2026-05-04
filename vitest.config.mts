import { defineConfig } from 'vitest/config';

// RLS tests run against the local Supabase stack (`supabase start`). Setup file
// loads .env.local for non-Supabase vars and overrides the Supabase URL/keys
// with values fetched from `npx supabase status -o env` so tests never accidentally
// touch the cloud project.
//
// Pool: forks (process per test file) — each test file allocates its own
// two-org fixture; isolation is by separate processes, not shared state.
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
    include: ['tests/**/*.test.ts'],
  },
});
