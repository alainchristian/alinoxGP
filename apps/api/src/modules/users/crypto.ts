import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Opaque random token (URL-safe). Only its sha256 is ever stored. */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export const safeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

/** AES-256-GCM. Output: iv.tag.ciphertext (base64url). Used for TOTP secrets at rest. */
export function encryptSecret(plain: string, keyBase64: string): string {
  const key = Buffer.from(keyBase64, 'base64');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ct].map((b) => b.toString('base64url')).join('.');
}

export function decryptSecret(payload: string, keyBase64: string): string {
  const [iv, tag, ct] = payload.split('.').map((p) => Buffer.from(p, 'base64url'));
  if (!iv || !tag || !ct) throw new Error('Malformed encrypted secret');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyBase64, 'base64'), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
