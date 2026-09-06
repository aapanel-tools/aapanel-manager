import {describe, expect, it} from 'vitest';
import {parseEnv} from './env';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  AUTH_SECRET: 'x'.repeat(32),
  APP_ENCRYPTION_KEY: 'a'.repeat(64), // 32 bytes hex
};

describe('parseEnv', () => {
  it('accepts valid env', () => { expect(() => parseEnv(valid)).not.toThrow(); });
  it('rejects short encryption key', () => { expect(() => parseEnv({...valid, APP_ENCRYPTION_KEY: 'ab'})).toThrow(); });
  it('rejects missing DATABASE_URL', () => { const {DATABASE_URL, ...rest} = valid; expect(() => parseEnv(rest)).toThrow(); });

  it('enables the poller by default', () => { expect(parseEnv(valid).ENABLE_POLLER).toBe(true); });
  it('disables the poller for false/0/off (not coerced to true)', () => {
    expect(parseEnv({...valid, ENABLE_POLLER: 'false'}).ENABLE_POLLER).toBe(false);
    expect(parseEnv({...valid, ENABLE_POLLER: '0'}).ENABLE_POLLER).toBe(false);
    expect(parseEnv({...valid, ENABLE_POLLER: 'OFF'}).ENABLE_POLLER).toBe(false);
  });
  it('treats other ENABLE_POLLER values as enabled', () => {
    expect(parseEnv({...valid, ENABLE_POLLER: 'true'}).ENABLE_POLLER).toBe(true);
    expect(parseEnv({...valid, ENABLE_POLLER: '1'}).ENABLE_POLLER).toBe(true);
  });

  it('leaves APP_RELEASE_ROOT undefined when unset, trims when set', () => {
    expect(parseEnv(valid).APP_RELEASE_ROOT).toBeUndefined();
    expect(parseEnv({...valid, APP_RELEASE_ROOT: '  /srv/app  '}).APP_RELEASE_ROOT).toBe('/srv/app');
  });
});
