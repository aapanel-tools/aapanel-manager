'use server';
import {revalidatePath} from 'next/cache';
import {requireAdmin, AuthError} from '@/lib/auth/guards';
import {recordAudit} from '@/lib/audit';
import {JobRejected, createJob, requestCancel} from '@/lib/jobs/queue';
import {projectControlJobSchema} from '@/lib/validation/job';
import {parseEnv} from '@/env';
import {log} from '@/log';

export type JobActionResult =
  | {ok: true; jobId: string}
  | {ok: false; error: string; fieldErrors?: Record<string, string[]>};

export interface SimpleJobResult {
  ok: boolean;
  message: string;
}

function rejectionReason(err: unknown): string | null {
  return err instanceof JobRejected ? err.reason : null;
}

/**
 * Queues a bulk project operation over the chosen servers.
 *
 * Admin only, and confirmed by typing the project name. Nothing is executed here:
 * the job is recorded and the leader process picks it up (ADR-0005), which is what
 * lets the operator close the tab and still learn how it went.
 */
export async function createProjectControlJobAction(formData: FormData): Promise<JobActionResult> {
  let userId: string;
  try {
    userId = (await requireAdmin()).id;
  } catch (e) {
    return {ok: false, error: e instanceof AuthError ? e.code : 'forbidden'};
  }

  const parsed = projectControlJobSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation',
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const serverIds = formData.getAll('serverIds').map(String).filter(Boolean);

  try {
    const {project, operation, stopOnError} = parsed.data;
    const job = await createJob({
      kind: 'project.control',
      params: {project, operation},
      serverIds,
      createdById: userId,
      stopOnError,
      maxServers: parseEnv().JOB_MAX_SERVERS,
    });
    await recordAudit({
      userId,
      action: 'job.create',
      target: `project.control ${operation} ${project} on ${serverIds.length} servers`,
      result: 'ok',
    });
    revalidatePath('/jobs');
    return {ok: true, jobId: job.id};
  } catch (err) {
    const reason = rejectionReason(err);
    if (reason) return {ok: false, error: reason};
    log.error({err}, 'createProjectControlJobAction failed');
    await recordAudit({userId, action: 'job.create', target: 'project.control', result: 'error'});
    return {ok: false, error: 'failed'};
  }
}

/**
 * Asks a running job to stop.
 *
 * Stopping means "start no more servers". A server already being worked on is left
 * to finish: aborting mid-request would leave a customer's machine in a state
 * nobody can describe.
 */
export async function cancelJobAction(jobId: string): Promise<SimpleJobResult> {
  let userId: string;
  try {
    userId = (await requireAdmin()).id;
  } catch {
    return {ok: false, message: 'forbidden'};
  }
  if (!jobId) return {ok: false, message: 'missing id'};

  try {
    const asked = await requestCancel(jobId);
    await recordAudit({
      userId,
      action: 'job.cancel',
      target: jobId,
      result: asked ? 'ok' : 'error',
    });
    revalidatePath(`/jobs/${jobId}`);
    return asked
      ? {ok: true, message: 'cancelRequested'}
      : {ok: false, message: 'alreadyFinished'};
  } catch (err) {
    log.error({err, jobId}, 'cancelJobAction failed');
    return {ok: false, message: 'failed'};
  }
}
