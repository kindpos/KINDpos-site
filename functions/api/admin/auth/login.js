// functions/api/admin/auth/login.js
import { getUserByEmail, updateLastLogin } from '../../../lib/auth/admin_users.js';
import { verifyPassword }                  from '../../../lib/auth/password.js';
import { createSession, sessionCookie }    from '../../../lib/auth/admin_sessions.js';
import { checkRateLimit, recordAttempt }   from '../../../lib/auth/rate_limit.js';

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export async function onRequestPost({ request, env }) {
  const db = env.KINDPOS_DB;
  const ip = request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For') ?? 'unknown';

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const { email, password } = body ?? {};
  if (!email || !password) return json({ error: 'missing_credentials' }, 400);

  // Rate limit check
  const limit = await checkRateLimit(db, email, ip);
  if (limit.limited) {
    return json({ error: 'rate_limited' }, 429, { 'Retry-After': '300' });
  }

  // Lookup user — generic error regardless of failure reason
  const user = await getUserByEmail(db, email);
  const valid = user ? await verifyPassword(password, user.password_hash) : false;

  await recordAttempt(db, email, ip, valid);

  if (!valid) return json({ error: 'invalid_credentials' }, 401);

  const { sessionId, expiresAt } = await createSession(db, user.user_id, request);
  await updateLastLogin(db, user.user_id);

  return json(
    { user_id: user.user_id, email: user.email, must_change_password: !!user.must_change_password },
    200,
    { 'Set-Cookie': sessionCookie(sessionId, expiresAt) }
  );
}
