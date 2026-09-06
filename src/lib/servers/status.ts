import 'server-only';
import {prisma} from '@/lib/db/prisma';
import {createClientForServer, AaPanelError} from '@/lib/aapanel';
import {notifyServerChanged} from '@/lib/realtime/notify';
import {log} from '@/log';

export interface RefreshResult {
  ok: boolean;
  online: boolean;
  message?: string;
}

function describeError(err: unknown): string {
  if (err instanceof AaPanelError) return `${err.kind}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return 'Unknown error';
}

/** Polls one server live, writes the result to the cache, notifies listeners.
 *  Shared by manual refresh (Server Actions) and the background worker. Never throws
 *  for poll failures — returns {ok:false}. (A missing server id still throws via findUniqueOrThrow.) */
export async function refreshServerStatus(serverId: string): Promise<RefreshResult> {
  const server = await prisma.server.findUniqueOrThrow({
    where: {id: serverId},
    select: {id: true, baseUrl: true, apiSkEnc: true, tlsMode: true, tlsPinSha256: true},
  });
  const now = new Date();
  try {
    const snap = await (await createClientForServer(server)).collectStatus();
    await prisma.serverStatus.upsert({
      where: {serverId},
      create: {serverId, online: true, cpu: snap.cpu, mem: snap.mem, disk: snap.disk, error: null, lastCheckedAt: now},
      update: {online: true, cpu: snap.cpu, mem: snap.mem, disk: snap.disk, error: null, lastCheckedAt: now},
    });
    await notifyServerChanged({serverId, online: true});
    return {ok: true, online: true};
  } catch (err) {
    const message = describeError(err);
    await prisma.serverStatus.upsert({
      where: {serverId},
      create: {serverId, online: false, error: message, lastCheckedAt: now},
      update: {online: false, error: message, lastCheckedAt: now},
    });
    await notifyServerChanged({serverId, online: false});
    log.warn({serverId, message}, 'server poll failed');
    return {ok: false, online: false, message};
  }
}
