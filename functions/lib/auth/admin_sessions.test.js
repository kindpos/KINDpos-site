import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

import { createAdminUser } from "./admin_users.js";
import {
  createAdminSession,
  getAdminSession,
  refreshAdminSession,
  revokeAdminSession,
} from "./admin_sessions.js";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let adminId;

beforeAll(async () => {
  await applyD1Migrations(env.KINDPOS_DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.KINDPOS_DB.exec("DELETE FROM admin_sessions");
  await env.KINDPOS_DB.exec("DELETE FROM admin_users");
  adminId = await createAdminUser(env.KINDPOS_DB, {
    email: "admin@example.com",
    passwordPlaintext: "passwordpassword",
    role: "super_admin",
  });
});

describe("createAdminSession", () => {
  it("returns a sessionId + expiresAt and the row exists in D1", async () => {
    const { sessionId, expiresAt } = await createAdminSession(env.KINDPOS_DB, {
      adminUserId: adminId,
      ip: "127.0.0.1",
      userAgent: "vitest",
    });
    expect(sessionId).toMatch(UUID_V4);
    expect(expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const sess = await getAdminSession(env.KINDPOS_DB, sessionId);
    expect(sess).not.toBeNull();
    expect(sess.admin_user_id).toBe(adminId);
    expect(sess.ip).toBe("127.0.0.1");
    expect(sess.user_agent).toBe("vitest");
    expect(sess.revoked).toBe(false);
  });
});

describe("getAdminSession", () => {
  it("returns the session before expiry", async () => {
    const { sessionId } = await createAdminSession(env.KINDPOS_DB, {
      adminUserId: adminId,
    });
    const sess = await getAdminSession(env.KINDPOS_DB, sessionId);
    expect(sess).not.toBeNull();
    expect(sess.session_id).toBe(sessionId);
  });

  it("returns null after expiry", async () => {
    const { sessionId } = await createAdminSession(env.KINDPOS_DB, {
      adminUserId: adminId,
    });
    // Bypass the repository and force expiry into the past directly.
    await env.KINDPOS_DB.prepare(
      `UPDATE admin_sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE session_id = ?`,
    )
      .bind(sessionId)
      .run();
    expect(await getAdminSession(env.KINDPOS_DB, sessionId)).toBeNull();
  });

  it("returns null for a revoked session", async () => {
    const { sessionId } = await createAdminSession(env.KINDPOS_DB, {
      adminUserId: adminId,
    });
    await revokeAdminSession(env.KINDPOS_DB, sessionId);
    expect(await getAdminSession(env.KINDPOS_DB, sessionId)).toBeNull();
  });

  it("returns null for an unknown session_id", async () => {
    expect(await getAdminSession(env.KINDPOS_DB, "no-such-session")).toBeNull();
  });
});

describe("refreshAdminSession", () => {
  it("advances expires_at on a live session", async () => {
    const { sessionId, expiresAt: initial } = await createAdminSession(
      env.KINDPOS_DB,
      { adminUserId: adminId },
    );
    // Small wait to guarantee the timestamp can move forward on any clock.
    await new Promise((r) => setTimeout(r, 25));
    await refreshAdminSession(env.KINDPOS_DB, sessionId);
    const refreshed = await getAdminSession(env.KINDPOS_DB, sessionId);
    expect(refreshed).not.toBeNull();
    expect(refreshed.expires_at > initial).toBe(true);
  });

  it("does not resurrect a revoked session", async () => {
    const { sessionId } = await createAdminSession(env.KINDPOS_DB, {
      adminUserId: adminId,
    });
    await revokeAdminSession(env.KINDPOS_DB, sessionId);
    await refreshAdminSession(env.KINDPOS_DB, sessionId);
    expect(await getAdminSession(env.KINDPOS_DB, sessionId)).toBeNull();
  });
});

describe("revokeAdminSession", () => {
  it("causes getAdminSession to return null thereafter", async () => {
    const { sessionId } = await createAdminSession(env.KINDPOS_DB, {
      adminUserId: adminId,
    });
    expect(await getAdminSession(env.KINDPOS_DB, sessionId)).not.toBeNull();
    await revokeAdminSession(env.KINDPOS_DB, sessionId);
    expect(await getAdminSession(env.KINDPOS_DB, sessionId)).toBeNull();
  });
});
