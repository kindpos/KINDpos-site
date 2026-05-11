import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

import { createAdminUser } from "../../../lib/auth/admin_users.js";
import {
  createAdminSession,
  revokeAdminSession,
} from "../../../lib/auth/admin_sessions.js";
import { onRequestPost as logoutHandler } from "./logout.js";

beforeAll(async () => {
  await applyD1Migrations(env.KINDPOS_DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.KINDPOS_DB.exec("DELETE FROM admin_sessions");
  await env.KINDPOS_DB.exec("DELETE FROM admin_users");
});

function makeLogoutRequest(sessionId = null) {
  const headers = { "content-type": "application/json" };
  if (sessionId) headers.cookie = `kindpos_admin_session=${sessionId}`;
  return new Request("https://kindpos.com/api/admin/auth/logout", {
    method: "POST",
    headers,
  });
}

async function seedAuthedSession() {
  const userId = await createAdminUser(env.KINDPOS_DB, {
    email: "logout@kindpos.com",
    passwordPlaintext: "passwordpassword",
    role: "super_admin",
  });
  const { sessionId } = await createAdminSession(env.KINDPOS_DB, {
    adminUserId: userId,
  });
  return { userId, sessionId };
}

describe("happy path", () => {
  it("revokes the session and returns 204 with a clear-cookie header", async () => {
    const { sessionId } = await seedAuthedSession();
    const resp = await logoutHandler({
      request: makeLogoutRequest(sessionId),
      env,
    });
    expect(resp.status).toBe(204);

    const setCookie = resp.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("kindpos_admin_session=;");
    expect(setCookie).toContain("Max-Age=0");
    expect(setCookie).toContain("Expires=Thu, 01 Jan 1970");

    const row = await env.KINDPOS_DB.prepare(
      `SELECT revoked FROM admin_sessions WHERE session_id = ?`,
    )
      .bind(sessionId)
      .first();
    expect(row.revoked).toBe(1);
  });
});

describe("rejection paths", () => {
  it("returns 401 when no session cookie is present", async () => {
    const resp = await logoutHandler({ request: makeLogoutRequest(null), env });
    expect(resp.status).toBe(401);
  });

  it("returns 401 when the session is already revoked", async () => {
    const { sessionId } = await seedAuthedSession();
    await revokeAdminSession(env.KINDPOS_DB, sessionId);
    const resp = await logoutHandler({
      request: makeLogoutRequest(sessionId),
      env,
    });
    expect(resp.status).toBe(401);
  });

  it("returns 401 for an unknown session_id", async () => {
    const resp = await logoutHandler({
      request: makeLogoutRequest("no-such-session"),
      env,
    });
    expect(resp.status).toBe(401);
  });
});
