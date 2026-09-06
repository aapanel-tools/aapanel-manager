import {describe, it, expect, vi, afterEach} from 'vitest';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeFile, rm} from 'node:fs/promises';

// `server-only` throws under the test runner; neutralize it for bundle.ts (IO).
vi.mock('server-only', () => ({}));

import {findBundleAssets, parseChecksumFile, sha256Hex} from './bundle-assets';
import {sha256OfFile} from './bundle';
import type {GithubRelease} from '@/lib/version/github';

function release(assets: GithubRelease['assets']): GithubRelease {
  return {
    version: 'v1.2.3',
    name: '1.2.3',
    body: '',
    prerelease: false,
    publishedAt: null,
    htmlUrl: '',
    assets,
  };
}

const asset = (name: string) => ({name, downloadUrl: `https://x/${name}`, size: 1, contentType: null});

describe('findBundleAssets', () => {
  it('finds the bundle and its checksum sidecar', () => {
    const r = release([
      asset('aapanel-manager-bundle-1.2.3.tar.gz'),
      asset('aapanel-manager-bundle-1.2.3.tar.gz.sha256'),
      asset('something-else.txt'),
    ]);
    const found = findBundleAssets(r, 'v1.2.3');
    expect(found?.bundle.name).toBe('aapanel-manager-bundle-1.2.3.tar.gz');
    expect(found?.checksum?.name).toBe('aapanel-manager-bundle-1.2.3.tar.gz.sha256');
  });

  it('returns the bundle with null checksum when no sidecar exists', () => {
    const found = findBundleAssets(release([asset('aapanel-manager-bundle-1.2.3.tar.gz')]), '1.2.3');
    expect(found?.bundle).toBeTruthy();
    expect(found?.checksum).toBeNull();
  });

  it('returns null when there is no matching bundle', () => {
    expect(findBundleAssets(release([asset('other.tar.gz')]), '1.2.3')).toBeNull();
  });
});

describe('parseChecksumFile', () => {
  const hex = 'a'.repeat(64);
  it('parses sha256sum-style "<hex>  <name>"', () => {
    expect(parseChecksumFile(`${hex}  bundle.tar.gz\n`)).toBe(hex);
  });
  it('parses a bare hex digest', () => {
    expect(parseChecksumFile(hex.toUpperCase())).toBe(hex);
  });
  it('returns null when no digest is present', () => {
    expect(parseChecksumFile('not a checksum')).toBeNull();
  });
});

describe('sha256', () => {
  it('hashes a buffer/string to known hex', () => {
    expect(sha256Hex('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('hashes a file to the same digest', async () => {
    const f = join(tmpdir(), `bundle-test-${process.pid}.txt`);
    await writeFile(f, 'hello');
    try {
      expect(await sha256OfFile(f)).toBe(sha256Hex('hello'));
    } finally {
      await rm(f, {force: true});
    }
  });
});

afterEach(() => vi.restoreAllMocks());
