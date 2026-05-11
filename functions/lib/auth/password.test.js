import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";

import { hashPassword, verifyPassword } from "./password.js";

const PBKDF2_FORMAT = /^pbkdf2\$100000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/;

describe("hashPassword", () => {
  it("returns the canonical pbkdf2 format", async () => {
    const hash = await hashPassword("hello-world-123");
    expect(hash).toMatch(PBKDF2_FORMAT);
  });

  it("produces a different hash on each call for the same plaintext", async () => {
    const a = await hashPassword("same-input-12345");
    const b = await hashPassword("same-input-12345");
    expect(a).not.toEqual(b);
    expect(a).toMatch(PBKDF2_FORMAT);
    expect(b).toMatch(PBKDF2_FORMAT);
  });
});

describe("verifyPassword", () => {
  it("returns true for matching plaintext", async () => {
    const stored = await hashPassword("the-correct-passphrase");
    expect(await verifyPassword("the-correct-passphrase", stored)).toBe(true);
  });

  it("returns false for wrong plaintext", async () => {
    const stored = await hashPassword("the-correct-passphrase");
    expect(await verifyPassword("the-wrong-passphrase!!", stored)).toBe(false);
  });

  it("returns false for a tampered hash (one base64 char changed)", async () => {
    const stored = await hashPassword("untampered-input-123");
    // Flip the final character of the hash portion. The last byte changing
    // is sufficient — a single bit of mismatch must invalidate the hash.
    const last = stored[stored.length - 1];
    const replacement = last === "A" ? "B" : "A";
    const tampered = stored.slice(0, -1) + replacement;
    expect(tampered).not.toEqual(stored);
    expect(await verifyPassword("untampered-input-123", tampered)).toBe(false);
  });

  it("returns false for a malformed stored value", async () => {
    expect(await verifyPassword("anything", "not-a-real-hash")).toBe(false);
    expect(await verifyPassword("anything", "")).toBe(false);
    expect(await verifyPassword("anything", "pbkdf2$nope")).toBe(false);
  });
});

describe("K1 ↔ K2 cross-compatibility", () => {
  // The seed hash is generated in vitest.config.js by spawning a Node child
  // process that runs scripts/seed_admin_user.mjs. If the PBKDF2 parameters
  // ever drift between the two implementations, this assertion will fail
  // and surface the divergence at the contract boundary.
  it("verifies a hash produced by scripts/seed_admin_user.mjs", async () => {
    expect(env.SEED_HASH).toMatch(PBKDF2_FORMAT);
    expect(await verifyPassword(env.SEED_PASSWORD, env.SEED_HASH)).toBe(true);
  });

  it("rejects the seed hash for a wrong plaintext", async () => {
    expect(await verifyPassword("definitely-not-it", env.SEED_HASH)).toBe(false);
  });
});
