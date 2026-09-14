import pkg from '../../../package.json';

export interface CurrentVersion {
  version: string;
  /** Short git commit baked at build time, if provided. */
  commit: string | null;
  /** ISO build timestamp baked at build time, if provided. */
  buildTime: string | null;
  /**
   * The build this server runs, as Next knows it (ADR-0011): set by
   * scripts/run-next.mjs from the id the build left in .next/. Null when the
   * server was started without one — a build made without the wrapper, or dev.
   */
  deploymentId: string | null;
}

/**
 * The build id, from the value Next hands to server code (ADR-0011).
 *
 * Next replaces `process.env.NEXT_DEPLOYMENT_ID` at compile time: with the
 * build's id, or with `false` when the build has none — `next dev`, or a build
 * made outside scripts/run-next.mjs. Read as a string, that `false` threw on
 * `.trim()` and took down every page of the app in `pnpm dev` (found by the
 * e2e run on 2026-09-14).
 */
export function deploymentIdFrom(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

/**
 * The application's own version, resolved server-side.
 *
 * Priority: `APP_VERSION` env (e.g. a Docker build-arg set from a git tag) wins,
 * otherwise the version baked into `package.json` at build time. `commit` and
 * `buildTime` come from optional env vars (`APP_COMMIT`, `APP_BUILD_TIME`).
 *
 * This reads only build/runtime metadata — no secrets — so it is safe to call
 * from any server component or action; pass the result down to client components.
 */
export function getCurrentVersion(): CurrentVersion {
  const envVersion = process.env.APP_VERSION?.trim();
  const version = envVersion && envVersion.length > 0 ? envVersion : pkg.version;
  const commit = process.env.APP_COMMIT?.trim() || null;
  const buildTime = process.env.APP_BUILD_TIME?.trim() || null;
  const deploymentId = deploymentIdFrom(process.env.NEXT_DEPLOYMENT_ID);
  return {version, commit, buildTime, deploymentId};
}
