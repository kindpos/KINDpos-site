import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

import {
  createAdminUser,
  markAdminUserLogin,
} from "../../../lib/auth/admin_users.js";
import { createAdminSession } from "../../../lib/auth/admin_sessions.js";
import { onRequestGet as meHandler } from "./me.js";

beforeAll(async () => {
  await applyD1Migrations(env.KINDPOS_DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.KINDPOS_DB.exec("DELETE FROM admin_sessions");
  await env.KINDPOS_DB.exec("DELETE FROM admin_users");
});

function makeRequest(sessionId = null) {
  const headers = {};
  if (sessionId) headers.cookie = `kindpos_admin_session=${sessionId}`;
  return new Request("https://kindpos.com/api/admin/auth/me", {
    method: "GET",
    headers,
  });
}

async function seedSession({
  email = "me@kindpos.com",
  role = "super_admin",
  mustChangePassword = false,
} = {}) {
  const userId = await createAdminUser(env.KINDPOS_DB, {
    email,
    passwordPlaintext: "passwordpassword",
    role,
    mustChangePassword,
  });
  await markAdminUserLogin(env.KINDPOS_DB, userId);
  const { sessionId } = await createAdminSession(env.KINDPOS_DB, {
    adminUserId: userId,
  });
  return { userId, sessionId };
}

describe("happy path", () => {
  it("returns 200 with the expected fields", async () => {
    const { userId, sessionId } = await seedSession({
      role: "support",
      mustChangePassword: true,
    });
    const resp = await meHandler({ request: makeRequest(sessionId), env });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body).toEqual({
      user_id: userId,
      email: "me@kindpos.com",
      role: "support",
      must_change_password: true,
      last_login_at: expect.any(String),
    });
  });

  it("never leaks password_hash", async () => {
    const { sessionId } = await seedSession();
    const resp = await meHandler({ request: makeRequest(sessionId), env });
    const body = await resp.json();
    expect(body).not.toHaveProperty("password_hash");
  });
});

describe("rejection paths", () => {
  it("returns 401 with no cookie", async () => {
    const resp = await meHandler({ request: makeRequest(null), env });
    expect(resp.status).toBe(401);
  });

  it("returns 401 for an expired session", async () => {
    const { sessionId } = await seedSession();
    await env.KINDPOS_DB.prepare(
      `UPDATE admin_sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE session_id = ?`,
    )
      .bind(sessionId)
      .run();
    const resp = await meHandler({ request: makeRequest(sessionId), env });
    expect(resp.status).toBe(401);
  });

  it("returns 401 for a revoked session", async () => {
    const { sessionId } = await seedSession();
    await env.KINDPOS_DB.prepare(
      `UPDATE admin_sessions SET revoked = 1 WHERE session_id = ?`,
    )
      .bind(sessionId)
      .run();
    const resp = await meHandler({ request: makeRequest(sessionId), env });
    expect(resp.status).toBe(401);
  });
});

describe("session refresh", () => {
  it("advances expires_at on a successful call", async () => {
    const { sessionId } = await seedSession();
    const before = (
      await env.KINDPOS_DB.prepare(
        `SELECT expires_at FROM admin_sessions WHERE session_id = ?`,
      )
        .bind(sessionId)
        .first()
    ).expires_at;
    await new Promise((r) => setTimeout(r, 25));
    const resp = await meHandler({ request: makeRequest(sessionId), env });
    expect(resp.status).toBe(200);
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
