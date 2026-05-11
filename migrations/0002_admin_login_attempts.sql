-- Failure log used by the D1-backed admin-login rate limiter.
--
-- One row per failed POST /api/admin/auth/login. The limiter reads counts
-- over a 5-minute window keyed by `email` and `ip`. Successful logins call
-- `clearAdminLoginFailures(db, email)` to wipe the per-email counter so a
-- legitimate user who fat-fingered a few times isn't stuck.
--
-- Rows accumulate forever in this v1 cut — a future migration can add a
-- retention sweep keyed on `failed_at`. The indexes below keep window
-- queries cheap regardless of table size.
CREATE TABLE IF NOT EXISTS admin_login_attempts (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ip        TEXT NOT NULL,
  email     TEXT,
  failed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_ip_time
  ON admin_login_attempts(ip, failed_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_email_time
  ON admin_login_attempts(email, failed_at DESC);
