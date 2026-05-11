// functions/lib/notify/auth.js
//
// Bearer auth for Overseer → kindpos.com phone-home calls.
// The Overseer sends: Authorization: Bearer <customer_api_key>
// kindpos.com verifies it against customers.api_key_hash (PBKDF2-SHA256).
//
// PROVISIONING_FLOW.md §7.1 — auth contract.
// Spec deviation: PBKDF2-SHA256 used instead of argon2id (not available
// natively in Cloudflare Workers).

import { verifyPassword } from "../auth/password.js";

/**
 * Extract the raw Bearer token from an Authorization header.
 * Returns null if missing or malformed.
 */
export function extractBearerToken(request) {
  const header = request.headers.get("Authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * Validate a phone-home request.
 *
 * Checks:
 *   1. Bearer token present in Authorization header
 *   2. store_ref exists in customers table
 *   3. Token verifies against customers.api_key_hash (PBKDF2-SHA256)
 *   4. Customer status is not 'cancelled'
 *
 * Returns { ok: true, customer } on success.
 * Returns { ok: false, status: 401|403|404 } on failure.
 * Never leaks which check failed in the status reason.
 *
 * @param {Request} request
 * @param {D1Database} db
 * @param {string} storeRef - from request body, validated against token owner
 */
export async function authenticateNotify(request, db, storeRef) {
  const token = extractBearerToken(request);
  if (!token) return { ok: false, status: 401 };

  // Lookup by store_ref — must match the request body's store_ref per §7.1 step 2
  const customer = await db
    .prepare(
      `SELECT store_ref, api_key_hash, status, support_status, activated_at
       FROM customers
       WHERE store_ref = ?`,
    )
    .bind(storeRef)
    .first();

  // Generic 401 for both not-found and wrong token — no enumeration
  if (!customer) return { ok: false, status: 401 };
  if (!customer.api_key_hash) return { ok: false, status: 401 };

  const valid = await verifyPassword(token, customer.api_key_hash);
  if (!valid) return { ok: false, status: 401 };

  // 403 for cancelled stores — token is valid but service is terminated
  if (customer.status === "cancelled") return { ok: false, status: 403 };

  return { ok: true, customer };
}
