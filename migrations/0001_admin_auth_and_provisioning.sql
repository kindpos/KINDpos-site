-- R1: Admin auth + provisioning schema
-- PROVISIONING_FLOW.md §2.1, §2.2
-- No DROP except confirmed-dead legacy tables (nodes → licenses dependency order)

-- Drop legacy tables (orphaned, no function references, confirmed by audit)
DROP TABLE IF EXISTS nodes;
DROP TABLE IF EXISTS licenses;

-- Normalize terminals.status to lowercase (§2.2)
-- DEFAULT 'PENDING' stays in schema; code enforces lowercase going forward
UPDATE terminals SET status = LOWER(status);

-- Add updated_at to terminals (required by §7.5 revocations poll)
ALTER TABLE terminals ADD COLUMN updated_at TEXT;
UPDATE terminals SET updated_at = datetime('now');

-- Index on terminals(store_ref) — phone-home endpoints query by store_ref
CREATE INDEX IF NOT EXISTS idx_terminals_store_ref
  ON terminals(store_ref);

-- New customers columns (§2.1)
ALTER TABLE customers ADD COLUMN customer_email   TEXT;
ALTER TABLE customers ADD COLUMN customer_phone   TEXT;
ALTER TABLE customers ADD COLUMN shipped_at       TEXT;
ALTER TABLE customers ADD COLUMN activated_at     TEXT;
ALTER TABLE customers ADD COLUMN support_status   TEXT NOT NULL DEFAULT 'none';
ALTER TABLE customers ADD COLUMN api_key_hash     TEXT;
ALTER TABLE customers ADD COLUMN status           TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE customers ADD COLUMN ent_report_id    TEXT;

-- Admin users (single-account, Alex only)
CREATE TABLE IF NOT EXISTS admin_users (
  user_id              TEXT PRIMARY KEY,
  email                TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash        TEXT NOT NULL,   -- PBKDF2-SHA256 via Web Crypto
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at        TEXT
);

-- Admin sessions
CREATE TABLE IF NOT EXISTS admin_sessions (
  session_id TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES admin_users(user_id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  ip         TEXT,
  user_agent TEXT,
  revoked    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_user
  ON admin_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires
  ON admin_sessions(expires_at);

-- Login attempts (rate limiting backing store)
CREATE TABLE IF NOT EXISTS admin_login_attempts (
  attempt_id   TEXT PRIMARY KEY,
  email        TEXT,
  ip           TEXT NOT NULL,
  success      INTEGER NOT NULL DEFAULT 0,
  attempted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_email
  ON admin_login_attempts(email, attempted_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip
  ON admin_login_attempts(ip, attempted_at);

-- Provisioning events (§2.1)
CREATE TABLE IF NOT EXISTS provisioning_events (
  event_id    TEXT PRIMARY KEY,
  store_ref   TEXT NOT NULL REFERENCES customers(store_ref),
  event_type  TEXT NOT NULL,
  event_data  TEXT,
  source_ip   TEXT,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_provisioning_events_store
  ON provisioning_events(store_ref, occurred_at DESC);
