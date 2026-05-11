// functions/api/notify/terminal-bound.js
// PROVISIONING_FLOW.md §7.2
//
// Called by the Overseer on each successful slot binding (unbound → bound).
// Auth: Bearer <customer_api_key>.
// No email alert on bind — dashboard counter only (§8).

import { authenticateNotify } from "../../lib/notify/auth.js";
import { recordProvisioningEvent } from "../../lib/notify/events.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sourceIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0].trim() ??
    null
  );
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const { store_ref, slot_id, terminal_name, hardware_fingerprint, bound_at } = body ?? {};
  if (!store_ref || !slot_id || !hardware_fingerprint || !bound_at) {
    return json({ error: "store_ref, slot_id, hardware_fingerprint and bound_at required" }, 400);
  }

  // §7.2 step 1: validate Bearer token against store_ref
  const auth = await authenticateNotify(request, env.KINDPOS_DB, store_ref);
  if (!auth.ok) {
    return new Response(null, { status: auth.status });
  }

  // §7.2 step 2: validate slot_id belongs to this customer
  const terminal = await env.KINDPOS_DB.prepare(
    `SELECT license_key, store_ref FROM terminals WHERE license_key = ? AND store_ref = ?`,
  )
    .bind(slot_id, store_ref)
    .first();

  if (!terminal) {
    return new Response(null, { status: 404 });
  }

  // §7.2 step 3: update terminals row
  await env.KINDPOS_DB.prepare(
    `UPDATE terminals
        SET hardware_fingerprint = ?,
            activated_at = ?,
            status = 'active',
            terminal_name = COALESCE(?, terminal_name),
            updated_at = ?
      WHERE license_key = ?`,
  )
    .bind(
      hardware_fingerprint,
      bound_at,
      terminal_name ?? null,
      new Date().toISOString(),
      slot_id,
    )
    .run();

  // §7.2 step 4: insert provisioning_events row
  await recordProvisioningEvent(env.KINDPOS_DB, {
    storeRef: store_ref,
    eventType: "terminal_bound",
    eventData: body,
    sourceIp: sourceIp(request),
  });

  return new Response(null, { status: 204 });
}
