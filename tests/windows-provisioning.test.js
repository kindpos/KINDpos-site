import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import { unzipSync, strFromU8 } from "fflate";

import { createSession, COOKIE_NAME } from "../functions/lib/auth/admin_sessions.js";
import { hashToken } from "../functions/lib/auth/password.js";
import { onRequestPost as buildImageHandler } from "../functions/api/admin/customers/[store_ref]/build-image.js";
import { onRequestGet as downloadHandler } from "../functions/api/provision/download.js";

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
  storeRef = "STORE-WIN",
  storeName = "Win Test Store",
  email = "owner@example.com",
  status = "pending",
} = {}) {
  await env.KINDPOS_DB.prepare(
    `INSERT INTO customers (store_ref, store_name, customer_email, status)
     VALUES (?, ?, ?, ?)`,
  ).bind(storeRef, storeName, email, status).run();
}

async function seedTerminal({ storeRef = "STORE-WIN", licenseKey, nodeNumber, terminalName = null }) {
  await env.KINDPOS_DB.prepare(
    `INSERT INTO terminals (license_key, store_ref, terminal_name, node_number, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))`,
  ).bind(licenseKey, storeRef, terminalName, nodeNumber).run();
}

function buildWindowsRequest(storeRef, sessionId) {
  return new Request(`https://kindpos.com/api/admin/customers/${storeRef}/build-image`, {
    method: "POST",
    headers: {
      Cookie: `${COOKIE_NAME}=${sessionId}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ platform: "windows" }),
  });
}

function downloadRequest(token) {
  return new Request(`https://kindpos.com/api/provision/download?token=${token}`, {
    method: "GET",
  });
}

function extractTokenFromUrl(provisioningUrl) {
  return new URL(provisioningUrl).searchParams.get("token");
}

describe("POST /api/admin/customers/:store_ref/build-image — platform=windows (§4.4)", () => {
  it("returns windows artifact + provisioning_url, writes windows columns", async () => {
    const sessionId = await seedAdminSession();
    await seedCustomer({ storeName: "Windows Store", email: "win@example.com" });
    await seedTerminal({ licenseKey: "KIND-W-1", nodeNumber: 1 });
    await seedTerminal({ licenseKey: "KIND-W-2", nodeNumber: 2 });

    const resp = await buildImageHandler({
      request: buildWindowsRequest("STORE-WIN", sessionId),
      env,
      params: { store_ref: "STORE-WIN" },
    });
    expect(resp.status).toBe(200);
    const body = await resp.json();

    expect(body.platform).toBe("windows");
    expect(body.windows_image_r2_key).toMatch(/^images\/STORE-WIN\/kindpos-provisioning-\d+\.zip$/);
    expect(typeof body.windows_image_built_at).toBe("string");
    expect(body.provisioning_url).toMatch(/^https:\/\/kindpos\.com\/api\/provision\/download\?token=[A-Za-z0-9_-]+$/);
    expect(body.image_r2_key).toBeUndefined();
    expect(body.terminal_count).toBe(2);
    expect(body.welcome_email_preview).toContain(body.provisioning_url);

    const obj = await env.KINDPOS_IMAGES.get(body.windows_image_r2_key);
    expect(obj).not.toBeNull();
    const zipBytes = new Uint8Array(await obj.arrayBuffer());
    const entries = unzipSync(zipBytes);
    expect(entries["accounts.db"]).toBeDefined();
    expect(entries["kindpos.toml"]).toBeDefined();
    expect(strFromU8(entries["kindpos.toml"])).toContain('store_name = "Windows Store"');

    const token = extractTokenFromUrl(body.provisioning_url);
    const expectedHash = await hashToken(token);
    const row = await env.KINDPOS_DB.prepare(
      `SELECT windows_image_r2_key, windows_image_built_at, installer_token_hash,
              pending_api_key_hash, pending_recovery_code_hash, image_r2_key
       FROM customers WHERE store_ref = ?`,
    ).bind("STORE-WIN").first();
    expect(row.windows_image_r2_key).toBe(body.windows_image_r2_key);
    expect(row.windows_image_built_at).toBe(body.windows_image_built_at);
    expect(row.installer_token_hash).toBe(expectedHash);
    expect(row.pending_api_key_hash).not.toBeNull();
    expect(row.pending_recovery_code_hash).not.toBeNull();
    expect(row.image_r2_key).toBeNull();
  });

  it("returns 400 invalid_platform for an unsupported platform value", async () => {
    const sessionId = await seedAdminSession();
    await seedCustomer();
    await seedTerminal({ licenseKey: "KIND-W-1", nodeNumber: 1 });
    const req = new Request("https://kindpos.com/api/admin/customers/STORE-WIN/build-image", {
      method: "POST",
      headers: { Cookie: `${COOKIE_NAME}=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ platform: "mac" }),
    });
    const resp = await buildImageHandler({ request: req, env, params: { store_ref: "STORE-WIN" } });
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toBe("invalid_platform");
  });
});

describe("GET /api/provision/download — §7.7", () => {
  async function buildWindowsPackage() {
    const sessionId = await seedAdminSession();
    await seedCustomer();
    await seedTerminal({ licenseKey: "KIND-W-1", nodeNumber: 1 });
    const resp = await buildImageHandler({
      request: buildWindowsRequest("STORE-WIN", sessionId),
      env,
      params: { store_ref: "STORE-WIN" },
    });
    expect(resp.status).toBe(200);
    return resp.json();
  }

  it("returns 400 missing_token when token query param is absent", async () => {
    const resp = await downloadHandler({
      request: new Request("https://kindpos.com/api/provision/download"),
      env,
    });
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toBe("missing_token");
  });

  it("returns 404 invalid_token for an unknown token", async () => {
    const resp = await downloadHandler({
      request: downloadRequest("not-a-real-token-zzz"),
      env,
    });
    expect(resp.status).toBe(404);
    const body = await resp.json();
    expect(body.error).toBe("invalid_token");
  });

  it("returns 410 token_expired when build is older than 7 days", async () => {
    const built = await buildWindowsPackage();
    const token = extractTokenFromUrl(built.provisioning_url);

    // Backdate the build past the 7-day window.
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    await env.KINDPOS_DB.prepare(
      `UPDATE customers SET windows_image_built_at = ? WHERE store_ref = ?`,
    ).bind(eightDaysAgo, "STORE-WIN").run();

    const resp = await downloadHandler({ request: downloadRequest(token), env });
    expect(resp.status).toBe(410);
    const body = await resp.json();
    expect(body.error).toBe("token_expired");
  });

  it("streams the zip on first download, marks used, audits, then 410 on second use", async () => {
    const built = await buildWindowsPackage();
    const token = extractTokenFromUrl(built.provisioning_url);

    const resp1 = await downloadHandler({ request: downloadRequest(token), env });
    expect(resp1.status).toBe(200);
    expect(resp1.headers.get("Content-Type")).toBe("application/zip");
    expect(resp1.headers.get("Content-Disposition")).toContain('filename="kindpos-provisioning.zip"');
    const zipBytes = new Uint8Array(await resp1.arrayBuffer());
    const entries = unzipSync(zipBytes);
    expect(entries["accounts.db"]).toBeDefined();
    expect(entries["kindpos.toml"]).toBeDefined();

    const row = await env.KINDPOS_DB.prepare(
      `SELECT installer_token_used_at, windows_image_downloaded_at
       FROM customers WHERE store_ref = ?`,
    ).bind("STORE-WIN").first();
    expect(row.installer_token_used_at).not.toBeNull();
    expect(row.windows_image_downloaded_at).not.toBeNull();
    expect(row.installer_token_used_at).toBe(row.windows_image_downloaded_at);

    const eventRow = await env.KINDPOS_DB.prepare(
      `SELECT event_type, event_data FROM provisioning_events
       WHERE store_ref = ? AND event_type = 'windows_package_downloaded'`,
    ).bind("STORE-WIN").first();
    expect(eventRow).not.toBeNull();
    const data = JSON.parse(eventRow.event_data);
    expect(data.r2_key).toBe(built.windows_image_r2_key);

    const resp2 = await downloadHandler({ request: downloadRequest(token), env });
    expect(resp2.status).toBe(410);
    const body2 = await resp2.json();
    expect(body2.error).toBe("token_already_used");
  });
});
