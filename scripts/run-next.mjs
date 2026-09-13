// Launches `next <cmd>` after loading .env, so the HTTP port can be taken from
// the PORT variable in .env.
//
// Why a wrapper: Next can't read PORT from .env on its own (the HTTP server
// initializes before .env is parsed), and `node --env-file` can't be used to
// launch Next either — Next forwards node CLI flags to its workers via
// NODE_OPTIONS, where --env-file is disallowed. So we load .env here (via the
// already-present `dotenv`) and spawn Next as a plain child process.
//
// Precedence: a real PORT env var (shell / Docker / systemd) wins over .env,
// because dotenv does not override variables already set in the environment.
// Falls back to 3000 when PORT is set nowhere.
//
// It also carries the build's deployment id (ADR-0011, scripts/deployment-id.mjs).
// `build` makes one, gives it to `next build` over anything inherited, and writes
// it into .next/ when the build succeeds; `start` reads it back, so the server
// runs as the build it serves. That is why the production server is started
// through this script: a bare `next start` runs without the id.
import 'dotenv/config';
import {spawn} from 'node:child_process';
import {readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {DEPLOYMENT_ID_FILE, makeDeploymentId, readDeploymentId} from './deployment-id.mjs';

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');

const cmd = process.argv[2];
if (cmd !== 'dev' && cmd !== 'start' && cmd !== 'build') {
  console.error(`run-next: expected "dev", "start" or "build", got "${cmd ?? ''}"`);
  process.exit(1);
}

// Next works in the current directory, so the id lives there too.
const appDir = process.cwd();
const env = {...process.env};
let buildId = null;

if (cmd === 'build') {
  const pkg = JSON.parse(readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  buildId = makeDeploymentId(pkg.version);
  // Set over the inherited value on purpose: a git update is started from the
  // running server, whose environment carries the old build's id.
  env.NEXT_DEPLOYMENT_ID = buildId;
  // A build that fails half-way must not leave the previous build's id behind.
  rmSync(path.join(appDir, DEPLOYMENT_ID_FILE), {force: true});
  console.log(`run-next: building with deployment id ${buildId}`);
} else if (cmd === 'start') {
  const {id, problem} = readDeploymentId(appDir);
  if (id) {
    env.NEXT_DEPLOYMENT_ID = id;
  } else {
    // Without the build's own id, any inherited one would describe a different
    // build than the one about to be served.
    delete env.NEXT_DEPLOYMENT_ID;
    console.warn(
      `run-next: ${DEPLOYMENT_ID_FILE} is ${problem}; starting without version-skew protection. ` +
        'Build with `pnpm build` (or `npm run build`) to give the build an id.',
    );
  }
} else {
  // Development has no build to be skewed against.
  delete env.NEXT_DEPLOYMENT_ID;
}

const args = cmd === 'build' ? [nextBin, 'build'] : [nextBin, cmd, '-p', process.env.PORT ?? '3000'];
const child = spawn(process.execPath, args, {stdio: 'inherit', env});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  if (cmd === 'build' && code === 0 && buildId) {
    try {
      writeFileSync(path.join(appDir, DEPLOYMENT_ID_FILE), `${buildId}\n`);
    } catch (err) {
      console.error(`run-next: the build succeeded but its id could not be written: ${err}`);
      process.exit(1);
    }
  }
  process.exit(code ?? 0);
});
