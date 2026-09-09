import 'server-only';
import {prisma} from '@/lib/db/prisma';

/**
 * The server's name for a message a person will read, resolved by id.
 *
 * Looked up on the error path instead of being carried through every call: the
 * name is wanted only when something failed, and threading it through twenty
 * actions would change every signature for a string used in one branch.
 *
 * Falls back to the id and never throws — a message naming an id is still more
 * useful than one naming nothing, and a helper that fails while describing a
 * failure would replace a real error with its own.
 */
export async function serverLabel(serverId: string): Promise<string> {
  try {
    const row = await prisma.server.findUnique({where: {id: serverId}, select: {name: true}});
    return row?.name ?? serverId;
  } catch {
    return serverId;
  }
}
