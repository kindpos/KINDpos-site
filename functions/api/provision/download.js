// PROVISIONING_FLOW.md §7.7 — public installer-token download endpoint.
// No admin auth; customer-facing one-time link emailed at build time.
// Validates the installer token, enforces 7-day expiry and single-use,
// then streams the Windows provisioning zip from R2 and audits the event.

import { hashToken } from '../../lib/auth/password.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

// PROVISIONING_FLOW.md §7.7 step 3 — link lifetime.
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) return json({ error: 'missing_token' }, 400);

  // §7.7 step 1 — deterministic lookup by SHA-256(token).
  const tokenHash = await hashToken(token);
  const customer = await env.KINDPOS_DB.prepare(
    `SELECT store_ref, windows_image_r2_key, windows_image_built_at,
            installer_token_used_at
     FROM customers
     WHERE installer_token_hash = ?`,
  ).bind(tokenHash).first();
  if (!customer) return json({ error: 'invalid_token' }, 404);

  // §7.7 step 2 — single-use.
  if (customer.installer_token_used_at) {
    return json({ error: 'token_already_used' }, 410);
  }

  // §7.7 step 3 — expiry relative to build time.
  if (!customer.windows_image_built_at) {
    return json({ error: 'invalid_token' }, 404);
  }
  const builtAt = new Date(customer.windows_image_built_at).getTime();
  if (Date.now() > builtAt + TOKEN_TTL_MS) {
    return json({ error: 'token_expired' }, 410);
  }

  // §7.7 step 5 — fetch the zip from R2.
  const obj = await env.KINDPOS_IMAGES.get(customer.windows_image_r2_key);
  if (!obj) return json({ error: 'package_not_found' }, 404);

  const now = new Date().toISOString();

  // §7.7 steps 6-7 — mark token used + audit log atomically.
  await env.KINDPOS_DB.batch([
    env.KINDPOS_DB.prepare(
      `UPDATE customers SET
         installer_token_used_at     = ?,
         windows_image_downloaded_at = ?,
         installer_token_url         = NULL
       WHERE store_ref = ?`,
    ).bind(now, now, customer.store_ref),
    env.KINDPOS_DB.prepare(
      `INSERT INTO provisioning_events
         (event_id, store_ref, event_type, event_data, occurred_at)
       VALUES (?, ?, 'windows_package_downloaded', ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      customer.store_ref,
      JSON.stringify({ r2_key: customer.windows_image_r2_key, downloaded_at: now }),
      now,
    ),
  ]);

  // §7.7 step 8 — stream the package.
  return new Response(obj.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="kindpos-provisioning.zip"',
    },
  });
}
