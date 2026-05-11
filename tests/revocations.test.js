import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";

import { generateAndHashApiKey } from "../functions/lib/notify/keys.js";
import { onRequestGet as revocationsHandler } from "../functions/api/store/[store_ref]/revocations.js";

beforeAll(async () => {
  await applyD1Migrations(env.KINDPOS_DB, __D1_MIGRATIONS__);
});

beforeEach(async () => {
  await env.KINDPOS_DB.exec("DELETE FROM terminals");
  await env.KINDPOS_DB.exec("DELETE FROM customers");
});

async function seedCustomer(storeRef = "STORE-1") {
  const { key, hash } = await generateAndHashApiKey();
  await env.KINDPOS_DB.prepare(
    `INSERT INTO customers (store_ref, store_name, status, api_key_hash) VALUES (?, ?, 'activated', ?)`,
  ).bind(storeRef, "Test Store", hash).run();
  return { storeRef, apiKey: key };
}

async function seedTerminal({ storeRef = "STORE-1", slotId, status = "active", updatedAt }) {
  await env.KINDPOS_DB.prepare(
    `INSERT INTO terminals (license_key, store_ref, status, updated_at, created_at) VALUES (?, ?, ?, ?, datetime('now'))`,
  ).bind(slotId, storeRef, status, updatedAt ?? new Date().toISOString()).run();
}

function makeRequest(storeRef, apiKey, since = null) {
  const url = `https://kindpos.com/api/store/${storeRef}/revocations${since ? `?since=${since}` : ""}`;
  return new Request(url, {
    method: "GET",
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });
}

describe("GET /api/store/{store_ref}/revocations", () => {
  it("returns empty revocations list when no terminals are revoked", async () => {
    const { storeRef, apiKey } = await seedCustomer();
    await seedTerminal({ storeRef, slotId: "KIND-001-AAAA-BBBB-CCCC", status: "active" });

    const resp = await revocationsHandler({
      request: makeRequest(storeRef, apiKey),
      params: { store_ref: storeRef },
      env,
    });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.revocations).toEqual([]);
    expect(body.as_of).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns revoked terminals without a since filter", async () => {
    const { storeRef, apiKey } = await seedCustomer();
    await seedTerminal({ storeRef, slotId: "KIND-001-REVOKED", status: "revoked", updatedAt: "2026-05-09T10:00:00.000Z" });
    await seedTerminal({ storeRef, slotId: "KIND-002-ACTIVE", status: "active" });

    const resp = await revocationsHandler({
      request: makeRequest(storeRef, apiKey),
      params: { store_ref: storeRef },
      env,
    });
    const body = await resp.json();
    expect(body.revocations).toHaveLength(1);
    expect(body.revocations[0].slot_id).toBe("KIND-001-REVOKED");
    expect(body.revocations[0].revoked_at).toBe("2026-05-09T10:00:00.000Z");
  });

  it("filters by since cursor", async () => {
    const { storeRef, apiKey } = await seedCustomer();
    await seedTerminal({ storeRef, slotId: "KIND-OLD", status: "revoked", updatedAt: "2026-05-01T00:00:00.000Z" });
    await seedTerminal({ storeRef, slotId: "KIND-NEW", status: "revoked", updatedAt: "2026-05-10T00:00:00.000Z" });

    const resp = await revocationsHandler({
      request: makeRequest(storeRef, apiKey, "2026-05-05T00:00:00.000Z"),
      params: { store_ref: storeRef },
      env,
    });
    const body = await resp.json();
    expect(body.revocations).toHaveLength(1);
    expect(body.revocations[0].slot_id).toBe("KIND-NEW");
  });

  it("does not return revocations from other stores", async () => {
    const { storeRef, apiKey } = await seedCustomer("STORE-A");
    await seedCustomer("STORE-B");
    await seedTerminal({ storeRef: "STORE-B", slotId: "KIND-OTHER-STORE", status: "revoked" });

    const resp = await revocationsHandler({
      request: makeRequest(storeRef, apiKey),
      params: { store_ref: storeRef },
      env,
    });
    const body = await resp.json();
    expect(body.revocations).toEqual([]);
  });

  it("returns 401 with no Authorization header", async () => {
    const { storeRef } = await seedCustomer();
    const resp = await revocationsHandler({
      request: makeRequest(storeRef, null),
      params: { store_ref: storeRef },
      env,
    });
    expect(resp.status).toBe(401);
  });

  it("returns 401 with wrong token", async () => {
    const { storeRef } = await seedCustomer();
    const resp = await revocationsHandler({
      request: makeRequest(storeRef, "wrong-key"),
      params: { store_ref: storeRef },
      env,
    });
    expect(resp.status).toBe(401);
  });
});
