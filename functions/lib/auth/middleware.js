// functions/lib/auth/middleware.js
import { getSession, getSessionIdFromRequest } from './admin_sessions.js';

export async function requireAdminAuth(request, env) {
  const sessionId = getSessionIdFromRequest(request);
  if (!sessionId) return null;

  const session = await getSession(env.KINDPOS_DB, sessionId);
  if (!session) return null;

  const user = await env.KINDPOS_DB.prepare(
    'SELECT user_id, email, must_change_password FROM admin_users WHERE user_id = ?'
  ).bind(session.user_id).first();

  return user ?? null;
}
