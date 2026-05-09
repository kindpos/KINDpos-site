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

  const { license_key, hardware_fingerprint } = body;
  if (!license_key || !hardware_fingerprint) {
    return json({ error: 'license_key and hardware_fingerprint are required' }, 400);
  }

  const db = env.KINDPOS_DB;

  const terminal = await db.prepare(
    `SELECT t.*, c.store_name
     FROM terminals t
     JOIN customers c ON c.store_ref = t.store_ref
     WHERE t.license_key = ?`
  ).bind(license_key).first();

  if (!terminal) {
    return json({ valid: false, reason: 'not_found' }, 200);
  }

  if (terminal.status === 'REVOKED') {
    return json({ valid: false, reason: 'revoked' }, 200);
  }

  if (terminal.status === 'ACTIVATED') {
    if (terminal.hardware_fingerprint !== hardware_fingerprint) {
      return json({ valid: false, reason: 'already_activated' }, 200);
    }
    return json({
      valid: true,
      store_ref: terminal.store_ref,
      terminal_name: terminal.terminal_name,
      prefix: terminal.prefix,
      node_number: terminal.node_number,
      activated_at: terminal.activated_at
    }, 200);
  }

  return json({ valid: false, reason: 'not_activated' }, 200);
}
