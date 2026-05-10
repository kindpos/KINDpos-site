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

function generateCode(prefix, nodeNum) {
  const seg = () => Math.random().toString(16).slice(2, 6).toUpperCase();
  return `${prefix}-${String(nodeNum).padStart(3, '0')}-${seg()}-${seg()}-${seg()}`;
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

  const { prefix, node_number, sku, store_ref } = body;
  if (!prefix || !node_number || !sku) {
    return json({ error: 'prefix, node_number, and sku are required' }, 400);
  }

  const code = generateCode(prefix.toUpperCase(), node_number);
  const now = new Date().toISOString();

  if (!store_ref) {
    return json({ error: 'store_ref is required' }, 400);
  }

  const custCheck = await env.KINDPOS_DB.prepare(
    'SELECT 1 FROM customers WHERE store_ref = ?'
  ).bind(store_ref).first();

  if (!custCheck) {
    return json({ error: `Customer '${store_ref}' not found` }, 400);
  }

  await env.KINDPOS_DB.prepare(
    `INSERT INTO terminals (license_key, store_ref, prefix, node_number, sku, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(code, store_ref, prefix.toUpperCase(), node_number, sku, now).run();

  return json({ code });
}
