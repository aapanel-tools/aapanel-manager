import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {fetchReleases, pickLatestStable, GithubError, type GithubRelease} from './github';

const cfg = {owner: 'acme', repo: 'panel'};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json', ...headers},
  });
}

const RELEASE_FIXTURE = [
  {
    tag_name: 'v1.2.0',
    name: 'Release 1.2.0',
    body: '## Changes\n- thing',
    draft: false,
    prerelease: false,
    published_at: '2026-06-10T10:00:00Z',
    html_url: 'https://github.com/acme/panel/releases/tag/v1.2.0',
    assets: [
      {
        name: 'aapanel-manager-bundle-1.2.0.tar.gz',
        browser_download_url: 'https://example.test/standalone.tar.gz',
        size: 1234,
        content_type: 'application/gzip',
      },
      // Malformed entries (missing url/name) must be dropped, not crash.
      {name: 'broken'},
    ],
  },
  {
    tag_name: 'v1.3.0-beta.1',
    name: 'Beta',
    body: 'beta notes',
    draft: false,
    prerelease: true,
    published_at: '2026-06-12T10:00:00Z',
    html_url: 'https://github.com/acme/panel/releases/tag/v1.3.0-beta.1',
  },
  {
    tag_name: 'v1.1.0',
    name: '',
    body: '',
    draft: false,
    prerelease: false,
    published_at: '2026-05-01T10:00:00Z',
    html_url: 'https://github.com/acme/panel/releases/tag/v1.1.0',
  },
  {
    tag_name: 'v9.9.9-draft',
    draft: true,
    prerelease: false,
  },
];

describe('fetchReleases', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('maps releases, drops drafts, sets a User-Agent and the auth header when a token is given', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(RELEASE_FIXTURE));
    const releases = await fetchReleases({...cfg, token: 'tok'});

    // draft dropped → 3 remain
    expect(releases).toHaveLength(3);
    expect(releases[0]).toEqual<GithubRelease>({
      version: 'v1.2.0',
      name: 'Release 1.2.0',
      body: '## Changes\n- thing',
      prerelease: false,
      publishedAt: '2026-06-10T10:00:00Z',
      htmlUrl: 'https://github.com/acme/panel/releases/tag/v1.2.0',
      assets: [
        {
          name: 'aapanel-manager-bundle-1.2.0.tar.gz',
          downloadUrl: 'https://example.test/standalone.tar.gz',
          size: 1234,
          contentType: 'application/gzip',
        },
      ],
    });
    // name falls back to tag when empty
    expect(releases[2]!.name).toBe('v1.1.0');

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/repos/acme/panel/releases');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['User-Agent']).toBeTruthy();
    expect(headers.Authorization).toBe('Bearer tok');
  });

  it('throws not_found on 404', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({message: 'Not Found'}, 404));
    await expect(fetchReleases(cfg)).rejects.toMatchObject({kind: 'not_found'} satisfies Partial<GithubError>);
  });

  it('throws rate_limited on 403 with no remaining quota', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 403, {'x-ratelimit-remaining': '0'}));
    await expect(fetchReleases(cfg)).rejects.toMatchObject({kind: 'rate_limited'});
  });

  it('throws on a network failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('boom'));
    await expect(fetchReleases(cfg)).rejects.toMatchObject({kind: 'network'});
  });

  it('throws when the repo is not configured', async () => {
    await expect(fetchReleases({owner: '', repo: ''})).rejects.toMatchObject({kind: 'error'});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('pickLatestStable', () => {
  it('returns the highest-version non-prerelease', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(RELEASE_FIXTURE));
    vi.stubGlobal('fetch', fetchMock);
    const releases = await fetchReleases(cfg);
    vi.unstubAllGlobals();

    const latest = pickLatestStable(releases);
    expect(latest?.version).toBe('v1.2.0'); // beta (1.3.0-beta.1) excluded
  });

  it('returns null when there is no stable release', () => {
    expect(pickLatestStable([{version: 'v1.0.0-beta', name: '', body: '', prerelease: true, publishedAt: null, htmlUrl: '', assets: []}])).toBeNull();
  });
});
