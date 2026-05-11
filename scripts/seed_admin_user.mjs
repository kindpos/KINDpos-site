#!/usr/bin/env node
// One-time bootstrap helper for the initial super_admin admin_users row.
//
// Reads BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD from the env,
// PBKDF2-hashes the password, and prints a single `INSERT INTO admin_users`
// statement to stdout. Does NOT execute SQL — pipe the output into wrangler:
//
//   BOOTSTRAP_ADMIN_EMAIL=alex@kindpos.com \
//   BOOTSTRAP_ADMIN_PASSWORD='temp-bootstrap-password' \
//     node scripts/seed_admin_user.mjs \
//     | xargs -0 -I{} npx wrangler d1 execute KINDPOS_DB --local --command "{}"
//
// (Or capture to a file and pass via `--file=`; both work.)
//
// Hash format — pbkdf2$100000$<b64-salt>$<b64-hash> — is the contract the
// K3 login endpoint verifies against. Do not change parameters without
// updating that endpoint in lockstep.

import { randomBytes, randomUUID, pbkdf2Sync } from "node:crypto";

const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const DIGEST = "sha256";

function fail(msg) {
  process.stderr.write(`seed_admin_user: ${msg}\n`);
  process.exit(1);
}

const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

if (!email) fail("BOOTSTRAP_ADMIN_EMAIL is required");
if (!password) fail("BOOTSTRAP_ADMIN_PASSWORD is required");
if (password.length < 12) {
  fail("BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters");
}

const salt = randomBytes(SALT_BYTES);
const derived = pbkdf2Sync(password, salt, ITERATIONS, KEY_BYTES, DIGEST);
const hash = `pbkdf2$${ITERATIONS}$${salt.toString("base64")}$${derived.toString("base64")}`;

const id = randomUUID();

// SQL string-escape: SQLite uses doubled single quotes inside literals.
const sqlEscape = (s) => s.replace(/'/g, "''");

const sql =
  `INSERT INTO admin_users (id, email, password_hash, role, must_change_password, is_active) ` +
  `VALUES ('${sqlEscape(id)}', '${sqlEscape(email)}', '${sqlEscape(hash)}', 'super_admin', 1, 1);`;

process.stdout.write(sql + "\n");
