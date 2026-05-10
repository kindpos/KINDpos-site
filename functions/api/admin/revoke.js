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

  const { license_key } = body;
  if (!license_key) {
    return json({ error: 'license_key is required' }, 400);
  }

  const db = env.KINDPOS_DB;

  let terminal;
  try {
    terminal = await db.prepare(
      'SELECT license_key FROM terminals WHERE license_key = ?'
    ).bind(license_key).first();
  } catch (err) {
    return json({ error: err.message || 'Database error' }, 500);
  }

  if (!terminal) {
    return json({ error: 'License not found' }, 404);
  }

  try {
    await db.prepare(
      `UPDATE terminals
       SET status = 'REVOKED', hardware_fingerprint = NULL
       WHERE license_key = ?`
    ).bind(license_key).run();
  } catch (err) {
    return json({ error: err.message || 'Revoke failed' }, 500);
  }

  return json({ success: true, revoked: license_key });
}
