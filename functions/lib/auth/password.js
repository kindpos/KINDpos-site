// PBKDF2-SHA256 password hashing for the kindpos.com admin auth.
//
// Workers-compatible: uses Web Crypto (`crypto.subtle`, `crypto.getRandomValues`)
// exclusively. Importing Node's built-in crypto module is forbidden here —
// the same code runs in the Cloudflare Workers runtime under `functions/api/`
// and a Node fallback would only mask the divergence at dev time.
//
// Output format: `pbkdf2$100000$<base64-salt>$<base64-hash>`. This matches
// exactly what `scripts/seed_admin_user.mjs` from K1 produces, so a bootstrap
// admin row inserted by that script verifies through `verifyPassword` here.

const LABEL = "pbkdf2";
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const HASH_ALG = "SHA-256";

function bytesToBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function base64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveBits(plaintext, salt, iterations, keyBytes) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(plaintext),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: HASH_ALG },
    baseKey,
    keyBytes * 8,
  );
  return new Uint8Array(bits);
}

// Rolled by hand — crypto.subtle doesn't expose a constant-time compare and
// using === here would expose a length-prefix timing oracle. XOR-accumulating
// over the full length keeps the runtime independent of where the mismatch is.
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function hashPassword(plaintext) {
  if (typeof plaintext !== "string") {
    throw new TypeError("hashPassword: plaintext must be a string");
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await deriveBits(plaintext, salt, ITERATIONS, KEY_BYTES);
  return `${LABEL}$${ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(derived)}`;
}

export async function verifyPassword(plaintext, stored) {
  if (typeof plaintext !== "string" || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 4) return false;
  const [label, itersStr, saltB64, hashB64] = parts;
  if (label !== LABEL) return false;
  const iterations = Number.parseInt(itersStr, 10);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;

  let salt;
  let expected;
  try {
    salt = base64ToBytes(saltB64);
    expected = base64ToBytes(hashB64);
  } catch {
    return false;
  }
  // Enforce the canonical sizes. Otherwise a base64 corruption that
  // changes the decoded length (e.g. flipping the `=` padding) could
  // shrink the comparison and exploit PBKDF2's prefix-extension property
  // to collide on a strict subset of the original derivation.
  if (salt.length !== SALT_BYTES) return false;
  if (expected.length !== KEY_BYTES) return false;

  const candidate = await deriveBits(plaintext, salt, iterations, KEY_BYTES);
  return constantTimeEqual(candidate, expected);
}
