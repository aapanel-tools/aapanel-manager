import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {updatePaths, isLockStale, acquireUpdateLock, UPDATE_LOCK_TTL_MS} from './git';

describe('updatePaths', () => {
  it('derives lock/log/backups under the repo root', () => {
    const p = updatePaths('/srv/app');
    expect(p.lock).toBe(path.join('/srv/app', '.update.lock'));
    expect(p.log).toBe(path.join('/srv/app', '.update.log'));
    expect(p.backupsDir).toBe(path.join('/srv/app', '.update-backups'));
  });
});

describe('isLockStale', () => {
  it('is fresh within the TTL', () => {
    expect(isLockStale(1000, 1000 + UPDATE_LOCK_TTL_MS - 1)).toBe(false);
  });
  it('is stale past the TTL', () => {
    expect(isLockStale(1000, 1000 + UPDATE_LOCK_TTL_MS + 1)).toBe(true);
  });
  it('treats a non-finite timestamp as stale', () => {
    expect(isLockStale(Number.NaN, 5000)).toBe(true);
  });
});

describe('acquireUpdateLock', () => {
  let dir: string;
  let lock: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'aap-upd-'));
    lock = path.join(dir, '.update.lock');
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  it('acquires when no lock exists', () => {
    expect(acquireUpdateLock(lock, {kind: 'update', target: '1.0.0', startedAt: 1000}, 1000)).toBe(true);
    expect(existsSync(lock)).toBe(true);
  });

  it('refuses when a fresh lock already exists', () => {
    acquireUpdateLock(lock, {kind: 'update', target: '1.0.0', startedAt: 1000}, 1000);
    expect(acquireUpdateLock(lock, {kind: 'update', target: '1.0.1', startedAt: 1500}, 1500)).toBe(false);
  });

  it('replaces a stale lock', () => {
    acquireUpdateLock(lock, {kind: 'update', target: '1.0.0', startedAt: 1000}, 1000);
    const later = 1000 + UPDATE_LOCK_TTL_MS + 1;
    expect(acquireUpdateLock(lock, {kind: 'rollback', target: '0.9.0', startedAt: later}, later)).toBe(true);
    const info = JSON.parse(readFileSync(lock, 'utf8')) as {target: string};
    expect(info.target).toBe('0.9.0');
  });

  it('replaces a corrupt lock', () => {
    writeFileSync(lock, 'not-json');
    expect(acquireUpdateLock(lock, {kind: 'update', target: '2.0.0', startedAt: 9999}, 9999)).toBe(true);
  });
});
