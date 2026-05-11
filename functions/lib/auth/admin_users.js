// Admin user repository (kindpos.com side, distinct from per-install Overseer).
//
// All exports take the D1 binding as the first argument so the same module
// works under different bindings in tests vs. production. UUIDs come from
// `crypto.randomUUID()` (Web Crypto, available in Workers).
//
// The `AdminUser` shape returned by every read function omits `password_hash`
// — the SELECT projections enumerate columns explicitly to make accidental
// leaks impossible. If you need to verify a password, call
// `verifyAdminUserPassword(db, userId, plaintext)`.

import { hashPassword, verifyPassword } from "./password.js";

const READ_COLUMNS =
  "id, email, role, must_change_password, created_at, last_login_at, is_active";

function toAdminUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    must_change_password: Boolean(row.must_change_password),
    created_at: row.created_at,
    last_login_at: row.last_login_at,
    is_active: Boolean(row.is_active),
  };
}

export async function createAdminUser(
  db,
  { email, passwordPlaintext, role, mustChangePassword = false },
) {
  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(passwordPlaintext);
  await db
    .prepare(
      `INSERT INTO admin_users
         (id, email, password_hash, role, must_change_password, is_active)
       VALUES (?, ?, ?, ?, ?, 1)`,
    )
    .bind(id, email, passwordHash, role, mustChangePassword ? 1 : 0)
    .run();
  return id;
}

export async function getAdminUserByEmail(db, email) {
  const row = await db
    .prepare(
      `SELECT ${READ_COLUMNS} FROM admin_users WHERE email = ? COLLATE NOCASE`,
    )
    .bind(email)
    .first();
  return toAdminUser(row);
}

export async function getAdminUserById(db, id) {
  const row = await db
    .prepare(`SELECT ${READ_COLUMNS} FROM admin_users WHERE id = ?`)
    .bind(id)
    .first();
  return toAdminUser(row);
}

export async function verifyAdminUserPassword(db, userId, passwordPlaintext) {
  const row = await db
    .prepare(`SELECT password_hash FROM admin_users WHERE id = ?`)
    .bind(userId)
    .first();
  if (!row) return false;
  return verifyPassword(passwordPlaintext, row.password_hash);
}

export async function updateAdminUserPassword(db, userId, newPasswordPlaintext) {
  const passwordHash = await hashPassword(newPasswordPlaintext);
  await db
    .prepare(
      `UPDATE admin_users
          SET password_hash = ?, must_change_password = 0
        WHERE id = ?`,
    )
    .bind(passwordHash, userId)
    .run();
}

export async function markAdminUserLogin(db, userId) {
  await db
    .prepare(`UPDATE admin_users SET last_login_at = datetime('now') WHERE id = ?`)
    .bind(userId)
    .run();
}

export async function setAdminUserActive(db, userId, isActive) {
  await db
    .prepare(`UPDATE admin_users SET is_active = ? WHERE id = ?`)
    .bind(isActive ? 1 : 0, userId)
    .run();
}

export async function listAdminUsers(db, includeInactive = false) {
  const sql = includeInactive
    ? `SELECT ${READ_COLUMNS} FROM admin_users ORDER BY created_at`
    : `SELECT ${READ_COLUMNS} FROM admin_users WHERE is_active = 1 ORDER BY created_at`;
  const { results } = await db.prepare(sql).all();
  return (results ?? []).map(toAdminUser);
}
