import { requireAdminAuth } from '../../lib/auth/middleware.js';

const CORS = {
  'Access-Control-Allow-Origin': 'https://kindpos.com',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  const user = await requireAdminAuth(request, env);
  if (!user) return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });

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
       c.customer_email,
       c.customer_phone,
       c.status,
       c.shipped_at,
       c.activated_at AS c_activated_at,
       c.support_status,
       c.image_built_at,
       c.image_r2_key,
       c.image_downloaded_at,
       c.windows_image_r2_key,
       c.windows_image_built_at,
       c.windows_image_downloaded_at,
       c.installer_token_used_at,
       t.license_key,
       t.terminal_name,
       t.node_number,
       t.prefix,
       t.sku,
       t.status AS t_status,
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
        customer_email: row.customer_email,
        customer_phone: row.customer_phone,
        status: row.status,
        shipped_at: row.shipped_at,
        c_activated_at: row.c_activated_at,
        support_status: row.support_status,
        image_built_at: row.image_built_at,
        image_r2_key: row.image_r2_key,
        image_downloaded_at: row.image_downloaded_at,
        windows_image_r2_key: row.windows_image_r2_key,
        windows_image_built_at: row.windows_image_built_at,
        windows_image_downloaded_at: row.windows_image_downloaded_at,
        installer_token_used_at: row.installer_token_used_at,
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
        status: row.t_status,
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

  const { store_ref, store_name, customer_email } = body;
  if (!store_ref || !store_name || !customer_email) {
    return json({ error: 'store_ref, store_name and customer_email are required' }, 400);
  }

  const db = env.KINDPOS_DB;
  try {
    await db.prepare(
      `INSERT INTO customers (store_ref, store_name, customer_email)
       VALUES (?, ?, ?)`
    ).bind(store_ref, store_name, customer_email).run();
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return json({ error: 'Store Ref already exists' }, 409);
    }
    throw err;
  }

  return json({ store_ref, store_name, customer_email, created_at: new Date().toISOString(), terminals: [] }, 201);
}
