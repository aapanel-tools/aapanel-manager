import type {ServerListParams} from '@/lib/validation/server';

/** Sortable column identifier (mirrors the `sort` enum of the list params). */
export type ServerSortField = ServerListParams['sort'];
/** Sort direction. */
export type SortDir = ServerListParams['dir'];

export interface ServerSort {
  sort: ServerSortField;
  dir: SortDir;
}

/**
 * Two-state sort cycle for the servers table.
 *
 * The list is always sorted — the URL always carries a column and a direction,
 * so there is no "unsorted" state to fall back to. Clicking the active column
 * therefore flips its direction (asc ⇄ desc) and never clears the sort; clicking
 * a different column starts that column ascending.
 */
export function cycleSort(current: ServerSort, clicked: ServerSortField): ServerSort {
  if (current.sort === clicked) {
    return {sort: clicked, dir: current.dir === 'asc' ? 'desc' : 'asc'};
  }
  return {sort: clicked, dir: 'asc'};
}
