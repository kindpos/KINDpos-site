-- KINDpos-site D1 initial schema (PROVISIONING_FLOW.md §2.1, §2.2)
-- and admin auth tables (companion to OVERSEER_AUTH.md identity model).
--
-- This migration treats the D1 as greenfield: the DROP TABLE IF EXISTS
-- block at the top resets any prior state, then the CREATE TABLE block
-- writes the canonical schema. Apply with intent — see migrations/README.md.
--
-- Status enums are lowercase per OVERSEER_AUTH.md §10:
--   customers.status     in ('pending','shipped','activated','cancelled')
--   customers.support_status in ('none','monthly','annual')
--   terminals.status     in ('pending','active','revoked')
--   admin_users.role     in ('super_admin','support','read_only')

-- ─── reset ───────────────────────────────────────────────────────────────
-- Child tables first so FK references unwind cleanly.
DROP TABLE IF EXISTS admin_sessions;
DROP TABLE IF EXISTS admin_users;
DROP TABLE IF EXISTS provisioning_events;
DROP TABLE IF EXISTS terminals;
DROP TABLE IF EXISTS customers;

-- ─── customers ───────────────────────────────────────────────────────────
-- Holds one row per shipped install. The seven columns from PROVISIONING_FLOW
-- §2.1 are folded directly into CREATE TABLE rather than added by ALTER.
-- recovery_code_hash is stored here as well for support-recovery flows
-- (see §3.2 — "Hash also stored as customers.recovery_code_hash on kindpos.com").
CREATE TABLE customers (
  store_ref           TEXT PRIMARY KEY,
  store_name          TEXT NOT NULL,
  customer_name       TEXT,
  customer_email      TEXT,
  customer_phone      TEXT,
  shipped_at          TEXT,
  activated_at        TEXT,
  support_status      TEXT NOT NULL DEFAULT 'none'
                        CHECK (support_status IN ('none','monthly','annual')),
  api_key_hash        TEXT,
  recovery_code_hash  TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','shipped','activated','cancelled')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── terminals ───────────────────────────────────────────────────────────
-- One row per provisioned slot. license_key is the internal slot identifier
-- (PROVISIONING_FLOW §9) and is never shown to customers under the new flow.
-- hardware_fingerprint is populated only by /api/notify/terminal-bound (§7.2).
-- updated_at is bumped by any status-changing endpoint (§7.5 revocation poll).
CREATE TABLE terminals (
  slot_id              TEXT PRIMARY KEY,
  license_key          TEXT NOT NULL UNIQUE,
  store_ref            TEXT NOT NULL REFERENCES customers(store_ref),
  terminal_name        TEXT,
  hardware_fingerprint TEXT,
  status               TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','active','revoked')),
  activated_at         TEXT,
  is_hub               INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── provisioning_events ────────────────────────────────────────────────
-- Append-only audit log of phone-home events from each Overseer (§7).
-- event_data is JSON, opaque to D1; queries that need to filter on it
-- can use json_extract() but should be rare — keep this as a log, not a store.
CREATE TABLE provisioning_events (
  event_id     TEXT PRIMARY KEY,
  store_ref    TEXT NOT NULL REFERENCES customers(store_ref),
  event_type   TEXT NOT NULL,
                 -- 'activated' | 'terminal_bound' | 'heartbeat' | 'user_created'
  event_data   TEXT,
  source_ip    TEXT,
  occurred_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── admin_users ────────────────────────────────────────────────────────
-- Alex's admin login (and any teammates Alex grants). Distinct from the
-- per-customer Overseer users, which live in each install's accounts.db.
-- password_hash format is the PBKDF2 string emitted by scripts/seed_admin_user.mjs
-- and verified by the K3 login endpoint: pbkdf2$100000$<b64-salt>$<b64-hash>.
CREATE TABLE admin_users (
  id                   TEXT PRIMARY KEY,
  email                TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash        TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('super_admin','support','read_only')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at        TEXT,
  is_active            INTEGER NOT NULL DEFAULT 1
);

-- ─── admin_sessions ─────────────────────────────────────────────────────
-- 24h HttpOnly Secure SameSite=Strict session cookies for the admin UI.
-- Refreshed on activity; revoked = 1 on explicit logout (K3).
CREATE TABLE admin_sessions (
  session_id     TEXT PRIMARY KEY,
  admin_user_id  TEXT NOT NULL REFERENCES admin_users(id),
  created_at     TEXT NOT NULL,
  expires_at     TEXT NOT NULL,
  ip             TEXT,
  user_agent     TEXT,
  revoked        INTEGER NOT NULL DEFAULT 0
);

-- ─── indexes ────────────────────────────────────────────────────────────
-- Per PROVISIONING_FLOW §2.1: serves the per-store events feed in newest-first
-- order for the admin dashboard and the support-context lookups.
CREATE INDEX idx_provisioning_events_store
  ON provisioning_events(store_ref, occurred_at DESC);
