-- PROVISIONING_FLOW.md §3.3: hashes stored at build, promoted on ship
ALTER TABLE customers ADD COLUMN pending_api_key_hash TEXT;
ALTER TABLE customers ADD COLUMN pending_recovery_code_hash TEXT;
