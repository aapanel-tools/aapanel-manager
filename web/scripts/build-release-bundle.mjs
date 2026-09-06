// Assembles the self-update release bundle: a full, migrate-capable build of the
// app packed as `aapanel-manager-bundle-<version>.tar.gz` plus a `.sha256`
// sidecar. The unpacked bundle is the release working directory the panel runs
// from (and migrates with) in aaPanel mode.
//
// Contract (consumed by src/lib/deploy): the archive root contains node_modules
// (incl. the prisma CLI + generated client), .next, public, prisma,
// prisma.config.ts, package.json + lockfiles, next.config.ts, scripts — so
// `node_modules/.bin/prisma migrate deploy` and `next start` both work after
// extraction without a rebuild.
//
// Prerequisites (the caller runs these first): pnpm install, prisma generate,
// next build. Linux/CI only (uses system `tar`).
//
// Usage: node scripts/build-release-bundle.mjs [outDir]   (run from web/)
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync, existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(webDir, 'package.json'), 'utf8'));
const version = (process.env.APP_VERSION || pkg.version || '').trim().replace(/^v/, '');
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Refusing to build: invalid version ${JSON.stringify(version)}`);
}

const outDir = path.resolve(webDir, process.argv[2] || 'release-dist');
mkdirSync(outDir, {recursive: true});

const bundleName = `aapanel-manager-bundle-${version}.tar.gz`;
const bundlePath = path.join(outDir, bundleName);

// Everything the release dir needs to run `next start` and `prisma migrate deploy`.
const INCLUDE = [
  'node_modules',
  '.next',
  'public',
  'prisma',
  'prisma.config.ts',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'next.config.ts',
  'scripts',
  'tsconfig.json',
];
const present = INCLUDE.filter((p) => existsSync(path.join(webDir, p)));
const missingRequired = ['node_modules', '.next', 'prisma', 'package.json'].filter(
  (p) => !present.includes(p),
);
if (missingRequired.length) {
  throw new Error(`Missing required paths (did build run?): ${missingRequired.join(', ')}`);
}

console.log(`Packing ${bundleName} from ${present.length} paths...`);
execFileSync(
  'tar',
  [
    '-czf',
    bundlePath,
    '--exclude=.next/cache',
    '--exclude=node_modules/.cache',
    '--exclude=.next/standalone', // redundant with full node_modules; saves space
    ...present,
  ],
  {cwd: webDir, stdio: 'inherit'},
);

// SHA-256 sidecar in `sha256sum` format ("<hex>  <name>").
const hex = createHash('sha256').update(readFileSync(bundlePath)).digest('hex');
writeFileSync(`${bundlePath}.sha256`, `${hex}  ${bundleName}\n`);

console.log(`Bundle:   ${bundlePath}`);
console.log(`SHA-256:  ${hex}`);
console.log(`Sidecar:  ${bundlePath}.sha256`);
