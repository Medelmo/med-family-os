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

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.spec.ts", "tests/integration/**/*.spec.ts", "tests/security/**/*.spec.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
