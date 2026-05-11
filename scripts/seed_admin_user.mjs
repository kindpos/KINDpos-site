#!/usr/bin/env node
// Usage: node scripts/seed_admin_user.mjs
// Required env vars: ADMIN_EMAIL, ADMIN_PASSWORD
// Optional env vars: DB_NAME (default: kindpos-licenses)
//
// Hashes the password with PBKDF2-SHA256 (matches functions/lib/auth/password.js),
// then executes an idempotent INSERT via wrangler d1 execute.

import { webcrypto } from 'node:crypto';
import { execSync }  from 'node:child_process';
import { randomUUID } from 'node:crypto';

const { subtle } = webcrypto;

const email    = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
const dbName   = process.env.DB_NAME ?? 'kindpos-licenses';

if (!email || !password) {
  console.error('ERROR: ADMIN_EMAIL and ADMIN_PASSWORD must be set.');
  process.exit(1);
}

// PBKDF2-SHA256 — must match the Workers-side implementation in R2
const ITERATIONS = 100_000;
const SALT_BYTES = 16;

const salt = webcrypto.getRandomValues(new Uint8Array(SALT_BYTES));
const keyMaterial = await subtle.importKey(
  'raw',
  new TextEncoder().encode(password),
  'PBKDF2',
  false,
  ['deriveBits']
);
const derived = await subtle.deriveBits(
  { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
  keyMaterial,
  256
);

const saltHex = Buffer.from(salt).toString('hex');
const hashHex = Buffer.from(derived).toString('hex');
// Stored format: pbkdf2:sha256:<iterations>:<saltHex>:<hashHex>
const passwordHash = `pbkdf2:sha256:${ITERATIONS}:${saltHex}:${hashHex}`;

const userId = randomUUID();
const now    = new Date().toISOString();

const sql = `
INSERT INTO admin_users (user_id, email, password_hash, must_change_password, created_at, updated_at)
VALUES ('${userId}', '${email.toLowerCase()}', '${passwordHash}', 0, '${now}', '${now}')
ON CONFLICT(email) DO UPDATE SET
  password_hash        = excluded.password_hash,
  must_change_password = 0,
  updated_at           = excluded.updated_at;
`.trim();

console.log('Seeding admin user:', email);
console.log('Database:', dbName);

execSync(
  `wrangler d1 execute ${dbName} --remote --command "${sql.replace(/"/g, '\\"')}"`,
  { stdio: 'inherit' }
);

console.log('Done.');
