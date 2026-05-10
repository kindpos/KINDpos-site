# KINDpos-Site License Admin Audit Report

**Date:** 2026-05-10  
**Scope:** License/key surface, terminal activation, revocation flows, D1 schema  
**Status:** Read-only audit (Phase 0 — Report Only)

---

## 1. D1 Schema Reality

### Current Schema (from `schema.sql`)

**Table: `customers`**
```sql
CREATE TABLE IF NOT EXISTS customers (
  store_ref   TEXT PRIMARY KEY,
  store_name  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```
- Primary key: `store_ref` (TEXT)
- Unique constraint: `store_ref` (implicit via PRIMARY KEY)
- No foreign key constraints
- No check constraints

**Table: `terminals`**
```sql
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
```
- Primary key: `license_key` (TEXT)
- Foreign key: `store_ref` → `customers(store_ref)` (NOT enforced in D1 — SQLite but FK constraints may not be enabled)
- Default status: `'PENDING'`
- Possible status values (from code): `PENDING`, `ACTIVATED`, `REVOKED`
- No check constraint on `status` field (permissive)
- No indices beyond implicit PK

### Migration History
- No migration files found in repo (no `migrations/` directory)
- Schema applied directly via Cloudflare D1 console (per comment in `schema.sql`)
- No version control of applied migrations; schema is the source of truth

### Schema Drift Notes
- None detected; schema matches the code's expectations
- Hardcoded status transitions in endpoints: `PENDING` → `ACTIVATED` (via `/api/activate`, `/api/admin/terminals/{license_key}`), `ACTIVATED` or `PENDING` → `REVOKED` (via `/api/admin/revoke`, `/api/admin/customers/{store_ref}` DELETE)

---

## 2. Endpoint Inventory

### Admin Endpoints
These are intended for `kindpos.com/admin` UI and require `Bearer ADMIN_SECRET` auth.

#### GET `/api/admin/config` (No Auth — SECURITY ISSUE)
- **File + function:** `functions/api/admin/config.js:onRequest`
- **Auth:** None (returns secret to anyone)
- **CORS:** `https://kindpos.com`
- **Response:** `{ admin_secret: env.ADMIN_SECRET }`
- **D1 Access:** None (read-only config endpoint)
- **Description:** Returns the admin secret plaintext without authentication

#### GET `/api/admin/customers`
- **File + function:** `functions/api/admin/customers.js:handleGet`
- **Auth:** `Bearer ADMIN_SECRET` (via `requireAdmin`)
- **CORS:** `https://kindpos.com`
- **D1 Read:** `SELECT ... FROM customers c LEFT JOIN terminals t ON t.store_ref = c.store_ref ORDER BY c.store_ref, t.created_at`
- **D1 Write:** None
- **Response:** `{ customers: [ { store_ref, store_name, created_at, terminals: [...] } ] }`
- **Description:** Lists all customers with grouped terminals

#### POST `/api/admin/customers`
- **File + function:** `functions/api/admin/customers.js:handlePost`
- **Auth:** `Bearer ADMIN_SECRET`
- **CORS:** `https://kindpos.com`
- **D1 Write:** `INSERT INTO customers (store_ref, store_name) VALUES (?, ?)`
- **Response:** `{ store_ref, store_name, created_at, terminals: [] }` (201)
- **Description:** Creates a new customer/store

#### DELETE `/api/admin/customers/{store_ref}`
- **File + function:** `functions/api/admin/customers/[store_ref].js:onRequest`
- **Auth:** `Bearer ADMIN_SECRET`
- **CORS:** `https://kindpos.com`
- **D1 Writes:** 
  - `UPDATE terminals SET status = 'REVOKED', hardware_fingerprint = NULL WHERE store_ref = ?`
  - `DELETE FROM customers WHERE store_ref = ?`
- **Response:** `{ deleted: store_ref }` (200)
- **Description:** Cascading delete: revokes all terminals for a store, then deletes customer record

#### GET `/api/admin/generate` (defined but see POST below)
- No GET handler; returns 405 Method Not Allowed

#### POST `/api/admin/generate`
- **File + function:** `functions/api/admin/generate.js:onRequest`
- **Auth:** `Bearer ADMIN_SECRET`
- **CORS:** `https://kindpos.com`
- **D1 Reads:** `SELECT 1 FROM customers WHERE store_ref = ?`
- **D1 Write:** `INSERT INTO terminals (license_key, store_ref, prefix, node_number, sku, created_at) VALUES (?, ?, ?, ?, ?, ?)`
- **Request:** `{ prefix, node_number, sku, store_ref }`
- **Response:** `{ code: "LICENSE_KEY_STRING" }` (201)
- **Description:** Generates a license key server-side via `generateCode()` function
- **Key Format:** `{PREFIX}-{NODE_PAD}-{SEG}-{SEG}-{SEG}` where each segment is random hex, e.g., `KIND-001-A5B2-C3D4-E6F7`
- **Validation:** Checks `store_ref` exists in `customers` table; no uniqueness check on generated key (relies on license_key PK)

#### POST `/api/admin/terminals` (note: not GET, only POST)
- **File + function:** `functions/api/admin/terminals.js:onRequest`
- **Auth:** `Bearer ADMIN_SECRET`
- **CORS:** `https://kindpos.com`
- **D1 Reads:** `SELECT 1 FROM customers WHERE store_ref = ?`
- **D1 Write:** 
  ```sql
  INSERT INTO terminals (license_key, store_ref, terminal_name, node_number, prefix, sku, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(license_key) DO UPDATE SET
    terminal_name = excluded.terminal_name,
    node_number = excluded.node_number,
    prefix = excluded.prefix,
    sku = excluded.sku
  ```
- **Request:** `{ license_key, store_ref, terminal_name?, node_number?, prefix?, sku? }`
- **Response:** Full terminal row with `store_name` (201)
- **Description:** Upsert operation — accepts pre-formed `license_key` from client (different from `/api/admin/generate`)
- **Validation:** Checks `store_ref` exists; **accepts arbitrary `license_key` from request body**

#### PUT `/api/admin/terminals/{license_key}`
- **File + function:** `functions/api/admin/terminals/[license_key].js:onRequest`
- **Auth:** `Bearer ADMIN_SECRET`
- **CORS:** `https://kindpos.com`
- **D1 Reads:** `SELECT license_key FROM terminals WHERE license_key = ?`
- **D1 Write:** `UPDATE terminals SET terminal_name = ?, node_number = ?, prefix = ?, sku = ? WHERE license_key = ?`
- **Request:** `{ terminal_name?, node_number?, prefix?, sku? }`
- **Response:** Full terminal row with `store_name` (200)
- **Description:** Updates metadata fields only; does NOT update `status` or `hardware_fingerprint`

#### POST `/api/admin/revoke`
- **File + function:** `functions/api/admin/revoke.js:onRequest`
- **Auth:** `Bearer ADMIN_SECRET`
- **CORS:** `https://kindpos.com`
- **D1 Reads:** `SELECT license_key FROM terminals WHERE license_key = ?`
- **D1 Write:** `UPDATE terminals SET status = 'REVOKED', hardware_fingerprint = NULL WHERE license_key = ?`
- **Request:** `{ license_key }`
- **Response:** `{ success: true, revoked: license_key }` (200)
- **Description:** Revokes a single terminal; nullifies the hardware fingerprint (breaks reactivation)

---

### Public Endpoints
These are intended for terminal backends to call; no auth or minimal auth.

#### POST `/api/activate`
- **File + function:** `functions/api/activate.js:onRequest`
- **Auth:** None
- **CORS:** `https://kindpos.com`
- **D1 Reads:** 
  ```sql
  SELECT t.*, c.store_name
  FROM terminals t
  LEFT JOIN customers c ON c.store_ref = t.store_ref
  WHERE t.license_key = ?
  ```
- **D1 Write:** `UPDATE terminals SET status = 'ACTIVATED', hardware_fingerprint = ?, activated_at = ? WHERE license_key = ?`
- **Request:** `{ license_key, hardware_fingerprint }`
- **Response:** `{ license_key, store_ref, store_name, terminal_name, node_number, prefix, sku, status, activated_at, hardware_fingerprint }` (200)
- **Description:** First-time activation or re-check of already-activated license
- **Flow:**
  1. Query terminal by `license_key`
  2. Check status: if `REVOKED`, reject
  3. If status is `ACTIVATED` and fingerprint matches, return current state (idempotent)
  4. If status is `ACTIVATED` and fingerprint doesn't match, reject ("already activated on another device")
  5. If status is `PENDING`, update to `ACTIVATED` with fingerprint and timestamp
- **LEFT JOIN BUG:** Line 37 & 80 — if customer row does NOT exist, query returns NULL for all customer columns (store_name, etc.), but code does not check; response includes `store_name: null` (not caught at compile time)

#### POST `/api/validate`
- **File + function:** `functions/api/validate.js:onRequest`
- **Auth:** None
- **CORS:** `https://kindpos.com`
- **D1 Reads:** 
  ```sql
  SELECT t.*, c.store_name
  FROM terminals t
  JOIN customers c ON c.store_ref = t.store_ref
  WHERE t.license_key = ?
  ```
- **D1 Write:** None
- **Request:** `{ license_key, hardware_fingerprint }`
- **Response:** One of:
  - `{ valid: true, license_key, store_ref, store_name, terminal_name, prefix, node_number, sku, activated_at }` (200)
  - `{ valid: false, reason: "not_found" | "revoked" | "already_activated" | "not_activated" }` (200)
- **Description:** Check if a license is valid and activated with matching fingerprint
- **Note:** Uses `JOIN` (not `LEFT JOIN`), so if customer doesn't exist, query returns no rows (valid: false, reason: not_found)

#### POST `/api/checkin`
- **File + function:** `functions/api/checkin.js:onRequest`
- **Auth:** None
- **CORS:** `https://kindpos.com`
- **D1 Reads:** `SELECT * FROM terminals WHERE license_key = ?`
- **D1 Write:** `UPDATE terminals SET ip = ?, last_seen = ? WHERE license_key = ?`
- **Request:** `{ license_key, hardware_fingerprint, ip? }`
- **Response:** `{ ok: true }` (200) or error message (400)
- **Description:** Updates last-seen timestamp and IP for an activated terminal
- **Validation:** Checks status is `ACTIVATED` and hardware fingerprint matches

---

## 3. Key Issuance Flow — POST /api/admin/generate

### Inputs
```
{
  "prefix": "KIND",       // e.g., "KIND" (2-4 chars, will be .toUpperCase())
  "node_number": 1,       // integer
  "sku": "KINDPOS-PI-5",  // e.g., "KINDPOS-PI-5"
  "store_ref": "STORE-1"  // required; customer must exist
}
```

### Validation
1. `prefix`, `node_number`, `sku` are required (400 if missing)
2. `store_ref` is required (400 if missing)
3. `store_ref` **must exist** in `customers` table (400 if not found)
4. No check on `license_key` uniqueness (relies on D1 PK constraint to catch duplicates)

### Key Generation
**Function:** `generateCode(prefix, nodeNum)` (line 18–21)
```javascript
function generateCode(prefix, nodeNum) {
  const seg = () => Math.random().toString(16).slice(2, 6).toUpperCase();
  return `${prefix}-${String(nodeNum).padStart(3, '0')}-${seg()}-${seg()}-${seg()}`;
}
```
- **Server-side generation:** Yes, key generated server-side (not accepted from client)
- **Format:** `{PREFIX}-{NODE_PAD}-{HEX_4}-{HEX_4}-{HEX_4}`
  - Prefix: uppercase, user-provided
  - Node: zero-padded to 3 digits
  - Three random 4-digit hex segments (0–65535 each ≈ 16M combinations per segment)
  - Example: `KIND-001-A5B2-C3D4-E6F7`
- **Entropy:** ~48 bits per key (16M × 16M × 16M / 2^48 ≈ 281T keys max)
- **Collisions:** Possible but rare with random generation

### D1 Writes (in order)
1. Check customer exists (read, not write)
2. INSERT into terminals:
   ```sql
   INSERT INTO terminals (license_key, store_ref, prefix, node_number, sku, created_at)
   VALUES (?, ?, ?, ?, ?, ?)
   ```
   - `status` defaults to `'PENDING'`
   - All other fields (terminal_name, hardware_fingerprint, ip, last_seen, activated_at) remain NULL

### Response
```json
{
  "code": "KIND-001-A5B2-C3D4-E6F7"
}
```
- Only the generated key is returned; no terminal metadata

### Idempotency
- **NOT idempotent** — calling twice with same inputs generates two different keys (different random segments)
- Second call returns a different `code`

---

## 4. Activation Flow — POST /api/activate (Legacy/Public)

### Inputs
```json
{
  "license_key": "KIND-001-A5B2-C3D4-E6F7",
  "hardware_fingerprint": "ABCD1234567890"
}
```

### Validation Chain

1. **Parse body:** JSON parse or 400
2. **Require fields:** Both `license_key` and `hardware_fingerprint` required or 400
3. **Look up terminal:**
   ```sql
   SELECT t.*, c.store_name
   FROM terminals t
   LEFT JOIN customers c ON c.store_ref = t.store_ref
   WHERE t.license_key = ?
   ```
   - If no match: 400 "License key not found"
4. **Check revocation status:**
   - If `terminal.status === 'REVOKED'`: 400 "License revoked"
5. **Handle already-activated case:**
   - If `terminal.status === 'ACTIVATED'`:
     - If `terminal.hardware_fingerprint === hardware_fingerprint`: Return current state (idempotent)
     - If fingerprints don't match: 400 "License already activated on another device"
6. **Otherwise, activate:**
   - If status is `PENDING` (or anything else), proceed to update

### D1 Writes (in order)
1. **First UPDATE:**
   ```sql
   UPDATE terminals
   SET status = 'ACTIVATED',
       hardware_fingerprint = ?,
       activated_at = ?
   WHERE license_key = ?
   ```
   Binds: `(hardware_fingerprint, now, license_key)`

2. **Re-read for response:**
   ```sql
   SELECT t.*, c.store_name
   FROM terminals t
   LEFT JOIN customers c ON c.store_ref = t.store_ref
   WHERE t.license_key = ?
   ```

### LEFT JOIN Bug
**Location:** `functions/api/activate.js:37–39` and `80–82`
```javascript
const terminal = await db.prepare(
  `SELECT t.*, c.store_name
   FROM terminals t
   LEFT JOIN customers c ON c.store_ref = t.store_ref
   WHERE t.license_key = ?`
).bind(license_key).first();
```
**What it does wrong:**
- If a terminal's `store_ref` does NOT reference any row in `customers` (orphaned record or FK constraint unenforced), the `LEFT JOIN` returns the terminal row with `c.store_name = NULL`
- Code does NOT validate that `c.store_ref IS NOT NULL` before using the result
- Response includes `"store_name": null` instead of rejecting the query

**Current status:** **No partial fix in working tree** — code remains vulnerable. The LEFT JOIN should be an INNER JOIN, or a check should validate `terminal.store_ref` exists.

### Response (on success)
```json
{
  "license_key": "KIND-001-A5B2-C3D4-E6F7",
  "store_ref": "STORE-1",
  "store_name": "Sammy's Pizza",      // or null if customer missing
  "terminal_name": "Register 1",
  "node_number": 1,
  "prefix": "KIND",
  "sku": "KINDPOS-PI-5",
  "status": "ACTIVATED",
  "hardware_fingerprint": "ABCD1234567890",
  "activated_at": "2026-05-10T12:34:56.789Z"
}
```

### Idempotency
- **Idempotent:** Calling twice with the same `license_key` and matching `hardware_fingerprint` returns the same state without a second write (checks via `if (terminal.status === 'ACTIVATED' && terminal.hardware_fingerprint === hardware_fingerprint)`)

---

## 5. Activation Flow — PUT /api/admin/terminals/{license_key}

### Inputs
```json
{
  "terminal_name": "Register 1",
  "node_number": 1,
  "prefix": "KIND",
  "sku": "KINDPOS-PI-5"
}
```

### Validation Chain

1. **Parse body:** JSON parse or 400
2. **Require terminal exists:**
   ```sql
   SELECT license_key FROM terminals WHERE license_key = ?
   ```
   - If no match: 404 "Terminal not found"

### D1 Writes (in order)
1. **UPDATE terminals:**
   ```sql
   UPDATE terminals
   SET terminal_name = ?, node_number = ?, prefix = ?, sku = ?
   WHERE license_key = ?
   ```
   - **Does NOT update `status` or `hardware_fingerprint`** (metadata-only)
   - **Does NOT update `activated_at`**

2. **Re-read for response:**
   ```sql
   SELECT t.*, c.store_name
   FROM terminals t
   JOIN customers c ON c.store_ref = t.store_ref
   WHERE t.license_key = ?
   ```
   - Uses `JOIN` (not `LEFT JOIN`), so if customer missing, no rows returned (would throw or return null)

### Response (on success)
```json
{
  "license_key": "KIND-001-A5B2-C3D4-E6F7",
  "store_ref": "STORE-1",
  "store_name": "Sammy's Pizza",
  "terminal_name": "Register 1",
  "node_number": 1,
  "prefix": "KIND",
  "sku": "KINDPOS-PI-5",
  "status": "ACTIVATED",
  "hardware_fingerprint": "ABCD1234567890",
  "activated_at": "2026-05-10T12:34:56.789Z",
  "ip": "192.168.1.100",
  "last_seen": "2026-05-10T12:34:56.789Z",
  "created_at": "2026-05-09T10:00:00.000Z"
}
```

### Semantics vs POST /api/activate

| Aspect | POST /api/activate | PUT /api/admin/terminals/{key} |
|--------|-------------------|-------------------------------|
| **Auth** | None | `Bearer ADMIN_SECRET` |
| **Purpose** | Terminal self-activation | Admin metadata update |
| **Sets status** | Yes (PENDING → ACTIVATED) | No |
| **Sets hardware_fingerprint** | Yes | No |
| **Sets activated_at** | Yes | No |
| **Idempotent** | Yes (if already activated) | Yes (overwrites metadata) |

---

## 6. Revocation Flow — POST /api/admin/revoke

### Inputs
```json
{
  "license_key": "KIND-001-A5B2-C3D4-E6F7"
}
```

### Validation Chain

1. **Parse body:** JSON parse or 400
2. **Require license_key:** 400 if missing
3. **Check license exists:**
   ```sql
   SELECT license_key FROM terminals WHERE license_key = ?
   ```
   - If no match: 404 "License not found"

### D1 Writes
1. **Single UPDATE:**
   ```sql
   UPDATE terminals
   SET status = 'REVOKED', hardware_fingerprint = NULL
   WHERE license_key = ?
   ```
   - Sets status to `'REVOKED'` (immutable)
   - Nullifies `hardware_fingerprint` (cannot be re-used for reactivation)

### Response (on success)
```json
{
  "success": true,
  "revoked": "KIND-001-A5B2-C3D4-E6F7"
}
```

### Notifications / Side Effects
- **No webhooks:** No observable webhook calls to external systems
- **No queue writes:** No Cloudflare Queues or KV writes
- **No events log:** No pub/sub or change-feed pushes
- **Silent revocation:** Existing activated terminals will detect revocation only on next `/api/validate` or `/api/checkin` call

### Reversibility
- **Cannot be reversed** — `REVOKED` status is permanent
- **No REINSTATE endpoint** — no way to un-revoke a key
- **Orphaned records:** Once revoked, the terminal record persists but is unusable

### Endpoint Detection of Revocation
- `POST /api/activate`: Returns 400 "License revoked"
- `POST /api/validate`: Returns `{ valid: false, reason: "revoked" }`
- `POST /api/checkin`: No explicit check for revoked status (checks only `status !== 'ACTIVATED'`, returns 400 "License not activated")

---

## 7. Read Endpoints Used by Terminal Backends

### GET /api/admin/config (No Auth — Critical Security Issue)
- **File + function:** `functions/api/admin/config.js:onRequest`
- **Auth:** **None** (public)
- **Response shape:**
  ```json
  {
    "admin_secret": "SECRET_VALUE_HERE"
  }
  ```
- **Freshness:** Real-time (no caching)
- **Data exposed:** **Raw `ADMIN_SECRET` environment variable**
- **Used by:** `admin.html` at initialization (line 213–216) to bootstrap admin UI
- **SECURITY ISSUE:** Secret exposed to any client that can reach the endpoint; no CORS limitation prevents cross-origin requests from other origins during development/testing

### GET /api/admin/customers
- **File + function:** `functions/api/admin/customers.js:handleGet`
- **Auth:** `Bearer ADMIN_SECRET`
- **Response shape:**
  ```json
  {
    "customers": [
      {
        "store_ref": "STORE-1",
        "store_name": "Sammy's Pizza",
        "created_at": "2026-05-09T10:00:00.000Z",
        "terminals": [
          {
            "license_key": "KIND-001-A5B2-C3D4-E6F7",
            "terminal_name": "Register 1",
            "node_number": 1,
            "prefix": "KIND",
            "sku": "KINDPOS-PI-5",
            "status": "ACTIVATED",
            "hardware_fingerprint": "ABCD1234567890",
            "ip": "192.168.1.100",
            "last_seen": "2026-05-10T12:34:56.789Z",
            "created_at": "2026-05-09T10:00:00.000Z",
            "activated_at": "2026-05-10T11:00:00.000Z"
          }
        ]
      }
    ]
  }
  ```
- **Freshness:** Real-time (no caching)
- **Includes:** All terminals with all metadata, including sensitive `hardware_fingerprint`

### No dedicated `/api/admin/terminals` GET endpoint
- `GET /api/admin/terminals` returns 405 Method Not Allowed
- Terminals are only readable via `GET /api/admin/customers`

### No `/api/admin/licenses/*` read endpoints
- No dedicated license read-by-key endpoint for admins
- Terminals are read via `/api/admin/customers` grouping

### Status-Specific Reads
- No filtering endpoint (e.g., "all revoked licenses") — terminal status is only readable via full `/api/admin/customers` list

---

## 8. Subscription / Change-Feed Capability

### Events-Since / Cursor Endpoints
- **None found** — no endpoint accepting a timestamp or cursor parameter to return "changes since"

### Webhook Registration
- **None found** — no webhook registration endpoints, no stored webhook URLs

### Cloudflare Queues Integration
- **None found** — no queue bindings in code, no queue writes

### Cloudflare Durable Objects
- **None found** — no Durable Objects used

### Cloudflare KV Bindings
- **None found** — no KV reads or writes in endpoints

### Per-Store Filtered Reads
- **None found** — no per-store event endpoint for an Overseer to poll

### Conclusion
**No change-feed surface exists.** The only way for external systems to stay in sync is to:
1. Poll `/api/admin/customers` periodically (expensive, reads entire dataset)
2. Call `/api/validate` on each license key (inefficient for discovery of new revocations)
3. No push notifications or async event delivery

---

## 9. Security Review

### Admin Secret Exposure
**🚨 CRITICAL:**
- **Endpoint:** `GET /api/admin/config` (line 20 in `functions/api/admin/config.js`)
- **Issue:** Returns `env.ADMIN_SECRET` without any authentication
- **Quote:**
  ```javascript
  return json({ admin_secret: env.ADMIN_SECRET });
  ```
- **CVSS Impact:** High — allows any client to obtain the global admin credential
- **Mitigation:** Require Bearer token or move to admin-only secure endpoint

### Public Endpoints with No Auth That Write
- **None explicitly write without auth**
- `/api/activate` and `/api/checkin` write to D1 but are "intended" for terminal backends (public by design?)
- **Note:** These are not admin operations but may be considered unauthenticated writes

### Token Comparison (Bearer Token Validation)
- **All admin endpoints:** Use `token === env.ADMIN_SECRET` (line 15 in multiple files)
- **Not constant-time comparison** (JavaScript `===` on strings is standard, not cryptographic timing-attack safe)
- **Risk:** Low for simple string comparison; high for use in cryptographic validation
- **Status:** Acceptable for admin secret (admin is trusted environment), but consider `crypto.timingSafeEqual()` if secret moves to user-provided tokens

### CORS Configuration
- **All endpoints:** `Access-Control-Allow-Origin: https://kindpos.com`
- **No CORS on write endpoints:** Correct; prevents cross-origin POST/PUT/DELETE
- **No `*` wildcard:** Correct

### Eval / Unsanitized Code
- **None found** — no `eval`, `Function`, or `new Function()` calls

### SQL Injection
- **All queries use parameterized queries (`.bind()`)** — no string concatenation for SQL
- **Status:** Safe

### Secrets Committed to Repo
- **No `.env` file in repo** (checked)
- **No hardcoded keys in wrangler.toml** (not found; likely in Cloudflare console)
- **No credentials in `admin.html`** (script initializes `ADMIN_SECRET` from `/api/admin/config` call)
- **Status:** Safe (no hardcoded secrets found)

---

## 10. Conflicts and Dead Code

### Endpoint Redundancy

**POST /api/admin/generate vs. POST /api/admin/terminals:**
- Both create terminals, but with different semantics:
  - `/api/admin/generate`: Server generates `license_key`, returns only the key
  - `/api/admin/terminals`: Client provides `license_key`, returns full terminal row
- **Conflict:** Unclear when to use which; API design ambiguity
- **Impact:** Admin UI uses both (line 518 in `admin.html` calls `/api/admin/generate`, then line 558 calls `/api/admin/terminals` to save)

**POST /api/activate vs. PUT /api/admin/terminals/{license_key}:**
- Both can activate/modify a terminal:
  - `/api/activate`: Public, sets status + fingerprint, idempotent
  - `/api/admin/terminals/{key}`: Admin-only, updates metadata only, does NOT set status
- **No real conflict** — different purposes (self-activation vs. admin metadata)

### Unused Endpoints
- `GET /api/admin/generate`: Defined in routing but only POST is handled; returns 405
- **Not dead code** (routing framework allows this) but unusual

### TODO/FIXME/XXX Comments
- **None found** in license-related code

### Unreferenced by Admin UI
- All admin endpoints are called by `admin.html`:
  - Line 213: `GET /api/admin/config`
  - Line 303: `GET /api/admin/customers`
  - Line 512: `POST /api/admin/generate`
  - Line 558: `POST /api/admin/terminals`
  - Line 601: `PUT /api/admin/terminals/{license_key}`
  - Line 628: `POST /api/admin/revoke`
  - Line 660: `DELETE /api/admin/customers/{store_ref}`

### Dead Code in License Surface
- None identified

---

## 11. Mapping Back to Terminal Side

**Cross-reference:** The terminal backend audit mentioned these endpoints. Verification:

| Endpoint | Status | Path/Method | Notes |
|----------|--------|------------|-------|
| `GET /api/admin/config` | ✅ Exists | GET `/api/admin/config` | No auth required (security issue) |
| `GET /api/admin/customers` | ✅ Exists | GET `/api/admin/customers` | Requires `Bearer ADMIN_SECRET` |
| `POST /api/admin/generate` | ✅ Exists | POST `/api/admin/generate` | Requires `Bearer ADMIN_SECRET`; returns `{ code }` |
| `POST /api/admin/terminals` | ✅ Exists | POST `/api/admin/terminals` | Requires `Bearer ADMIN_SECRET`; accepts client-provided key |
| `PUT /api/admin/terminals/{license_key}` | ✅ Exists | PUT `/api/admin/terminals/{license_key}` | Requires `Bearer ADMIN_SECRET`; metadata-only update |
| `POST /api/admin/revoke` | ✅ Exists | POST `/api/admin/revoke` | Requires `Bearer ADMIN_SECRET` |
| `POST /api/activate` | ✅ Exists | POST `/api/activate` | No auth; public activation endpoint |

**All endpoints accounted for.** No mismatches in naming or missing implementations.

---

## 12. Summary

### Key Findings

**Schema & Migrations:**
- Simple two-table schema (customers, terminals)
- No migrations tracked; applied directly to D1
- Status field permissive (no CHECK constraint)

**Endpoints:**
- 10 total endpoints: 7 admin (auth required), 3 public
- All admin endpoints require `Bearer ADMIN_SECRET`
- All use parameterized queries (SQL injection safe)

**License Issuance:**
- Server-side generation via `generateCode()` (48-bit entropy)
- Stored as PRIMARY KEY in `terminals` table
- Validation checks `store_ref` exists

**Activation:**
- Two flows: `/api/activate` (public) and `/api/admin/terminals/{key}` PUT (admin metadata)
- Idempotent design (can re-activate same key with same fingerprint)
- **LEFT JOIN bug:** Missing orphaned customer check (can return null store_name)

**Revocation:**
- Single endpoint: `POST /api/admin/revoke`
- Status set to `'REVOKED'`, fingerprint nullified
- Permanent; no un-revoke
- No async notifications or webhooks

**Change Feed:**
- **None exists** — no events API, no webhooks, no KV/Queue bindings

### Critical Issues

1. **`GET /api/admin/config` leaks ADMIN_SECRET** without authentication (line 20 of `config.js`)
2. **LEFT JOIN bug in `/api/activate`** (lines 37, 80) — does not validate customer existence; can return `store_name: null`
3. **No change-feed capability** — impossible for terminal backends to detect revocations in real-time

### Architectural Observations

- Admin UI and public API tightly coupled via shared endpoints
- Two different key-issuance patterns (server-generated vs. client-provided) with unclear use cases
- Revocation is a "write-only" status; no reconciliation or event replay mechanism
- No per-store or per-terminal audit log

---

**AUDIT COMPLETE**
