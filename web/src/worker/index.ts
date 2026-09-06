// Optional dedicated poller process. The web app already polls in-process via
// instrumentation.ts (unless ENABLE_POLLER=false), so this is NOT required —
// run it only to move polling off the web server. The Postgres advisory lock in
// startServerPoller() guarantees exactly one active poller across all processes,
// so this is safe to run alongside one or more web instances.
//
// Launched via `pnpm worker`, which loads tsconfig.worker.json — its `paths`
// alias maps `server-only` to a no-op (src/__mocks__/server-only.ts) so the
// imported modules' server-only guards don't throw under tsx (Next.js
// neutralizes them via the react-server condition in its own bundles).
import {startServerPoller} from '@/lib/servers/poller';

startServerPoller({exitOnShutdown: true});
