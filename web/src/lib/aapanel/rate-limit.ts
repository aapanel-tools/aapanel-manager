/**
 * Bounded concurrency per panel (ADR-0004).
 *
 * The limit protects the customer's machine from us, not us from load: on that
 * machine live the sites the panel is supposed to serve, and a panel busy answering
 * this manager stops serving them. PROJECT_RULES.md §16 makes it an invariant —
 * "менеджер, кладущий панель шквалом запросов, — инструмент отказа в обслуживании".
 *
 * Keyed by panel origin rather than by our server id: load lands on a machine, not
 * on a row in our table, so two records pointing at the same panel share one budget.
 */

/** Conservative default: well under what any web server handles, ample for one page. */
export const DEFAULT_MAX_CONCURRENT = 4;

/** Waiting for a free slot ran out of time — the panel is busy with *us*. */
export class PanelBusyError extends Error {
  constructor(
    readonly origin: string,
    readonly limit: number,
  ) {
    super(`No free request slot for ${origin} (limit ${limit})`);
    this.name = 'PanelBusyError';
  }
}

/** Releases a slot. Safe to call more than once. */
export type ReleaseSlot = () => void;

interface Waiter {
  grant: () => void;
  fail: (err: Error) => void;
}

class PanelGate {
  private inFlight = 0;
  private readonly queue: Waiter[] = [];

  constructor(
    private readonly origin: string,
    private readonly limit: number,
  ) {}

  /** Requests in flight right now. Test seam. */
  get active(): number {
    return this.inFlight;
  }

  /** Requests waiting for a slot. Test seam. */
  get waiting(): number {
    return this.queue.length;
  }

  /**
   * Takes a slot, waiting if the panel is at its limit.
   *
   * The caller's own deadline governs the wait: `signal` is the same one that will
   * abort the request itself, so queueing cannot extend the promised budget.
   */
  acquire(signal: AbortSignal): Promise<ReleaseSlot> {
    if (signal.aborted) return Promise.reject(new PanelBusyError(this.origin, this.limit));
    if (this.inFlight < this.limit) {
      this.inFlight += 1;
      return Promise.resolve(this.makeRelease());
    }

    return new Promise<ReleaseSlot>((resolve, reject) => {
      const waiter: Waiter = {
        grant: () => {
          signal.removeEventListener('abort', onAbort);
          resolve(this.makeRelease());
        },
        fail: reject,
      };
      const onAbort = (): void => {
        const at = this.queue.indexOf(waiter);
        if (at >= 0) this.queue.splice(at, 1);
        waiter.fail(new PanelBusyError(this.origin, this.limit));
      };
      signal.addEventListener('abort', onAbort, {once: true});
      this.queue.push(waiter);
    });
  }

  private makeRelease(): ReleaseSlot {
    let released = false;
    return () => {
      // A double release would inflate the budget and quietly defeat the limit.
      if (released) return;
      released = true;
      const next = this.queue.shift();
      // Hand the slot straight over: the count does not change, one request ends
      // and another begins.
      if (next) next.grant();
      else this.inFlight -= 1;
    };
  }
}

const gates = new Map<string, PanelGate>();

/**
 * The gate for a panel, created on first use.
 *
 * A gate keeps the limit it was created with: changing the setting takes effect for
 * panels not yet contacted, and fully after a restart. Re-reading it per request
 * would let a config reload silently widen a limit mid-operation.
 */
export function gateFor(origin: string, limit: number = DEFAULT_MAX_CONCURRENT): PanelGate {
  let gate = gates.get(origin);
  if (!gate) {
    gate = new PanelGate(origin, limit);
    gates.set(origin, gate);
  }
  return gate;
}

/** Test seam: forgets every gate so limits do not leak between test cases. */
export function resetGates(): void {
  gates.clear();
}

/** The key a panel is limited by. Falls back to the raw string for a malformed URL. */
export function panelOrigin(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return baseUrl;
  }
}
