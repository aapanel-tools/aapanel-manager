import {z} from 'zod';

/**
 * Input schemas for the scheduler's three changing operations.
 *
 * Everything here arrives from a browser and ends up acting on someone else's
 * production machine, so each field is checked rather than trusted: a server
 * action is a public endpoint, and a TypeScript signature is not a runtime
 * guard.
 */

/** The task id, which is what every one of the panel's cron endpoints acts on. */
const taskId = z.coerce.number().int().nonnegative();

export const cronRunSchema = z.object({
  id: taskId,
  /** Carried for the journal, which has to name the task rather than its number. */
  name: z.string().trim().max(200).default(''),
});

export const cronStatusSchema = z.object({
  id: taskId,
  name: z.string().trim().max(200).default(''),
  /** Where the toggle is going, not where it came from. */
  enabled: z.enum(['true', 'false']).transform((v) => v === 'true'),
});

export const cronDeleteSchema = z.object({
  id: taskId,
  name: z.string().trim().max(200).default(''),
  confirm: z.string(),
});

/**
 * What has to be typed to confirm deleting a task.
 *
 * The panel allows a task with no name at all, and an empty confirmation phrase
 * would turn "type the name to be sure" into "press the button twice". Such a
 * task is identified by its number instead.
 *
 * Exported because the browser has to show the same phrase it will be checked
 * against — computed in one place so the two cannot drift apart, with the check
 * itself staying on the server where a browser cannot reach it.
 */
export function cronConfirmPhrase(task: {id: number; name: string}): string {
  return task.name.trim() !== '' ? task.name.trim() : `#${task.id}`;
}

export type CronRunInput = z.infer<typeof cronRunSchema>;
export type CronStatusInput = z.infer<typeof cronStatusSchema>;
export type CronDeleteInput = z.infer<typeof cronDeleteSchema>;
