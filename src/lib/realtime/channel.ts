export const SERVER_EVENTS_CHANNEL = 'servers_status';

export interface ServerEvent {
  serverId: string;
  online: boolean;
}

/** Parses a NOTIFY payload into a ServerEvent; returns null on anything invalid. */
export function parseServerEvent(payload: string): ServerEvent | null {
  try {
    const v = JSON.parse(payload) as Record<string, unknown>;
    if (typeof v.serverId === 'string' && typeof v.online === 'boolean') {
      return {serverId: v.serverId, online: v.online};
    }
    return null;
  } catch {
    return null;
  }
}
