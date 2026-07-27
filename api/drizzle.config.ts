import { defineConfig } from 'drizzle-kit';
import { env } from './src/config/env.js';

// The schema in db/migrations/ is the source of truth (carried over from Flyway).
// This config exists so `drizzle-kit studio` / `drizzle-kit check` can reach the
// database; generated migrations are intentionally not used.
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: env.databaseUrl },
});
