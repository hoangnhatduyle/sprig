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
    url: process.env.DATABASE_URL ?? "",
  },
});
