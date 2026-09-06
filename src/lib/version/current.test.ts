import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {getCurrentVersion} from './current';

describe('getCurrentVersion', () => {
  const saved = {
    APP_VERSION: process.env.APP_VERSION,
    APP_COMMIT: process.env.APP_COMMIT,
    APP_BUILD_TIME: process.env.APP_BUILD_TIME,
  };

  beforeEach(() => {
    delete process.env.APP_VERSION;
    delete process.env.APP_COMMIT;
    delete process.env.APP_BUILD_TIME;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('falls back to the package.json version (a valid semver) when APP_VERSION is unset', () => {
    const {version} = getCurrentVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('prefers APP_VERSION when set', () => {
    process.env.APP_VERSION = '9.9.9';
    expect(getCurrentVersion().version).toBe('9.9.9');
  });

  it('reads commit and build time from env, null when absent', () => {
    expect(getCurrentVersion().commit).toBeNull();
    expect(getCurrentVersion().buildTime).toBeNull();
    process.env.APP_COMMIT = 'abc1234';
    process.env.APP_BUILD_TIME = '2026-06-13T00:00:00Z';
    const v = getCurrentVersion();
    expect(v.commit).toBe('abc1234');
    expect(v.buildTime).toBe('2026-06-13T00:00:00Z');
  });
});
