// D1-backed login rate limiter (kindpos.com admin auth).
//
// Workers are stateless across invocations, so we cannot keep an in-memory
// token bucket the way the Vz2.0 Overseer does. Counters live in the
// `admin_login_attempts` table created by migration 0002. Each
// `recordAdminLoginFailure` writes one row; `checkAdminLoginRateLimit`
// counts rows in the trailing 5-minute window keyed by email and IP.
//
// Caps:
//   per email: 5 failures / 5 minutes
//   per IP:    20 failures / 5 minutes
//
// On a successful login, `clearAdminLoginFailures(db, email)` wipes the
// per-email counter so a legitimate user is never stuck after a few typos.
// The IP counter is intentionally NOT cleared on success — a compromised
// LAN host should remain rate-limited even when a legitimate user happens
// to authenticate from it.

const EMAIL_CAP = 5;
const IP_CAP = 20;
const WINDOW_SECONDS = 300;

export async function checkAdminLoginRateLimit(db, { email, ip }) {
  const emailRow = email
    ? await db
        .prepare(
          `SELECT COUNT(*) AS c FROM admin_login_attempts
             WHERE email = ? COLLATE NOCASE
               AND failed_at > datetime('now', '-${WINDOW_SECONDS} seconds')`,
        )
        .bind(email)
        .first()
    : { c: 0 };
  if ((emailRow?.c ?? 0) >= EMAIL_CAP) {
    return { ok: false, retryAfter: WINDOW_SECONDS };
  }

  const ipRow = ip
    ? await db
        .prepare(
          `SELECT COUNT(*) AS c FROM admin_login_attempts
             WHERE ip = ?
               AND failed_at > datetime('now', '-${WINDOW_SECONDS} seconds')`,
        )
        .bind(ip)
        .first()
    : { c: 0 };
  if ((ipRow?.c ?? 0) >= IP_CAP) {
    return { ok: false, retryAfter: WINDOW_SECONDS };
  }

  return { ok: true };
}

export async function recordAdminLoginFailure(db, { email, ip }) {
  await db
    .prepare(
      `INSERT INTO admin_login_attempts (ip, email) VALUES (?, ?)`,
    )
    .bind(ip ?? "unknown", email ?? null)
    .run();
}

export async function clearAdminLoginFailures(db, email) {
  if (!email) return;
  await db
    .prepare(`DELETE FROM admin_login_attempts WHERE email = ? COLLATE NOCASE`)
    .bind(email)
    .run();
}

export const __testing__ = { EMAIL_CAP, IP_CAP, WINDOW_SECONDS };
