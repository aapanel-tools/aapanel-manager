import path from 'node:path';

/**
 * On-disk layout for self-update releases. Pure path computation only — no I/O —
 * so it is fully unit-testable on any OS. Server paths are always POSIX
 * (production is Linux); we use `path.posix` so a Windows dev box computes the
 * same strings the Ubuntu server will use.
 *
 *   <root>/releases/<version>/   unpacked release bundle
 *   <root>/current               symlink → the active release (aaPanel cwd)
 *   <root>/backups/              pre-update DB dumps
 *   <root>/tmp/                  download scratch space
 */
export interface ReleaseLayout {
  root: string;
  releasesDir: string;
  releaseDir: string;
  currentLink: string;
  backupsDir: string;
  tmpDir: string;
}

/**
 * Strict semver path segment. A release version becomes a directory name and a
 * download filename, so it MUST NOT contain path separators or traversal — only
 * digits, dots and the semver pre-release/build charset.
 */
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Normalizes a release tag/version to a safe path segment (drops a single
 * leading "v"). Throws on anything that isn't a plain semver string — this is
 * the guard that keeps an attacker-influenced tag from escaping the root.
 */
export function sanitizeVersion(raw: string): string {
  const v = raw.trim().replace(/^v/, '');
  if (!VERSION_RE.test(v)) {
    throw new Error(`Unsafe or invalid release version: ${JSON.stringify(raw)}`);
  }
  return v;
}

/** Release bundle file name for a version (must match the release pipeline). */
export function bundleAssetName(version: string): string {
  return `aapanel-manager-bundle-${sanitizeVersion(version)}.tar.gz`;
}

/** SHA-256 sidecar file name for the bundle. */
export function checksumAssetName(version: string): string {
  return `${bundleAssetName(version)}.sha256`;
}

/** Computes the full release layout for a root + version. Validates the version. */
export function releaseLayout(root: string, version: string): ReleaseLayout {
  const safeVersion = sanitizeVersion(version);
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const releasesDir = path.posix.join(base, 'releases');
  return {
    root: base,
    releasesDir,
    releaseDir: path.posix.join(releasesDir, safeVersion),
    currentLink: path.posix.join(base, 'current'),
    backupsDir: path.posix.join(base, 'backups'),
    tmpDir: path.posix.join(base, 'tmp'),
  };
}
