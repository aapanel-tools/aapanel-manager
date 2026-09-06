import {isIP} from 'node:net';
import {connect as tlsConnect, type PeerCertificate, type TLSSocket} from 'node:tls';
import {Agent, buildConnector} from 'undici';

/**
 * How a panel's TLS certificate is trusted. Mirrors the Prisma `TlsMode` enum.
 *
 * There is deliberately no "do not check" mode: see ADR-0002. The connection
 * carries api_sk, which is root over the customer's server, so an unidentified
 * peer must never receive it.
 */
export type TlsMode = 'PINNED' | 'VERIFY';

/** The panel presented a certificate other than the pinned one. */
export class TlsPinMismatchError extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`TLS fingerprint mismatch: expected ${expected}, got ${actual}`);
    this.name = 'TlsPinMismatchError';
  }
}

/** Hex, uppercase, no separators — the single shape that is stored and compared. */
export function normalizeFingerprint(value: string): string {
  return value.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
}

/** `AA:BB:CC…` — the shape shown to a human comparing it against the panel. */
export function formatFingerprint(value: string): string {
  return normalizeFingerprint(value).replace(/(.{2})(?=.)/g, '$1:');
}

export interface CertificateInfo {
  /** SHA-256 of the leaf certificate, normalized. */
  fingerprint: string;
  subject: string;
  issuer: string;
  /** Expiry as reported by the panel, verbatim. */
  validTo: string;
  selfSigned: boolean;
}

function describe(cert: PeerCertificate): CertificateInfo {
  const name = (parts: PeerCertificate['subject'] | PeerCertificate['issuer']): string =>
    parts && typeof parts === 'object'
      ? Object.entries(parts)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(', ')
      : String(parts ?? '');
  const subject = name(cert.subject);
  const issuer = name(cert.issuer);
  return {
    fingerprint: normalizeFingerprint(cert.fingerprint256),
    subject,
    issuer,
    validTo: cert.valid_to ?? '',
    selfSigned: subject === issuer,
  };
}

/**
 * Opens a throwaway TLS connection and reports the certificate the panel presents.
 *
 * Verification is off on purpose: the point is to LOOK at the certificate so that
 * a human — or trust-on-first-use — can decide about it. Nothing is sent over this
 * connection, and it is closed immediately; api_sk never touches it.
 */
export function probeCertificate(baseUrl: string, timeoutMs = 10_000): Promise<CertificateInfo> {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:') {
    return Promise.reject(new Error(`${url.protocol}// has no certificate to pin`));
  }
  const host = url.hostname;
  const port = url.port ? Number(url.port) : 443;

  return new Promise<CertificateInfo>((resolve, reject) => {
    // SNI is a DNS name by definition; sending an IP there is invalid and some
    // stacks drop the handshake over it.
    const socket = tlsConnect(
      {host, port, rejectUnauthorized: false, ...(isIP(host) ? {} : {servername: host})},
      () => {
        const cert = socket.getPeerCertificate();
        socket.destroy();
        if (!cert?.fingerprint256) {
          reject(new Error(`${url.host} presented no TLS certificate`));
          return;
        }
        resolve(describe(cert));
      },
    );
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      reject(new Error(`TLS probe of ${url.host} timed out after ${timeoutMs}ms`));
    });
    socket.once('error', (err) => {
      socket.destroy();
      reject(err);
    });
  });
}

type Connector = ReturnType<typeof buildConnector>;

/**
 * Connector that accepts exactly one certificate: the pinned one.
 *
 * Chain verification and hostname identity are both switched off and replaced by
 * the fingerprint comparison. For this case that is strictly stronger: panel
 * certificates are self-signed (no chain to verify) and routinely issued to an IP
 * or to a name that no longer matches, so PKI checks would reject the legitimate
 * panel while accepting any other certificate a man in the middle signs himself.
 * The fingerprint accepts one certificate and nothing else.
 */
function pinnedConnector(expected: string): Connector {
  const base = buildConnector({rejectUnauthorized: false, checkServerIdentity: () => undefined});
  return (options, callback) => {
    base(options, (err, socket) => {
      if (err || !socket) {
        callback(err ?? new Error('TLS connect failed'), null);
        return;
      }
      const peer = socket as TLSSocket;
      // Plain http has no certificate; there is nothing to pin and nothing to check.
      if (typeof peer.getPeerCertificate !== 'function') {
        callback(null, socket);
        return;
      }
      const presented = peer.getPeerCertificate()?.fingerprint256;
      if (!presented) {
        socket.destroy();
        callback(new Error('Panel presented no TLS certificate'), null);
        return;
      }
      const actual = normalizeFingerprint(presented);
      if (actual !== expected) {
        socket.destroy();
        callback(new TlsPinMismatchError(expected, actual), null);
        return;
      }
      callback(null, socket);
    });
  };
}

/**
 * Pooled dispatchers, one per pinned fingerprint.
 *
 * Clients are built per request, so a fresh Agent each time would open a new
 * connection pool per request and leak sockets. Keyed by fingerprint rather than
 * by server: two servers behind the same certificate can share a pool safely.
 */
const dispatchers = new Map<string, Agent>();

/** Dispatcher for a server, or undefined to use undici's default (which verifies). */
export function dispatcherFor(mode: TlsMode, pin: string | null | undefined): Agent | undefined {
  if (mode === 'VERIFY') return undefined;
  const expected = pin ? normalizeFingerprint(pin) : '';
  if (!expected) {
    throw new Error('PINNED mode requires a certificate fingerprint; pin the panel first');
  }
  let agent = dispatchers.get(expected);
  if (!agent) {
    agent = new Agent({connect: pinnedConnector(expected)});
    dispatchers.set(expected, agent);
  }
  return agent;
}

/** Test seam: drops cached dispatchers so a pin change cannot be masked by a pool. */
export function resetDispatchers(): void {
  dispatchers.clear();
}
