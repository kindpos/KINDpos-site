import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";

import { generateAndHashApiKey } from "../functions/lib/notify/keys.js";
import { onRequestPost as activatedHandler } from "../functions/api/notify/activated.js";
import { onRequestPost as terminalBoundHandler } from "../functions/api/notify/terminal-bound.js";

beforeAll(async () => {
  await applyD1Migrations(env.KINDPOS_DB, __D1_MIGRATIONS__);
});

beforeEach(async () => {
  await env.KINDPOS_DB.exec("DELETE FROM provisioning_events");
  await env.KINDPOS_DB.exec("DELETE FROM terminals");
  await env.KINDPOS_DB.exec("DELETE FROM customers");
});

// ── seed helpers ────────────────────────────────────────────────────────────

async function seedCustomer({ storeRef = "STORE-1", status = "shipped" } = {}) {
  const { key, hash } = await generateAndHashApiKey();
  await env.KINDPOS_DB.prepare(
    `INSERT INTO customers (store_ref, store_name, status, api_key_hash)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(storeRef, "Test Store", status, hash)
    .run();
  return { storeRef, apiKey: key };
}

async function seedTerminal({ storeRef = "STORE-1", slotId = "KIND-001-AAAA-BBBB-CCCC" } = {}) {
  await env.KINDPOS_DB.prepare(
    `INSERT INTO terminals (license_key, store_ref, status, created_at)
     VALUES (?, ?, 'pending', datetime('now'))`,
  )
    .bind(slotId, storeRef)
    .run();
  return slotId;
}

function makeRequest(path, apiKey, body) {
  return new Request(`https://kindpos.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      "CF-Connecting-IP": "203.0.113.1",
    },
    body: JSON.stringify(body),
  });
}

// ── POST /api/notify/activated ───────────────────────────────────────────────

describe("POST /api/notify/activated", () => {
  it("returns 204 and updates customer status on valid request", async () => {
    const { storeRef, apiKey } = await seedCustomer();
    const resp = await activatedHandler({
      request: makeRequest("/api/notify/activated", apiKey, {
        store_ref: storeRef,
        activated_at: "2026-05-11T14:00:00Z",
        terminal_count: 2,
      }),
      env,
    });
    expect(resp.status).toBe(204);

    const customer = await env.KINDPOS_DB.prepare(
      `SELECT status, activated_at FROM customers WHERE store_ref = ?`,
    ).bind(storeRef).first();
    expect(customer.status).toBe("activated");
    expect(customer.activated_at).toBe("2026-05-11T14:00:00Z");
  });

  it("inserts a provisioning_events row on success", async () => {
    const { storeRef, apiKey } = await seedCustomer();
    await activatedHandler({
      request: makeRequest("/api/notify/activated", apiKey, {
        store_ref: storeRef,
        activated_at: "2026-05-11T14:00:00Z",
      }),
      env,
    });
    const event = await env.KINDPOS_DB.prepare(
      `SELECT event_type, source_ip FROM provisioning_events WHERE store_ref = ?`,
    ).bind(storeRef).first();
    expect(event.event_type).toBe("activated");
    expect(event.source_ip).toBe("203.0.113.1");
  });

  it("returns 409 if customer is already activated (idempotent)", async () => {
    const { storeRef, apiKey } = await seedCustomer({ status: "activated" });
    const resp = await activatedHandler({
      request: makeRequest("/api/notify/activated", apiKey, {
        store_ref: storeRef,
        activated_at: "2026-05-11T14:00:00Z",
      }),
      env,
    });
    expect(resp.status).toBe(409);
  });

  it("returns 401 with no Authorization header", async () => {
    const { storeRef } = await seedCustomer();
    const resp = await activatedHandler({
      request: makeRequest("/api/notify/activated", null, {
        store_ref: storeRef,
        activated_at: "2026-05-11T14:00:00Z",
      }),
      env,
    });
    expect(resp.status).toBe(401);
  });

  it("returns 401 with wrong token", async () => {
    const { storeRef } = await seedCustomer();
    const resp = await activatedHandler({
      request: makeRequest("/api/notify/activated", "wrong-key", {
        store_ref: storeRef,
        activated_at: "2026-05-11T14:00:00Z",
      }),
      env,
    });
    expect(resp.status).toBe(401);
  });

  it("returns 400 if required fields are missing", async () => {
    const { storeRef, apiKey } = await seedCustomer();
    const resp = await activatedHandler({
      request: makeRequest("/api/notify/activated", apiKey, { store_ref: storeRef }),
      env,
    });
    expect(resp.status).toBe(400);
  });
});

// ── POST /api/notify/terminal-bound ─────────────────────────────────────────

describe("POST /api/notify/terminal-bound", () => {
  it("returns 204 and updates terminal row on valid request", async () => {
    const { storeRef, apiKey } = await seedCustomer({ status: "activated" });
    const slotId = await seedTerminal({ storeRef });
    const resp = await terminalBoundHandler({
      request: makeRequest("/api/notify/terminal-bound", apiKey, {
        store_ref: storeRef,
        slot_id: slotId,
        terminal_name: "Front Counter",
        hardware_fingerprint: "abc123fingerprint",
        bound_at: "2026-05-11T14:30:00Z",
      }),
      env,
    });
    expect(resp.status).toBe(204);

    const terminal = await env.KINDPOS_DB.prepare(
      `SELECT status, hardware_fingerprint, terminal_name FROM terminals WHERE license_key = ?`,
    ).bind(slotId).first();
    expect(terminal.status).toBe("active");
    expect(terminal.hardware_fingerprint).toBe("abc123fingerprint");
    expect(terminal.terminal_name).toBe("Front Counter");
  });

  it("inserts a provisioning_events row on success", async () => {
    const { storeRef, apiKey } = await seedCustomer({ status: "activated" });
    const slotId = await seedTerminal({ storeRef });
    await terminalBoundHandler({
      request: makeRequest("/api/notify/terminal-bound", apiKey, {
        store_ref: storeRef,
        slot_id: slotId,
        terminal_name: "Bar",
        hardware_fingerprint: "fp-bar",
        bound_at: "2026-05-11T14:30:00Z",
      }),
      env,
    });
    const event = await env.KINDPOS_DB.prepare(
      `SELECT event_type FROM provisioning_events WHERE store_ref = ?`,
    ).bind(storeRef).first();
    expect(event.event_type).toBe("terminal_bound");
  });

  it("returns 404 if slot_id does not belong to this customer", async () => {
    const { storeRef, apiKey } = await seedCustomer({ status: "activated" });
    const resp = await terminalBoundHandler({
      request: makeRequest("/api/notify/terminal-bound", apiKey, {
        store_ref: storeRef,
        slot_id: "KIND-999-XXXX-YYYY-ZZZZ",
        hardware_fingerprint: "fp",
        bound_at: "2026-05-11T14:30:00Z",
      }),
      env,
    });
    expect(resp.status).toBe(404);
  });

  it("returns 401 with wrong token", async () => {
    const { storeRef } = await seedCustomer({ status: "activated" });
    const slotId = await seedTerminal({ storeRef });
    const resp = await terminalBoundHandler({
      request: makeRequest("/api/notify/terminal-bound", "wrong", {
        store_ref: storeRef,
        slot_id: slotId,
        hardware_fingerprint: "fp",
        bound_at: "2026-05-11T14:30:00Z",
      }),
      env,
    });
    expect(resp.status).toBe(401);
  });

  it("returns 400 if required fields are missing", async () => {
    const { storeRef, apiKey } = await seedCustomer({ status: "activated" });
    const resp = await terminalBoundHandler({
      request: makeRequest("/api/notify/terminal-bound", apiKey, {
        store_ref: storeRef,
      }),
      env,
    });
    expect(resp.status).toBe(400);
  });
});
