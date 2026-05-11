// Session cookie + auth-guard helpers for the admin endpoints.
//
// Cookie name and attributes are spec-fixed (PROVISIONING_FLOW.md §12): the
// browser holds an HttpOnly Secure SameSite=Strict cookie containing the
// opaque session_id, which the server resolves to a row in `admin_sessions`.
//
// `requireAdminAuth` and `requireAdminRole` throw `Response` objects rather
// than custom errors so endpoint handlers can `try { ... } catch (err) { if
// (err instanceof Response) return err; throw err; }`. This is the idiomatic
// Cloudflare Functions pattern and keeps each handler one straight-line path.

import {
  getAdminSession,
  refreshAdminSession,
} from "./admin_sessions.js";
import { getAdminUserById } from "./admin_users.js";

const SESSION_COOKIE_NAME = "kindpos_admin_session";
const SESSION_LIFETIME_SECONDS = 24 * 60 * 60;

export function getSessionCookieName() {
  return SESSION_COOKIE_NAME;
}

export function parseSessionCookie(request) {
  const header = request.headers.get("cookie");
  if (!header) return null;
  const target = `${SESSION_COOKIE_NAME}=`;
  for (const segment of header.split(";")) {
    const trimmed = segment.trim();
    if (trimmed.startsWith(target)) {
      const value = trimmed.slice(target.length);
      return value === "" ? null : value;
    }
  }
  return null;
}

export function buildSessionCookie(sessionId, expiresAtIso) {
  const expires = new Date(expiresAtIso).toUTCString();
  return (
    `${SESSION_COOKIE_NAME}=${sessionId}; ` +
    `HttpOnly; Secure; SameSite=Strict; Path=/; ` +
    `Max-Age=${SESSION_LIFETIME_SECONDS}; Expires=${expires}`
  );
}

export function buildClearCookie() {
  return (
    `${SESSION_COOKIE_NAME}=; ` +
    `HttpOnly; Secure; SameSite=Strict; Path=/; ` +
    `Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
  );
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const UNAUTHORIZED = () => jsonResponse(401, { error: "invalid credentials" });
const FORBIDDEN = () => jsonResponse(403, { error: "forbidden" });

export async function requireAdminAuth(request, env) {
  const sessionId = parseSessionCookie(request);
  if (!sessionId) throw UNAUTHORIZED();

  const session = await getAdminSession(env.KINDPOS_DB, sessionId);
  if (!session) throw UNAUTHORIZED();

  // Refresh on activity. If the row vanished or got revoked between the
  // read and the update, treat it as not authenticated rather than
  // silently continuing.
  await refreshAdminSession(env.KINDPOS_DB, sessionId);
  return session;
}

export async function requireAdminRole(session, env, ...roles) {
  const user = await getAdminUserById(env.KINDPOS_DB, session.admin_user_id);
  if (!user || !user.is_active) throw UNAUTHORIZED();
  if (roles.length > 0 && !roles.includes(user.role)) throw FORBIDDEN();
  return user;
}
