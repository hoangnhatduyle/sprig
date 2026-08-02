import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    globalSetup: ["./vitest.global-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**"],
    // Every domain test file shares one Postgres schema (the "test" schema
    // in local Docker Postgres, see vitest.global-setup.ts). Each spec file's
    // beforeEach wipes shared tables via deleteMany — running spec files
    // concurrently in separate worker threads would race on that shared
    // state (one file's reset clobbering rows another file is mid-assertion
    // on), not a fixture bug but a genuine shared-resource race. Sequential
    // file execution is the simplest fix short of giving each spec file its
    // own schema.
    fileParallelism: false,
  },
});
