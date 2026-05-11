import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";

import initSqlJs from "sql.js/dist/sql-wasm.js";
import sqlWasm from "sql.js/dist/sql-wasm.wasm";

import { createSession, COOKIE_NAME } from "../functions/lib/auth/admin_sessions.js";
import { onRequestPost as buildImageHandler } from "../functions/api/admin/customers/[store_ref]/build-image.js";
import { onRequestGet as imageDownloadHandler } from "../functions/api/admin/customers/[store_ref]/image-download.js";

let SQL;

beforeAll(async () => {
  await applyD1Migrations(env.KINDPOS_DB, __D1_MIGRATIONS__);
  SQL = await initSqlJs({
    instantiateWasm(imports, receive) {
      WebAssembly.instantiate(sqlWasm, imports).then((instance) => receive(instance, sqlWasm));
      return {};
    },
  });
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
  storeRef = "STORE-IMG",
  storeName = "Image Test Store",
  email = "owner@example.com",
  status = "pending",
} = {}) {
  await env.KINDPOS_DB.prepare(
    `INSERT INTO customers (store_ref, store_name, customer_email, status)
     VALUES (?, ?, ?, ?)`,
  ).bind(storeRef, storeName, email, status).run();
}

async function seedTerminal({ storeRef = "STORE-IMG", licenseKey, nodeNumber, terminalName = null }) {
  await env.KINDPOS_DB.prepare(
    `INSERT INTO terminals (license_key, store_ref, terminal_name, node_number, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))`,
  ).bind(licenseKey, storeRef, terminalName, nodeNumber).run();
}

function buildRequest(storeRef, sessionId) {
  return new Request(`https://kindpos.com/api/admin/customers/${storeRef}/build-image`, {
    method: "POST",
    headers: { Cookie: `${COOKIE_NAME}=${sessionId}` },
  });
}

function downloadRequest(storeRef, sessionId) {
  return new Request(`https://kindpos.com/api/admin/customers/${storeRef}/image-download`, {
    method: "GET",
    headers: { Cookie: `${COOKIE_NAME}=${sessionId}` },
  });
}

async function gunzip(bytes) {
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const chunks = [];
  let total = 0;
  const reader = ds.readable.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function untar(bytes) {
  const entries = {};
  let off = 0;
  const td = new TextDecoder();
  while (off + 512 <= bytes.length) {
    const header = bytes.subarray(off, off + 512);
    let allZero = true;
    for (let i = 0; i < 512; i++) if (header[i] !== 0) { allZero = false; break; }
    if (allZero) break;
    const nameEnd = header.indexOf(0, 0);
    const name = td.decode(header.subarray(0, nameEnd === -1 ? 100 : Math.min(nameEnd, 100)));
    const sizeStr = td.decode(header.subarray(124, 135)).trim().replace(/\0/g, "");
    const size = parseInt(sizeStr, 8);
    off += 512;
    const data = bytes.subarray(off, off + size);
    entries[name] = new Uint8Array(data);
    off += size;
    const pad = (512 - (size % 512)) % 512;
    off += pad;
  }
  return entries;
}

describe("POST /api/admin/customers/:store_ref/build-image — §3.1 conditions", () => {
  it("returns 404 when customer does not exist", async () => {
    const sessionId = await seedAdminSession();
    const resp = await buildImageHandler({
      request: buildRequest("NO-SUCH-STORE", sessionId),
      env,
      params: { store_ref: "NO-SUCH-STORE" },
    });
    expect(resp.status).toBe(404);
  });

  it("returns 409 missing_email when customer_email is NULL", async () => {
    const sessionId = await seedAdminSession();
    await seedCustomer({ email: null });
    await seedTerminal({ licenseKey: "KIND-IMG-1", nodeNumber: 1 });
    const resp = await buildImageHandler({
      request: buildRequest("STORE-IMG", sessionId),
      env,
      params: { store_ref: "STORE-IMG" },
    });
    expect(resp.status).toBe(409);
    const body = await resp.json();
    expect(body.condition).toBe("missing_email");
  });

  it("returns 409 missing_store_name when store_name is falsy", async () => {
    const sessionId = await seedAdminSession();
    // customers.store_name has NOT NULL in the base schema, so we use the empty
    // string to exercise the §3.1 falsy-check path in the handler.
    await env.KINDPOS_DB.prepare(
      `INSERT INTO customers (store_ref, store_name, customer_email, status)
       VALUES (?, '', ?, ?)`,
    ).bind("STORE-IMG", "owner@example.com", "pending").run();
    await seedTerminal({ licenseKey: "KIND-IMG-1", nodeNumber: 1 });
    const resp = await buildImageHandler({
      request: buildRequest("STORE-IMG", sessionId),
      env,
      params: { store_ref: "STORE-IMG" },
    });
    expect(resp.status).toBe(409);
    const body = await resp.json();
    expect(body.condition).toBe("missing_store_name");
  });

  it("returns 409 no_terminals when no terminals exist for store_ref", async () => {
    const sessionId = await seedAdminSession();
    await seedCustomer();
    const resp = await buildImageHandler({
      request: buildRequest("STORE-IMG", sessionId),
      env,
      params: { store_ref: "STORE-IMG" },
    });
    expect(resp.status).toBe(409);
    const body = await resp.json();
    expect(body.condition).toBe("no_terminals");
  });

  it("returns 409 wrong_status when status != 'pending'", async () => {
    const sessionId = await seedAdminSession();
    await seedCustomer({ status: "activated" });
    await seedTerminal({ licenseKey: "KIND-IMG-1", nodeNumber: 1 });
    const resp = await buildImageHandler({
      request: buildRequest("STORE-IMG", sessionId),
      env,
      params: { store_ref: "STORE-IMG" },
    });
    expect(resp.status).toBe(409);
    const body = await resp.json();
    expect(body.condition).toBe("wrong_status");
  });
});

describe("POST /api/admin/customers/:store_ref/build-image — success", () => {
  it("builds image, returns secrets and writes r2_key + image_built_at to D1", async () => {
    const sessionId = await seedAdminSession();
    await seedCustomer({ storeName: "My Store", email: "alex@example.com" });
    await seedTerminal({ licenseKey: "KIND-T-A", nodeNumber: 2, terminalName: "Front" });
    await seedTerminal({ licenseKey: "KIND-T-B", nodeNumber: 1, terminalName: "Back" });

    const resp = await buildImageHandler({
      request: buildRequest("STORE-IMG", sessionId),
      env,
      params: { store_ref: "STORE-IMG" },
    });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.store_ref).toBe("STORE-IMG");
    expect(typeof body.temp_password).toBe("string");
    expect(body.temp_password.length).toBe(20);
    expect(typeof body.recovery_code).toBe("string");
    expect(body.recovery_code).toMatch(/^[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}$/);
    expect(body.image_r2_key).toMatch(/^images\/STORE-IMG\/kindpos-overlay-\d+\.tar\.gz$/);
    expect(typeof body.image_built_at).toBe("string");
    expect(body.terminal_count).toBe(2);
    expect(body.welcome_email_preview).toContain("My Store");
    expect(body.welcome_email_preview).toContain("alex@example.com");
    expect(body.welcome_email_preview).toContain(body.temp_password);

    const row = await env.KINDPOS_DB.prepare(
      `SELECT image_r2_key, image_built_at, status, recovery_code_hash, api_key_hash
       FROM customers WHERE store_ref = ?`,
    ).bind("STORE-IMG").first();
    expect(row.image_r2_key).toBe(body.image_r2_key);
    expect(row.image_built_at).toBe(body.image_built_at);
    expect(row.status).toBe("pending");
    expect(row.recovery_code_hash).toBeNull();
    expect(row.api_key_hash).toBeNull();
  });

  it("tarball contains accounts.db whose contents match the §3.1 / §3.2 spec", async () => {
    const sessionId = await seedAdminSession();
    await seedCustomer({ storeName: "Untar Store", email: "owner@example.com" });
    await seedTerminal({ licenseKey: "KIND-N-1", nodeNumber: 1, terminalName: "Hub Terminal" });
    await seedTerminal({ licenseKey: "KIND-N-2", nodeNumber: 2, terminalName: null });
    await seedTerminal({ licenseKey: "KIND-N-3", nodeNumber: 3, terminalName: null });

    const resp = await buildImageHandler({
      request: buildRequest("STORE-IMG", sessionId),
      env,
      params: { store_ref: "STORE-IMG" },
    });
    expect(resp.status).toBe(200);
    const body = await resp.json();

    const obj = await env.KINDPOS_IMAGES.get(body.image_r2_key);
    expect(obj).not.toBeNull();
    const gzBytes = new Uint8Array(await obj.arrayBuffer());
    const tar = await gunzip(gzBytes);
    const entries = untar(tar);

    expect(entries["var/lib/kindpos/accounts.db"]).toBeDefined();
    expect(entries["var/lib/kindpos/kindpos.toml"]).toBeDefined();
    const toml = new TextDecoder().decode(entries["var/lib/kindpos/kindpos.toml"]);
    expect(toml).toContain('store_name = "Untar Store"');
    expect(toml).toContain('customer_email = "owner@example.com"');

    const adb = new SQL.Database(entries["var/lib/kindpos/accounts.db"]);

    const userCount = adb.exec("SELECT COUNT(*) AS n FROM users")[0].values[0][0];
    expect(userCount).toBe(1);
    const userRow = adb.exec("SELECT role, must_change_password, email FROM users")[0].values[0];
    expect(userRow[0]).toBe("store_admin");
    expect(userRow[1]).toBe(1);
    expect(userRow[2]).toBe("owner@example.com");

    const tbRows = adb.exec(
      "SELECT slot_id, terminal_name, is_hub, hardware_fingerprint, bound_at FROM terminal_bindings ORDER BY slot_id",
    )[0].values;
    expect(tbRows.length).toBe(3);
    const hubCount = tbRows.filter((r) => r[2] === 1).length;
    expect(hubCount).toBe(1);
    const hubRow = tbRows.find((r) => r[2] === 1);
    expect(hubRow[0]).toBe("KIND-N-1");
    expect(hubRow[3]).toBeNull();
    expect(hubRow[4]).toBeNull();
    const defaultNamedRow = tbRows.find((r) => r[0] === "KIND-N-2");
    expect(defaultNamedRow[1]).toBe("Terminal 2");

    const provRows = adb.exec("SELECT key, value FROM provisioning")[0].values;
    const provMap = Object.fromEntries(provRows);
    const requiredKeys = [
      "first_boot_pending",
      "store_ref",
      "customer_api_key",
      "kindpos_api_base",
      "overseer_private_key",
      "overseer_public_key",
      "recovery_code_hash",
    ];
    for (const k of requiredKeys) expect(provMap[k]).toBeDefined();
    expect(provMap.first_boot_pending).toBe("true");
    expect(provMap.store_ref).toBe("STORE-IMG");
    expect(provMap.kindpos_api_base).toBe("https://kindpos.com");
    expect(provMap.recovery_code_hash).toMatch(/^\$argon2id\$/);

    const tableNames = adb.exec(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    )[0].values.map((r) => r[0]);
    for (const t of ["users", "sessions", "terminal_bindings", "revocations", "provisioning", "phone_home_queue"]) {
      expect(tableNames).toContain(t);
    }

    adb.close();
  });
});

describe("GET /api/admin/customers/:store_ref/image-download", () => {
  it("returns 404 image_not_built when no build has run", async () => {
    const sessionId = await seedAdminSession();
    await seedCustomer();
    const resp = await imageDownloadHandler({
      request: downloadRequest("STORE-IMG", sessionId),
      env,
      params: { store_ref: "STORE-IMG" },
    });
    expect(resp.status).toBe(404);
    const body = await resp.json();
    expect(body.error).toBe("image_not_built");
  });

  it("returns 200 after build, records audit event, sets image_downloaded_at on first download only", async () => {
    const sessionId = await seedAdminSession();
    await seedCustomer();
    await seedTerminal({ licenseKey: "KIND-DL-1", nodeNumber: 1 });

    const buildResp = await buildImageHandler({
      request: buildRequest("STORE-IMG", sessionId),
      env,
      params: { store_ref: "STORE-IMG" },
    });
    expect(buildResp.status).toBe(200);

    const resp1 = await imageDownloadHandler({
      request: downloadRequest("STORE-IMG", sessionId),
      env,
      params: { store_ref: "STORE-IMG" },
    });
    expect(resp1.status).toBe(200);
    expect(resp1.headers.get("Content-Type")).toBe("application/gzip");
    expect(resp1.headers.get("Content-Disposition")).toContain('filename="kindpos-overlay-STORE-IMG.tar.gz"');
    await resp1.arrayBuffer();

    const eventRow1 = await env.KINDPOS_DB.prepare(
      `SELECT COUNT(*) AS n FROM provisioning_events WHERE store_ref = ? AND event_type = 'image_downloaded'`,
    ).bind("STORE-IMG").first();
    expect(eventRow1.n).toBe(1);

    const c1 = await env.KINDPOS_DB.prepare(
      `SELECT image_downloaded_at FROM customers WHERE store_ref = ?`,
    ).bind("STORE-IMG").first();
    expect(c1.image_downloaded_at).not.toBeNull();
    const firstDownloadedAt = c1.image_downloaded_at;

    await new Promise((r) => setTimeout(r, 20));

    const resp2 = await imageDownloadHandler({
      request: downloadRequest("STORE-IMG", sessionId),
      env,
      params: { store_ref: "STORE-IMG" },
    });
    expect(resp2.status).toBe(200);
    await resp2.arrayBuffer();

    const eventRow2 = await env.KINDPOS_DB.prepare(
      `SELECT COUNT(*) AS n FROM provisioning_events WHERE store_ref = ? AND event_type = 'image_downloaded'`,
    ).bind("STORE-IMG").first();
    expect(eventRow2.n).toBe(2);

    const c2 = await env.KINDPOS_DB.prepare(
      `SELECT image_downloaded_at FROM customers WHERE store_ref = ?`,
    ).bind("STORE-IMG").first();
    expect(c2.image_downloaded_at).toBe(firstDownloadedAt);
  });
});
