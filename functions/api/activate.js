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

  const { license_key, hardware_fingerprint } = body;
  if (!license_key || !hardware_fingerprint) {
    return json({ error: 'license_key and hardware_fingerprint are required' }, 400);
  }

  const db = env.KINDPOS_DB;

  const terminal = await db.prepare(
    `SELECT t.*, c.store_name
     FROM terminals t
     LEFT JOIN customers c ON c.store_ref = t.store_ref
     WHERE t.license_key = ?`
  ).bind(license_key).first();

  if (!terminal) {
    return json({ error: 'License key not found' }, 400);
  }

  if (terminal.status === 'REVOKED') {
    return json({ error: 'License revoked' }, 400);
  }

  if (terminal.status === 'ACTIVATED') {
    if (terminal.hardware_fingerprint === hardware_fingerprint) {
      return json({
        license_key: terminal.license_key,
        store_ref: terminal.store_ref,
        store_name: terminal.store_name,
        terminal_name: terminal.terminal_name,
        node_number: terminal.node_number,
        prefix: terminal.prefix,
        sku: terminal.sku,
        status: terminal.status,
        activated_at: terminal.activated_at
      }, 200);
    } else {
      return json({ error: 'License already activated on another device' }, 400);
    }
  }

  const now = new Date().toISOString();

  await db.prepare(
    `UPDATE terminals
     SET status = 'ACTIVATED',
         hardware_fingerprint = ?,
         activated_at = ?
     WHERE license_key = ?`
  ).bind(hardware_fingerprint, now, license_key).run();

  const updated = await db.prepare(
    `SELECT t.*, c.store_name
     FROM terminals t
     LEFT JOIN customers c ON c.store_ref = t.store_ref
     WHERE t.license_key = ?`
  ).bind(license_key).first();

  return json({
    license_key: updated.license_key,
    store_ref: updated.store_ref,
    store_name: updated.store_name,
    terminal_name: updated.terminal_name,
    node_number: updated.node_number,
    prefix: updated.prefix,
    sku: updated.sku,
    status: updated.status,
    hardware_fingerprint: updated.hardware_fingerprint,
    activated_at: updated.activated_at
  }, 200);
}
