// functions/lib/auth/password.js
const ITERATIONS = 100_000;
const SALT_BYTES = 16;

export async function hashPassword(plaintext) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(plaintext), 'PBKDF2', false, ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    keyMaterial, 256
  );
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2,'0')).join('');
  const hashHex = Array.from(new Uint8Array(derived)).map(b => b.toString(16).padStart(2,'0')).join('');
  return `pbkdf2:sha256:${ITERATIONS}:${saltHex}:${hashHex}`;
}

export async function verifyPassword(plaintext, stored) {
  const parts = stored.split(':');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2' || parts[1] !== 'sha256') return false;
  const iterations = parseInt(parts[2], 10);
  const salt = Uint8Array.from(parts[3].match(/.{2}/g).map(b => parseInt(b, 16)));
  const expectedHex = parts[4];
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(plaintext), 'PBKDF2', false, ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    keyMaterial, 256
  );
  const actualHex = Array.from(new Uint8Array(derived)).map(b => b.toString(16).padStart(2,'0')).join('');
  // Constant-time compare
  if (actualHex.length !== expectedHex.length) return false;
  let diff = 0;
  for (let i = 0; i < actualHex.length; i++) diff |= actualHex.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  return diff === 0;
}
