import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

import { serverEnv } from "@/env";

/**
 * AES-256-GCM, not CBC: the tag makes tampering detectable. A refresh token is
 * a bearer credential, so a silently corrupted decrypt is worse than a failure.
 */
const ALGORITHM = "aes-256-gcm";
/** 96 bits, the size GCM is specified around. */
const IV_BYTES = 12;
const TAG_BYTES = 16;

function key(): Buffer {
  const raw = Buffer.from(serverEnv.tokenEncryptionKey, "base64");
  if (raw.length !== 32) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32)",
    );
  }
  return raw;
}

/**
 * Encrypts a secret for the `bytea` columns holding Google tokens.
 *
 * The IV is random per call and stored alongside the ciphertext, so sealing the
 * same token twice produces different bytes — reusing a GCM nonce under one key
 * would leak the plaintext relationship between them.
 *
 * Layout: iv (12) ‖ tag (16) ‖ ciphertext.
 */
export function seal(plaintext: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

/** Reverses `seal`. Throws if the bytes were altered or the key has changed. */
export function unseal(sealed: Buffer): string {
  if (sealed.length < IV_BYTES + TAG_BYTES) throw new Error("Sealed value is truncated");

  const iv = sealed.subarray(0, IV_BYTES);
  const tag = sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = sealed.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/**
 * Constant-time string comparison, for secrets that arrive in a request:
 * the cron bearer token and Google's webhook channel token.
 */
export function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // Length alone is not secret, and timingSafeEqual throws on a mismatch.
  return left.length === right.length && timingSafeEqual(left, right);
}
