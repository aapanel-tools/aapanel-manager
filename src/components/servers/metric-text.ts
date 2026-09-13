/**
 * How a load figure reads on screen.
 *
 * One spelling for the server table, the project list and the connection test,
 * which carried three copies of it. CPU keeps one decimal and memory is a whole
 * number, as the server table has always shown them.
 *
 * A figure the panel did not report is a dash, never a number: the connection
 * test used to turn missing memory into `mem 0%`, which reads as a machine with
 * nothing in use (Д-29).
 */
export const UNKNOWN_METRIC = '—';

const known = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export function cpuText(value: number | null | undefined): string {
  return known(value) ? `${value.toFixed(1)}%` : UNKNOWN_METRIC;
}

export function percentText(value: number | null | undefined): string {
  return known(value) ? `${Math.round(value)}%` : UNKNOWN_METRIC;
}
