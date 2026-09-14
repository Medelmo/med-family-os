import pino from "pino";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

// ADR-010: declarative redaction, not per-call-site discipline. Extend this
// list whenever a new SENSITIVE/HIGHLY_SENSITIVE field is added anywhere in
// the domain model (docs/domain/domain-model.md) — this is a standing
// review item for every schema change, not a one-time setup.
const REDACT_PATHS = [
  "*.password",
  "*.passwordHash",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "*.sessionToken",
  "*.authSecret",
  "*.haReadonlyToken",
  "*.databaseUrl",
  "req.headers.authorization",
  "req.headers.cookie",
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } }
      : undefined,
});

// Per-request correlation ID (docs/security/security-model.md: "request
// correlation IDs"). Populated by middleware.ts for every request; read
// anywhere in the application/domain layers without threading a parameter
// through every function call.
const correlationStorage = new AsyncLocalStorage<{ requestId: string }>();

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return correlationStorage.run({ requestId }, fn);
}

export function getRequestId(): string | undefined {
  return correlationStorage.getStore()?.requestId;
}

export function newRequestId(): string {
  // A random ID, not the user ID or email (ADR-010): traceable without
  // being user-identifying on its own.
  return randomUUID();
}

export function requestLogger() {
  const requestId = getRequestId();
  return requestId ? logger.child({ requestId }) : logger;
}
