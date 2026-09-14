import 'server-only';
import {prisma} from '@/lib/db/prisma';
import {log} from '@/log';

/**
 * The server a request names is not registered — removed in another tab, or an
 * address that never pointed at one (Д-34).
 *
 * A refusal rather than a failure: nothing broke, and callers answer with the
 * `notFound` code the interface already puts into words. Before this a missing
 * row reached the operator as Prisma's own message, internal paths included, was
 * logged at error level on every poll of a list left open on it, and made an
 * irreversible action claim that the journal was down.
 *
 * The message carries no database text, so it is safe wherever it ends up — a
 * job step's result on the operations page included.
 */
export class ServerNotFoundError extends Error {
  readonly serverId: string;

  constructor(serverId: string) {
    super(`Server ${serverId} was not found — it may have been removed`);
    this.name = 'ServerNotFoundError';
    this.serverId = serverId;
  }
}

/**
 * What it takes to talk to one registered panel, looked up by id.
 *
 * The one way server actions, the status refresh and the job runner find a
 * server. Seven action modules used to keep a private copy of this lookup built
 * on `findUniqueOrThrow`, so a missing server surfaced as a database error
 * wherever it was asked for.
 *
 * It also sets an order for irreversible actions: the lookup comes before their
 * journal line. The line references the server, so for a missing one it cannot
 * be written, and "the journal is unavailable" is a false thing to tell someone
 * whose server is simply gone. Nothing reaches the panel before the journal all
 * the same — building the client, which may probe the certificate, stays after
 * it (Д-19).
 *
 * A server action is a public endpoint, so the id is not trusted to be a string.
 * Only a debug line is written: callers decide what a missing server is worth,
 * and they answer `notFound` without an error line.
 */
export async function loadServerCreds(serverId: unknown) {
  if (typeof serverId !== 'string' || serverId.length === 0) {
    throw new ServerNotFoundError(String(serverId));
  }
  const server = await prisma.server.findUnique({
    where: {id: serverId},
    select: {id: true, baseUrl: true, apiSkEnc: true, tlsMode: true, tlsPinSha256: true},
  });
  if (!server) {
    log.debug({serverId}, 'server not found');
    throw new ServerNotFoundError(serverId);
  }
  return server;
}

/** A registered server, as loadServerCreds returns it. */
export type RegisteredServer = Awaited<ReturnType<typeof loadServerCreds>>;
