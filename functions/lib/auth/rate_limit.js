// functions/lib/auth/rate_limit.js
const WINDOW_MS      = 5 * 60 * 1000;
const MAX_PER_EMAIL  = 5;
const MAX_PER_IP     = 20;

export async function checkRateLimit(db, email, ip) {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();

  const emailCount = await db.prepare(
    'SELECT COUNT(*) as n FROM admin_login_attempts WHERE LOWER(email) = LOWER(?) AND success = 0 AND attempted_at >= ?'
  ).bind(email, since).first('n');

  if (emailCount >= MAX_PER_EMAIL) return { limited: true, reason: 'email' };

  const ipCount = await db.prepare(
    'SELECT COUNT(*) as n FROM admin_login_attempts WHERE ip = ? AND success = 0 AND attempted_at >= ?'
  ).bind(ip, since).first('n');

  if (ipCount >= MAX_PER_IP) return { limited: true, reason: 'ip' };

  return { limited: false };
}

export async function recordAttempt(db, email, ip, success) {
  const id = crypto.randomUUID();
  await db.prepare(
    'INSERT INTO admin_login_attempts (attempt_id, email, ip, success, attempted_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, email ?? null, ip, success ? 1 : 0, new Date().toISOString()).run();
}
