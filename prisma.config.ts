import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Deliberately not prisma/config's `env()` helper: it resolves eagerly
    // at config-load time and throws for every prisma command, including
    // `generate` — which only reads schema.prisma and never opens a
    // connection. Reading process.env directly means `generate` (run from
    // postinstall, before DATABASE_URL is necessarily set — e.g. a fresh
    // CI/deploy install step) still succeeds; `migrate`/`db push`/`studio`
    // still fail with a clear connection error if DATABASE_URL is actually
    // missing when one of them tries to connect.
    //
    // DIRECT_URL (not DATABASE_URL) on purpose: `migrate deploy`/`migrate dev`
    // take a session-level `pg_advisory_lock` for the duration of the
    // migration, which requires a persistent connection. Neon's pooled
    // endpoint (hostname with "-pooler", used by DATABASE_URL for the app's
    // runtime queries via @prisma/adapter-pg in src/lib/prisma.ts) proxies
    // through PgBouncer in transaction mode, where each statement can land on
    // a different backend connection — the lock is never visible to whichever
    // connection checks for it next, so migrate hangs until P1002. DIRECT_URL
    // should point at Neon's direct/unpooled connection string. Falls back to
    // DATABASE_URL for local dev, where there's typically one non-pooled
    // Postgres instance and no separate direct endpoint to speak of.
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
