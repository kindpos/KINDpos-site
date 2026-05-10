const CORS = {
  'Access-Control-Allow-Origin': 'https://kindpos.com',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

function requireAdmin(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  return token === env.ADMIN_SECRET;
}

export async function onRequest({ request, env, params }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (!requireAdmin(request, env)) {
    return json({ error: 'Unauthorized' }, 401);
  }
  if (request.method !== 'PUT') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const license_key = params.license_key;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { terminal_name, node_number, prefix, sku } = body;

  const db = env.KINDPOS_DB;

  const existing = await db.prepare(
    'SELECT license_key FROM terminals WHERE license_key = ?'
  ).bind(license_key).first();

  if (!existing) {
    return json({ error: 'Terminal not found' }, 404);
  }

  await db.prepare(
    `UPDATE terminals
     SET terminal_name = ?, node_number = ?, prefix = ?, sku = ?
     WHERE license_key = ?`
  ).bind(terminal_name || null, node_number || null, prefix || null, sku || null, license_key).run();

  const updated = await db.prepare(
    `SELECT t.*, c.store_name
     FROM terminals t
     JOIN customers c ON c.store_ref = t.store_ref
     WHERE t.license_key = ?`
  ).bind(license_key).first();

  return json(updated, 200);
}
