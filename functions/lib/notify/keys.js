// functions/lib/notify/keys.js
//
// customer_api_key generation and hashing.
// PROVISIONING_FLOW.md §3.2 — 32-byte random token, base64url-encoded.
// Hash stored as PBKDF2-SHA256 on kindpos.com; plaintext baked into SD image only.

import { hashPassword } from "../auth/password.js";

const KEY_BYTES = 32;

/**
 * Generate a new customer_api_key.
 * Returns the plaintext key (base64url, 43 chars).
 * This value is shown once and baked into the SD image — never stored on kindpos.com.
 */
export function generateApiKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  // base64url: replace + with -, / with _, strip =
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Hash a plaintext customer_api_key for storage in customers.api_key_hash.
 * Uses PBKDF2-SHA256 via Web Crypto (same scheme as admin passwords).
 */
export async function hashApiKey(plaintextKey) {
  return hashPassword(plaintextKey);
}

/**
 * Generate a key and its hash in one call.
 * Returns { key, hash } — store hash in D1, give key to image-builder.
 */
export async function generateAndHashApiKey() {
  const key = generateApiKey();
  const hash = await hashApiKey(key);
  return { key, hash };
}
