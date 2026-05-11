// functions/api/admin/auth/logout.js
import { getSessionIdFromRequest, revokeSession, clearCookie } from '../../../lib/auth/admin_sessions.js';

export async function onRequestPost({ request, env }) {
  const sessionId = getSessionIdFromRequest(request);
  if (sessionId) await revokeSession(env.KINDPOS_DB, sessionId);
  return new Response(null, {
    status: 204,
    headers: { 'Set-Cookie': clearCookie() },
  });
}
