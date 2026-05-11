// functions/lib/auth/admin_users.js
export async function getUserByEmail(db, email) {
  return db.prepare(
    'SELECT user_id, email, password_hash, must_change_password, last_login_at FROM admin_users WHERE LOWER(email) = LOWER(?)'
  ).bind(email).first();
}

export async function updateLastLogin(db, userId) {
  await db.prepare(
    'UPDATE admin_users SET last_login_at = ? WHERE user_id = ?'
  ).bind(new Date().toISOString(), userId).run();
}
