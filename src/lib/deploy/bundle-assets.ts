import {createHash} from 'node:crypto';
import type {GithubRelease, GithubReleaseAsset} from '@/lib/version/github';
import {bundleAssetName, checksumAssetName} from './layout';

/**
 * Pure (no I/O, no `server-only`) helpers for locating and checksumming release
 * bundles. Kept separate from `bundle.ts` so Server Actions and the status
 * reader can import the asset matcher without pulling in the filesystem layer.
 */

export interface BundleAssets {
  bundle: GithubReleaseAsset;
  /** SHA-256 sidecar, when the release published one. */
  checksum: GithubReleaseAsset | null;
}

/**
 * Finds the standalone bundle (and its checksum sidecar) for a version among a
 * release's assets. Returns null when the release has no matching bundle.
 */
export function findBundleAssets(release: GithubRelease, version: string): BundleAssets | null {
  const wanted = bundleAssetName(version);
  const wantedSum = checksumAssetName(version);
  const assets = release.assets ?? [];
  const bundle = assets.find((a) => a.name === wanted);
  if (!bundle) return null;
  const checksum = assets.find((a) => a.name === wantedSum) ?? null;
  return {bundle, checksum};
}

/**
 * Extracts the SHA-256 hex digest from a `sha256sum`-style file body. Accepts
 * both "<hex>  <name>" and a bare "<hex>". Returns null when none is found.
 */
export function parseChecksumFile(text: string): string | null {
  const match = text.match(/\b([0-9a-fA-F]{64})\b/);
  return match ? match[1]!.toLowerCase() : null;
}

/** SHA-256 of a buffer/string as lowercase hex. */
export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}
