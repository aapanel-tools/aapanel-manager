import pkg from '../../../package.json';

export interface CurrentVersion {
  version: string;
  /** Short git commit baked at build time, if provided. */
  commit: string | null;
  /** ISO build timestamp baked at build time, if provided. */
  buildTime: string | null;
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
  return {version, commit, buildTime};
}
