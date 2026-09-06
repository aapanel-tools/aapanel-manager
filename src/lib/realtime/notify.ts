import 'server-only';
import {prisma} from '@/lib/db/prisma';
import {SERVER_EVENTS_CHANNEL, type ServerEvent} from './channel';
import {log} from '@/log';

/** Best-effort NOTIFY; a failed notify never breaks the caller. */
export async function notifyServerChanged(evt: ServerEvent): Promise<void> {
  try {
    await prisma.$executeRaw`SELECT pg_notify(${SERVER_EVENTS_CHANNEL}, ${JSON.stringify(evt)})`;
  } catch (err) {
    log.error({err, serverId: evt.serverId}, 'pg_notify failed');
  }
}
