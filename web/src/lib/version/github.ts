import {compareVersions} from './semver';

/**
 * Read-only GitHub Releases client for the update checker.
 *
 * Server-side only (a private-repo token may be passed). Uses the Next.js fetch
 * cache (`next.revalidate`) so we never exceed GitHub's unauthenticated rate
 * limit (60/h). No writes, no auth beyond an optional read token.
 */

/** A downloadable file attached to a release (e.g. the standalone bundle). */
export interface GithubReleaseAsset {
  /** File name, e.g. "aapanel-manager-standalone-1.2.0.tar.gz". */
  name: string;
  /** Direct download URL (browser_download_url). */
  downloadUrl: string;
  /** Size in bytes (0 when unknown). */
  size: number;
  /** MIME type reported by GitHub, or null. */
  contentType: string | null;
}

export interface GithubRelease {
  /** Release tag, e.g. "v1.2.0". */
  version: string;
  /** Release title (falls back to the tag). */
  name: string;
  /** Release notes (markdown). */
  body: string;
  prerelease: boolean;
  publishedAt: string | null;
  htmlUrl: string;
  /** Attached downloadable files (empty when the release has none). */
  assets: GithubReleaseAsset[];
}

/** Parses the `assets` array of a raw GitHub release into typed assets. */
export function parseReleaseAssets(raw: unknown): GithubReleaseAsset[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
    .map((a) => ({
      name: typeof a.name === 'string' ? a.name : '',
      downloadUrl: typeof a.browser_download_url === 'string' ? a.browser_download_url : '',
      size: typeof a.size === 'number' ? a.size : 0,
      contentType: typeof a.content_type === 'string' ? a.content_type : null,
    }))
    .filter((a) => a.name.length > 0 && a.downloadUrl.length > 0);
}

export type GithubErrorKind =
  | 'not_found'
  | 'rate_limited'
  | 'unauthorized'
  | 'network'
  | 'error';

export class GithubError extends Error {
  constructor(
    public readonly kind: GithubErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'GithubError';
  }
}

export interface GithubRepoConfig {
  owner: string;
  repo: string;
  /** Personal access token for private repos (optional). */
  token?: string | null;
}

const API_BASE = 'https://api.github.com';
const RELEASES_PER_PAGE = 20;
const DEFAULT_REVALIDATE_SECONDS = 3_600;

type FetchInit = RequestInit & {next?: {revalidate?: number}};

/**
 * Fetches up to the 20 most recent releases (drafts excluded).
 * @throws {GithubError} on any non-success response or network failure.
 */
export async function fetchReleases(
  cfg: GithubRepoConfig,
  opts: {revalidateSeconds?: number} = {},
): Promise<GithubRelease[]> {
  const owner = cfg.owner.trim();
  const repo = cfg.repo.trim();
  if (!owner || !repo) throw new GithubError('error', 'GitHub repository is not configured');

  const url =
    `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
    `/releases?per_page=${RELEASES_PER_PAGE}`;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    // GitHub requires a User-Agent on every API request.
    'User-Agent': 'aapanel-manager',
  };
  if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;

  const init: FetchInit = {headers};
  const revalidate = opts.revalidateSeconds ?? DEFAULT_REVALIDATE_SECONDS;
  if (revalidate > 0) init.next = {revalidate};

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new GithubError('network', err instanceof Error ? err.message : 'Network error');
  }

  if (res.status === 404) {
    throw new GithubError(
      'not_found',
      'Repository not found — check owner/repo, or add a token for a private repo',
    );
  }
  if (res.status === 401) {
    throw new GithubError('unauthorized', 'GitHub rejected the access token');
  }
  if (res.status === 403) {
    if (res.headers.get('x-ratelimit-remaining') === '0') {
      throw new GithubError('rate_limited', 'GitHub API rate limit reached — try later or add a token');
    }
    throw new GithubError('unauthorized', 'GitHub denied access (403)');
  }
  if (!res.ok) {
    throw new GithubError('error', `GitHub returned HTTP ${res.status}`);
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    throw new GithubError('error', 'GitHub returned a non-JSON response');
  }
  if (!Array.isArray(raw)) throw new GithubError('error', 'Unexpected GitHub response');

  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && (r as {draft?: unknown}).draft !== true)
    .map((r) => {
      const tag = typeof r.tag_name === 'string' ? r.tag_name : '';
      return {
        version: tag,
        name: typeof r.name === 'string' && r.name ? r.name : tag,
        body: typeof r.body === 'string' ? r.body : '',
        prerelease: r.prerelease === true,
        publishedAt: typeof r.published_at === 'string' ? r.published_at : null,
        htmlUrl: typeof r.html_url === 'string' ? r.html_url : '',
        assets: parseReleaseAssets(r.assets),
      } satisfies GithubRelease;
    })
    .filter((r) => r.version.length > 0);
}

/** Highest-version non-prerelease release, or null if there are none. */
export function pickLatestStable(releases: GithubRelease[]): GithubRelease | null {
  const stable = releases.filter((r) => !r.prerelease);
  if (stable.length === 0) return null;
  return [...stable].sort((a, b) => compareVersions(b.version, a.version))[0] ?? null;
}
