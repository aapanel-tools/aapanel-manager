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
import 'dotenv/config';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');

const cmd = process.argv[2];
if (cmd !== 'dev' && cmd !== 'start') {
  console.error(`run-next: expected "dev" or "start", got "${cmd ?? ''}"`);
  process.exit(1);
}

const port = process.env.PORT ?? '3000';
const child = spawn(process.execPath, [nextBin, cmd, '-p', port], {stdio: 'inherit'});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
