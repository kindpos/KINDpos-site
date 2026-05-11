-- PROVISIONING_FLOW.md §3.3: hashes persisted on Mark as Shipped
ALTER TABLE customers ADD COLUMN recovery_code_hash TEXT;

-- PROVISIONING_FLOW.md §13.4 / §13.6: image artifact tracking
ALTER TABLE customers ADD COLUMN image_built_at TEXT;
ALTER TABLE customers ADD COLUMN image_r2_key TEXT;
ALTER TABLE customers ADD COLUMN image_downloaded_at TEXT;
