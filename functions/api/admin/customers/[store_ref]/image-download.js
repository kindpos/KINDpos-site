import { requireAdminAuth } from '../../../../lib/auth/middleware.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

export async function onRequestGet({ request, env, params }) {
  const user = await requireAdminAuth(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const { store_ref } = params;
  const db = env.KINDPOS_DB;

  const customer = await db.prepare(
    `SELECT image_r2_key FROM customers WHERE store_ref = ?`,
  ).bind(store_ref).first();

  if (!customer || !customer.image_r2_key) {
    return json({ error: 'image_not_built' }, 404);
  }

  const obj = await env.KINDPOS_IMAGES.get(customer.image_r2_key);
  if (!obj) return json({ error: 'image_not_built' }, 404);

  const now = new Date().toISOString();

  await db.prepare(
    `INSERT INTO provisioning_events (event_id, store_ref, event_type, event_data, occurred_at)
     VALUES (?, ?, 'image_downloaded', ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    store_ref,
    JSON.stringify({ r2_key: customer.image_r2_key, downloaded_at: now }),
    now,
  ).run();

  await db.prepare(
    `UPDATE customers SET image_downloaded_at = ?
     WHERE store_ref = ? AND image_downloaded_at IS NULL`,
  ).bind(now, store_ref).run();

  return new Response(obj.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="kindpos-overlay-${store_ref}.tar.gz"`,
    },
  });
}
