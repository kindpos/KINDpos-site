import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";

import { createSession, COOKIE_NAME } from "../functions/lib/auth/admin_sessions.js";
import { onRequestPost as markShippedHandler } from "../functions/api/admin/customers/[store_ref]/mark-shipped.js";

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
  const seedReq = new Request("https://kindpos.com/", { headers: { "CF-Connecting-IP": "1.2.3.4" } });
  const { sessionId } = await createSession(env.KINDPOS_DB, "admin-1", seedReq);
  return sessionId;
}

async function seedCustomer({
  storeRef = "STORE-SHIP",
  status = "pending",
  imageR2Key = "images/STORE-SHIP/kindpos-overlay-1.tar.gz",
  pendingApiKeyHash = "pbkdf2:sha256:100000:deadbeef:cafebabe",
  pendingRecoveryCodeHash = "pbkdf2:sha256:100000:beefdead:babecafe",
} = {}) {
  await env.KINDPOS_DB.prepare(
    `INSERT INTO customers (store_ref, store_name, customer_email, status, image_r2_key,
                            pending_api_key_hash, pending_recovery_code_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(storeRef, "Ship Test Store", "owner@example.com", status, imageR2Key, pendingApiKeyHash, pendingRecoveryCodeHash).run();
}

function shipRequest(storeRef, sessionId) {
  return new Request(`https://kindpos.com/api/admin/customers/${storeRef}/mark-shipped`, {
    method: "POST",
    headers: { Cookie: `${COOKIE_NAME}=${sessionId}` },
  });
}

describe("POST /api/admin/customers/:store_ref/mark-shipped", () => {
  it("returns 404 when customer does not exist", async () => {
    const sessionId = await seedAdminSession();
    const resp = await markShippedHandler({
      request: shipRequest("NO-SUCH-STORE", sessionId),
      env,
      params: { store_ref: "NO-SUCH-STORE" },
    });
    expect(resp.status).toBe(404);
    const body = await resp.json();
    expect(body.error).toBe("not_found");
  });

  it("returns 409 image_not_built when image_r2_key is NULL", async () => {
    const sessionId = await seedAdminSession();
    await seedCustomer({ imageR2Key: null });
    const resp = await markShippedHandler({
      request: shipRequest("STORE-SHIP", sessionId),
      env,
      params: { store_ref: "STORE-SHIP" },
    });
    expect(resp.status).toBe(409);
    const body = await resp.json();
    expect(body.error).toBe("image_not_built");
  });

  it("returns 409 wrong_status when status is not 'pending'", async () => {
    const sessionId = await seedAdminSession();
    await seedCustomer({ status: "shipped" });
    const resp = await markShippedHandler({
      request: shipRequest("STORE-SHIP", sessionId),
      env,
      params: { store_ref: "STORE-SHIP" },
    });
    expect(resp.status).toBe(409);
    const body = await resp.json();
    expect(body.error).toBe("wrong_status");
  });

  it("promotes pending hashes to final cols, sets status=shipped, inserts shipped event", async () => {
    const sessionId = await seedAdminSession();
    await seedCustomer();

    const resp = await markShippedHandler({
      request: shipRequest("STORE-SHIP", sessionId),
      env,
      params: { store_ref: "STORE-SHIP" },
    });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.store_ref).toBe("STORE-SHIP");
    expect(body.status).toBe("shipped");
    expect(typeof body.shipped_at).toBe("string");

    const row = await env.KINDPOS_DB.prepare(
      `SELECT status, shipped_at, api_key_hash, recovery_code_hash,
              pending_api_key_hash, pending_recovery_code_hash
       FROM customers WHERE store_ref = ?`,
    ).bind("STORE-SHIP").first();
    expect(row.status).toBe("shipped");
    expect(row.shipped_at).toBe(body.shipped_at);
    expect(row.api_key_hash).toBe("pbkdf2:sha256:100000:deadbeef:cafebabe");
    expect(row.recovery_code_hash).toBe("pbkdf2:sha256:100000:beefdead:babecafe");
    expect(row.pending_api_key_hash).toBeNull();
    expect(row.pending_recovery_code_hash).toBeNull();

    const event = await env.KINDPOS_DB.prepare(
      `SELECT event_type, event_data, occurred_at
       FROM provisioning_events WHERE store_ref = ? AND event_type = 'shipped'`,
    ).bind("STORE-SHIP").first();
    expect(event).not.toBeNull();
    expect(event.event_type).toBe("shipped");
    expect(event.occurred_at).toBe(body.shipped_at);
    const data = JSON.parse(event.event_data);
    expect(data.shipped_at).toBe(body.shipped_at);
    expect(data.shipped_by).toBe("admin-1");
  });
});
