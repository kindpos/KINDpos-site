const CORS = {
  'Access-Control-Allow-Origin': 'https://kindpos.com',
  'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

function requireAdmin(request, env) {
  const auth = request.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  return !!token && token === env.ADMIN_SECRET;
}

export async function onRequest({ request, env, params }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (!requireAdmin(request, env)) {
    return json({ error: 'Unauthorized' }, 401);
  }
  if (request.method !== 'DELETE') {
    return json({ error: 'Method Not Allowed' }, 405);
  }

  const { store_ref } = params;
  const db = env.KINDPOS_DB;

  let customer;
  try {
    customer = await db.prepare(
      'SELECT store_ref FROM customers WHERE store_ref = ?'
    ).bind(store_ref).first();
  } catch (err) {
    return json({ error: err.message || 'Database error' }, 500);
  }

  if (!customer) {
    return json({ error: 'Customer not found' }, 404);
  }

  try {
    await db.prepare(
      'DELETE FROM terminals WHERE store_ref = ?'
    ).bind(store_ref).run();

    await db.prepare(
      'DELETE FROM customers WHERE store_ref = ?'
    ).bind(store_ref).run();
  } catch (err) {
    return json({ error: err.message || 'Delete failed' }, 500);
  }

  return json({ deleted: store_ref });
}
