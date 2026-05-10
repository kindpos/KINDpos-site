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
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { license_key, hardware_fingerprint, ip } = body;
  if (!license_key || !hardware_fingerprint) {
    return json({ error: 'license_key and hardware_fingerprint are required' }, 400);
  }

  const db = env.KINDPOS_DB;

  const terminal = await db.prepare(
    'SELECT * FROM terminals WHERE license_key = ?'
  ).bind(license_key).first();

  if (!terminal) {
    return json({ error: 'License key not found' }, 400);
  }

  if (terminal.status !== 'ACTIVATED') {
    return json({ error: 'License not activated' }, 400);
  }

  if (terminal.hardware_fingerprint !== hardware_fingerprint) {
    return json({ error: 'Hardware fingerprint mismatch' }, 400);
  }

  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE terminals
     SET ip = ?, last_seen = ?
     WHERE license_key = ?`
  ).bind(ip || null, now, license_key).run();

  return json({ ok: true }, 200);
}
