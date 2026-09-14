import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Server-only packages that must be require()'d at runtime rather than
  // bundled: each uses a native binding or a dynamic require that a
  // bundler mangles. Found the hard way — without this, `next dev` worked
  // but the production build silently failed sign-in, because the
  // rate limiter's `pg` client threw inside the bundle and the failure was
  // swallowed as "rate limited" (see infrastructure/rate-limit/limiter.ts,
  // whose error handling now distinguishes those two cases).
  serverExternalPackages: ["pg", "postgres", "@node-rs/argon2", "pino", "pino-pretty"],
};

export default withNextIntl(nextConfig);
