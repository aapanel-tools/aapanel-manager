import type {DeploymentMode} from './types';

/**
 * Best-effort upgrade command shown to the admin for the configured deployment
 * mode (Phase 1 is read-only — the panel shows the command, it does not run it).
 * The actual one-click update lands in Phase 2 via deployment adapters.
 */
/** Pull + install + generate client + apply migrations + build — orchestrator-agnostic core. */
const BUILD_AND_MIGRATE =
  'git pull && npm install && npm run db:generate && npm run db:deploy && npm run build';

export function buildUpgradeCommand(
  mode: DeploymentMode,
  opts: {serviceName?: string | null} = {},
): string {
  const service = opts.serviceName?.trim() || '<service>';
  switch (mode) {
    case 'docker':
      return 'docker compose pull && docker compose up -d';
    case 'systemd':
      return `${BUILD_AND_MIGRATE} && systemctl restart ${service}`;
    case 'aapanel':
    case 'git':
      // Build on the server, then restart the Node project from the panel.
      return BUILD_AND_MIGRATE;
    case 'manual':
    default:
      // No orchestrator — the operator restarts the app however they run it.
      return BUILD_AND_MIGRATE;
  }
}
