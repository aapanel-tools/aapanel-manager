import {describe, it, expect} from 'vitest';
import {denyUserDeletion, denyRoleChange} from './policy';

describe('denyUserDeletion', () => {
  it('blocks deleting your own account', () => {
    expect(denyUserDeletion({isSelf: true, targetIsAdmin: false, adminCount: 5})).toBe('cannotDeleteSelf');
  });

  it('blocks deleting the last admin', () => {
    expect(denyUserDeletion({isSelf: false, targetIsAdmin: true, adminCount: 1})).toBe('lastAdmin');
  });

  it('allows deleting an admin when others remain', () => {
    expect(denyUserDeletion({isSelf: false, targetIsAdmin: true, adminCount: 2})).toBeNull();
  });

  it('allows deleting a viewer', () => {
    expect(denyUserDeletion({isSelf: false, targetIsAdmin: false, adminCount: 1})).toBeNull();
  });

  it('prioritises the self-delete block over the last-admin block', () => {
    expect(denyUserDeletion({isSelf: true, targetIsAdmin: true, adminCount: 1})).toBe('cannotDeleteSelf');
  });
});

describe('denyRoleChange', () => {
  it('blocks demoting the last admin to viewer', () => {
    expect(denyRoleChange({targetIsAdmin: true, nextRole: 'viewer', adminCount: 1})).toBe('lastAdmin');
  });

  it('allows demoting an admin when others remain', () => {
    expect(denyRoleChange({targetIsAdmin: true, nextRole: 'viewer', adminCount: 2})).toBeNull();
  });

  it('allows keeping the last admin as admin (no demotion)', () => {
    expect(denyRoleChange({targetIsAdmin: true, nextRole: 'admin', adminCount: 1})).toBeNull();
  });

  it('allows promoting a viewer to admin', () => {
    expect(denyRoleChange({targetIsAdmin: false, nextRole: 'admin', adminCount: 1})).toBeNull();
  });
});
