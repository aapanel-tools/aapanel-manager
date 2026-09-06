// Proves a release bundle is migrate-capable and boots. Extracts the tarball,
// runs `prisma migrate deploy` from it against a throwaway Postgres, starts the
// app with `next start`, and asserts GET /api/health returns the bundle's
// version. Exits non-zero on any failure so CI/release fail loudly instead of
// publishing a broken bundle. Linux/CI only.
//
// Usage: DATABASE_URL=... node scripts/smoke-release-bundle.mjs <bundle.tar.gz>
import {execFileSync, spawn} from 'node:child_process';
import {mkdtempSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

const tarball = process.argv[2];
if (!tarball || !existsSync(tarball)) {
  console.error(`Bundle not found: ${tarball}`);
  process.exit(1);
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required for the smoke test');
  process.exit(1);
}

const expectedVersion = path.basename(tarball).replace(/^aapanel-manager-bundle-/, '').replace(/\.tar\.gz$/, '');
const PORT = process.env.SMOKE_PORT || '3123';

const dir = mkdtempSync(path.join(tmpdir(), 'bundle-smoke-'));
console.log(`Extracting ${tarball} → ${dir}`);
execFileSync('tar', ['-xzf', tarball, '-C', dir], {stdio: 'inherit'});

const prismaBin = path.join(dir, 'node_modules', '.bin', 'prisma');
const nextBin = path.join(dir, 'node_modules', '.bin', 'next');
for (const bin of [prismaBin, nextBin]) {
  if (!existsSync(bin)) {
    console.error(`Bundle is missing ${path.relative(dir, bin)} — assembly is incomplete`);
    process.exit(1);
  }
}

const runtimeEnv = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  AUTH_SECRET: 'smoke-test-secret-not-used-anywhere-0000',
  APP_ENCRYPTION_KEY: '0'.repeat(64),
  // Make the running app report the same version the bundle is named for, so the
  // health assertion verifies APP_VERSION wiring regardless of package.json.
  APP_VERSION: expectedVersion,
  ENABLE_POLLER: 'false',
  NODE_ENV: 'production',
  PORT,
};

console.log('Running prisma migrate deploy from the bundle...');
execFileSync(prismaBin, ['migrate', 'deploy'], {cwd: dir, env: runtimeEnv, stdio: 'inherit'});

console.log(`Starting next start on :${PORT}...`);
const server = spawn(nextBin, ['start', '-p', PORT], {cwd: dir, env: runtimeEnv, stdio: 'inherit'});

let exitCode = 1;
try {
  await waitForHealth(`http://127.0.0.1:${PORT}/api/health`, expectedVersion);
  console.log('Smoke test passed: bundle migrates, boots, and /api/health reports the version.');
  exitCode = 0;
} catch (err) {
  console.error(`Smoke test failed: ${err instanceof Error ? err.message : err}`);
} finally {
  server.kill('SIGTERM');
  setTimeout(() => server.kill('SIGKILL'), 5000).unref();
}
process.exit(exitCode);

async function waitForHealth(url, expectedVersion, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = 'no response';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const body = await res.json();
        if (body?.ok !== true) throw new Error(`health not ok: ${JSON.stringify(body)}`);
        if (body.version !== expectedVersion) {
          throw new Error(`version mismatch: bundle ${expectedVersion}, /api/health ${body.version}`);
        }
        return;
      }
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await sleep(1000);
  }
  throw new Error(`/api/health never became healthy within ${timeoutMs}ms (last: ${lastErr})`);
}

// Function declaration (hoisted) so waitForHealth can call it — it runs during
// top-level execution before a `const sleep` further down would be initialized.
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
