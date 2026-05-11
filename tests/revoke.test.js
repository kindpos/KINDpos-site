import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";

import { createSession, COOKIE_NAME } from "../functions/lib/auth/admin_sessions.js";
import { onRequest as revokeHandler } from "../functions/api/admin/revoke.js";
import { onRequest as deleteCustomerHandler } from "../functions/api/admin/customers/[store_ref].js";
import { onRequestGet as revocationsHandler } from "../functions/api/store/[store_ref]/revocations.js";
import { generateAndHashApiKey } from "../functions/lib/notify/keys.js";

beforeAll(async () => {
  await applyD1Migrations(env.KINDPOS_DB, __D1_MIGRATIONS__);
});

beforeEach(async () => {
  await env.KINDPOS_DB.exec("DELETE FROM provisioning_events");
  await env.KINDPOS_DB.exec("DELETE FROM terminals");
  await env.KINDPOS_DB.exec("DELETE FROM customers");
  await env.KINDPOS_DB.exec("DELETE FROM admin_sessions");
  await env.KINDPOS_DB.exec("DELETE FROM admin_users");
});

async function seedAdminSession() {
  await env.KINDPOS_DB.prepare(
    `INSERT INTO admin_users (user_id, email, password_hash, created_at, updated_at)
     VALUES ('admin-1', 'admin@kindpos.com', 'x', datetime('now'), datetime('now'))`,
  ).run();
  const seedReq = new Request("https://kindpos.com/", {
    headers: { "CF-Connecting-IP": "1.2.3.4" },
  });
  const { sessionId } = await createSession(env.KINDPOS_DB, "admin-1", seedReq);
  return sessionId;
}

async function seedCustomer(storeRef = "STORE-1") {
  const { key, hash } = await generateAndHashApiKey();
  await env.KINDPOS_DB.prepare(
    `INSERT INTO customers (store_ref, store_name, status, api_key_hash)
     VALUES (?, ?, 'activated', ?)`,
  ).bind(storeRef, "Test Store", hash).run();
  return { storeRef, apiKey: key };
}

async function seedTerminal({ storeRef = "STORE-1", licenseKey, status = "active", updatedAt = "2026-01-01T00:00:00.000Z" }) {
  await env.KINDPOS_DB.prepare(
    `INSERT INTO terminals (license_key, store_ref, status, updated_at, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
  ).bind(licenseKey, storeRef, status, updatedAt).run();
}

function adminRequest(path, sessionId, body) {
  return new Request(`https://kindpos.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Cookie: `${COOKIE_NAME}=${sessionId}`,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/revoke", () => {
  it("sets updated_at on the revoked terminal", async () => {
    const sessionId = await seedAdminSession();
    await seedCustomer();
    await seedTerminal({ licenseKey: "KIND-001-AAAA-BBBB-CCCC", updatedAt: "2026-01-01T00:00:00.000Z" });

    const before = await env.KINDPOS_DB.prepare(
      `SELECT updated_at FROM terminals WHERE license_key = ?`,
    ).bind("KIND-001-AAAA-BBBB-CCCC").first();
    expect(before.updated_at).toBe("2026-01-01T00:00:00.000Z");

    const resp = await revokeHandler({
      request: adminRequest("/api/admin/revoke", sessionId, { license_key: "KIND-001-AAAA-BBBB-CCCC" }),
      env,
    });
    expect(resp.status).toBe(200);

    const after = await env.KINDPOS_DB.prepare(
      `SELECT status, hardware_fingerprint, updated_at FROM terminals WHERE license_key = ?`,
    ).bind("KIND-001-AAAA-BBBB-CCCC").first();
    expect(after.status).toBe("revoked");
    expect(after.hardware_fingerprint).toBeNull();
    expect(after.updated_at).not.toBe("2026-01-01T00:00:00.000Z");
    expect(after.updated_at).not.toBeNull();
    expect(typeof after.updated_at).toBe("string");
  });

  it("revoked terminal appears in /api/store/{store_ref}/revocations cursor poll", async () => {
    const sessionId = await seedAdminSession();
    const { storeRef, apiKey } = await seedCustomer();
    await seedTerminal({ storeRef, licenseKey: "KIND-INTEG-001", updatedAt: "2026-01-01T00:00:00.000Z" });

    const revokeResp = await revokeHandler({
      request: adminRequest("/api/admin/revoke", sessionId, { license_key: "KIND-INTEG-001" }),
      env,
    });
    expect(revokeResp.status).toBe(200);

    const pollResp = await revocationsHandler({
      request: new Request(`https://kindpos.com/api/store/${storeRef}/revocations`, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
      params: { store_ref: storeRef },
      env,
    });
    expect(pollResp.status).toBe(200);
    const body = await pollResp.json();
    expect(body.revocations).toHaveLength(1);
    expect(body.revocations[0].slot_id).toBe("KIND-INTEG-001");
    expect(body.revocations[0].revoked_at).not.toBeNull();
  });
});

describe("DELETE /api/admin/customers/{store_ref}", () => {
  it("removes the customer plus its terminals and provisioning_events atomically", async () => {
    const sessionId = await seedAdminSession();
    await seedCustomer("STORE-DEL");
    await seedTerminal({ storeRef: "STORE-DEL", licenseKey: "KIND-DEL-1" });
    await seedTerminal({ storeRef: "STORE-DEL", licenseKey: "KIND-DEL-2" });
    await env.KINDPOS_DB.prepare(
      `INSERT INTO provisioning_events (event_id, store_ref, event_type, event_data)
       VALUES (?, ?, 'activated', '{}')`,
    ).bind("evt-1", "STORE-DEL").run();
    await env.KINDPOS_DB.prepare(
      `INSERT INTO provisioning_events (event_id, store_ref, event_type, event_data)
       VALUES (?, ?, 'terminal_bound', '{}')`,
    ).bind("evt-2", "STORE-DEL").run();

    const resp = await deleteCustomerHandler({
      request: new Request("https://kindpos.com/api/admin/customers/STORE-DEL", {
        method: "DELETE",
        headers: { Cookie: `${COOKIE_NAME}=${sessionId}` },
      }),
      params: { store_ref: "STORE-DEL" },
      env,
    });
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ deleted: "STORE-DEL" });

    const customer = await env.KINDPOS_DB.prepare(
      `SELECT 1 FROM customers WHERE store_ref = ?`,
    ).bind("STORE-DEL").first();
    expect(customer).toBeNull();

    const terminalCount = await env.KINDPOS_DB.prepare(
      `SELECT COUNT(*) AS n FROM terminals WHERE store_ref = ?`,
    ).bind("STORE-DEL").first();
    expect(terminalCount.n).toBe(0);

    const eventCount = await env.KINDPOS_DB.prepare(
      `SELECT COUNT(*) AS n FROM provisioning_events WHERE store_ref = ?`,
    ).bind("STORE-DEL").first();
    expect(eventCount.n).toBe(0);
  });
});
