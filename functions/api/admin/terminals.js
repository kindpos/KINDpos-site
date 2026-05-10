const CORS = {
  'Access-Control-Allow-Origin': 'https://kindpos.com',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (!requireAdmin(request, env)) {
    return json({ error: 'Unauthorized' }, 401);
  }
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { license_key, store_ref, terminal_name, node_number, prefix, sku } = body;
  if (!license_key || !store_ref) {
    return json({ error: 'license_key and store_ref are required' }, 400);
  }

  const db = env.KINDPOS_DB;

  const custCheck = await db.prepare(
    'SELECT 1 FROM customers WHERE store_ref = ?'
  ).bind(store_ref).first();

  if (!custCheck) {
    return json({ error: `Customer '${store_ref}' not found` }, 400);
  }

  try {
    await db.prepare(
      `INSERT INTO terminals (license_key, store_ref, terminal_name, node_number, prefix, sku, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(license_key) DO UPDATE SET
         terminal_name = excluded.terminal_name,
         node_number = excluded.node_number,
         prefix = excluded.prefix,
         sku = excluded.sku`
    ).bind(license_key, store_ref, terminal_name || null, node_number || null, prefix || null, sku || null, new Date().toISOString()).run();
  } catch (err) {
    return json({ error: err.message || 'Database error' }, 500);
  }

  const saved = await db.prepare(
    `SELECT t.*, c.store_name
     FROM terminals t
     JOIN customers c ON c.store_ref = t.store_ref
     WHERE t.license_key = ?`
  ).bind(license_key).first();

  return json(saved, 201);
}
