import { execSync } from "node:child_process";
import { Client } from "pg";
import { TEST_DATABASE_URL } from "./src/domain/grid/test-db";

export default async function setup(): Promise<void> {
  const schema = new URL(TEST_DATABASE_URL).searchParams.get("schema") ?? "public";

  // Drop and recreate the test schema for a clean slate — the Postgres
  // equivalent of the old "delete prisma/test.db before every run" reset.
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await client.end();

  execSync("pnpm exec prisma db push", {
    cwd: __dirname,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "inherit",
  });
}
