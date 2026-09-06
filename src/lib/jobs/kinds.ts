import {z} from 'zod';
import type {AaPanelClient} from '@/lib/aapanel';

/**
 * The kinds of work a bulk job can do (ADR-0005).
 *
 * A kind owns three things: the shape of its parameters, whether it changes server
 * state, and how to perform it on ONE server. The queue itself knows none of that,
 * so adding a kind never means touching the queue.
 */

/** What an executor is handed for a single server. */
export interface JobItemContext {
  client: AaPanelClient;
  serverName: string;
}

interface KindDefinition<P> {
  kind: string;
  schema: z.ZodType<P>;
  /** Changes state on the customer's machine — drives the confirmation wording. */
  destructive: boolean;
  /** Performs the operation on one server. Returns a short note, throws on failure. */
  run(ctx: JobItemContext, params: P): Promise<string>;
}

/** A kind with its parameter type erased, as the queue sees it. */
export interface RunnableKind {
  kind: string;
  destructive: boolean;
  /** Validates raw parameters, throwing a ZodError when they do not fit. */
  parse(raw: unknown): unknown;
  runOn(ctx: JobItemContext, raw: unknown): Promise<string>;
}

/**
 * Parameters are re-validated on every run, not just at creation: time passes
 * between the two, and what comes back out of the database is external data like
 * any other (PROJECT_RULES.md §16).
 */
function defineKind<P>(def: KindDefinition<P>): RunnableKind {
  return {
    kind: def.kind,
    destructive: def.destructive,
    parse: (raw) => def.schema.parse(raw),
    runOn: (ctx, raw) => def.run(ctx, def.schema.parse(raw)),
  };
}

export const projectControlParams = z.object({
  /** Project name, the same on every selected server. */
  project: z.string().trim().min(1).max(100),
  operation: z.enum(['start', 'stop', 'restart']),
});

export type ProjectControlParams = z.infer<typeof projectControlParams>;

/**
 * Start, stop or restart a Node project across servers.
 *
 * First kind on purpose: its API is captured and verified, operators reach for it
 * often, and it is dangerous enough to exercise every invariant — preview, canary,
 * stop on first error, per-server report.
 */
const projectControl = defineKind<ProjectControlParams>({
  kind: 'project.control',
  schema: projectControlParams,
  destructive: true,
  async run({client}, {project, operation}) {
    const result = await client.batchOperation([project], operation);
    const outcome = result.msg_list[0];
    // The panel answers 200 with a per-project verdict inside; a false status is
    // a failure even though the request itself succeeded.
    if (outcome && outcome.status === false) {
      throw new Error(outcome.msg || `Panel refused to ${operation} ${project}`);
    }
    return outcome?.msg || `${operation} ok`;
  },
});

const REGISTRY: readonly RunnableKind[] = [projectControl];

/** The kind by name, or null when a stored job names something we no longer have. */
export function jobKind(kind: string): RunnableKind | null {
  return REGISTRY.find((k) => k.kind === kind) ?? null;
}

/** Every kind, for the interface offering a choice. */
export function jobKinds(): readonly RunnableKind[] {
  return REGISTRY;
}
