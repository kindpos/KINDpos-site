const CORS = {
  'Access-Control-Allow-Origin': '*',
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

  const { license_key, hardware_fingerprint, ip, mac } = body;
  if (!license_key || !hardware_fingerprint) {
    return json({ error: 'license_key and hardware_fingerprint are required' }, 400);
  }

  const db = env.KINDPOS_DB;

  const license = await db.prepare(
    'SELECT * FROM licenses WHERE id = ?'
  ).bind(license_key).first();

  if (!license) {
    return json({ error: 'License not found' }, 404);
  }

  if (
    license.activated &&
    license.hardware_fingerprint &&
    license.hardware_fingerprint !== hardware_fingerprint
  ) {
    return json({ error: 'License already activated on another device' }, 409);
  }

  const now = new Date().toISOString();

  await db.prepare(
    `UPDATE licenses
     SET activated = 1,
         hardware_fingerprint = ?,
         activated_at = COALESCE(activated_at, ?),
         last_seen = ?
     WHERE id = ?`
  ).bind(hardware_fingerprint, now, now, license_key).run();

  await db.prepare(
    `INSERT OR REPLACE INTO nodes (id, license_id, ip, mac, last_seen)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(license_key, license_key, ip || null, mac || null, now).run();

  return json({ success: true, license_key, activated_at: now });
}
