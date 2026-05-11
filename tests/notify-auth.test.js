import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";

import { generateAndHashApiKey, generateApiKey } from "../functions/lib/notify/keys.js";
import { authenticateNotify, extractBearerToken } from "../functions/lib/notify/auth.js";

beforeAll(async () => {
  await applyD1Migrations(env.KINDPOS_DB, __D1_MIGRATIONS__);
});

beforeEach(async () => {
  await env.KINDPOS_DB.exec("DELETE FROM customers");
});

// ── helpers ────────────────────────────────────────────────────────────────

async function seedCustomer({
  storeRef = "STORE-TEST-1",
  status = "activated",
  withKey = true,
} = {}) {
  let apiKeyHash = null;
  let plaintextKey = null;
  if (withKey) {
    const { key, hash } = await generateAndHashApiKey();
    plaintextKey = key;
    apiKeyHash = hash;
  }
  await env.KINDPOS_DB.prepare(
    `INSERT INTO customers (store_ref, store_name, status, api_key_hash)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(storeRef, "Test Store", status, apiKeyHash)
    .run();
  return { storeRef, plaintextKey, apiKeyHash };
}

function makeRequest(token = null) {
  const headers = token
    ? { Authorization: `Bearer ${token}` }
    : {};
  return new Request("https://kindpos.com/api/notify/activated", {
    method: "POST",
    headers,
  });
}

// ── extractBearerToken ─────────────────────────────────────────────────────

describe("extractBearerToken", () => {
  it("extracts the token from a well-formed header", () => {
    const req = makeRequest("my-secret-token");
    expect(extractBearerToken(req)).toBe("my-secret-token");
  });

  it("returns null when Authorization header is absent", () => {
    expect(extractBearerToken(new Request("https://x/"))).toBeNull();
  });

  it("returns null for a non-Bearer scheme", () => {
    const req = new Request("https://x/", {
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(extractBearerToken(req)).toBeNull();
  });

  it("is case-insensitive on the Bearer prefix", () => {
    const req = new Request("https://x/", {
      headers: { Authorization: "BEARER abc123" },
    });
    expect(extractBearerToken(req)).toBe("abc123");
  });
});

// ── generateApiKey ─────────────────────────────────────────────────────────

describe("generateApiKey", () => {
  it("returns a 43-char base64url string (no +, /, or =)", () => {
    const key = generateApiKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("produces unique values on each call", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a).not.toBe(b);
  });
});

// ── authenticateNotify ─────────────────────────────────────────────────────

describe("authenticateNotify", () => {
  it("returns ok=true for a valid token and active customer", async () => {
    const { storeRef, plaintextKey } = await seedCustomer();
    const req = makeRequest(plaintextKey);
    const result = await authenticateNotify(req, env.KINDPOS_DB, storeRef);
    expect(result.ok).toBe(true);
    expect(result.customer.store_ref).toBe(storeRef);
  });

  it("returns 401 when no Authorization header", async () => {
    const { storeRef } = await seedCustomer();
    const result = await authenticateNotify(
      new Request("https://x/"),
      env.KINDPOS_DB,
      storeRef,
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  it("returns 401 for wrong token", async () => {
    const { storeRef } = await seedCustomer();
    const result = await authenticateNotify(
      makeRequest("totally-wrong-key"),
      env.KINDPOS_DB,
      storeRef,
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  it("returns 401 for unknown store_ref (no enumeration leak)", async () => {
    const { plaintextKey } = await seedCustomer();
    const result = await authenticateNotify(
      makeRequest(plaintextKey),
      env.KINDPOS_DB,
      "STORE-DOES-NOT-EXIST",
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  it("returns 401 when customer has no api_key_hash set", async () => {
    const { storeRef } = await seedCustomer({ withKey: false });
    const result = await authenticateNotify(
      makeRequest("any-key"),
      env.KINDPOS_DB,
      storeRef,
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  it("returns 403 for a cancelled customer with a valid token", async () => {
    const { storeRef, plaintextKey } = await seedCustomer({ status: "cancelled" });
    const result = await authenticateNotify(
      makeRequest(plaintextKey),
      env.KINDPOS_DB,
      storeRef,
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });
});
