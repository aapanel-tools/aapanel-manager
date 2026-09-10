// Deep path on purpose: the '@/lib/aapanel' barrel is server-only. This import
// is type-only and erased at build time, but the deep path keeps that fact from
// depending on anyone remembering it.
import type {CronTask} from '@/lib/aapanel/types';

/**
 * When a task runs, in words, for a person reading a list of them.
 *
 * The panel's own sentence is used as-is and is not translated. That is a
 * deliberate limitation rather than an omission: only one combination of the
 * structured schedule fields has ever been observed on a live panel — a daily
 * task with an hour and a minute — and what `where1` means for a weekly,
 * monthly or every-N-minutes task is documented but unverified. Rendering our
 * own sentence from that would be a guess about when something runs on someone
 * else's production machine, which is a worse failure than showing the panel's
 * wording in the panel's language. It is the same rule presentError follows for
 * a panel's error text.
 *
 * The fallback exists for the case where `cycle` is missing entirely. It stays
 * deliberately unlovely — the shape and the time, no invented prose — so that
 * nobody mistakes it for a translated description.
 */
export function scheduleText(task: Pick<CronTask, 'cycle' | 'type' | 'hour' | 'minute'>): string {
  if (task.cycle.trim() !== '') return task.cycle;
  const time = clockTime(task);
  if (task.type === '' && time === null) return '—';
  return [task.type, time].filter((part) => part !== null && part !== '').join(' ');
}

/**
 * The hour and minute as a clock reading, or null when the panel sent neither.
 *
 * Null rather than a default: a task with no hour set is not a task that runs
 * at midnight, and 00:00 is exactly what an operator would read it as.
 */
export function clockTime(task: Pick<CronTask, 'hour' | 'minute'>): string | null {
  if (task.hour === null && task.minute === null) return null;
  const pad = (n: number | null) => (n === null ? '--' : String(n).padStart(2, '0'));
  return `${pad(task.hour)}:${pad(task.minute)}`;
}
