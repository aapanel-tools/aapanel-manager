/**
 * Minimal semantic-version comparison — no external dependency.
 *
 * Supports `MAJOR.MINOR.PATCH` with an optional leading `v` and an optional
 * pre-release suffix (`-beta.1`). Build metadata (`+...`) is ignored. This is
 * enough to compare GitHub release tags against the app's own version; it is
 * not a full semver implementation.
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated pre-release identifiers, e.g. ["beta", "1"]. Empty for a release. */
  prerelease: string[];
}

/** Parses a version string; returns null when it isn't a recognizable semver. */
export function parseVersion(input: string): ParsedVersion | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.trim().replace(/^v/i, '');
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(cleaned);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

/** Compares two pre-release identifier lists per semver §11. */
function comparePrerelease(a: string[], b: string[]): -1 | 0 | 1 {
  // No pre-release outranks having one (1.0.0 > 1.0.0-beta).
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    const aNum = /^\d+$/.test(ai);
    const bNum = /^\d+$/.test(bi);
    if (aNum && bNum) {
      const diff = Number(ai) - Number(bi);
      if (diff !== 0) return diff < 0 ? -1 : 1;
    } else if (aNum !== bNum) {
      // Numeric identifiers have lower precedence than non-numeric.
      return aNum ? -1 : 1;
    } else if (ai !== bi) {
      return ai < bi ? -1 : 1;
    }
  }
  if (a.length === b.length) return 0;
  return a.length < b.length ? -1 : 1;
}

/**
 * Compares two version strings.
 * Returns -1 if a < b, 0 if equal, 1 if a > b. Unparsable versions sort as lowest.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;

  for (const key of ['major', 'minor', 'patch'] as const) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1;
  }
  return comparePrerelease(pa.prerelease, pb.prerelease);
}

/** True when `candidate` is strictly newer than `current`. */
export function isNewer(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}
