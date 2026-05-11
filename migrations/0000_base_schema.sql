-- Base schema (mirrors schema.sql; safe to re-apply via IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS customers (
  store_ref   TEXT PRIMARY KEY,
  store_name  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS terminals (
  license_key          TEXT PRIMARY KEY,
  store_ref            TEXT NOT NULL REFERENCES customers(store_ref),
  terminal_name        TEXT,
  node_number          INTEGER,
  prefix               TEXT,
  sku                  TEXT,
  status               TEXT NOT NULL DEFAULT 'PENDING',
  hardware_fingerprint TEXT,
  ip                   TEXT,
  last_seen            TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  activated_at         TEXT
);
