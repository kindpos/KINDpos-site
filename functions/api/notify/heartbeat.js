// functions/api/notify/heartbeat.js
// PROVISIONING_FLOW.md §7.3
//
// Optional daily health check from the Overseer. Only sent if the customer
// has an active support subscription (support_status != 'none').
// Server-side gate: if support_status is 'none', return 204 silently —
// the Overseer controls send frequency but the server won't store junk data.
//
// No customer record update. No alert (§8). Inserts one provisioning_events row.

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

  const { store_ref, as_of, overseer_version } = body ?? {};
  if (!store_ref || !as_of) {
    return json({ error: "store_ref and as_of required" }, 400);
  }

  // §7.3: Bearer auth
  const auth = await authenticateNotify(request, env.KINDPOS_DB, store_ref);
  if (!auth.ok) {
    return new Response(null, { status: auth.status });
  }

  const { customer } = auth;

  // §7.3: only store event for support-subscribed customers
  // Non-subscribed stores silently succeed — no data stored
  if (customer.support_status !== "none") {
    await recordProvisioningEvent(env.KINDPOS_DB, {
      storeRef: store_ref,
      eventType: "heartbeat",
      eventData: body,
      sourceIp: sourceIp(request),
    });
  }

  return new Response(null, { status: 204 });
}
