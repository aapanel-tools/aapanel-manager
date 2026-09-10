'use client';

import {useCallback, useEffect, useRef, useState} from 'react';

/**
 * Quiet time after the last keystroke before the panel is asked.
 *
 * Every request lands on someone else's production machine through a limiter
 * that only allows a few at a time (ADR-0004), so one request per character
 * would spend a stranger's capacity on prefixes nobody wanted an answer to.
 * Long enough to swallow ordinary typing, short enough that a person who has
 * stopped typing does not wonder whether the box works.
 */
const SEARCH_DEBOUNCE_MS = 350;

export interface SearchableList<T> {
  /** The rows currently on screen, in whatever shape the action returns. */
  result: T;
  /** What is in the box right now, debounce or not. */
  search: string;
  setSearch: (value: string) => void;
  /**
   * The term the rows on screen were actually fetched with.
   *
   * Different from `search` for as long as the debounce is running, and that
   * difference is the point: "nothing matched X" has to name the term that
   * produced the empty list, not the one being typed.
   */
  applied: string;
  /** True while a request for this list is out. */
  pending: boolean;
  /**
   * Re-reads the list with the term currently in the box.
   *
   * Resolves when the answer has landed, so a caller that has just started or
   * stopped something can wait for the refreshed rows before letting go of the
   * buttons it disabled.
   */
  reload: () => Promise<void>;
  /** The same, but does nothing while a request is already out — for polling. */
  reloadIfIdle: () => void;
}

/**
 * The machinery shared by every list that can be refreshed and searched.
 *
 * It exists because the three list sections had begun to diverge on it. All
 * three re-fetch through a server action; `projects-table` had grown a request
 * token to stop a slow answer from overwriting a newer one, and the other two
 * had not. With a search box that fires as you type, that race stops being
 * rare and becomes the ordinary case — so the guard belongs in one place that
 * every list gets, rather than in whichever table someone remembered.
 *
 * Search is deliberately server-side: `load` is handed the term and passes it
 * to the panel. Filtering what already arrived would search inside the same
 * page the operator can already see, and the rows worth finding are the ones
 * past the row limit (Д-16).
 *
 * `load` is held in a ref rather than listed as a dependency, so a caller who
 * builds it inline gets correct behaviour instead of a refetch loop.
 */
export function useSearchableList<T>(
  initial: T,
  load: (search: string) => Promise<T>,
): SearchableList<T> {
  const [result, setResult] = useState<T>(initial);
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [pending, setPending] = useState(false);

  const loadRef = useRef(load);
  const reqIdRef = useRef(0);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  /** Mirrors `applied` for the debounce, which must not re-run when it changes. */
  const appliedRef = useRef('');

  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(async (term: string) => {
    const reqId = (reqIdRef.current += 1);
    inFlightRef.current = true;
    setPending(true);
    try {
      const next = await loadRef.current(term);
      // Only the newest request may paint. Typing puts several in flight at
      // once and the slowest is not the truest: without this the list settles
      // on results for a term that is no longer in the box.
      if (mountedRef.current && reqId === reqIdRef.current) {
        appliedRef.current = term;
        setResult(next);
        setApplied(term);
      }
    } finally {
      // Only the newest request may declare the list idle; an older one
      // finishing late says nothing about the request that replaced it.
      if (reqId === reqIdRef.current) {
        inFlightRef.current = false;
        if (mountedRef.current) setPending(false);
      }
    }
  }, []);

  useEffect(() => {
    // Nothing to do when the box already agrees with what is on screen. That
    // covers the first render — those rows came from the server and asking for
    // them again would be a second request for the same page — and it covers
    // typing a term and deleting it again before the pause ran out.
    if (search === appliedRef.current) return;
    const timer = setTimeout(() => void run(search), SEARCH_DEBOUNCE_MS);
    // Each keystroke cancels the previous timer, so a panel sees one request
    // per pause in typing rather than one per character.
    return () => clearTimeout(timer);
  }, [search, run]);

  // Refresh uses the term in the box, not the applied one: pressing Refresh
  // while a search is typed means "these rows, again", and reloading the
  // unfiltered list would throw away what the operator was looking at.
  const reload = useCallback(() => run(search), [run, search]);

  const reloadIfIdle = useCallback(() => {
    if (!inFlightRef.current) void reload();
  }, [reload]);

  return {result, search, setSearch, applied, pending, reload, reloadIfIdle};
}
