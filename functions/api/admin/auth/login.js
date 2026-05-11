// POST /api/admin/auth/login (PROVISIONING_FLOW.md §12).
//
// Verifies email + password against admin_users, issues an HttpOnly Secure
// SameSite=Strict session cookie, and returns the user record minus the
// password hash. Generic 401 on both "no such user" and "wrong password"
// — the response body is byte-identical for both branches so a probing
// attacker can't enumerate registered admins.
//
// Rate limiting: per-email and per-IP failure counters in D1 (see
// migration 0002 and `../../../lib/auth/rate_limit.js`). Successful login
// clears the per-email counter; the per-IP counter is intentionally left
// in place.

import {
  getAdminUserByEmail,
  markAdminUserLogin,
  verifyAdminUserPassword,
} from "../../../lib/auth/admin_users.js";
import { createAdminSession } from "../../../lib/auth/admin_sessions.js";
import { buildSessionCookie } from "../../../lib/auth/middleware.js";
import {
  checkAdminLoginRateLimit,
  clearAdminLoginFailures,
  recordAdminLoginFailure,
} from "../../../lib/auth/rate_limit.js";

function jsonResponse(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

function extractIp(request) {
  // Prefer Cloudflare's authoritative `cf-connecting-ip`; fall back to the
  // first segment of `x-forwarded-for` for local/test transports that don't
  // synthesize the CF header.
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf;
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

async function parseBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function onRequestPost({ request, env }) {
  const body = await parseBody(request);
  const email = typeof body?.email === "string" ? body.email : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) {
    return jsonResponse(400, { error: "email and password required" });
  }

  const ip = extractIp(request);

  const limit = await checkAdminLoginRateLimit(env.KINDPOS_DB, { email, ip });
  if (!limit.ok) {
    return jsonResponse(
      429,
      { error: "too many attempts" },
      { "Retry-After": String(limit.retryAfter ?? 300) },
    );
  }

  const user = await getAdminUserByEmail(env.KINDPOS_DB, email);
  if (!user) {
    await recordAdminLoginFailure(env.KINDPOS_DB, { email, ip });
    return jsonResponse(401, { error: "invalid credentials" });
  }

  if (!user.is_active) {
    // Distinct status code per the spec — credentials may be legitimate;
    // the account is simply disabled.
    return jsonResponse(423, { error: "account disabled" });
  }

  const ok = await verifyAdminUserPassword(env.KINDPOS_DB, user.id, password);
  if (!ok) {
    await recordAdminLoginFailure(env.KINDPOS_DB, { email, ip });
    return jsonResponse(401, { error: "invalid credentials" });
  }

  await clearAdminLoginFailures(env.KINDPOS_DB, email);
  await markAdminUserLogin(env.KINDPOS_DB, user.id);

  const { sessionId, expiresAt } = await createAdminSession(env.KINDPOS_DB, {
    adminUserId: user.id,
    ip,
    userAgent: request.headers.get("user-agent"),
  });

  return jsonResponse(
    200,
    {
      user_id: user.id,
      email: user.email,
      role: user.role,
      must_change_password: user.must_change_password,
      expires_at: expiresAt,
    },
    { "set-cookie": buildSessionCookie(sessionId, expiresAt) },
  );
}
