import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

import {
  __testing__,
  checkAdminLoginRateLimit,
  clearAdminLoginFailures,
  recordAdminLoginFailure,
} from "./rate_limit.js";

const { EMAIL_CAP, IP_CAP, WINDOW_SECONDS } = __testing__;

beforeAll(async () => {
  await applyD1Migrations(env.KINDPOS_DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.KINDPOS_DB.exec("DELETE FROM admin_login_attempts");
});

async function recordN(n, attrs) {
  for (let i = 0; i < n; i++) {
    await recordAdminLoginFailure(env.KINDPOS_DB, attrs);
  }
}

describe("checkAdminLoginRateLimit", () => {
  it("returns ok=true on a clean counter", async () => {
    const res = await checkAdminLoginRateLimit(env.KINDPOS_DB, {
      email: "a@b.com",
      ip: "10.0.0.1",
    });
    expect(res.ok).toBe(true);
  });

  it("blocks once the per-email cap is reached", async () => {
    await recordN(EMAIL_CAP, { email: "burst@example.com", ip: "10.0.0.1" });
    const res = await checkAdminLoginRateLimit(env.KINDPOS_DB, {
      email: "burst@example.com",
      ip: "10.0.0.99", // different IP so per-IP cap wouldn't fire
    });
    expect(res.ok).toBe(false);
    expect(res.retryAfter).toBeGreaterThan(0);
  });

  it("blocks once the per-IP cap is reached even with varying emails", async () => {
    // Use a unique email per attempt so per-email never trips.
    for (let i = 0; i < IP_CAP; i++) {
      await recordAdminLoginFailure(env.KINDPOS_DB, {
        email: `unique${i}@example.com`,
        ip: "10.0.0.42",
      });
    }
    const res = await checkAdminLoginRateLimit(env.KINDPOS_DB, {
      email: "fresh@example.com",
      ip: "10.0.0.42",
    });
    expect(res.ok).toBe(false);
  });

  it("treats different IPs as independent counters", async () => {
    for (let i = 0; i < IP_CAP; i++) {
      await recordAdminLoginFailure(env.KINDPOS_DB, {
        email: `e${i}@example.com`,
        ip: "10.0.0.50",
      });
    }
    const res = await checkAdminLoginRateLimit(env.KINDPOS_DB, {
      email: "x@example.com",
      ip: "10.0.0.51",
    });
    expect(res.ok).toBe(true);
  });

  it("ignores failures outside the trailing window", async () => {
    // Backdate failures to outside the window — they should not count.
    const stale = `datetime('now', '-${WINDOW_SECONDS + 60} seconds')`;
    for (let i = 0; i < EMAIL_CAP; i++) {
      await env.KINDPOS_DB.prepare(
        `INSERT INTO admin_login_attempts (ip, email, failed_at)
         VALUES (?, ?, ${stale})`,
      )
        .bind("10.0.0.7", "stale@example.com")
        .run();
    }
    const res = await checkAdminLoginRateLimit(env.KINDPOS_DB, {
      email: "stale@example.com",
      ip: "10.0.0.7",
    });
    expect(res.ok).toBe(true);
  });

  it("permits exactly CAP-1 failures before tripping", async () => {
    await recordN(EMAIL_CAP - 1, { email: "edge@example.com", ip: "10.0.0.3" });
    expect(
      (
        await checkAdminLoginRateLimit(env.KINDPOS_DB, {
          email: "edge@example.com",
          ip: "10.0.0.3",
        })
      ).ok,
    ).toBe(true);
    await recordAdminLoginFailure(env.KINDPOS_DB, {
      email: "edge@example.com",
      ip: "10.0.0.3",
    });
    expect(
      (
        await checkAdminLoginRateLimit(env.KINDPOS_DB, {
          email: "edge@example.com",
          ip: "10.0.0.3",
        })
      ).ok,
    ).toBe(false);
  });
});

describe("clearAdminLoginFailures", () => {
  it("resets only the targeted email", async () => {
    await recordN(EMAIL_CAP, { email: "wipe@example.com", ip: "10.0.0.1" });
    await recordN(2, { email: "keep@example.com", ip: "10.0.0.1" });

    await clearAdminLoginFailures(env.KINDPOS_DB, "wipe@example.com");

    expect(
      (
        await checkAdminLoginRateLimit(env.KINDPOS_DB, {
          email: "wipe@example.com",
          ip: "10.0.0.99",
        })
      ).ok,
    ).toBe(true);
    // Other email's counter intact.
    const otherRow = await env.KINDPOS_DB.prepare(
      `SELECT COUNT(*) AS c FROM admin_login_attempts WHERE email = ?`,
    )
      .bind("keep@example.com")
      .first();
    expect(otherRow.c).toBe(2);
  });

  it("is case-insensitive on email", async () => {
    await recordN(EMAIL_CAP, { email: "MixedCase@example.com", ip: "10.0.0.1" });
    await clearAdminLoginFailures(env.KINDPOS_DB, "mixedcase@example.com");
    expect(
      (
        await checkAdminLoginRateLimit(env.KINDPOS_DB, {
          email: "mixedcase@example.com",
          ip: "10.0.0.99",
        })
      ).ok,
    ).toBe(true);
  });
});
