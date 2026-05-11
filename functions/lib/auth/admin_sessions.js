// functions/lib/auth/admin_sessions.js
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const COOKIE_NAME = 'kindpos_admin_session';

function randomHex(bytes) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function createSession(db, userId, request) {
  const sessionId = randomHex(32);
  const now       = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  const ip        = request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For') ?? null;
  const userAgent = request.headers.get('User-Agent') ?? null;

  await db.prepare(
    'INSERT INTO admin_sessions (session_id, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(sessionId, userId, now.toISOString(), expiresAt, ip, userAgent).run();

  return { sessionId, expiresAt };
}

export async function getSession(db, sessionId) {
  if (!sessionId) return null;
  const session = await db.prepare(
    'SELECT session_id, user_id, expires_at, revoked FROM admin_sessions WHERE session_id = ?'
  ).bind(sessionId).first();
  if (!session) return null;
  if (session.revoked) return null;
  if (new Date(session.expires_at) < new Date()) return null;
  return session;
}

export async function revokeSession(db, sessionId) {
  await db.prepare(
    'UPDATE admin_sessions SET revoked = 1 WHERE session_id = ?'
  ).bind(sessionId).run();
}

export function sessionCookie(sessionId, expiresAt) {
  return `${COOKIE_NAME}=${sessionId}; HttpOnly; Secure; SameSite=Strict; Path=/; Expires=${new Date(expiresAt).toUTCString()}`;
}

export function clearCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

export function getSessionIdFromRequest(request) {
  const cookie = request.headers.get('Cookie') ?? '';
  const match  = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return match ? match[1] : null;
}
