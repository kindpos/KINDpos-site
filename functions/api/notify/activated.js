// functions/api/notify/activated.js
// PROVISIONING_FLOW.md §7.1
//
// Called by the Overseer on first successful password change after first-boot.
// Auth: Bearer <customer_api_key> validated against customers.api_key_hash.
// Idempotent: 409 if already activated (treat as success on Overseer side).

import { authenticateNotify } from "../../lib/notify/auth.js";
import { recordProvisioningEvent } from "../../lib/notify/events.js";
import { sendActivationAlert } from "../../lib/notify/alerts.js";

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

  const { store_ref, activated_at, hub_fingerprint, terminal_count } = body ?? {};
  if (!store_ref || !activated_at) {
    return json({ error: "store_ref and activated_at required" }, 400);
  }

  // §7.1 step 1-2: validate Bearer token against store_ref
  const auth = await authenticateNotify(request, env.KINDPOS_DB, store_ref);
  if (!auth.ok) {
    return new Response(null, { status: auth.status });
  }

  const { customer } = auth;

  // §7.1 step — 409 if already activated (idempotent)
  if (customer.status === "activated") {
    return new Response(null, { status: 409 });
  }

  // §7.1 step 3: update customers row
  await env.KINDPOS_DB.prepare(
    `UPDATE customers
        SET activated_at = ?, status = 'activated'
      WHERE store_ref = ?`,
  )
    .bind(activated_at, store_ref)
    .run();

  // §7.1 step 4: insert provisioning_events row
  await recordProvisioningEvent(env.KINDPOS_DB, {
    storeRef: store_ref,
    eventType: "activated",
    eventData: body,
    sourceIp: sourceIp(request),
  });

  // §7.1 step 5 / §8: fire alert
  await sendActivationAlert(env, {
    customer,
    activatedAt: activated_at,
    terminalCount: terminal_count ?? 0,
  });

  return new Response(null, { status: 204 });
}
