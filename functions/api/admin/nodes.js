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
       l.id          AS license_key,
       l.prefix,
       l.node_number,
       l.sku,
       l.store_ref,
       l.store_name,
       l.terminal_name,
       l.activated,
       l.hardware_fingerprint,
       l.activated_at,
       l.last_seen,
       n.ip,
       n.mac
     FROM licenses l
     LEFT JOIN nodes n ON n.license_id = l.id
     ORDER BY l.prefix, l.node_number`
  ).all();

  return json({ nodes: results });
}
