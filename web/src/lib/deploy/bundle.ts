import 'server-only';
import {createHash} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import {mkdir, rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Filesystem-bound bundle operations (download, hash, verify, extract). Imports
 * `server-only`; the pure asset matcher / checksum parser live in
 * `bundle-assets.ts` so non-server modules can use them.
 */

/** Streams a file through SHA-256 and returns the lowercase hex digest. */
export async function sha256OfFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}

/**
 * Downloads a URL to a file, creating parent dirs. Sends a GitHub auth header
 * when a token is given (needed for private-repo assets) and a User-Agent
 * (required by GitHub). Removes a partial file on failure.
 */
export async function downloadToFile(
  url: string,
  destPath: string,
  opts: {token?: string | null; signal?: AbortSignal} = {},
): Promise<void> {
  await mkdir(dirOf(destPath), {recursive: true});
  const headers: Record<string, string> = {
    'User-Agent': 'aapanel-manager',
    Accept: 'application/octet-stream',
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  let res: Response;
  try {
    res = await fetch(url, {headers, redirect: 'follow', signal: opts.signal});
  } catch (err) {
    throw new Error(`Download failed: ${err instanceof Error ? err.message : 'network error'}`);
  }
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: HTTP ${res.status}`);
  }
  try {
    await pipeline(
      Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(destPath),
    );
  } catch (err) {
    await rm(destPath, {force: true}).catch(() => undefined);
    throw new Error(`Download write failed: ${err instanceof Error ? err.message : 'io error'}`);
  }
}

/**
 * Verifies a file's SHA-256 against an expected hex digest. Throws on mismatch.
 * Comparison is case-insensitive on the hex.
 */
export async function verifyFileChecksum(filePath: string, expectedHex: string): Promise<void> {
  const expected = expectedHex.trim().toLowerCase();
  const actual = await sha256OfFile(filePath);
  if (actual !== expected) {
    throw new Error(`Checksum mismatch: expected ${expected}, got ${actual}`);
  }
}

/**
 * Extracts a .tar.gz into a destination directory using the system `tar`
 * (present on Ubuntu; avoids adding a dependency). The destination is created
 * first. The bundle is packed at its root (no leading component to strip).
 */
export async function extractTarGz(tarPath: string, destDir: string): Promise<void> {
  await mkdir(destDir, {recursive: true});
  try {
    await execFileAsync('tar', ['-xzf', tarPath, '-C', destDir]);
  } catch (err) {
    throw new Error(`Extract failed: ${err instanceof Error ? err.message : 'tar error'}`);
  }
}

function dirOf(p: string): string {
  const norm = p.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i <= 0 ? '.' : norm.slice(0, i);
}
