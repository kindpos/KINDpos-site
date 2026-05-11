# KINDpos-site D1 migrations

Schema lives under `migrations/`. Wrangler runs each `NNNN_*.sql` file in
order and tracks applied migrations in the D1's internal `d1_migrations`
table. The D1 binding (`KINDPOS_DB`) and the `migrations_dir` setting are
declared in `wrangler.toml`.

## Applying migrations

**Local** — operates on the SQLite file under `.wrangler/state/v3/d1/`,
safe to wipe and re-run as often as needed:

```
npx wrangler d1 migrations apply KINDPOS_DB --local
```

**Remote** — applies to the production D1. Replace `database_id` in
`wrangler.toml` with the value from `wrangler d1 create kindpos-site`
before the first remote apply. Only run with explicit intent:

```
npx wrangler d1 migrations apply KINDPOS_DB --remote
```

## Seeding the first admin user

`scripts/seed_admin_user.mjs` reads `BOOTSTRAP_ADMIN_EMAIL` and
`BOOTSTRAP_ADMIN_PASSWORD` from the environment, PBKDF2-hashes the
password, and prints a single `INSERT INTO admin_users` statement to
stdout. Capture the output to a file and apply via wrangler:

```
BOOTSTRAP_ADMIN_EMAIL=alex@kindpos.com \
BOOTSTRAP_ADMIN_PASSWORD='choose-something-strong' \
  node scripts/seed_admin_user.mjs > /tmp/seed_admin.sql

npx wrangler d1 execute KINDPOS_DB --local --file=/tmp/seed_admin.sql
```

The hash format — `pbkdf2$100000$<b64-salt>$<b64-hash>` — is the contract
verified by the K3 login endpoint. Do not change PBKDF2 parameters in the
seed script without updating the verifier in lockstep.

## ⚠️ Destructive: `0001_initial.sql` resets the schema

`0001_initial.sql` begins with `DROP TABLE IF EXISTS` statements for every
table it manages (`customers`, `terminals`, `provisioning_events`,
`admin_users`, `admin_sessions`). Applying this migration to a populated
database **wipes every row**. The pattern is intentional for the bootstrap
of a greenfield D1 but is dangerous if re-applied to production by
accident. Only run `wrangler d1 migrations apply KINDPOS_DB --remote`
with deliberate intent — typically once, at first provisioning.
