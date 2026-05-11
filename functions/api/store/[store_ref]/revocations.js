// functions/api/store/[store_ref]/revocations.js
// PROVISIONING_FLOW.md §7.5
//
// Overseer polls this endpoint on schedule to retrieve terminal slots revoked
// at or after the `since` cursor. Frequency: every 15 min for support-
// subscribed stores, every 24h otherwise (enforced by the Overseer, not here).
//
// Auth: Bearer <customer_api_key> validated against store_ref from the URL.
// Requires terminals.updated_at (added in migration 0001).

import { authenticateNotify } from "../../../lib/notify/auth.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function onRequestGet({ request, params, env }) {
  const storeRef = params.store_ref;
  if (!storeRef) return json({ error: "missing store_ref" }, 400);

  // §7.5: Bearer token validated against store_ref from URL
  const auth = await authenticateNotify(request, env.KINDPOS_DB, storeRef);
  if (!auth.ok) {
    return new Response(null, { status: auth.status });
  }

  // `since` query parameter — ISO 8601 timestamp cursor
  const url = new URL(request.url);
  const since = url.searchParams.get("since");

  let rows;
  if (since) {
    const { results } = await env.KINDPOS_DB.prepare(
      `SELECT license_key AS slot_id, updated_at AS revoked_at
         FROM terminals
        WHERE store_ref = ?
          AND status = 'revoked'
          AND updated_at >= ?
        ORDER BY updated_at ASC`,
    )
      .bind(storeRef, since)
      .all();
    rows = results ?? [];
  } else {
    // No cursor — return all revoked terminals for this store
    const { results } = await env.KINDPOS_DB.prepare(
      `SELECT license_key AS slot_id, updated_at AS revoked_at
         FROM terminals
        WHERE store_ref = ?
          AND status = 'revoked'
        ORDER BY updated_at ASC`,
    )
      .bind(storeRef)
      .all();
    rows = results ?? [];
  }

  return json({
    as_of: new Date().toISOString(),
    revocations: rows,
  });
}
