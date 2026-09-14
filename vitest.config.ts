import { defineConfig } from "vitest/config";
import { existsSync } from "node:fs";
import path from "node:path";

// Vitest does not auto-load .env the way `next dev`/`next start` do; the
// integration suite needs DATABASE_URL, so load it explicitly here rather
// than requiring every test invocation to `source .env` by hand.
// process.loadEnvFile is a Node built-in (stable since Node 20.6; this
// project requires Node >=22 per package.json engines) — no dependency
// needed for this, unlike importing `loadEnv` from `vite` itself, which
// isn't a direct dependency of a Next.js project and would only be
// reachable as an undeclared phantom dependency through vitest's own
// nested node_modules.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

// Quiet the application logger during tests unless something actually goes
// wrong: the outbox worker logs every processed event at debug level, which
// buries real failures in the runner's output. Warnings and errors still
// print, and an individual run can override this.
process.env.LOG_LEVEL ??= "warn";

const alias = { "@": path.resolve(__dirname, ".") };

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.spec.ts", "tests/security/**/*.spec.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.spec.ts"],
          // Every integration file truncates the same development database
          // between cases, so running two of them at once deadlocks on the
          // TRUNCATE and fails with foreign-key violations from the other
          // file's half-built fixtures. One fork keeps them serial.
          // Separating the projects means the pure unit tests still run in
          // parallel rather than paying for a constraint that is only the
          // database's.
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
  },
});
