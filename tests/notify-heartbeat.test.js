import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";

import { generateAndHashApiKey } from "../functions/lib/notify/keys.js";
import { onRequestPost as heartbeatHandler } from "../functions/api/notify/heartbeat.js";

beforeAll(async () => {
  await applyD1Migrations(env.KINDPOS_DB, __D1_MIGRATIONS__);
});

beforeEach(async () => {
  await env.KINDPOS_DB.exec("DELETE FROM provisioning_events");
  await env.KINDPOS_DB.exec("DELETE FROM customers");
});

async function seedCustomer({
  storeRef = "STORE-1",
  supportStatus = "monthly",
} = {}) {
  const { key, hash } = await generateAndHashApiKey();
  await env.KINDPOS_DB.prepare(
    `INSERT INTO customers (store_ref, store_name, status, api_key_hash, support_status)
     VALUES (?, ?, 'activated', ?, ?)`,
  )
    .bind(storeRef, "Test Store", hash, supportStatus)
    .run();
  return { storeRef, apiKey: key };
}

function makeRequest(apiKey, body) {
  return new Request("https://kindpos.com/api/notify/heartbeat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "CF-Connecting-IP": "10.0.0.1",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const validPayload = (storeRef) => ({
  store_ref: storeRef,
  as_of: "2026-05-11T23:59:00Z",
  overseer_version: "2.0.0",
  terminal_count_bound: 2,
  orders_24h: 87,
  last_shift_end: "2026-05-11T22:00:00Z",
  error_count_24h: 0,
});

describe("POST /api/notify/heartbeat", () => {
  it("returns 204 and records event for support-subscribed customer", async () => {
    const { storeRef, apiKey } = await seedCustomer({ supportStatus: "monthly" });
    const resp = await heartbeatHandler({
      request: makeRequest(apiKey, validPayload(storeRef)),
      env,
    });
    expect(resp.status).toBe(204);

    const event = await env.KINDPOS_DB.prepare(
      `SELECT event_type FROM provisioning_events WHERE store_ref = ?`,
    ).bind(storeRef).first();
    expect(event.event_type).toBe("heartbeat");
  });

  it("returns 204 but does NOT record event for non-subscribed customer", async () => {
    const { storeRef, apiKey } = await seedCustomer({ supportStatus: "none" });
    const resp = await heartbeatHandler({
      request: makeRequest(apiKey, validPayload(storeRef)),
      env,
    });
    expect(resp.status).toBe(204);

    const event = await env.KINDPOS_DB.prepare(
      `SELECT event_type FROM provisioning_events WHERE store_ref = ?`,
    ).bind(storeRef).first();
    expect(event).toBeNull();
  });

  it("returns 204 for annual support subscription", async () => {
    const { storeRef, apiKey } = await seedCustomer({ supportStatus: "annual" });
    const resp = await heartbeatHandler({
      request: makeRequest(apiKey, validPayload(storeRef)),
      env,
    });
    expect(resp.status).toBe(204);

    const event = await env.KINDPOS_DB.prepare(
      `SELECT event_type FROM provisioning_events WHERE store_ref = ?`,
    ).bind(storeRef).first();
    expect(event.event_type).toBe("heartbeat");
  });

  it("does not update customers row (read-only per §7.3)", async () => {
    const { storeRef, apiKey } = await seedCustomer();
    const before = await env.KINDPOS_DB.prepare(
      `SELECT activated_at, status FROM customers WHERE store_ref = ?`,
    ).bind(storeRef).first();

    await heartbeatHandler({
      request: makeRequest(apiKey, validPayload(storeRef)),
      env,
    });

    const after = await env.KINDPOS_DB.prepare(
      `SELECT activated_at, status FROM customers WHERE store_ref = ?`,
    ).bind(storeRef).first();

    expect(after.status).toBe(before.status);
    expect(after.activated_at).toBe(before.activated_at);
  });

  it("returns 401 with no Authorization header", async () => {
    const { storeRef } = await seedCustomer();
    const resp = await heartbeatHandler({
      request: makeRequest(null, validPayload(storeRef)),
      env,
    });
    expect(resp.status).toBe(401);
  });

  it("returns 401 with wrong token", async () => {
    const { storeRef } = await seedCustomer();
    const resp = await heartbeatHandler({
      request: makeRequest("wrong-key", validPayload(storeRef)),
      env,
    });
    expect(resp.status).toBe(401);
  });

  it("returns 400 when store_ref or as_of is missing", async () => {
    const { storeRef, apiKey } = await seedCustomer();
    const resp = await heartbeatHandler({
      request: makeRequest(apiKey, { store_ref: storeRef }),
      env,
    });
    expect(resp.status).toBe(400);
  });
});
