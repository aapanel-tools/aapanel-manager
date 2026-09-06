import {parseEnv} from '@/env';

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // Fail fast on invalid configuration at server startup.
  const env = parseEnv();
  // Run the background poll loop inside the web process (no separate worker).
  // A Postgres advisory lock keeps this correct even with multiple app replicas.
  // Dynamic import keeps pg/prisma out of the edge bundle and build-time eval.
  if (env.ENABLE_POLLER) {
    const {startServerPoller} = await import('@/lib/servers/poller');
    startServerPoller();
  }
}
