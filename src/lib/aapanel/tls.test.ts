import {describe, it, expect, afterEach} from 'vitest';
import {createServer, type Server, type Socket} from 'node:net';
import {probeCertificate} from './tls';
import {AaPanelError} from './types';

/**
 * A probe that cannot reach a panel is that panel being unreachable, and says so
 * as a panel failure (Д-35). It used to reject with the socket's bare error, which
 * presentError() now keeps off the screen as the app's own — so an operator who
 * mistyped an address would have been sent to the log instead of told.
 *
 * Local sockets only: a unit test never connects anywhere off this machine.
 */
const servers: Server[] = [];
const sockets: Socket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

/** A plain TCP listener on a free local port; `onConnection` decides what the peer does. */
function listen(onConnection: (socket: Socket) => void = () => undefined): Promise<{server: Server; port: number}> {
  return new Promise((resolve) => {
    const server = createServer((socket) => {
      sockets.push(socket);
      onConnection(socket);
    });
    servers.push(server);
    server.listen(0, '127.0.0.1', () => {
      resolve({server, port: (server.address() as {port: number}).port});
    });
  });
}

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected the probe to fail');
    },
    (err: unknown) => err,
  );
}

describe('probeCertificate failures', () => {
  it(
    'reports a port nothing listens on as the panel being unreachable',
    async () => {
      // Bound, then closed again, so the port is known and known to be free.
      const {server, port} = await listen();
      servers.splice(servers.indexOf(server), 1);
      await new Promise<void>((resolve) => server.close(() => resolve()));

      // The default budget: Windows takes about two seconds to refuse a local
      // connection, and a short budget would turn this into a timeout.
      const err = await failureOf(probeCertificate(`https://127.0.0.1:${port}`));
      expect(err).toBeInstanceOf(AaPanelError);
      expect(err).toMatchObject({kind: 'network', message: expect.stringContaining('ECONNREFUSED')});
    },
    15_000,
  );

  it('reports a peer that accepts and never answers as a panel that did not answer in time', async () => {
    const {port} = await listen();
    const err = await failureOf(probeCertificate(`https://127.0.0.1:${port}`, 200));
    expect(err).toBeInstanceOf(AaPanelError);
    expect(err).toMatchObject({kind: 'timeout', message: expect.stringContaining('timed out')});
  });

  it('reports a peer that hangs up mid-handshake as unreachable, in the socket’s own words', async () => {
    const {port} = await listen((socket) => socket.destroy());
    const err = await failureOf(probeCertificate(`https://127.0.0.1:${port}`, 5_000));
    expect(err).toBeInstanceOf(AaPanelError);
    expect(err).toMatchObject({kind: 'network'});
    expect((err as AaPanelError).message.length).toBeGreaterThan(0);
  });

  it('refuses plain http as the caller’s mistake, not as a panel failure', async () => {
    // No connection is attempted: there is no certificate on plain http to look at.
    const err = await failureOf(probeCertificate('http://127.0.0.1:1'));
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(AaPanelError);
  });
});
