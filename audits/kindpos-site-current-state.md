# KINDpos-site Current-State Audit

**Date:** 2026-05-11  
**Branch audited:** `claude/audit-kindpos-site-HzExn`  
**Audit mode:** Read-only. No source files were modified.

---

## A. Git State

### Command output

```
* claude/audit-kindpos-site-HzExn
  main

fea2820 Merge pull request #12 from kindpos/claude/fix-activation-worker-keys-wCaOD
da14759 Fix activation JOIN bug — LEFT JOIN + store_ref validation
4336225 Fix loadCustomers() timing — wait for config fetch before calling
75f7c1b Fix loadCustomers() to run only after config fetch completes
1ba5499 Merge pull request #10 from kindpos/claude/add-backend-registration-OO419
b73d05c Add local backend registration after KINDpos-site activation
283dd10 Merge pull request #9 from kindpos/claude/installer-activation-status-kUOye
36ebda2 Add __pycache__ to .gitignore
ff14f05 Add clear activation status messages during license registration
fb43d97 Merge pull request #8 from kindpos/claude/audit-key-generation-5IT9N

On branch claude/audit-kindpos-site-HzExn
nothing to commit, working tree clean
```

### Summary

- **Current branch:** `claude/audit-kindpos-site-HzExn`
- **Last 10 commits:** Merges and fixes for activation JOIN bug, loadCustomers timing, backend registration, and key-generation audit. Most recent work is on the activation worker.
- **Uncommitted changes:** None. Working tree is clean.

---

## B. Wrangler Config

No `wrangler.toml` file exists in the repository root or any subdirectory. The comment at the top of `schema.sql` confirms this:

```sql
-- Apply via Cloudflare D1 console. No wrangler.toml.
```

**Findings:**
- **D1 binding name:** `KINDPOS_DB` (inferred from `env.KINDPOS_DB` in every function file — e.g., `functions/api/activate.js:35`)
- **D1 database ID:** Not recorded — no `wrangler.toml`
- **KV / R2 bindings:** None found
- **`[vars]` keys:** Not recorded — no `wrangler.toml`; `ADMIN_SECRET` is an environment secret accessed via `env.ADMIN_SECRET` (e.g., `functions/api/admin/config.js:20`)
- **`compatibility_date`:** Not recorded — no `wrangler.toml`
- **`routes` / `pages_build_output_dir`:** Not recorded — no `wrangler.toml`; project appears to be a Cloudflare Pages project (Functions-based routing)

---

## C. D1 Schema

### SQL files found

```
./schema.sql
```

### `schema.sql` — verbatim

```sql
-- KINDpos D1 Schema
-- Apply via Cloudflare D1 console. No wrangler.toml.

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
```

### Tables

| Table | Column | Type | Constraints |
|-------|--------|------|-------------|
| `customers` | `store_ref` | TEXT | PRIMARY KEY |
| `customers` | `store_name` | TEXT | NOT NULL |
| `customers` | `created_at` | TEXT | NOT NULL, DEFAULT `datetime('now')` |
| `terminals` | `license_key` | TEXT | PRIMARY KEY |
| `terminals` | `store_ref` | TEXT | NOT NULL, FK → `customers(store_ref)` |
| `terminals` | `terminal_name` | TEXT | nullable |
| `terminals` | `node_number` | INTEGER | nullable |
| `terminals` | `prefix` | TEXT | nullable |
| `terminals` | `sku` | TEXT | nullable |
| `terminals` | `status` | TEXT | NOT NULL, DEFAULT `'PENDING'` |
| `terminals` | `hardware_fingerprint` | TEXT | nullable |
| `terminals` | `ip` | TEXT | nullable |
| `terminals` | `last_seen` | TEXT | nullable |
| `terminals` | `created_at` | TEXT | NOT NULL, DEFAULT `datetime('now')` |
| `terminals` | `activated_at` | TEXT | nullable |

No `CREATE INDEX` statements exist. No `ALTER TABLE` statements exist.

---

## D. Functions Inventory

### File list

```
functions/api/activate.js
functions/api/admin/config.js
functions/api/admin/customers.js
functions/api/admin/customers/[store_ref].js
functions/api/admin/generate.js
functions/api/admin/revoke.js
functions/api/admin/terminals.js
functions/api/admin/terminals/[license_key].js
functions/api/checkin.js
functions/api/validate.js
```

---

### `functions/api/activate.js`

- **Handler:** `onRequest` (exported as named export)
- **Route:** `POST /api/activate`
- **Auth pattern:** None — no `Authorization` header checked, no `ADMIN_SECRET` reference
- **Tables / operations:**
  - `SELECT t.*, c.store_name FROM terminals t LEFT JOIN customers c ... WHERE t.license_key = ?`
  - `UPDATE terminals SET status='ACTIVATED', hardware_fingerprint=?, activated_at=? WHERE license_key=?`
  - Second `SELECT` to return updated row
- **Success response shape:**
  ```json
  {
    "license_key": "...",
    "store_ref": "...",
    "store_name": "...",
    "terminal_name": "...",
    "node_number": 1,
    "prefix": "...",
    "sku": "...",
    "status": "ACTIVATED",
    "hardware_fingerprint": "...",
    "activated_at": "..."
  }
  ```

---

### `functions/api/validate.js`

- **Handler:** `onRequest`
- **Route:** `POST /api/validate`
- **Auth pattern:** None
- **Tables / operations:**
  - `SELECT t.*, c.store_name FROM terminals t JOIN customers c ... WHERE t.license_key = ?`
- **Success response shape:**
  ```json
  { "valid": true, "license_key": "...", "store_ref": "...", "store_name": "...",
    "terminal_name": "...", "prefix": "...", "node_number": 1, "sku": "...", "activated_at": "..." }
  ```
  or `{ "valid": false, "reason": "not_found|revoked|already_activated|not_activated" }`

---

### `functions/api/checkin.js`

- **Handler:** `onRequest`
- **Route:** `POST /api/checkin`
- **Auth pattern:** None
- **Tables / operations:**
  - `SELECT * FROM terminals WHERE license_key = ?`
  - `UPDATE terminals SET ip=?, last_seen=? WHERE license_key=?`
- **Success response shape:** `{ "ok": true }`

---

### `functions/api/admin/config.js`

- **Handler:** `onRequest`
- **Route:** `GET /api/admin/config`
- **Auth pattern:** **NONE** — no auth check whatsoever (see finding below)
  - `functions/api/admin/config.js:20`: `return json({ admin_secret: env.ADMIN_SECRET });`
- **Tables / operations:** None — reads only the env var
- **Success response shape:** `{ "admin_secret": "<secret value>" }`

---

### `functions/api/admin/customers.js`

- **Handler:** `onRequest`
- **Route:** `GET /api/admin/customers`, `POST /api/admin/customers`
- **Auth pattern:** `requireAdmin` function at line 12–15:
  ```js
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  return token === env.ADMIN_SECRET;
  ```
- **Tables / operations:**
  - GET: `SELECT c.*, t.* FROM customers c LEFT JOIN terminals t ON t.store_ref = c.store_ref ORDER BY c.store_ref, t.created_at`
  - POST: `INSERT INTO customers (store_ref, store_name) VALUES (?, ?)`
- **Success response shape:**
  - GET: `{ "customers": [{ "store_ref": "...", "store_name": "...", "created_at": "...", "terminals": [...] }] }`
  - POST: `{ "store_ref": "...", "store_name": "...", "created_at": "...", "terminals": [] }` (HTTP 201)

---

### `functions/api/admin/customers/[store_ref].js`

- **Handler:** `onRequest`
- **Route:** `DELETE /api/admin/customers/:store_ref`
- **Auth pattern:** `requireAdmin` at line 13–16:
  ```js
  const auth = request.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  return !!token && token === env.ADMIN_SECRET;
  ```
  (Note: this version also checks `!!token`, unlike the others)
- **Tables / operations:**
  - `UPDATE terminals SET status='REVOKED', hardware_fingerprint=NULL WHERE store_ref=?`
  - `DELETE FROM customers WHERE store_ref=?`
- **Success response shape:** `{ "deleted": "<store_ref>" }`

---

### `functions/api/admin/generate.js`

- **Handler:** `onRequest`
- **Route:** `POST /api/admin/generate`
- **Auth pattern:** `requireAdmin` at line 12–15 (same as customers.js pattern)
- **Tables / operations:**
  - `SELECT 1 FROM customers WHERE store_ref = ?` (existence check)
  - `INSERT INTO terminals (license_key, store_ref, prefix, node_number, sku, created_at) VALUES (?, ?, ?, ?, ?, ?)`
- **Success response shape:** `{ "code": "<generated_license_key>" }`
- **Key generation algorithm (lines 18–21):**
  ```js
  function generateCode(prefix, nodeNum) {
    const seg = () => Math.random().toString(16).slice(2, 6).toUpperCase();
    return `${prefix}-${String(nodeNum).padStart(3, '0')}-${seg()}-${seg()}-${seg()}`;
  }
  ```
  Uses `Math.random()` — not cryptographically secure.

---

### `functions/api/admin/revoke.js`

- **Handler:** `onRequest`
- **Route:** `POST /api/admin/revoke`
- **Auth pattern:** `requireAdmin` at line 12–15 (same pattern)
- **Tables / operations:**
  - `SELECT license_key FROM terminals WHERE license_key = ?`
  - `UPDATE terminals SET status='REVOKED', hardware_fingerprint=NULL WHERE license_key=?`
- **Success response shape:** `{ "success": true, "revoked": "<license_key>" }`

---

### `functions/api/admin/terminals.js`

- **Handler:** `onRequest`
- **Route:** `POST /api/admin/terminals`
- **Auth pattern:** `requireAdmin` at line 12–15
- **Tables / operations:**
  - `SELECT 1 FROM customers WHERE store_ref = ?`
  - `INSERT INTO terminals (...) ON CONFLICT(license_key) DO UPDATE SET terminal_name, node_number, prefix, sku`
  - `SELECT t.*, c.store_name FROM terminals t JOIN customers c ... WHERE t.license_key = ?`
- **Success response shape:** Full terminal row (HTTP 201)

---

### `functions/api/admin/terminals/[license_key].js`

- **Handler:** `onRequest`
- **Route:** `PUT /api/admin/terminals/:license_key`
- **Auth pattern:** `requireAdmin` at line 12–15
- **Tables / operations:**
  - `SELECT license_key FROM terminals WHERE license_key = ?`
  - `UPDATE terminals SET terminal_name=?, node_number=?, prefix=?, sku=? WHERE license_key=?`
  - `SELECT t.*, c.store_name FROM terminals t JOIN customers c ... WHERE t.license_key = ?`
- **Success response shape:** Updated full terminal row (HTTP 200)

---

## E. admin.html

- **File path:** `admin.html` (repository root)
- **Line count:** 741

### Every `fetch()` call

| Line | URL | Method | Auth Header | Body Shape |
|------|-----|--------|-------------|------------|
| 213 | `${API}/api/admin/config` | GET (default) | None | — |
| 303 | `${API}/api/admin/customers` | GET | `Bearer ${ADMIN_SECRET}` | — |
| 512 | `${API}/api/admin/generate` | POST | `Bearer ${ADMIN_SECRET}` | `{ prefix, node_number, sku, store_ref }` |
| 558 | `${API}/api/admin/terminals` | POST | `Bearer ${ADMIN_SECRET}` | `{ license_key, store_ref, terminal_name, node_number, prefix, sku }` |
| 601 | `${API}/api/admin/terminals/${license_key}` | PUT | `Bearer ${ADMIN_SECRET}` | `{ terminal_name, node_number, prefix, sku }` |
| 628 | `${API}/api/admin/revoke` | POST | `Bearer ${ADMIN_SECRET}` | `{ license_key }` |
| 660 | `${API}/api/admin/customers/${store_ref}` | DELETE | `Bearer ${ADMIN_SECRET}` | — |
| 716 | `${API}/api/admin/customers` | POST | `Bearer ${ADMIN_SECRET}` | `{ store_ref, store_name }` |

### `ADMIN_SECRET` references

| Line | Verbatim |
|------|----------|
| 205 | `  let ADMIN_SECRET = '';` |
| 216 | `        ADMIN_SECRET = config.admin_secret \|\| '';` |
| 304 | `        headers: { Authorization: \`Bearer ${ADMIN_SECRET}\` }` |
| 515 | `          Authorization: \`Bearer ${ADMIN_SECRET}\`,` |
| 562 | `          'Authorization': \`Bearer ${ADMIN_SECRET}\`` |
| 605 | `          'Authorization': \`Bearer ${ADMIN_SECRET}\`` |
| 631 | `          Authorization: \`Bearer ${ADMIN_SECRET}\`,` |
| 662 | `        headers: { Authorization: \`Bearer ${ADMIN_SECRET}\` }` |
| 720 | `          'Authorization': \`Bearer ${ADMIN_SECRET}\`` |

### Structural outline

```
<html>
  <head> — JetBrains Mono font, minimal CSS resets, scrollbar styling
  <body>
    #shell (full-viewport flex column)
      #header — "KINDPOS · License Admin" + "LIVE" badge; no logout button
      #body (flex row)
        #sidebar (200px)
          #customer-search — text search input
          #customer-list — dynamically populated customer list
          #new-customer-btn — opens #new-customer-modal
        #main
          #profile-header — selected customer name
          #terminal-cards — dynamically populated terminal cards
    #overlay-backdrop — semi-transparent backdrop for overlay panel
    #overlay-panel — slide-up panel for Add/Edit terminal
      #overlay-title
      inputs: ov-terminal-name, ov-node-number, ov-store-ref (readonly), ov-prefix, ov-sku
      #ov-key-box — generated key display (initially hidden)
      #ov-error — error message display
      #ov-buttons — action buttons (dynamically populated)
    #new-customer-backdrop — backdrop for new customer modal
    #new-customer-modal — centered modal
      nc-store-name, nc-store-ref inputs
      CANCEL / CREATE buttons
    <script>
      initializeConfig() — fetches /api/admin/config to obtain ADMIN_SECRET
      loadCustomers() — fetches customer list
      renderCustomers(), renderMain(), renderProfileHeader(), renderTerminalCards()
      generateKey(), saveTerminal(), handleSaveEdit()
      revokeTerminal(), deleteCustomer()
      openNewCustomer(), createCustomer()
```

### Login form / auth check

**No login form exists.** There is no password input, no login gate, and no session/cookie mechanism. Authentication state is bootstrapped silently: `initializeConfig()` (line 211–221) fetches `/api/admin/config` at page load and stores the returned `admin_secret` in the JS variable `ADMIN_SECRET`. This means anyone who can load `admin.html` automatically receives the admin secret via an unauthenticated HTTP request.

### Logout button

**No logout button exists.** The header (`#header`, lines 30–37) contains only the "KINDPOS · License Admin" title and a "LIVE" badge.

---

## F. ADMIN_SECRET Surface

### Full grep output

```
admin.html:205:  let ADMIN_SECRET = '';
admin.html:216:        ADMIN_SECRET = config.admin_secret || '';
admin.html:304:        headers: { Authorization: `Bearer ${ADMIN_SECRET}` }
admin.html:515:          Authorization: `Bearer ${ADMIN_SECRET}`,
admin.html:562:          'Authorization': `Bearer ${ADMIN_SECRET}`
admin.html:605:          'Authorization': `Bearer ${ADMIN_SECRET}`
admin.html:631:          Authorization: `Bearer ${ADMIN_SECRET}`,
admin.html:662:        headers: { Authorization: `Bearer ${ADMIN_SECRET}` }
admin.html:720:          'Authorization': `Bearer ${ADMIN_SECRET}`
functions/api/admin/generate.js:15:  return token === env.ADMIN_SECRET;
functions/api/admin/terminals.js:15:  return token === env.ADMIN_SECRET;
functions/api/admin/customers.js:15:  return token === env.ADMIN_SECRET;
functions/api/admin/revoke.js:15:  return token === env.ADMIN_SECRET;
functions/api/admin/terminals/[license_key].js:15:  return token === env.ADMIN_SECRET;
functions/api/admin/config.js:20:  return json({ admin_secret: env.ADMIN_SECRET });
functions/api/admin/customers/[store_ref].js:15:  return !!token && token === env.ADMIN_SECRET;
```

### Critical finding

`functions/api/admin/config.js:20` returns `{ admin_secret: env.ADMIN_SECRET }` **with zero authentication**. Any unauthenticated HTTP GET to `/api/admin/config` discloses the full admin secret. Combined with `admin.html:213–216`, the browser fetches this endpoint on every page load before showing the UI — meaning the secret is delivered to the browser in plain text with no login step required.

---

## G. Test Infrastructure

### Test files found

```
(none)
```

The `find` command returned no `.test.js`, `.spec.js`, `vitest.config*`, or `jest.config*` files outside `node_modules`.

### `package.json`

**No `package.json` exists** in the repository. There is no `node_modules/` directory, no `"test"` script, and no recorded Node.js version.

- **Test runner:** None configured
- **`package.json` `"test"` script:** N/A — no `package.json`
- **Test file count:** 0
- **`@cloudflare/vitest-pool-workers`:** Not present

### Node version file

No `.nvmrc` or `.node-version` file exists.

---

## H. feat Branch Delta

### Command output

```
branch not available locally
```

The branch `feat/admin-auth-rebuild` does not exist in the local repository or as a tracked remote. Available remote branches are:

```
remotes/origin/claude/audit-kindpos-site-HzExn
remotes/origin/main
```

No cherry-pick candidates can be identified.

---

## I. Legacy Endpoints

| Route | File | Status |
|-------|------|--------|
| `POST /api/activate` | `functions/api/activate.js` | **Live** — fully implemented, handles PENDING→ACTIVATED transition with hardware fingerprint binding |
| `POST /api/validate` | `functions/api/validate.js` | **Live** — fully implemented, validates an activated license |
| `POST /api/checkin` | `functions/api/checkin.js` | **Live** — fully implemented, updates `ip` and `last_seen` |
| `GET /api/admin/config` | `functions/api/admin/config.js` | **Live** — fully implemented, but **unauthenticated** — exposes `ADMIN_SECRET` to any caller |

All four routes are live. None is a 410 stub.

---

## J. package.json

### Output

```
no package.json
no node version file
```

No `package.json` exists. No `.nvmrc` or `.node-version` file exists. The project has no npm dependencies declared, no build scripts, and no test runner configured. It is a pure Cloudflare Pages project with vanilla JS functions and no bundler.

---

## Summary of Critical Findings

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| 1 | **CRITICAL** | `/api/admin/config` returns `ADMIN_SECRET` with no authentication — any unauthenticated request obtains the admin credential | `functions/api/admin/config.js:20` |
| 2 | **CRITICAL** | `admin.html` automatically fetches and stores the admin secret on page load, with no login gate | `admin.html:211–223` |
| 3 | **HIGH** | No login form or session mechanism exists — any visitor to `admin.html` receives full admin access | `admin.html` (entire file) |
| 4 | **HIGH** | No logout button or session invalidation mechanism | `admin.html:30–37` |
| 5 | **MEDIUM** | License key generation uses `Math.random()` (not cryptographically secure) | `functions/api/admin/generate.js:18–21` |
| 6 | **MEDIUM** | `requireAdmin` in `customers.js`, `generate.js`, `revoke.js`, `terminals.js` does not check `!!token` (empty string would fail comparison but a timing or encoding edge could be exploited) | All `requireAdmin` functions except `customers/[store_ref].js:15` |
| 7 | **LOW** | No test infrastructure — zero tests, no test runner, no `package.json` | Entire repo |
| 8 | **LOW** | No `wrangler.toml` — D1 binding and secrets are not version-controlled | Repo root |
| 9 | **INFO** | `feat/admin-auth-rebuild` branch referenced in audit instructions does not exist in this repo | Git remotes |
