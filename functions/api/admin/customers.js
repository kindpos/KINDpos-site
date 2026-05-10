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

  if (request.method === 'GET') {
    return handleGet(request, env);
  } else if (request.method === 'POST') {
    return handlePost(request, env);
  } else {
    return json({ error: 'Method not allowed' }, 405);
  }
}

async function handleGet(request, env) {
  const { results } = await env.KINDPOS_DB.prepare(
    `SELECT
       c.store_ref,
       c.store_name,
       c.created_at,
       t.license_key,
       t.terminal_name,
       t.node_number,
       t.prefix,
       t.sku,
       t.status,
       t.hardware_fingerprint,
       t.ip,
       t.last_seen,
       t.created_at AS t_created_at,
       t.activated_at
     FROM customers c
     LEFT JOIN terminals t ON t.store_ref = c.store_ref
     ORDER BY c.store_ref, t.created_at`
  ).all();

  const grouped = {};
  for (const row of results) {
    const key = row.store_ref;
    if (!grouped[key]) {
      grouped[key] = {
        store_ref: row.store_ref,
        store_name: row.store_name,
        created_at: row.created_at,
        terminals: []
      };
    }
    if (row.license_key) {
      grouped[key].terminals.push({
        license_key: row.license_key,
        terminal_name: row.terminal_name,
        node_number: row.node_number,
        prefix: row.prefix,
        sku: row.sku,
        status: row.status,
        hardware_fingerprint: row.hardware_fingerprint,
        ip: row.ip,
        last_seen: row.last_seen,
        created_at: row.t_created_at,
        activated_at: row.activated_at
      });
    }
  }

  return json({ customers: Object.values(grouped) });
}

async function handlePost(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { store_ref, store_name } = body;
  if (!store_ref || !store_name) {
    return json({ error: 'store_ref and store_name are required' }, 400);
  }

  const db = env.KINDPOS_DB;
  try {
    await db.prepare(
      `INSERT INTO customers (store_ref, store_name)
       VALUES (?, ?)`
    ).bind(store_ref, store_name).run();
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return json({ error: 'Store Ref already exists' }, 409);
    }
    throw err;
  }

  return json({ store_ref, store_name, created_at: new Date().toISOString(), terminals: [] }, 201);
}
