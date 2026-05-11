-- Store plaintext provisioning URL for welcome email delivery
-- Nulled after first download (installer_token_used_at set)
ALTER TABLE customers ADD COLUMN installer_token_url TEXT;
