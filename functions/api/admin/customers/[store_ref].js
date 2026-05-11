import { requireAdminAuth } from '../../../lib/auth/middleware.js';

const CORS = {
  'Access-Control-Allow-Origin': 'https://kindpos.com',
  'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

export async function onRequest({ request, env, params }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  const user = await requireAdminAuth(request, env);
  if (!user) return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
  if (request.method !== 'DELETE') {
    return json({ error: 'Method Not Allowed' }, 405);
  }

  const { store_ref } = params;
  const db = env.KINDPOS_DB;

  // FK order: terminals + provisioning_events both reference customers(store_ref)
  // (no ON DELETE CASCADE), so child rows must be deleted before the parent.
  // Batched for atomicity — if any statement fails, none commit.
  await db.batch([
    db.prepare('DELETE FROM provisioning_events WHERE store_ref = ?').bind(store_ref),
    db.prepare('DELETE FROM terminals WHERE store_ref = ?').bind(store_ref),
    db.prepare('DELETE FROM customers WHERE store_ref = ?').bind(store_ref),
  ]);

  return json({ deleted: store_ref });
}
