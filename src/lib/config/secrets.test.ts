import {describe, it, expect, afterEach} from 'vitest';
import {getEncryptionKey} from './secrets';

const VALID = 'a'.repeat(64);

describe('getEncryptionKey', () => {
  const original = process.env.APP_ENCRYPTION_KEY;
  afterEach(() => {process.env.APP_ENCRYPTION_KEY = original;});

  it('returns the key when it is 64 hex chars', () => {
    process.env.APP_ENCRYPTION_KEY = VALID;
    expect(getEncryptionKey()).toBe(VALID);
  });

  it('throws when missing or malformed', () => {
    delete process.env.APP_ENCRYPTION_KEY;
    expect(() => getEncryptionKey()).toThrow();
    process.env.APP_ENCRYPTION_KEY = 'short';
    expect(() => getEncryptionKey()).toThrow();
  });
});
