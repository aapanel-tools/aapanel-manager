import 'server-only';
import {EventEmitter} from 'node:events';
import {Client} from 'pg';
import {SERVER_EVENTS_CHANNEL, parseServerEvent, type ServerEvent} from './channel';
import {errInfo} from '@/lib/safe-error';
import {log} from '@/log';

type Globals = typeof globalThis & {__serverEvents?: ServerEventsHub};

const RECONNECT_DELAY_MS = 3000;

class ServerEventsHub {
  private emitter = new EventEmitter();
  private client?: Client;
  private connecting = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.emitter.setMaxListeners(0); // many concurrent SSE subscribers
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.client || this.connecting) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.ensureClient();
    }, RECONNECT_DELAY_MS);
  }

  /** Connection dropped: self-heal so already-subscribed SSE clients keep
   *  receiving events without needing a new subscribe()/page reload. */
  private dropClient(): void {
    this.client = undefined;
    this.scheduleReconnect();
  }

  private async ensureClient(): Promise<void> {
    if (this.client || this.connecting) return;
    this.connecting = true;
    let failed = false;
    try {
      const client = new Client({connectionString: process.env.DATABASE_URL});
      client.on('notification', (msg) => {
        if (!msg.payload) return;
        const evt = parseServerEvent(msg.payload);
        if (evt) this.emitter.emit('event', evt);
      });
      client.on('error', (err) => {
        log.error({err: errInfo(err)}, 'server-events: LISTEN client error; reconnecting');
        this.dropClient();
      });
      client.on('end', () => {
        this.dropClient();
      });
      await client.connect();
      await client.query(`LISTEN ${SERVER_EVENTS_CHANNEL}`);
      this.client = client;
      log.info('server-events: LISTEN established');
    } catch (err) {
      log.error({err: errInfo(err)}, 'server-events: failed to establish LISTEN; retrying');
      failed = true;
    } finally {
      this.connecting = false;
    }
    if (failed) this.scheduleReconnect();
  }

  subscribe(cb: (evt: ServerEvent) => void): () => void {
    void this.ensureClient(); // lazy connect on first subscriber
    this.emitter.on('event', cb);
    return () => this.emitter.off('event', cb);
  }
}

function getHub(): ServerEventsHub {
  const g = globalThis as Globals;
  g.__serverEvents ??= new ServerEventsHub();
  return g.__serverEvents;
}

/** Subscribe to live server status events; returns an unsubscribe fn. */
export function subscribeToServerEvents(cb: (evt: ServerEvent) => void): () => void {
  return getHub().subscribe(cb);
}
