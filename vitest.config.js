// Vitest configuration for the kindpos.com Workers code.
//
// Runs everything through `@cloudflare/vitest-pool-workers` so D1 bindings,
// `crypto.subtle`, and `crypto.randomUUID()` resolve to the real Workers
// runtime via miniflare. Each test file gets an isolated in-memory D1, and
// the K1 migration is applied per file through `applyD1Migrations`.
//
// The K1 ↔ K2 contract probe runs at config-load time: a Node child process
// invokes `scripts/seed_admin_user.mjs` with a known plaintext, the emitted
// SQL is parsed for its password_hash, and the value is exposed to the
// Workers tests as the `SEED_HASH` binding. The password test then verifies
// it through `verifyPassword`. If K1's hashing parameters ever drift from
// K2's, this binding-driven assert will fail loudly.

import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const SEED_EMAIL = "cross-compat@example.com";
const SEED_PASSWORD = "cross-compat-password-1234";

function generateSeedHash(rootDir) {
  const stdout = execFileSync(
    process.execPath,
    [path.join(rootDir, "scripts", "seed_admin_user.mjs")],
    {
      env: {
        ...process.env,
        BOOTSTRAP_ADMIN_EMAIL: SEED_EMAIL,
        BOOTSTRAP_ADMIN_PASSWORD: SEED_PASSWORD,
      },
    },
  ).toString();
  const m = stdout.match(/'(pbkdf2\$\d+\$[^']+\$[^']+)'/);
  if (!m) {
    throw new Error(
      "vitest.config.js: could not parse password_hash from seed script output",
    );
  }
  return m[1];
}

export default defineConfig(async () => {
  const rootDir = import.meta.dirname;
  const migrations = await readD1Migrations(path.join(rootDir, "migrations"));
  const seedHash = generateSeedHash(rootDir);

  return {
    plugins: [
      cloudflareTest({
        miniflare: {
          compatibilityDate: "2025-10-11",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: ["KINDPOS_DB"],
          bindings: {
            TEST_MIGRATIONS: migrations,
            SEED_HASH: seedHash,
            SEED_PASSWORD,
            SEED_EMAIL,
          },
        },
      }),
    ],
  };
});
