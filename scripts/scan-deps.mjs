#!/usr/bin/env node
/**
 * The dependency gate (CLAUDE.md §12), runnable however pnpm was invoked.
 *
 * A one-line `"scan:deps": "pnpm audit --audit-level high"` is the obvious
 * spelling and it is subtly wrong: it assumes `pnpm` is on PATH. It is
 * under `pnpm/action-setup` in CI and on a machine with a global install,
 * and it is **not** when pnpm is run through corepack — which is how a
 * fresh checkout runs it, since corepack ships with Node and this project
 * needs no global install otherwise. The script failed exactly that way
 * the first time it was run.
 *
 * `npm_execpath` is set by every package manager to its own entry point,
 * so re-entering through it works no matter how the outer call was made.
 *
 * Fails on HIGH and above. Everything below is printed and does not fail
 * the build: a gate that fires on findings nobody can act on is a gate
 * people learn to pass by ignoring.
 */
import { spawnSync } from "node:child_process";

/**
 * How to re-enter the package manager.
 *
 * `npm_execpath` is *not* always a JavaScript file. pnpm 12 installed
 * through corepack points it at `pnpm-native.exe`, and running
 * `node pnpm-native.exe` fails with ERR_UNKNOWN_FILE_EXTENSION.
 *
 * That mattered more than it looks: the crash exits non-zero, so the gate
 * "failed the build" on a vulnerable tree and appeared to work. It was
 * only visible by reading the output of a run that was supposed to fail —
 * a check that cannot tell a real finding from its own crash is not a
 * check.
 */
const execPath = process.env.npm_execpath;
const isScript = execPath ? /\.(c|m)?js$/i.test(execPath) : false;

const [command, baseArgs] = execPath
  ? isScript
    ? [process.execPath, [execPath]]
    : [execPath, []]
  : // No package manager in the environment at all — a bare
    // `node scripts/scan-deps.mjs`. PATH is the only option left.
    ["pnpm", []];

// Reported in full first, so a moderate advisory is visible to whoever is
// deciding whether it matters rather than silently under the threshold.
console.log("--- Every advisory, at any severity ---");
spawnSync(command, [...baseArgs, "audit"], { stdio: "inherit" });

console.log("\n--- The gate: high and above ---");
const gated = spawnSync(command, [...baseArgs, "audit", "--audit-level", "high"], { stdio: "inherit" });

if (gated.error) {
  console.error("\nCould not run pnpm audit.");
  process.exit(2);
}

if (gated.status !== 0) {
  console.error("\nA high or critical advisory is outstanding. This is what CI fails on.");
  process.exit(1);
}

console.log("\nNothing high or above outstanding.");
