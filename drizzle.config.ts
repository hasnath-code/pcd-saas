import { defineConfig } from 'drizzle-kit';

// drizzle-kit auto-loads .env / .env.local from cwd. Uses DIRECT_URL (port 5432)
// because pooler in transaction mode breaks kit operations (per ARCHITECTURE-saas.md §28).
export default defineConfig({
  schema: './db/schema/*',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DIRECT_URL!,
  },
  // Use snake_case in generated SQL — matches ARCHITECTURE-saas.md §5 column convention
  casing: 'snake_case',
});
