import {describe, it, expect} from 'vitest';
import {
  sanitizeVersion,
  bundleAssetName,
  checksumAssetName,
  releaseLayout,
} from './layout';

describe('sanitizeVersion', () => {
  it('accepts plain semver and strips a leading v', () => {
    expect(sanitizeVersion('1.2.3')).toBe('1.2.3');
    expect(sanitizeVersion('v1.2.3')).toBe('1.2.3');
    expect(sanitizeVersion('v1.2.3-beta.1')).toBe('1.2.3-beta.1');
    expect(sanitizeVersion(' v1.2.3+build.5 ')).toBe('1.2.3+build.5');
  });

  it('rejects path-traversal and non-semver input', () => {
    for (const bad of ['../etc', '1.2', 'v1.2.3/..', '1.2.3/x', 'latest', '1.2.3;rm', '']) {
      expect(() => sanitizeVersion(bad)).toThrow();
    }
  });
});

describe('asset names', () => {
  it('builds the bundle and checksum names from a version', () => {
    expect(bundleAssetName('v1.2.3')).toBe('aapanel-manager-bundle-1.2.3.tar.gz');
    expect(checksumAssetName('1.2.3')).toBe('aapanel-manager-bundle-1.2.3.tar.gz.sha256');
  });
});

describe('releaseLayout', () => {
  it('computes POSIX paths under the root, regardless of trailing slash', () => {
    const l = releaseLayout('/srv/app/', 'v1.2.3');
    expect(l).toEqual({
      root: '/srv/app',
      releasesDir: '/srv/app/releases',
      releaseDir: '/srv/app/releases/1.2.3',
      currentLink: '/srv/app/current',
      backupsDir: '/srv/app/backups',
      tmpDir: '/srv/app/tmp',
    });
  });

  it('normalizes Windows-style backslashes to POSIX', () => {
    const l = releaseLayout('C:\\srv\\app', '1.0.0');
    expect(l.releaseDir).toBe('C:/srv/app/releases/1.0.0');
  });

  it('throws on an unsafe version before building any path', () => {
    expect(() => releaseLayout('/srv/app', '../../etc')).toThrow();
  });
});
