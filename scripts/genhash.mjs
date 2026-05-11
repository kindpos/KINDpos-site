import { webcrypto as c } from 'node:crypto';
const pass = 'KINDpos-admin-2026';
const salt = c.getRandomValues(new Uint8Array(16));
const key = await c.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits']);
const bits = await c.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:100000}, key, 256);
const hex = b => Array.from(b).map(x => x.toString(16).padStart(2,'0')).join('');
console.log('pbkdf2:sha256:100000:' + hex(salt) + ':' + hex(new Uint8Array(bits)));