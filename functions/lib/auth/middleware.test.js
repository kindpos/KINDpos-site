import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

import { createAdminUser } from "./admin_users.js";
import {
  createAdminSession,
  revokeAdminSession,
} from "./admin_sessions.js";
import {
  buildClearCookie,
  buildSessionCookie,
  getSessionCookieName,
  parseSessionCookie,
  requireAdminAuth,
  requireAdminRole,
} from "./middleware.js";

beforeAll(async () => {
  await applyD1Migrations(env.KINDPOS_DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.KINDPOS_DB.exec("DELETE FROM admin_sessions");
  await env.KINDPOS_DB.exec("DELETE FROM admin_users");
});

describe("getSessionCookieName", () => {
  it("returns the spec-fixed cookie name", () => {
    expect(getSessionCookieName()).toBe("kindpos_admin_session");
  });
});

describe("parseSessionCookie", () => {
  function reqWithCookie(value) {
    return new Request("https://x/", { headers: { cookie: value } });
  }

  it("returns null when no cookie header is set", () => {
    expect(parseSessionCookie(new Request("https://x/"))).toBeNull();
  });

  it("returns null when the session cookie is not present", () => {
    expect(parseSessionCookie(reqWithCookie("other=value"))).toBeNull();
  });

  it("extracts the session_id when present alongside other cookies", () => {
    const req = reqWithCookie("foo=bar; kindpos_admin_session=abc123; baz=qux");
    expect(parseSessionCookie(req)).toBe("abc123");
  });

  it("returns null for an empty cookie value", () => {
    expect(parseSessionCookie(reqWithCookie("kindpos_admin_session="))).toBeNull();
  });
});

describe("buildSessionCookie", () => {
  it("includes HttpOnly Secure SameSite=Strict Path=/ Max-Age and Expires", () => {
    const cookie = buildSessionCookie(
      "session-uuid",
      "2026-05-11T14:00:00.000Z",
    );
    expect(cookie).toContain("kindpos_admin_session=session-uuid");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=86400");
    expect(cookie).toMatch(/Expires=[A-Z][a-z]{2}, /);
  });
});

describe("buildClearCookie", () => {
  it("emits a Max-Age=0 Expires-in-the-past cookie", () => {
    const cookie = buildClearCookie();
    expect(cookie).toContain("kindpos_admin_session=;");
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
  });
});

async function seedUserAndSession(email = "guard@example.com") {
  const userId = await createAdminUser(env.KINDPOS_DB, {
    email,
    passwordPlaintext: "guard-password-12",
    role: "super_admin",
  });
  const { sessionId } = await createAdminSession(env.KINDPOS_DB, {
    adminUserId: userId,
  });
  return { userId, sessionId };
}

function reqWithSession(sessionId) {
  return new Request("https://x/", {
    headers: { cookie: `kindpos_admin_session=${sessionId}` },
  });
}

describe("requireAdminAuth", () => {
  it("throws 401 when no cookie is present", async () => {
    let thrown = null;
    try {
      await requireAdminAuth(new Request("https://x/"), env);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Response);
    expect(thrown.status).toBe(401);
  });

  it("throws 401 for an unknown session_id", async () => {
    let thrown = null;
    try {
      await requireAdminAuth(reqWithSession("no-such-session"), env);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Response);
    expect(thrown.status).toBe(401);
  });

  it("throws 401 for a revoked session", async () => {
    const { sessionId } = await seedUserAndSession();
    await revokeAdminSession(env.KINDPOS_DB, sessionId);
    let thrown = null;
    try {
      await requireAdminAuth(reqWithSession(sessionId), env);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Response);
    expect(thrown.status).toBe(401);
  });

  it("throws 401 for an expired session", async () => {
    const { sessionId } = await seedUserAndSession();
    await env.KINDPOS_DB.prepare(
      `UPDATE admin_sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE session_id = ?`,
    )
      .bind(sessionId)
      .run();
    let thrown = null;
    try {
      await requireAdminAuth(reqWithSession(sessionId), env);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Response);
    expect(thrown.status).toBe(401);
  });

  it("returns the session and refreshes expires_at on success", async () => {
    const { sessionId } = await seedUserAndSession();
    const before = (
      await env.KINDPOS_DB.prepare(
        `SELECT expires_at FROM admin_sessions WHERE session_id = ?`,
      )
        .bind(sessionId)
        .first()
    ).expires_at;
    await new Promise((r) => setTimeout(r, 25));
    const session = await requireAdminAuth(reqWithSession(sessionId), env);
    expect(session.session_id).toBe(sessionId);
    const after = (
      await env.KINDPOS_DB.prepare(
        `SELECT expires_at FROM admin_sessions WHERE session_id = ?`,
      )
        .bind(sessionId)
        .first()
    ).expires_at;
    expect(after > before).toBe(true);
  });
});

describe("requireAdminRole", () => {
  it("throws 403 when the user's role is not in the allowed list", async () => {
    const { sessionId } = await seedUserAndSession();
    const session = await requireAdminAuth(reqWithSession(sessionId), env);
    let thrown = null;
    try {
      await requireAdminRole(session, env, "support");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Response);
    expect(thrown.status).toBe(403);
  });

  it("returns the user when role matches", async () => {
    const { sessionId } = await seedUserAndSession();
    const session = await requireAdminAuth(reqWithSession(sessionId), env);
    const user = await requireAdminRole(session, env, "super_admin");
    expect(user.role).toBe("super_admin");
    expect(user).not.toHaveProperty("password_hash");
  });

  it("throws 401 when the linked user is inactive", async () => {
    const { userId, sessionId } = await seedUserAndSession();
    await env.KINDPOS_DB.prepare(
      `UPDATE admin_users SET is_active = 0 WHERE id = ?`,
    )
      .bind(userId)
      .run();
    const session = await requireAdminAuth(reqWithSession(sessionId), env);
    let thrown = null;
    try {
      await requireAdminRole(session, env, "super_admin");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Response);
    expect(thrown.status).toBe(401);
  });
});
