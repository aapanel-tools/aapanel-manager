/**
 * Progress model for an in-place git self-update — shared by the detached
 * runner (which WRITES it step by step) and the settings UI (which READS it to
 * render the checklist). Pure data + transitions only: no fs, no `server-only`,
 * so it is trivially testable and importable from both server and client.
 *
 * The fs read/write lives in {@link ./git} (server-only); the live polling
 * action that surfaces it to the client lives in the updates server actions.
 */

/** The user-facing steps of an update, in execution order. */
export const UPDATE_STEPS = ['download', 'install', 'migrate', 'build', 'restart'] as const;
export type UpdateStep = (typeof UPDATE_STEPS)[number];

/** Overall run state of the update. */
export type UpdateRunState = 'running' | 'done' | 'failed';

/** Per-step state derived for the UI checklist. */
export type StepState = 'pending' | 'running' | 'done' | 'failed';

/** Persisted progress record (written to `.update.status` as JSON). */
export interface UpdateStatus {
  kind: 'update' | 'rollback';
  /** Target version, without the leading "v". */
  target: string;
  /** Epoch ms when the run started. */
  startedAt: number;
  /** Epoch ms of the last transition. */
  updatedAt: number;
  /** The step currently in progress, or null once done/failed-before-start. */
  current: UpdateStep | null;
  state: UpdateRunState;
  /** Failure message when `state === 'failed'`, else null. */
  error: string | null;
}

/** A fresh status at the very start of a run (no step entered yet). */
export function initialStatus(kind: UpdateStatus['kind'], target: string, now: number): UpdateStatus {
  return {kind, target, startedAt: now, updatedAt: now, current: null, state: 'running', error: null};
}

/** Marks `step` as the one now in progress (prior steps become "done"). */
export function advanceTo(status: UpdateStatus, step: UpdateStep, now: number): UpdateStatus {
  return {...status, current: step, state: 'running', updatedAt: now};
}

/** Marks the whole run finished successfully (all steps "done"). */
export function markDone(status: UpdateStatus, now: number): UpdateStatus {
  return {...status, current: null, state: 'done', updatedAt: now};
}

/** Marks the run failed at the current step, with a human message. */
export function markFailed(status: UpdateStatus, error: string, now: number): UpdateStatus {
  return {...status, state: 'failed', error, updatedAt: now};
}

/**
 * Derives the per-step checklist state for the UI from a status record:
 * steps before the current one are "done", the current one is "running"
 * (or "failed"), later ones are "pending"; a finished run is all "done".
 */
export function deriveStepStates(status: UpdateStatus): Record<UpdateStep, StepState> {
  const currentIndex =
    status.state === 'done'
      ? UPDATE_STEPS.length
      : status.current
        ? UPDATE_STEPS.indexOf(status.current)
        : -1;

  const result = {} as Record<UpdateStep, StepState>;
  for (let i = 0; i < UPDATE_STEPS.length; i++) {
    const step = UPDATE_STEPS[i];
    if (status.state === 'done' || i < currentIndex) {
      result[step] = 'done';
    } else if (i === currentIndex) {
      result[step] = status.state === 'failed' ? 'failed' : 'running';
    } else {
      result[step] = 'pending';
    }
  }
  return result;
}
