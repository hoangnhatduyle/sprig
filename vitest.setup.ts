import "@testing-library/jest-dom/vitest";
import { TEST_DATABASE_URL } from "./src/domain/grid/test-db";

// src/lib/prisma.ts's app-wide singleton throws if DATABASE_URL is unset
// (fail-fast instead of silently falling back to a hardcoded dev path).
// Some component tests import modules that transitively reference that
// singleton (without ever querying through it — mutations are injected as
// mocked props), so it still needs a valid value here, pointed at the same
// disposable test database the domain test suites use.
process.env.DATABASE_URL ??= TEST_DATABASE_URL;
