import { decryptSecret, encryptSecret, randomToken, safeEqual, sha256 } from './crypto';

const key = Buffer.alloc(32, 9).toString('base64');

describe('crypto helpers', () => {
  it('round-trips an encrypted secret and never stores plaintext', () => {
    const enc = encryptSecret('JBSWY3DPEHPK3PXP', key);
    expect(enc).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(enc, key)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('uses a fresh IV each time', () => {
    expect(encryptSecret('same', key)).not.toBe(encryptSecret('same', key));
  });

  it('detects tampering and the wrong key', () => {
    const [iv, tag, ct] = encryptSecret('secret', key).split('.');
    const flipped = Buffer.from(ct!, 'base64url');
    flipped[0] = flipped[0]! ^ 0xff;
    expect(() => decryptSecret([iv, tag, flipped.toString('base64url')].join('.'), key)).toThrow();
    expect(() => decryptSecret(encryptSecret('secret', key), Buffer.alloc(32, 1).toString('base64'))).toThrow();
    expect(() => decryptSecret('garbage', key)).toThrow();
  });

  it('hashes deterministically and generates unique URL-safe tokens', () => {
    expect(sha256('a')).toBe(sha256('a'));
    expect(sha256('a')).not.toBe(sha256('b'));
    const t = new Set(Array.from({ length: 200 }, () => randomToken()));
    expect(t.size).toBe(200);
    expect([...t][0]).toMatch(/^[\w-]{43}$/);
  });

  it('compares in constant-time-safe fashion, including different lengths', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
