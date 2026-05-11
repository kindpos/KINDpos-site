import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

import {
  createAdminUser,
  getAdminUserByEmail,
  getAdminUserById,
  listAdminUsers,
  markAdminUserLogin,
  setAdminUserActive,
  updateAdminUserPassword,
  verifyAdminUserPassword,
} from "./admin_users.js";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

beforeAll(async () => {
  await applyD1Migrations(env.KINDPOS_DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  // Per-test isolation: each test runs against an empty admin_users table.
  await env.KINDPOS_DB.exec("DELETE FROM admin_sessions");
  await env.KINDPOS_DB.exec("DELETE FROM admin_users");
});

describe("createAdminUser", () => {
  it("returns a UUID v4 and persists a fetchable row", async () => {
    const id = await createAdminUser(env.KINDPOS_DB, {
      email: "alex@kindpos.com",
      passwordPlaintext: "supersecret-12345",
      role: "super_admin",
    });
    expect(id).toMatch(UUID_V4);
    const user = await getAdminUserById(env.KINDPOS_DB, id);
    expect(user).not.toBeNull();
    expect(user.email).toBe("alex@kindpos.com");
    expect(user.role).toBe("super_admin");
    expect(user.is_active).toBe(true);
    expect(user.must_change_password).toBe(false);
  });

  it("never exposes password_hash on returned objects", async () => {
    const id = await createAdminUser(env.KINDPOS_DB, {
      email: "a@b.com",
      passwordPlaintext: "secretsecret-1",
      role: "support",
    });
    const byId = await getAdminUserById(env.KINDPOS_DB, id);
    const byEmail = await getAdminUserByEmail(env.KINDPOS_DB, "a@b.com");
    const listed = await listAdminUsers(env.KINDPOS_DB);
    for (const u of [byId, byEmail, ...listed]) {
      expect(u).not.toHaveProperty("password_hash");
    }
  });

  it("rejects duplicate emails (case-insensitive)", async () => {
    await createAdminUser(env.KINDPOS_DB, {
      email: "dup@example.com",
      passwordPlaintext: "passwordpassword",
      role: "support",
    });
    await expect(
      createAdminUser(env.KINDPOS_DB, {
        email: "DUP@example.com",
        passwordPlaintext: "another-password!",
        role: "read_only",
      }),
    ).rejects.toThrow();
  });

  it("rejects invalid role via CHECK constraint", async () => {
    await expect(
      createAdminUser(env.KINDPOS_DB, {
        email: "bad@example.com",
        passwordPlaintext: "passwordpassword",
        role: "hacker",
      }),
    ).rejects.toThrow();
  });
});

describe("getAdminUserByEmail", () => {
  it("matches case-insensitively", async () => {
    await createAdminUser(env.KINDPOS_DB, {
      email: "Mixed.Case@Example.com",
      passwordPlaintext: "passwordpassword",
      role: "super_admin",
    });
    const upper = await getAdminUserByEmail(
      env.KINDPOS_DB,
      "MIXED.CASE@EXAMPLE.COM",
    );
    const lower = await getAdminUserByEmail(
      env.KINDPOS_DB,
      "mixed.case@example.com",
    );
    expect(upper).not.toBeNull();
    expect(lower).not.toBeNull();
    expect(upper.id).toBe(lower.id);
  });

  it("returns null for unknown email", async () => {
    expect(await getAdminUserByEmail(env.KINDPOS_DB, "ghost@nowhere")).toBeNull();
  });
});

describe("verifyAdminUserPassword", () => {
  it("returns true for correct, false for wrong", async () => {
    const id = await createAdminUser(env.KINDPOS_DB, {
      email: "v@example.com",
      passwordPlaintext: "correctpassword!!",
      role: "super_admin",
    });
    expect(
      await verifyAdminUserPassword(env.KINDPOS_DB, id, "correctpassword!!"),
    ).toBe(true);
    expect(
      await verifyAdminUserPassword(env.KINDPOS_DB, id, "wrong-password-123"),
    ).toBe(false);
  });

  it("returns false for unknown user", async () => {
    expect(
      await verifyAdminUserPassword(env.KINDPOS_DB, "no-such-id", "anything"),
    ).toBe(false);
  });
});

describe("updateAdminUserPassword", () => {
  it("rotates the hash, invalidates old password, clears must_change_password", async () => {
    const id = await createAdminUser(env.KINDPOS_DB, {
      email: "r@example.com",
      passwordPlaintext: "old-password-12345",
      role: "super_admin",
      mustChangePassword: true,
    });
    expect(
      (await getAdminUserById(env.KINDPOS_DB, id)).must_change_password,
    ).toBe(true);

    await updateAdminUserPassword(env.KINDPOS_DB, id, "new-password-12345");

    expect(
      await verifyAdminUserPassword(env.KINDPOS_DB, id, "old-password-12345"),
    ).toBe(false);
    expect(
      await verifyAdminUserPassword(env.KINDPOS_DB, id, "new-password-12345"),
    ).toBe(true);
    expect(
      (await getAdminUserById(env.KINDPOS_DB, id)).must_change_password,
    ).toBe(false);
  });
});

describe("markAdminUserLogin", () => {
  it("sets last_login_at from null to a timestamp", async () => {
    const id = await createAdminUser(env.KINDPOS_DB, {
      email: "l@example.com",
      passwordPlaintext: "passwordpassword",
      role: "support",
    });
    expect((await getAdminUserById(env.KINDPOS_DB, id)).last_login_at).toBeNull();
    await markAdminUserLogin(env.KINDPOS_DB, id);
    expect(
      (await getAdminUserById(env.KINDPOS_DB, id)).last_login_at,
    ).not.toBeNull();
  });
});

describe("setAdminUserActive + listAdminUsers", () => {
  it("excludes inactive users by default and includes them with the flag", async () => {
    const activeId = await createAdminUser(env.KINDPOS_DB, {
      email: "active@example.com",
      passwordPlaintext: "passwordpassword",
      role: "super_admin",
    });
    const inactiveId = await createAdminUser(env.KINDPOS_DB, {
      email: "inactive@example.com",
      passwordPlaintext: "passwordpassword",
      role: "read_only",
    });
    await setAdminUserActive(env.KINDPOS_DB, inactiveId, false);

    const defaultIds = (await listAdminUsers(env.KINDPOS_DB)).map((u) => u.id);
    expect(defaultIds).toContain(activeId);
    expect(defaultIds).not.toContain(inactiveId);

    const fullIds = (await listAdminUsers(env.KINDPOS_DB, true)).map(
      (u) => u.id,
    );
    expect(fullIds).toContain(activeId);
    expect(fullIds).toContain(inactiveId);
  });

  it("can re-activate a previously deactivated user", async () => {
    const id = await createAdminUser(env.KINDPOS_DB, {
      email: "toggle@example.com",
      passwordPlaintext: "passwordpassword",
      role: "support",
    });
    await setAdminUserActive(env.KINDPOS_DB, id, false);
    expect((await getAdminUserById(env.KINDPOS_DB, id)).is_active).toBe(false);
    await setAdminUserActive(env.KINDPOS_DB, id, true);
    expect((await getAdminUserById(env.KINDPOS_DB, id)).is_active).toBe(true);
  });
});
