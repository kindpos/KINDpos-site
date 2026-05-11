import { describe, it, expect, beforeAll } from 'vitest';
import { env, applyD1Migrations } from 'cloudflare:test';
import { hashPassword, verifyPassword } from '../functions/lib/auth/password.js';
import { getUserByEmail } from '../functions/lib/auth/admin_users.js';
import { createSession, getSession, revokeSession, getSessionIdFromRequest, COOKIE_NAME } from '../functions/lib/auth/admin_sessions.js';
import { checkRateLimit, recordAttempt } from '../functions/lib/auth/rate_limit.js';

// Minimal request factory
function makeRequest(overrides = {}) {
  return new Request('https://kindpos.com/', {
    headers: { 'CF-Connecting-IP': '1.2.3.4', ...overrides.headers },
    ...overrides,
  });
}

describe('password', () => {
  it('hashes and verifies correctly', async () => {
    const hash = await hashPassword('hunter2');
    expect(await verifyPassword('hunter2', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('produces different hashes for same input (random salt)', async () => {
    const h1 = await hashPassword('same');
    const h2 = await hashPassword('same');
    expect(h1).not.toBe(h2);
  });
});

describe('sessions', () => {
  let db;
  beforeAll(async () => {
    db = env.KINDPOS_DB;
    await applyD1Migrations(db, __D1_MIGRATIONS__);
    // Seed a user
    await db.prepare(
      "INSERT OR IGNORE INTO admin_users (user_id, email, password_hash, created_at, updated_at) VALUES ('u1', 'test@kindpos.com', 'x', datetime('now'), datetime('now'))"
    ).run();
  });

  it('creates and retrieves a session', async () => {
    const req = makeRequest();
    const { sessionId } = await createSession(db, 'u1', req);
    const session = await getSession(db, sessionId);
    expect(session).not.toBeNull();
    expect(session.user_id).toBe('u1');
  });

  it('revoked session returns null', async () => {
    const req = makeRequest();
    const { sessionId } = await createSession(db, 'u1', req);
    await revokeSession(db, sessionId);
    expect(await getSession(db, sessionId)).toBeNull();
  });

  it('parses session id from cookie header', () => {
    const req = new Request('https://x.com/', {
      headers: { Cookie: `${COOKIE_NAME}=abc123; other=x` },
    });
    expect(getSessionIdFromRequest(req)).toBe('abc123');
  });
});

describe('rate limiting', () => {
  let db;
  beforeAll(async () => {
    db = env.KINDPOS_DB;
    await applyD1Migrations(db, __D1_MIGRATIONS__);
  });

  it('blocks after 5 email failures', async () => {
    const email = `rl-email-${Date.now()}@x.com`;
    for (let i = 0; i < 5; i++) await recordAttempt(db, email, '9.9.9.9', false);
    const result = await checkRateLimit(db, email, '9.9.9.9');
    expect(result.limited).toBe(true);
    expect(result.reason).toBe('email');
  });
});
