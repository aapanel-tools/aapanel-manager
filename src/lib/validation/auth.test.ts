import {describe, expect, it} from 'vitest';
import {signInSchema} from './auth';

describe('signInSchema', () => {
  it('accepts a valid credential pair', () => {
    expect(() => signInSchema.parse({email: 'a@b.com', password: 'longenough'})).not.toThrow();
  });
  it('rejects a bad email', () => {
    expect(() => signInSchema.parse({email: 'nope', password: 'longenough'})).toThrow();
  });
  it('rejects a short password', () => {
    expect(() => signInSchema.parse({email: 'a@b.com', password: 'x'})).toThrow();
  });
});
