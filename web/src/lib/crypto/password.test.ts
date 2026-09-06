import {describe, expect, it} from 'vitest';
import {hashPassword, verifyPassword} from './password';

describe('password', () => {
  it('verifies a correct password', async () => {
    const h = await hashPassword('s3cret!');
    expect(await verifyPassword(h, 's3cret!')).toBe(true);
  });
  it('rejects a wrong password', async () => {
    const h = await hashPassword('s3cret!');
    expect(await verifyPassword(h, 'nope')).toBe(false);
  });
});
