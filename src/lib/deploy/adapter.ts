import type {DeploymentMode} from '@/lib/version/types';
import type {GithubRelease} from '@/lib/version/github';

/** Readiness of a deployment target for staging an update. */
export interface PreflightResult {
  /** True when staging can be attempted. */
  ok: boolean;
  /** Human-readable blockers (empty when ok). */
  issues: string[];
  /** Whether pg_dump is present — false means a backup needs explicit override. */
  pgDumpAvailable: boolean;
}

/** One step of the staging pipeline, for the audit/log trail and the UI. */
export interface StageStep {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface StageResult {
  ok: boolean;
  version: string;
  steps: StageStep[];
  /** Path of the pre-update DB dump, if one was taken. */
  backupPath?: string | null;
  /** Error summary when ok is false. */
  message?: string;
}

export interface StageInput {
  /** Target release (must carry assets — the bundle is downloaded from them). */
  release: GithubRelease;
  /** Live DB connection string (used for the pre-update dump + migrations). */
  databaseUrl: string;
  /** Token for private-repo asset downloads (null for public). */
  githubToken: string | null;
  /** Proceed even when a DB backup can't be taken (pg_dump missing). */
  allowBackupSkip?: boolean;
}

export interface ActivateInput {
  /** The already-staged version to activate (or the target version to roll back to). */
  version: string;
  /** The version running right now (becomes the rollback target after activation). */
  runningVersion: string;
  /**
   * Restarts the panel so it boots the newly-pointed release. Injected by the
   * caller (aaPanel API restart of the panel's own Node project) so the adapter
   * stays testable. May not return — the restart can kill this process — so it
   * is called LAST, after the symlink swap and DB writes are committed.
   */
  restart: () => Promise<void>;
}

export interface ActivateResult {
  ok: boolean;
  version: string;
  /** The version that was active before this activation (rollback target). */
  previousVersion: string | null;
  steps: StageStep[];
  message?: string;
}

/**
 * A deployment adapter encapsulates how the panel updates itself for one
 * installation mode.
 * - Phase 2a: detection + staging (download, verify, backup, migrate).
 * - Phase 2b: activation (atomic release swap + restart) and rollback.
 */
export interface DeployAdapter {
  readonly mode: DeploymentMode;
  /** Cheap environment-readiness check (no network, no release needed). */
  preflight(): Promise<PreflightResult>;
  /** Downloads + verifies + unpacks the release and applies migrations. */
  stage(input: StageInput): Promise<StageResult>;
  /** Points `current` at the staged release and restarts (Phase 2b). */
  activate(input: ActivateInput): Promise<ActivateResult>;
  /** Points `current` back at a previous release and restarts (Phase 2b). */
  rollback(input: ActivateInput): Promise<ActivateResult>;
}
