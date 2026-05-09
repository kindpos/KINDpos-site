const CORS = {
  'Access-Control-Allow-Origin': '*',
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
  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const { results } = await env.KINDPOS_DB.prepare(
    `SELECT
       l.id                  AS license_key,
       l.prefix,
       l.node_number,
       l.sku,
       l.store_ref,
       l.store_name,
       l.terminal_name,
       l.activated,
       l.activated_at,
       l.last_seen,
       l.hardware_fingerprint,
       n.ip,
       n.mac
     FROM licenses l
     LEFT JOIN nodes n ON n.license_id = l.id
     ORDER BY l.store_ref, l.prefix, l.node_number`
  ).all();

  const grouped = {};
  for (const row of results) {
    const key = row.store_ref ?? '__none__';
    if (!grouped[key]) {
      grouped[key] = { store_ref: row.store_ref, terminals: [] };
    }
    grouped[key].terminals.push({
      license_key:          row.license_key,
      prefix:               row.prefix,
      node_number:          row.node_number,
      sku:                  row.sku,
      store_name:           row.store_name,
      terminal_name:        row.terminal_name,
      activated:            Boolean(row.activated),
      activated_at:         row.activated_at,
      last_seen:            row.last_seen,
      hardware_fingerprint: row.hardware_fingerprint,
      ip:                   row.ip,
      mac:                  row.mac,
    });
  }

  return json({ customers: Object.values(grouped) });
}
