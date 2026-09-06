/** How the panel is installed — determines how it restarts/updates itself. */
export const DEPLOYMENT_MODES = ['docker', 'systemd', 'aapanel', 'git', 'manual'] as const;
export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number];

/** Settings view returned to the client — never includes the raw GitHub token. */
import type {TlsMode} from '@/lib/aapanel/tls';

export interface UpdateSettingsView {
  deploymentMode: DeploymentMode;
  githubOwner: string;
  githubRepo: string;
  /** Whether a private-repo token is stored (the token itself is never sent). */
  hasToken: boolean;
  /** Self-restart: the panel's own aaPanel, used to restart its own Node project. */
  selfBaseUrl: string | null;
  /** Whether a self-restart api_sk is stored (the key itself is never sent). */
  hasSelfKey: boolean;
  /** How the panel's own certificate is trusted (ADR-0002). */
  selfTlsMode: TlsMode;
  /** Its pinned SHA-256, or null while not pinned yet. */
  selfTlsPinSha256: string | null;
  selfProject: string | null;
  aapanelServerId: string | null;
  aapanelProject: string | null;
  startScript: string | null;
  serviceName: string | null;
  /** Version downloaded + migrated and awaiting activation (Phase 2b), or null. */
  stagedVersion: string | null;
  /** ISO timestamp when the staged release was prepared, or null. */
  stagedAt: string | null;
  /** Version active before the last activation — the rollback target, or null. */
  previousVersion: string | null;
}
