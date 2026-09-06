import {describe, expect, it} from 'vitest';
import {encryptSecret, decryptSecret} from './secret-box';

const key = 'a'.repeat(64); // 32 bytes hex

describe('secret-box', () => {
  it('round-trips a secret', () => {
    const enc = encryptSecret('my-api_sk', key);
    expect(enc).not.toContain('my-api_sk');
    expect(decryptSecret(enc, key)).toBe('my-api_sk');
  });
  it('produces different ciphertext each time (random IV)', () => {
    expect(encryptSecret('x', key)).not.toBe(encryptSecret('x', key));
  });
  it('fails to decrypt if tampered', () => {
    const enc = encryptSecret('x', key);
    const bad = enc.slice(0, -2) + (enc.endsWith('aa') ? 'bb' : 'aa');
    expect(() => decryptSecret(bad, key)).toThrow();
  });
});
