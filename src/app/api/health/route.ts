import {NextResponse} from 'next/server';
import {getCurrentVersion} from '@/lib/version/current';

/**
 * Public liveness + version probe. Used by the self-update flow to confirm the
 * new version came up after a restart (Phase 2b) and as a generic health check
 * for supervisors. Reads only build metadata — no secrets, no DB — so it stays
 * fast and safe to expose unauthenticated.
 *
 * `deploymentId` is the build this server runs: a tab compares it with the
 * build it was rendered by and says so when they differ (ADR-0011).
 */
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  const {version, commit, buildTime, deploymentId} = getCurrentVersion();
  return NextResponse.json({ok: true, version, commit, buildTime, deploymentId});
}
