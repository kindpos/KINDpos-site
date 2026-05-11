# Phone-Home Site Audit — Current State

**Repo:** KINDpos-site
**Branch:** main (`origin/main`)
**Spec:** `PROVISIONING_FLOW.md` §7
**Date:** 2026-05-11
**Scope:** Read-only inspection of phone-home endpoints, D1 schema, auth, and alert surface.

---

## A. Git state

```
$ git log --oneline -5
52dae1f cleanup: remove debug try/catch from login handler
8307eae genhash update
d4015a2 debug: wrap login handler in try/catch to surface 1101 root cause
1ae48ed R4: Retire /api/admin/config (410) + admin.html login gate, logout, cookie auth
35c37f5 R3: Migrate all admin endpoints from Bearer/ADMIN_SECRET to cookie auth
```

```
$ git status
On branch main
Your branch is up to date with 'origin/main'.

Changes not staged for commit:
  modified:   .claude/settings.local.json
```

No tracked-source modifications outstanding. `.claude/settings.local.json` is a local Claude harness file, not phone-home code.

**Note:** `PROVISIONING_FLOW.md` is referenced as the spec, but it is **not present in this repo** (Glob `**/PROVISIONING_FLOW.md` → no matches). All §-references below are interpreted against the audit's stated intent, not a verified spec file.

---

## B. Existing notify endpoints

```
$ find functions/api/notify -type f
$ find functions/api/store -type f
```

- `functions/api/notify/` — **does not exist**
- `functions/api/store/` — **does not exist**

No notify-namespace or store-namespace endpoints exist. Phone-home endpoints per §7 are unimplemented under those paths.

---

## C. D1 schema — notify-relevant tables

**Caveat:** I cannot execute `wrangler d1 execute` from this audit (read-only, no live D1 access). The findings below cite the authoritative migration source: `migrations/0001_admin_auth_and_provisioning.sql`. Assumes migrations have been applied to the prod database (binding `KINDPOS_DB`, db_id `88d61c28-9bf2-4191-8e57-57623c04c5ed` per `wrangler.toml:8`).

### `provisioning_events` — §2.1
Defined at `migrations/0001_admin_auth_and_provisioning.sql:73-80`:
```sql
CREATE TABLE IF NOT EXISTS provisioning_events (
  event_id    TEXT PRIMARY KEY,
  store_ref   TEXT NOT NULL REFERENCES customers(store_ref),
  event_type  TEXT NOT NULL,
  event_data  TEXT,
  source_ip   TEXT,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```
Index: `idx_provisioning_events_store ON (store_ref, occurred_at DESC)` (line 82-83).
**Status:** Table defined per spec. **Zero code references in `functions/`** (grep `provisioning_events` in functions/ → no matches). Nothing writes events yet.

### `customers` — §2.1 columns
Base schema at `migrations/0000_base_schema.sql:2-6` (store_ref, store_name, created_at).
Migration 0001 adds at `migrations/0001_admin_auth_and_provisioning.sql:22-29`:
- `customer_email TEXT` (line 22)
- `customer_phone TEXT` (line 23)
- `shipped_at TEXT` (line 24)
- `activated_at TEXT` (line 25) ✓
- `support_status TEXT NOT NULL DEFAULT 'none'` (line 26) ✓
- `api_key_hash TEXT` (line 27) ✓
- `status TEXT NOT NULL DEFAULT 'pending'` (line 28) ✓
- `ent_report_id TEXT` (line 29)

**Status:** All four §2.1 required columns (`api_key_hash`, `status`, `activated_at`, `support_status`) present in schema.

### `terminals` — §2.1 columns
Base schema at `migrations/0000_base_schema.sql:8-21`:
- `hardware_fingerprint TEXT` (line 16) ✓
- `status TEXT NOT NULL DEFAULT 'PENDING'` (line 15) ✓ (note: schema default is uppercase; migration 0001:11 lowercases existing rows — see §C note below)

Migration 0001 adds at line 14:
- `updated_at TEXT` ✓

**Status:** All three required columns present. **Inconsistency:** schema `DEFAULT 'PENDING'` (uppercase) vs. migration 0001 `UPDATE terminals SET status = LOWER(status)` plus header comment "code enforces lowercase going forward" (line 10). Future INSERTs using DEFAULT will still write uppercase 'PENDING' — phone-home code must either override the default or migrate the DEFAULT.

---

## D. Auth pattern for phone-home

### Bearer validation helper
```
$ grep -r "Bearer" functions/
(no matches)
```
**Status:** No Bearer-token validation helper exists in `functions/lib/`. The only auth helper is `functions/lib/auth/middleware.js:4 requireAdminAuth()` — cookie-based admin session check, not Bearer.

### `api_key_hash` verification
```
$ grep -r "api_key_hash" functions/
(no matches)
```
**Status:** Column defined in `customers` (migration 0001 line 27) but **zero verification logic anywhere in functions/**. The hash column exists; nothing reads it.

### argon2id availability
- `package.json` (lines 9-12) lists only `@cloudflare/vitest-pool-workers` and `vitest` as devDependencies. **No runtime crypto deps.**
- Existing password hashing (`functions/lib/auth/password.js`) uses **PBKDF2-SHA256 via Web Crypto** (`crypto.subtle`), Workers-native.
- **argon2id is NOT natively available in the Cloudflare Workers runtime.** It requires a WASM package (e.g. `argon2-browser`, `@node-rs/argon2`), none of which are installed.

**Flag:** If §7.1 mandates argon2id for `api_key_hash` verification, the dependency must be added (and verified Workers-compatible) — or the spec needs to accept PBKDF2-SHA256 to match the existing admin password scheme.

---

## E. Alert delivery surface (§8)

### Email
```
$ grep -ri "mailchannels|sendgrid|resend\.com" .
(no matches in source code)
```
**Status:** No email-sending code anywhere in the repo.

### Slack
```
$ grep -ri "hooks\.slack|slack\.com/services" .
(no matches)
```
**Status:** No Slack webhook code anywhere in the repo.

### Config
`wrangler.toml` (full contents):
```
name = "kindpos-site"
compatibility_date = "2025-01-01"
pages_build_output_dir = "."

[[d1_databases]]
binding        = "KINDPOS_DB"
database_name  = "kindpos-licenses"
database_id    = "88d61c28-9bf2-4191-8e57-57623c04c5ed"
migrations_dir = "migrations"
```
**No alert-related env vars** (`ALEX_EMAIL`, `SLACK_WEBHOOK_URL`, `ALERT_FROM`, etc.) in `wrangler.toml`. Cloudflare dashboard env vars are not auditable from this filesystem view — but no code consumes any `env.SLACK_*` or `env.MAIL_*` either (grep above), so even if dashboard vars existed, they're unused.

**Status:** Alert delivery is **entirely unimplemented**.

---

## F. Existing legacy notify routes (§11 — all should be 410)

### `functions/api/activate.js` — **LIVE** (not 410)
- Method: POST (`onRequest` dispatches; 405 for non-POST at line 16-18; OPTIONS preflight at line 13-15)
- Auth: **none** (no Bearer, no cookie — open endpoint accepting `license_key` + `hardware_fingerprint` in body)
- Reads: `SELECT t.*, c.store_name FROM terminals t LEFT JOIN customers c … WHERE t.license_key = ?` (lines 34-39, 77-82)
- Writes: `UPDATE terminals SET status='ACTIVATED', hardware_fingerprint=?, activated_at=? WHERE license_key = ?` (lines 69-75)
- Returns: 200 with terminal record on success; 400 for missing/invalid/revoked/already-activated-on-other-device.
- **Per §11 should be 410. Currently fully operational.**

### `functions/api/checkin.js` — **LIVE** (not 410)
- Method: POST (405 non-POST at line 16-18; OPTIONS at line 13-15)
- Auth: **none**
- Reads: `SELECT * FROM terminals WHERE license_key = ?` (line 34-36)
- Writes: `UPDATE terminals SET ip = ?, last_seen = ? WHERE license_key = ?` (lines 51-55)
- Returns: `{ ok: true }` on success; 400 for not-found/not-activated/fingerprint-mismatch.
- **Per §11 should be 410. Currently fully operational.**

### `functions/api/validate.js` — **LIVE** (not 410)
- Method: POST (405 non-POST at line 16-18; OPTIONS at line 13-15)
- Auth: **none**
- Reads: `SELECT t.*, c.store_name FROM terminals t JOIN customers c … WHERE t.license_key = ?` (lines 34-39)
- Writes: none (read-only)
- Returns: `{ valid: bool, reason?, ...terminal_fields? }` always 200.
- **Per §11 should be 410. Currently fully operational.**

**Summary:** All three legacy routes are **live and functional**. None has been replaced with a 410 stub. Migrating them is part of the phone-home rebuild.

---

## G. package.json — available deps

```
$ cat package.json
{
  "name": "kindpos-site",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.16.3",
    "vitest": "^4.1.0"
  }
}
```

- **Hashing libraries:** None. PBKDF2-SHA256 via Web Crypto (`crypto.subtle`) is used by `functions/lib/auth/password.js` for admin passwords — Workers-native, no dep needed.
- **argon2id:** **NOT natively available in Workers.** If §7.1 mandates argon2id for `api_key_hash` verification, a WASM dep would need to be added (e.g. `@node-rs/argon2` is Node-only and won't work in Workers; `argon2-browser` is a candidate but adds ~80KB WASM). **Recommend reusing the existing PBKDF2-SHA256 scheme** from `password.js` for `api_key_hash` to avoid a new dependency and crypto-review surface.

---

## Findings summary

| Area | Status |
|------|--------|
| `functions/api/notify/` exists | ❌ Not created |
| `functions/api/store/` exists | ❌ Not created |
| `provisioning_events` table defined | ✓ (migration 0001:73-80) — zero code writes to it |
| `customers` §2.1 columns | ✓ (migration 0001:22-29) |
| `terminals` §2.1 columns | ✓ — but DEFAULT 'PENDING' is uppercase vs. lowercased convention |
| Bearer-token auth helper | ❌ Not implemented |
| `api_key_hash` verification code | ❌ Column exists, zero verifications |
| argon2id available | ❌ Not in Workers; PBKDF2 is the natively-available option |
| Email alert delivery | ❌ Unimplemented |
| Slack alert delivery | ❌ Unimplemented |
| `wrangler.toml` alert vars | ❌ Not configured |
| `activate.js` legacy → 410 | ❌ Still LIVE |
| `checkin.js` legacy → 410 | ❌ Still LIVE |
| `validate.js` legacy → 410 | ❌ Still LIVE |

**Headline:** Schema is largely ready; **no phone-home runtime code exists**. Bearer auth, `api_key_hash` verification, `provisioning_events` writers, and alert delivery are all greenfield. Three legacy endpoints remain live and will need 410-stubbing as part of the migration.

**Spec gap:** `PROVISIONING_FLOW.md` was not found in the repo — section references in this audit could not be cross-checked against the actual spec text.
