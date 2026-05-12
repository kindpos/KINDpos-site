import { requireAdminAuth } from '../../../../lib/auth/middleware.js';
import { hashPassword, hashToken } from '../../../../lib/auth/password.js';
import initSqlJs from 'sql.js/dist/sql-wasm.js';
import sqlWasm from 'sql.js/dist/sql-wasm.wasm';
import argon2WasmModule from './argon2.wasm';
import blake2bWasmModule from './blake2b.wasm';
import { argon2id } from 'hash-wasm';
import { zipSync } from 'fflate';

// workerd disallows runtime WebAssembly.compile(). hash-wasm calls compile() on
// its base64-embedded wasm bytes; statically-imported modules are pre-compiled
// at load time and allowed. Bridge the two by intercepting compile() and
// returning the matching pre-compiled module for hash-wasm's known payloads.
const PRECOMPILED_BY_SIZE = new Map([
  [argon2WasmModule, 6660],
  [blake2bWasmModule, 7442],
]);
const SIZE_TO_MODULE = new Map();
for (const [mod, size] of PRECOMPILED_BY_SIZE) SIZE_TO_MODULE.set(size, mod);

const originalCompile = WebAssembly.compile.bind(WebAssembly);
WebAssembly.compile = function patchedCompile(bytes) {
  const len = bytes?.byteLength ?? bytes?.length;
  const mod = SIZE_TO_MODULE.get(len);
  if (mod) return Promise.resolve(mod);
  return originalCompile(bytes);
};

const CORS = {
  'Access-Control-Allow-Origin': 'https://kindpos.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

let SQL_PROMISE = null;
function loadSql() {
  if (!SQL_PROMISE) {
    // sql.js emscripten init reads self.location.href as a script-directory
    // probe. workerd doesn't define `location`, so this throws TypeError
    // before our locateFile callback gets a chance to run.
    globalThis.location ??= { href: 'https://kindpos.local/' };
    SQL_PROMISE = initSqlJs({
      locateFile: () => 'sql-wasm.wasm',   // prevents import.meta.url crash
      instantiateWasm(imports, receive) {
        WebAssembly.instantiate(sqlWasm, imports).then(instance => {
          receive(instance, sqlWasm);
        });
        return {};
      },
    });
  }
  return SQL_PROMISE;
}

const PASSWORD_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_!';
const RECOVERY_ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

function pickFromAlphabet(alphabet, count) {
  const out = new Array(count);
  const max = Math.floor(256 / alphabet.length) * alphabet.length;
  const buf = new Uint8Array(count * 2);
  let filled = 0;
  while (filled < count) {
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && filled < count; i++) {
      if (buf[i] < max) {
        out[filled++] = alphabet[buf[i] % alphabet.length];
      }
    }
  }
  return out.join('');
}

function generateTempPassword() {
  return pickFromAlphabet(PASSWORD_ALPHABET, 20);
}

function generateRecoveryCode() {
  const groups = [];
  for (let i = 0; i < 6; i++) groups.push(pickFromAlphabet(RECOVERY_ALPHABET, 4));
  return groups.join('-');
}

function generateApiKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function bufToBase64Url(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function argon2idHash(plaintext) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return argon2id({
    password: plaintext,
    salt,
    parallelism: 1,
    iterations: 2,
    memorySize: 19456,
    hashLength: 32,
    outputType: 'encoded',
  });
}

async function generateEd25519Keypair() {
  const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', kp.privateKey);
  const spki = await crypto.subtle.exportKey('spki', kp.publicKey);
  return {
    privateKey: bufToBase64Url(pkcs8),
    publicKey: bufToBase64Url(spki),
  };
}

const ACCOUNTS_DDL = `
CREATE TABLE users (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE terminal_bindings (
  slot_id TEXT PRIMARY KEY,
  terminal_name TEXT NOT NULL,
  hardware_fingerprint TEXT,
  bound_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_hub INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE revocations (
  slot_id TEXT PRIMARY KEY,
  revoked_at TEXT NOT NULL,
  reason TEXT
);
CREATE TABLE provisioning (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE phone_home_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
`;

async function buildAccountsDb({
  customerEmail,
  tempPasswordHash,
  terminals,
  storeRef,
  apiKeyPlain,
  privateKey,
  publicKey,
  recoveryCodeHash,
  now,
}) {
  const SQL = await loadSql();
  const db = new SQL.Database();
  db.exec(ACCOUNTS_DDL);

  const userId = crypto.randomUUID();
  db.run(
    `INSERT INTO users (user_id, email, password_hash, role, must_change_password, is_active, created_at, updated_at)
     VALUES (?, ?, ?, 'store_admin', 1, 1, ?, ?)`,
    [userId, customerEmail, tempPasswordHash, now, now],
  );

  const minNode = terminals.reduce(
    (m, t) => (t.node_number != null && (m == null || t.node_number < m) ? t.node_number : m),
    null,
  );
  for (const t of terminals) {
    const name = t.terminal_name ?? `Terminal ${t.node_number}`;
    const isHub = t.node_number != null && t.node_number === minNode ? 1 : 0;
    db.run(
      `INSERT INTO terminal_bindings (slot_id, terminal_name, hardware_fingerprint, bound_at, is_active, is_hub)
       VALUES (?, ?, NULL, NULL, 1, ?)`,
      [t.license_key, name, isHub],
    );
  }

  const provRows = [
    ['first_boot_pending', 'true'],
    ['store_ref', storeRef],
    ['customer_api_key', apiKeyPlain],
    ['kindpos_api_base', 'https://kindpos.com'],
    ['overseer_private_key', privateKey],
    ['overseer_public_key', publicKey],
    ['recovery_code_hash', recoveryCodeHash],
  ];
  for (const [k, v] of provRows) {
    db.run(`INSERT INTO provisioning (key, value) VALUES (?, ?)`, [k, v]);
  }

  const bytes = db.export();
  db.close();
  return bytes;
}

function tomlEscape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildKindposToml(storeName, customerEmail) {
  return (
    `[store]\n` +
    `store_name = "${tomlEscape(storeName)}"\n` +
    `customer_email = "${tomlEscape(customerEmail)}"\n` +
    `\n` +
    `[support]\n` +
    `contact_email = "support@kindpos.com"\n` +
    `contact_phone = "(XXX) XXX-XXXX"\n`
  );
}

function writeOctal(buf, offset, value, length) {
  const s = value.toString(8).padStart(length - 1, '0') + '\0';
  for (let i = 0; i < length; i++) buf[offset + i] = s.charCodeAt(i);
}

function writeString(buf, offset, str, length) {
  const bytes = new TextEncoder().encode(str);
  const n = Math.min(bytes.length, length);
  for (let i = 0; i < n; i++) buf[offset + i] = bytes[i];
}

function tarHeader(name, size, mtime) {
  const header = new Uint8Array(512);
  writeString(header, 0, name, 100);
  writeOctal(header, 100, 0o644, 8);
  writeOctal(header, 108, 0, 8);
  writeOctal(header, 116, 0, 8);
  writeOctal(header, 124, size, 12);
  writeOctal(header, 136, mtime, 12);
  for (let i = 148; i < 156; i++) header[i] = 0x20;
  header[156] = 0x30;
  writeString(header, 257, 'ustar', 6);
  header[263] = 0x30;
  header[264] = 0x30;
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i];
  const sumStr = sum.toString(8).padStart(6, '0') + '\0 ';
  for (let i = 0; i < 8; i++) header[148 + i] = sumStr.charCodeAt(i);
  return header;
}

function buildTar(entries, mtime) {
  const parts = [];
  let total = 0;
  for (const { path, data } of entries) {
    const header = tarHeader(path, data.length, mtime);
    parts.push(header);
    total += 512;
    parts.push(data);
    total += data.length;
    const pad = (512 - (data.length % 512)) % 512;
    if (pad > 0) {
      parts.push(new Uint8Array(pad));
      total += pad;
    }
  }
  parts.push(new Uint8Array(1024));
  total += 1024;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

async function gzip(bytes) {
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const chunks = [];
  let total = 0;
  const reader = cs.readable.getReader();
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

function welcomeEmailPreview({ storeName, customerEmail, tempPassword, platform, provisioningUrl }) {
  // PROVISIONING_FLOW.md §5 — Windows recipients also get the one-time
  // provisioning download link required by the installer.
  const windowsBlock = platform === 'windows' && provisioningUrl
    ? `Download your provisioning package (required during installation):\n${provisioningUrl}\n\n` +
      `This link expires in 7 days or after first use.\n\n`
    : '';
  return (
    `Subject: Welcome to KINDpos — ${storeName}\n\n` +
    `Hi,\n\n` +
    `Your KINDpos terminal for ${storeName} has been prepared and is ready to ship.\n\n` +
    windowsBlock +
    `When the system first boots, log in with:\n` +
    `  Email: ${customerEmail}\n` +
    `  Temporary password: ${tempPassword}\n\n` +
    `You will be prompted to change your password on first login. Keep your recovery code in a safe place — it is the only way to regain access if you lose your password.\n\n` +
    `If you need help, contact support@kindpos.com.\n\n` +
    `— The KINDpos Team\n`
  );
}

export async function onRequestPost({ request, env, params }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  const user = await requireAdminAuth(request, env);
  if (!user) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { store_ref } = params;
  const db = env.KINDPOS_DB;

  // PROVISIONING_FLOW.md §4.1 — caller selects target platform.
  // Empty/malformed body defaults to 'pi' for backward compatibility.
  const body = await request.json().catch(() => ({}));
  const platform = body?.platform ?? 'pi';
  if (platform !== 'pi' && platform !== 'windows') {
    return json({ error: 'invalid_platform' }, 400);
  }

  const customer = await db.prepare(
    `SELECT store_ref, store_name, customer_email, status FROM customers WHERE store_ref = ?`,
  ).bind(store_ref).first();
  if (!customer) return json({ error: 'not_found' }, 404);

  if (!customer.customer_email) return json({ error: 'missing_email', condition: 'missing_email' }, 409);
  if (!customer.store_name) return json({ error: 'missing_store_name', condition: 'missing_store_name' }, 409);

  const { results: terminals } = await db.prepare(
    `SELECT license_key, terminal_name, node_number FROM terminals WHERE store_ref = ? ORDER BY node_number ASC`,
  ).bind(store_ref).all();
  if (!terminals || terminals.length === 0) {
    return json({ error: 'no_terminals', condition: 'no_terminals' }, 409);
  }

  if (customer.status !== 'pending') {
    return json({ error: 'wrong_status', condition: 'wrong_status' }, 409);
  }

  const tempPassword = generateTempPassword();
  const recoveryCode = generateRecoveryCode();
  const apiKey = generateApiKey();

  const [tempPasswordHash, recoveryCodeHash, keypair, pendingApiKeyHash, pendingRecoveryCodeHash] = await Promise.all([
    argon2idHash(tempPassword),
    argon2idHash(recoveryCode),
    generateEd25519Keypair(),
    hashPassword(apiKey),
    hashPassword(recoveryCode),
  ]);

  const now = new Date().toISOString();
  const accountsBytes = await buildAccountsDb({
    customerEmail: customer.customer_email,
    tempPasswordHash,
    terminals,
    storeRef: store_ref,
    apiKeyPlain: apiKey,
    privateKey: keypair.privateKey,
    publicKey: keypair.publicKey,
    recoveryCodeHash,
    now,
  });

  const tomlBytes = new TextEncoder().encode(
    buildKindposToml(customer.store_name, customer.customer_email),
  );

  let r2Key;
  let provisioningUrl = null;

  if (platform === 'pi') {
    // PROVISIONING_FLOW.md §4.3 — Pi tar.gz overlay path.
    const mtime = Math.floor(Date.now() / 1000);
    const tar = buildTar(
      [
        { path: 'var/lib/kindpos/accounts.db', data: accountsBytes },
        { path: 'var/lib/kindpos/kindpos.toml', data: tomlBytes },
      ],
      mtime,
    );
    const tarball = await gzip(tar);

    r2Key = `images/${store_ref}/kindpos-overlay-${Date.now()}.tar.gz`;
    await env.KINDPOS_IMAGES.put(r2Key, tarball, {
      httpMetadata: { contentType: 'application/gzip' },
    });

    await db.prepare(
      `UPDATE customers SET
         image_r2_key               = ?,
         image_built_at             = ?,
         pending_api_key_hash       = ?,
         pending_recovery_code_hash = ?
       WHERE store_ref = ?`,
    ).bind(r2Key, now, pendingApiKeyHash, pendingRecoveryCodeHash, store_ref).run();
  } else {
    // PROVISIONING_FLOW.md §4.4 — Windows zip path (pure-JS via fflate).
    const zipData = zipSync({
      'accounts.db': accountsBytes,
      'kindpos.toml': tomlBytes,
    });

    // PROVISIONING_FLOW.md §3.2 item 6 — one-time installer download token.
    // Stored as unsalted SHA-256 so the public endpoint can look it up.
    const installerTokenBytes = crypto.getRandomValues(new Uint8Array(32));
    const installerToken = bufToBase64Url(installerTokenBytes);
    const installerTokenHash = await hashToken(installerToken);
    provisioningUrl = `https://kindpos.com/api/provision/download?token=${installerToken}`;

    r2Key = `images/${store_ref}/kindpos-provisioning-${Date.now()}.zip`;
    await env.KINDPOS_IMAGES.put(r2Key, zipData, {
      httpMetadata: { contentType: 'application/zip' },
    });

    await db.prepare(
      `UPDATE customers SET
         windows_image_r2_key       = ?,
         windows_image_built_at     = ?,
         installer_token_hash       = ?,
         installer_token_url        = ?,
         pending_api_key_hash       = ?,
         pending_recovery_code_hash = ?
       WHERE store_ref = ?`,
    ).bind(r2Key, now, installerTokenHash, provisioningUrl, pendingApiKeyHash, pendingRecoveryCodeHash, store_ref).run();
  }

  return json({
    store_ref,
    platform,
    ...(platform === 'pi'
      ? { image_r2_key: r2Key, image_built_at: now }
      : {
          windows_image_r2_key: r2Key,
          windows_image_built_at: now,
          provisioning_url: provisioningUrl,
        }),
    temp_password: tempPassword,
    recovery_code: recoveryCode,
    terminal_count: terminals.length,
    welcome_email_preview: welcomeEmailPreview({
      storeName: customer.store_name,
      customerEmail: customer.customer_email,
      tempPassword,
      platform,
      provisioningUrl,
    }),
  });
}
