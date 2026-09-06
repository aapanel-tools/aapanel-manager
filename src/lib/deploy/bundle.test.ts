import {describe, it, expect, vi, afterEach} from 'vitest';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeFile, readFile, mkdir, rm} from 'node:fs/promises';

// `server-only` throws under the test runner; neutralize it for bundle.ts (IO).
vi.mock('server-only', () => ({}));

import {findBundleAssets, parseChecksumFile, sha256Hex} from './bundle-assets';
import {sha256OfFile, carryEnvFile} from './bundle';
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

describe('carryEnvFile', () => {
  // Д-14: a release is a fresh directory, so the config has to travel with it.
  // Getting this wrong is invisible until the symlink swap, when the panel that
  // would offer "roll back" is the process that just failed to start.
  let dirs: string[] = [];

  async function tempDir(tag: string): Promise<string> {
    const d = join(tmpdir(), `carry-env-${process.pid}-${tag}-${Math.random().toString(36).slice(2)}`);
    await mkdir(d, {recursive: true});
    dirs.push(d);
    return d;
  }

  afterEach(async () => {
    await Promise.all(dirs.map((d) => rm(d, {recursive: true, force: true})));
    dirs = [];
  });

  it('copies .env from the running release into the new one', async () => {
    const from = await tempDir('from');
    const to = await tempDir('to');
    await writeFile(join(from, '.env'), 'DATABASE_URL="postgresql://u:p@localhost:5432/db"\n');

    expect(await carryEnvFile(from, to)).toBe('copied');
    expect(await readFile(join(to, '.env'), 'utf8')).toContain('DATABASE_URL');
  });

  it('reports "absent" when the running release has no .env, and copies nothing', async () => {
    // Not a failure: Docker/systemd/aaPanel project variables configure the app
    // through the process environment, which the new release inherits anyway.
    const from = await tempDir('from');
    const to = await tempDir('to');

    expect(await carryEnvFile(from, to)).toBe('absent');
    await expect(readFile(join(to, '.env'), 'utf8')).rejects.toThrow();
  });

  it('never overwrites a .env already present in the new release', async () => {
    const from = await tempDir('from');
    const to = await tempDir('to');
    await writeFile(join(from, '.env'), 'FROM_RUNNING=1\n');
    await writeFile(join(to, '.env'), 'ALREADY_THERE=1\n');

    expect(await carryEnvFile(from, to)).toBe('kept');
    expect(await readFile(join(to, '.env'), 'utf8')).toBe('ALREADY_THERE=1\n');
  });
});

afterEach(() => vi.restoreAllMocks());
