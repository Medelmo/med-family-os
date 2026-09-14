// Ambient URLPattern Web API types.
//
// Next.js 16.3.5's bundled type declarations
// (next/dist/server/web/spec-extension/url-pattern.d.ts) reference a global
// `URLPattern` (plus `URLPatternInput`/`URLPatternOptions`), but neither
// TypeScript 5.9.3's bundled lib.dom.d.ts nor @types/node 22.20.2 declare
// it yet, so `tsc --noEmit` fails on a stock `pnpm install` with this
// repository's pinned versions. This is a stopgap for that gap between
// dependency versions — delete this file once a `pnpm typecheck` run stays
// clean without it (re-check after any Next.js/TypeScript/@types/node
// version bump).
interface URLPatternInit {
  protocol?: string;
  username?: string;
  password?: string;
  hostname?: string;
  port?: string;
  pathname?: string;
  search?: string;
  hash?: string;
  baseURL?: string;
}

type URLPatternInput = string | URLPatternInit;

interface URLPatternOptions {
  ignoreCase?: boolean;
}

interface URLPatternComponentResult {
  input: string;
  groups: Record<string, string | undefined>;
}

interface URLPatternResult {
  inputs: [URLPatternInit | string] | [URLPatternInit | string, string];
  protocol: URLPatternComponentResult;
  username: URLPatternComponentResult;
  password: URLPatternComponentResult;
  hostname: URLPatternComponentResult;
  port: URLPatternComponentResult;
  pathname: URLPatternComponentResult;
  search: URLPatternComponentResult;
  hash: URLPatternComponentResult;
}

interface URLPattern {
  test(input?: URLPatternInput, baseURL?: string): boolean;
  exec(input?: URLPatternInput, baseURL?: string): URLPatternResult | null;
  readonly protocol: string;
  readonly username: string;
  readonly password: string;
  readonly hostname: string;
  readonly port: string;
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
  readonly hasRegExpGroups: boolean;
}
