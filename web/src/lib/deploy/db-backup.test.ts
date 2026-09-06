import {describe, it, expect, vi} from 'vitest';

vi.mock('server-only', () => ({}));

import {pgConnEnv, pgDumpArgs} from './db-backup';

describe('pgConnEnv', () => {
  it('maps a full URL to libpq env vars (password not in argv)', () => {
    const env = pgConnEnv('postgresql://bob:s3cr3t@db.host:6543/appdb?sslmode=require&schema=public');
    expect(env).toMatchObject({
      PGHOST: 'db.host',
      PGPORT: '6543',
      PGDATABASE: 'appdb',
      PGUSER: 'bob',
      PGPASSWORD: 's3cr3t',
      PGSSLMODE: 'require',
    });
  });

  it('defaults the port and url-decodes credentials', () => {
    const env = pgConnEnv('postgresql://us%40er:p%3Ass@localhost/db');
    expect(env.PGPORT).toBe('5432');
    expect(env.PGUSER).toBe('us@er');
    expect(env.PGPASSWORD).toBe('p:ss');
    expect(env.PGSSLMODE).toBeUndefined();
  });
});

describe('pgDumpArgs', () => {
  it('produces a restorable plain dump to the out file', () => {
    expect(pgDumpArgs('/b/pre.sql')).toEqual([
      '--no-owner',
      '--no-privileges',
      '--clean',
      '--if-exists',
      '-f',
      '/b/pre.sql',
    ]);
  });
});
