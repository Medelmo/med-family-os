#!/usr/bin/env node
/**
 * Builds the image and scans it, the same way CI does (CLAUDE.md §12).
 *
 * Exists because CI is not the only place this has to be runnable. This
 * repository has no remote and the workflow has never executed on a
 * runner, so a gate that only lives in `ci.yml` is a gate nobody has ever
 * seen run. Everything here is what the workflow's `scan` job does, in a
 * form a person can type.
 *
 * Trivy is used through its own container rather than installed, so this
 * needs nothing but Docker — which is already required to run the
 * application.
 */
import { spawnSync } from "node:child_process";

const IMAGE = process.env.SCAN_IMAGE ?? "med-family-os:scan";
const TRIVY = "aquasec/trivy:latest";

/** The Docker socket, spelled the way each platform's shell needs. */
const SOCKET = process.platform === "win32" ? "//var/run/docker.sock" : "/var/run/docker.sock";

function run(command, args, { capture = false } = {}) {
  const result = spawnSync(command, args, {
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
    // MSYS/Git Bash rewrites anything that looks like a Unix path into a
    // Windows one, which turns the Docker socket mount into a directory it
    // then fails to create. Off for these calls only.
    env: { ...process.env, MSYS_NO_PATHCONV: "1" },
  });

  if (result.error) {
    console.error(`\nCould not run ${command}. Is Docker installed and running?`);
    process.exit(2);
  }
  return result;
}

console.log(`Building ${IMAGE} …`);
if (run("docker", ["build", "-t", IMAGE, "."]).status !== 0) {
  console.error("\nThe image did not build. Nothing to scan.");
  process.exit(1);
}

const trivy = (extra) => [
  "run",
  "--rm",
  "-v",
  `${SOCKET}:/var/run/docker.sock`,
  TRIVY,
  "image",
  "--scanners",
  "vuln",
  "--severity",
  "HIGH,CRITICAL",
  ...extra,
  IMAGE,
];

// Informational first, so the unfixed findings are on screen before the
// gate has a chance to end the run. Somebody choosing whether the base
// image is still the right one needs to see them; a red build must not be
// what forces that decision.
console.log("\n--- Everything HIGH and above, including what has no fix ---");
run("docker", trivy(["--quiet", "--exit-code", "0"]));

console.log("\n--- The gate: HIGH and above with a fix available ---");
const gated = run("docker", trivy(["--quiet", "--ignore-unfixed", "--exit-code", "1"]));

if (gated.status !== 0) {
  console.error("\nThe image has fixable HIGH or CRITICAL vulnerabilities. This is what CI fails on.");
  process.exit(1);
}

console.log("\nNothing fixable outstanding.");
