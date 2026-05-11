import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

import { createAdminUser } from "../../../lib/auth/admin_users.js";
import { onRequestPost as loginHandler } from "./login.js";

beforeAll(async () => {
  await applyD1Migrations(env.KINDPOS_DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.KINDPOS_DB.exec("DELETE FROM admin_login_attempts");
  await env.KINDPOS_DB.exec("DELETE FROM admin_sessions");
  await env.KINDPOS_DB.exec("DELETE FROM admin_users");
});

function makeLoginRequest({ email, password, ip = "203.0.113.1" }) {
  return new Request("https://kindpos.com/api/admin/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": ip,
    },
    body: JSON.stringify({ email, password }),
  });
}

async function seedAdmin({
  email = "admin@kindpos.com",
  password = "supersecret-1234",
  role = "super_admin",
  mustChangePassword = false,
  isActive = true,
} = {}) {
  const id = await createAdminUser(env.KINDPOS_DB, {
    email,
    passwordPlaintext: password,
    role,
    mustChangePassword,
  });
  if (!isActive) {
    await env.KINDPOS_DB.prepare(
      `UPDATE admin_users SET is_active = 0 WHERE id = ?`,
    )
      .bind(id)
      .run();
  }
  return id;
}

describe("happy path", () => {
  it("returns 200 with user fields and a Set-Cookie", async () => {
    const id = await seedAdmin({ mustChangePassword: true });
    const resp = await loginHandler({
      request: makeLoginRequest({
        email: "admin@kindpos.com",
        password: "supersecret-1234",
      }),
      env,
    });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.user_id).toBe(id);
    expect(body.email).toBe("admin@kindpos.com");
    expect(body.role).toBe("super_admin");
    expect(body.must_change_password).toBe(true);
    expect(body.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const setCookie = resp.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("kindpos_admin_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Max-Age=86400");
  });

  it("matches email case-insensitively", async () => {
    await seedAdmin({ email: "Mixed@Kindpos.com" });
    const resp = await loginHandler({
      request: makeLoginRequest({
        email: "mixed@kindpos.com",
        password: "supersecret-1234",
      }),
      env,
    });
    expect(resp.status).toBe(200);
  });
});

describe("credential failures", () => {
  it("returns identical 401 generic body for wrong password and unknown email", async () => {
    await seedAdmin();
    const wrongPassword = await loginHandler({
      request: makeLoginRequest({
        email: "admin@kindpos.com",
        password: "totally-wrong-123",
      }),
      env,
    });
    const unknownEmail = await loginHandler({
      request: makeLoginRequest({
        email: "ghost@kindpos.com",
        password: "totally-wrong-123",
      }),
      env,
    });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(await wrongPassword.json()).toEqual({ error: "invalid credentials" });
    expect(await unknownEmail.json()).toEqual({ error: "invalid credentials" });
  });

  it("returns 423 for an inactive user", async () => {
    await seedAdmin({ isActive: false });
    const resp = await loginHandler({
      request: makeLoginRequest({
        email: "admin@kindpos.com",
        password: "supersecret-1234",
      }),
      env,
    });
    expect(resp.status).toBe(423);
  });

  it("returns 400 when body is missing fields", async () => {
    const resp = await loginHandler({
      request: new Request("https://kindpos.com/api/admin/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "admin@kindpos.com" }),
      }),
      env,
    });
    expect(resp.status).toBe(400);
  });
});

describe("rate limiting", () => {
  it("returns 429 with Retry-After after 5 same-email failures", async () => {
    await seedAdmin();
    for (let i = 0; i < 5; i++) {
      const r = await loginHandler({
        request: makeLoginRequest({
          email: "admin@kindpos.com",
          password: "totally-wrong-123",
        }),
        env,
      });
      expect(r.status).toBe(401);
    }
    const sixth = await loginHandler({
      request: makeLoginRequest({
        email: "admin@kindpos.com",
        password: "totally-wrong-123",
      }),
      env,
    });
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get("retry-after")).toMatch(/^\d+$/);
  });

  it("returns 429 after 20 same-IP failures across different emails", async () => {
    for (let i = 0; i < 20; i++) {
      // Each unique email keeps per-email counter at 1 so per-IP fires first.
      await loginHandler({
        request: makeLoginRequest({
          email: `ghost${i}@kindpos.com`,
          password: "totally-wrong-123",
          ip: "203.0.113.50",
        }),
        env,
      });
    }
    const next = await loginHandler({
      request: makeLoginRequest({
        email: "ghost-final@kindpos.com",
        password: "totally-wrong-123",
        ip: "203.0.113.50",
      }),
      env,
    });
    expect(next.status).toBe(429);
  });

  it("successful login clears the per-email counter", async () => {
    await seedAdmin();
    // Burn 4 failures (still under the per-email cap of 5).
    for (let i = 0; i < 4; i++) {
      const r = await loginHandler({
        request: makeLoginRequest({
          email: "admin@kindpos.com",
          password: "totally-wrong-123",
        }),
        env,
      });
      expect(r.status).toBe(401);
    }
    // Successful login clears.
    const ok = await loginHandler({
      request: makeLoginRequest({
        email: "admin@kindpos.com",
        password: "supersecret-1234",
      }),
      env,
    });
    expect(ok.status).toBe(200);
    // Five more failures should all 401 (not 429) — the bucket was reset.
    for (let i = 0; i < 5; i++) {
      const r = await loginHandler({
        request: makeLoginRequest({
          email: "admin@kindpos.com",
          password: "totally-wrong-123",
        }),
        env,
      });
      expect(r.status).toBe(401);
    }
    // The sixth in the new batch should finally 429.
    const trip = await loginHandler({
      request: makeLoginRequest({
        email: "admin@kindpos.com",
        password: "totally-wrong-123",
      }),
      env,
    });
    expect(trip.status).toBe(429);
  });
});
