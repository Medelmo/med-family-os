// Serves the same artifact the Docker image runs.
//
// next.config.ts sets `output: "standalone"`, and Next.js explicitly warns
// that `next start` "does not work with output: standalone" — so running
// the E2E suite against `next start` would be testing something other than
// what ships. That distinction is not academic: the production-only
// `UntrustedHost` auth failure (see infrastructure/auth/auth.config.ts)
// was invisible to `next dev` and would have been invisible to any test
// that didn't exercise a production server.
//
// The standalone bundle needs the static assets copied in beside it,
// exactly as the Dockerfile does with its COPY steps.
import { cp, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const standaloneDir = path.join(root, ".next", "standalone");

await access(path.join(standaloneDir, "server.js")).catch(() => {
  throw new Error("No standalone build found. Run `pnpm build` first.");
});

await cp(path.join(root, ".next", "static"), path.join(standaloneDir, ".next", "static"), { recursive: true });
if (existsSync(path.join(root, "public"))) {
  await cp(path.join(root, "public"), path.join(standaloneDir, "public"), { recursive: true });
}

if (existsSync(path.join(root, ".env"))) {
  process.loadEnvFile(path.join(root, ".env"));
}

process.chdir(standaloneDir);
// pathToFileURL, not a bare path: ESM `import()` of an absolute Windows
// path ("C:\...") fails with ERR_UNSUPPORTED_ESM_URL_SCHEME.
await import(pathToFileURL(path.join(standaloneDir, "server.js")).href);
