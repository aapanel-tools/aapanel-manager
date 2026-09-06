import {describe, it, expect} from 'vitest';
import {parseVersion, compareVersions, isNewer} from './semver';

describe('parseVersion', () => {
  it('parses plain and v-prefixed versions', () => {
    expect(parseVersion('1.2.3')).toEqual({major: 1, minor: 2, patch: 3, prerelease: []});
    expect(parseVersion('v0.1.0')).toEqual({major: 0, minor: 1, patch: 0, prerelease: []});
  });

  it('parses a pre-release and ignores build metadata', () => {
    expect(parseVersion('1.2.3-beta.1')).toEqual({major: 1, minor: 2, patch: 3, prerelease: ['beta', '1']});
    expect(parseVersion('1.2.3+build.5')).toEqual({major: 1, minor: 2, patch: 3, prerelease: []});
  });

  it('returns null for garbage', () => {
    expect(parseVersion('not-a-version')).toBeNull();
    expect(parseVersion('1.2')).toBeNull();
    expect(parseVersion('')).toBeNull();
  });
});

describe('compareVersions', () => {
  it('orders by major, minor, patch', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
    expect(compareVersions('1.2.0', '1.1.0')).toBe(1);
    expect(compareVersions('1.1.1', '1.1.2')).toBe(-1);
    expect(compareVersions('1.1.1', '1.1.1')).toBe(0);
  });

  it('treats v-prefix as equal', () => {
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
  });

  it('ranks a release above its pre-release', () => {
    expect(compareVersions('1.0.0', '1.0.0-beta')).toBe(1);
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(-1);
  });

  it('orders pre-release identifiers (numeric < non-numeric, then lexically/numerically)', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBe(-1);
    expect(compareVersions('1.0.0-beta.1', '1.0.0-beta')).toBe(1);
  });

  it('sorts unparsable versions as lowest', () => {
    expect(compareVersions('garbage', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0', 'garbage')).toBe(1);
  });
});

describe('isNewer', () => {
  it('is true only when the candidate is strictly greater', () => {
    expect(isNewer('1.2.0', '1.1.0')).toBe(true);
    expect(isNewer('1.1.0', '1.1.0')).toBe(false);
    expect(isNewer('1.0.0', '1.1.0')).toBe(false);
    expect(isNewer('v2.0.0', '1.9.9')).toBe(true);
  });
});
