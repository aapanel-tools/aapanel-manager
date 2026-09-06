import {describe, it, expect} from 'vitest';
import {
  userCreateSchema,
  userUpdateSchema,
  userDeleteSchema,
  changeOwnPasswordSchema,
  MIN_PASSWORD_LENGTH,
} from './user';

const LONG = 'x'.repeat(MIN_PASSWORD_LENGTH);

describe('userCreateSchema', () => {
  it('accepts a valid user and normalises the email', () => {
    const r = userCreateSchema.safeParse({email: '  Admin@Example.COM ', role: 'admin', password: LONG});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBe('admin@example.com');
  });

  it('rejects a short password', () => {
    const r = userCreateSchema.safeParse({email: 'a@b.co', role: 'viewer', password: 'short'});
    expect(r.success).toBe(false);
  });

  it('rejects an unknown role', () => {
    const r = userCreateSchema.safeParse({email: 'a@b.co', role: 'root', password: LONG});
    expect(r.success).toBe(false);
  });

  it('rejects a malformed email', () => {
    const r = userCreateSchema.safeParse({email: 'not-an-email', role: 'viewer', password: LONG});
    expect(r.success).toBe(false);
  });
});

describe('userUpdateSchema', () => {
  it('treats a blank password as "keep existing" (undefined)', () => {
    const r = userUpdateSchema.safeParse({id: 'u1', role: 'viewer', password: ''});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.password).toBeUndefined();
  });

  it('treats an omitted password as "keep existing"', () => {
    const r = userUpdateSchema.safeParse({id: 'u1', role: 'admin'});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.password).toBeUndefined();
  });

  it('rejects a non-empty but too-short password', () => {
    const r = userUpdateSchema.safeParse({id: 'u1', role: 'admin', password: 'short'});
    expect(r.success).toBe(false);
  });

  it('accepts a valid new password', () => {
    const r = userUpdateSchema.safeParse({id: 'u1', role: 'admin', password: LONG});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.password).toBe(LONG);
  });
});

describe('userDeleteSchema', () => {
  it('requires an id', () => {
    expect(userDeleteSchema.safeParse({id: '', confirm: 'x'}).success).toBe(false);
  });
});

describe('changeOwnPasswordSchema', () => {
  it('accepts a valid change', () => {
    const r = changeOwnPasswordSchema.safeParse({currentPassword: 'whatever', newPassword: LONG});
    expect(r.success).toBe(true);
  });

  it('rejects when the new password equals the current one', () => {
    const r = changeOwnPasswordSchema.safeParse({currentPassword: LONG, newPassword: LONG});
    expect(r.success).toBe(false);
  });

  it('rejects a short new password', () => {
    const r = changeOwnPasswordSchema.safeParse({currentPassword: 'whatever', newPassword: 'short'});
    expect(r.success).toBe(false);
  });
});
