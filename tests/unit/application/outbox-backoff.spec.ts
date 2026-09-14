import { describe, expect, it } from "vitest";
import { backoffMs, MAX_ATTEMPTS } from "../../../application/outbox/processOutbox";

describe("outbox backoff", () => {
  it("grows exponentially from the first retry", () => {
    expect(backoffMs(1)).toBe(5_000);
    expect(backoffMs(2)).toBe(10_000);
    expect(backoffMs(3)).toBe(20_000);
    expect(backoffMs(4)).toBe(40_000);
  });

  it("never returns a negative or zero delay, even for a nonsensical attempt count", () => {
    expect(backoffMs(0)).toBeGreaterThan(0);
    expect(backoffMs(-5)).toBeGreaterThan(0);
  });

  it("caps retries so a permanently broken event cannot loop forever", () => {
    expect(MAX_ATTEMPTS).toBeGreaterThan(1);
    expect(MAX_ATTEMPTS).toBeLessThanOrEqual(10);
  });
});
