// Admin session repository.
//
// Sessions are 24-hour HttpOnly Secure SameSite=Strict browser sessions for
// the kindpos.com admin UI. `getAdminSession` returns null for revoked or
// expired sessions so callers never have to repeat that filter.
// `refreshAdminSession` extends `expires_at` by another 24h on each
// authenticated request — the K3 dependency layer will call it on every
// request that resolves to a logged-in admin.

const SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;

function isoNow(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function toAdminSession(row) {
  if (!row) return null;
  return {
    session_id: row.session_id,
    admin_user_id: row.admin_user_id,
    created_at: row.created_at,
    expires_at: row.expires_at,
    ip: row.ip,
    user_agent: row.user_agent,
    revoked: Boolean(row.revoked),
  };
}

export async function createAdminSession(
  db,
  { adminUserId, ip = null, userAgent = null },
) {
  const sessionId = crypto.randomUUID();
  const createdAt = isoNow(0);
  const expiresAt = isoNow(SESSION_LIFETIME_MS);
  await db
    .prepare(
      `INSERT INTO admin_sessions
         (session_id, admin_user_id, created_at, expires_at, ip, user_agent, revoked)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
    )
    .bind(sessionId, adminUserId, createdAt, expiresAt, ip, userAgent)
    .run();
  return { sessionId, expiresAt };
}

export async function getAdminSession(db, sessionId) {
  const row = await db
    .prepare(`SELECT * FROM admin_sessions WHERE session_id = ?`)
    .bind(sessionId)
    .first();
  const sess = toAdminSession(row);
  if (sess === null) return null;
  if (sess.revoked) return null;
  if (Date.parse(sess.expires_at) <= Date.now()) return null;
  return sess;
}

export async function refreshAdminSession(db, sessionId) {
  const newExpiresAt = isoNow(SESSION_LIFETIME_MS);
  await db
    .prepare(
      `UPDATE admin_sessions
          SET expires_at = ?
        WHERE session_id = ? AND revoked = 0`,
    )
    .bind(newExpiresAt, sessionId)
    .run();
}

export async function revokeAdminSession(db, sessionId) {
  await db
    .prepare(`UPDATE admin_sessions SET revoked = 1 WHERE session_id = ?`)
    .bind(sessionId)
    .run();
}
