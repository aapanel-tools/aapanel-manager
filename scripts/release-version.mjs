// One-command release: bump package.json, commit, tag, push.
//
// Pushing the tag `vX.Y.Z` triggers .github/workflows/release.yml, which builds
// the Docker image + the self-update bundle and publishes the GitHub Release.
//
// Usage (from the repo root):
//   pnpm release 0.4.0
//   pnpm release 0.4.0 "Short release notes for the tag annotation"
//
// Safety: refuses to run on a dirty tree or off the main branch, and rejects a
// version that is not strictly greater than the current one.

import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function git(args, opts = {}) {
  return execFileSync('git', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts}).trim();
}

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

/** [major,minor,patch] ignoring any prerelease suffix. */
function core(v) {
  return v.split('-')[0].split('.').map((n) => Number.parseInt(n, 10));
}

/** true when a is strictly greater than b (core version only). */
function isGreater(a, b) {
  const [x, y] = [core(a), core(b)];
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] > y[i];
  }
  return false;
}

const version = process.argv[2];
const notes = process.argv.slice(3).join(' ').trim();

if (!version) fail('Usage: pnpm release <X.Y.Z> ["notes"]');
if (!SEMVER.test(version)) fail(`Invalid version "${version}" — expected X.Y.Z (e.g. 0.4.0).`);

// --- preflight: clean tree, on main ----------------------------------------
const status = git(['status', '--porcelain']);
if (status) fail(`Working tree is not clean. Commit or stash first:\n${status}`);

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch !== 'main') fail(`Not on main (on "${branch}"). Switch to main before releasing.`);

const pkgPath = resolve(process.cwd(), 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const current = pkg.version;

if (version === current) fail(`package.json is already at ${version}.`);
if (!isGreater(version, current)) fail(`New version ${version} is not greater than current ${current}.`);

// Tag must not already exist.
const existingTag = git(['tag', '--list', `v${version}`]);
if (existingTag) fail(`Tag v${version} already exists.`);

// --- apply ------------------------------------------------------------------
console.log(`Releasing ${current} → ${version} …`);
pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

git(['add', 'package.json']);
git(['commit', '-m', `chore(release): ${version}`]);
git(['tag', '-a', `v${version}`, '-m', notes || `Release ${version}`]);

console.log('Pushing commit + tag …');
git(['push', 'origin', 'HEAD']);
git(['push', 'origin', `v${version}`]);

console.log(`\n✓ Released v${version}.`);
console.log('  GitHub Actions (release.yml) is now building the image + bundle and publishing the release.');
console.log('  Watch: https://github.com/aapanel-tools/aapanel-manager/actions');
