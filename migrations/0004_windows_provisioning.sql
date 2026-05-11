-- PROVISIONING_FLOW.md §4.4, §4.5, §7.7 — Windows installer flow.
-- Adds columns for the Windows zip artifact and the one-time installer
-- download token (§3.2 item 6) consumed by /api/provision/download.
ALTER TABLE customers ADD COLUMN windows_image_r2_key TEXT;
ALTER TABLE customers ADD COLUMN windows_image_built_at TEXT;
ALTER TABLE customers ADD COLUMN windows_image_downloaded_at TEXT;
ALTER TABLE customers ADD COLUMN installer_token_hash TEXT;
ALTER TABLE customers ADD COLUMN installer_token_used_at TEXT;
