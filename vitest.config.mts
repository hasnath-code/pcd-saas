import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// RLS tests run against the local Supabase stack (`supabase start`). Setup file
// loads .env.local for non-Supabase vars and overrides the Supabase URL/keys
// with values fetched from `npx supabase status -o env` so tests never accidentally
// touch the cloud project.
//
// Pool: forks (process per test file) — each test file allocates its own
// two-org fixture; isolation is by separate processes, not shared state.
//
// Action tests (tests/actions/*) import from @/ which needs an explicit alias
// here — tsconfig paths aren't honored by vitest without a plugin or this
// resolve.alias. Mirrors tsconfig.json's "@/*": ["./*"].
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
      // server-only's index.js throws when imported outside a Server Component
      // context. Vitest doesn't honor the react-server conditional export, so
      // alias directly to the no-op empty.js. RLS tests don't import any
      // server-only modules — only action tests need this.
      'server-only': resolve(__dirname, 'node_modules/server-only/empty.js'),
    },
  },
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
