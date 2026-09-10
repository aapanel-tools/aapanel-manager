import type {SourceTruncation} from './types';

/**
 * Rows a list request asks for when the caller does not say.
 *
 * High on purpose: a management screen wants the whole list, and one request
 * for a thousand rows costs the panel less than ten requests for a hundred.
 * It is a ceiling, not a page size — everything below exists so that hitting
 * it is visible instead of silent.
 */
export const DEFAULT_PAGE_LIMIT = 1000;

/**
 * The row count the panel reports in its own pagination markup.
 *
 * `page` is HTML the panel builds for its own interface — for example
 * `<span class='Pcount'>Total 3</span>` — so reading it is best-effort by
 * nature: the wording follows the panel's display language, and a version
 * that restyles its pagination can stop matching without anything else
 * changing. Nothing may depend on this number being present.
 *
 * Returns null when no count can be read. Null means "unknown", never "none":
 * a caller that treats it as zero turns an unreadable answer into a claim
 * that the panel is empty.
 */
export function readPanelTotal(page: string | null | undefined): number | null {
  if (!page) return null;
  const match = /Total\s+(\d+)/i.exec(page);
  if (!match) return null;
  const total = Number(match[1]);
  return Number.isSafeInteger(total) ? total : null;
}

/**
 * Whether a page of rows leaves anything unread, in terms a person can act on.
 *
 * Returns null when the list is whole — the common case, and the only one that
 * needs no explanation.
 *
 * Two signals, deliberately ranked. The panel's own count is exact, so it wins
 * when it can be read: it also clears the awkward case of a list that is
 * exactly `limit` rows long and complete. Otherwise the fallback is the row
 * count itself, which depends on no markup at all: a source that returned
 * everything it was asked for probably had more to give.
 *
 * The conservative direction is chosen on purpose. Claiming "there may be more"
 * when there is not costs a line of text; claiming a truncated list is complete
 * is how an operator concludes a site was deleted (ADR-0003).
 */
export function describePage(
  source: string,
  shown: number,
  limit: number,
  page: string | null | undefined,
): SourceTruncation | null {
  const total = readPanelTotal(page);
  if (total !== null) return total > shown ? {source, shown, total} : null;
  return shown >= limit ? {source, shown, total: null} : null;
}

/**
 * Longest search term forwarded to a panel.
 *
 * No site, database or project name comes near this. The cap is not about
 * those: the term arrives from a browser and is posted to someone else's
 * production machine, so its length has to be decided here rather than by
 * whoever is typing.
 */
export const MAX_SEARCH_LENGTH = 200;

/**
 * A search term in the only form a panel should ever be sent.
 *
 * Two things happen, both for the same reason — the term is untrusted input on
 * its way to a production server.
 *
 * Control characters become spaces. They cannot occur in a domain, a database
 * name or a project name, and the panel writes what it was asked for into its
 * own log: a newline in a search term is a forged log line waiting to happen.
 *
 * An over-long term is cut, not refused. Cutting widens the search — a prefix
 * matches everything the full term would have matched and more — so the failure
 * direction is extra rows, never missing ones, which is the same direction
 * describePage() errs in and for the same reason. Cutting by code point rather
 * than by code unit, so a term ending in an emoji or a surrogate pair does not
 * arrive as half a character.
 *
 * An empty result is the panel's own idiom for "no filter": every one of these
 * endpoints already receives `search=` when nothing is being searched for.
 */
export function normalizeSearch(raw: unknown): string {
  // `unknown`, not `string`, because the nearest caller is a server action and
  // a type annotation is not a runtime check: whatever a browser sends arrives
  // here as-is, and `.replace` on an object would be a crash, not a refusal.
  if (typeof raw !== 'string' || !raw) return '';
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  const points = Array.from(cleaned);
  return points.length > MAX_SEARCH_LENGTH ? points.slice(0, MAX_SEARCH_LENGTH).join('') : cleaned;
}
