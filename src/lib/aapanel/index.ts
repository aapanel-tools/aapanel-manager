import 'server-only';
import {decryptSecret} from '@/lib/crypto/secret-box';
import {getEncryptionKey} from '@/lib/config/secrets';
import {recordAudit} from '@/lib/audit';
import {prisma} from '@/lib/db/prisma';
import {AaPanelClient} from './client';
import {formatFingerprint, probeCertificate, type TlsMode} from './tls';
import {parseEnv} from '@/env';

export interface ServerCreds {
  /** Present for a stored server; absent when testing one that is not saved yet. */
  id?: string;
  baseUrl: string;
  apiSkEnc: string;
  tlsMode: TlsMode;
  tlsPinSha256: string | null;
}

function usesTls(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Builds a client for a stored server, pinning the panel's certificate on first use.
 *
 * Trust on first use (ADR-0002): a server with no fingerprint yet is pinned to the
 * certificate the panel currently presents, and the pin goes into the audit log.
 * From the second connection on, a different certificate is refused — quietly
 * accepting a new one would make the pin decorative. A server that is not saved yet
 * (no id) is pinned for this call only.
 *
 * A plain-http panel has no certificate to pin; nothing can be verified there, and
 * the mode is irrelevant.
 */
export async function createClientForServer(server: ServerCreds): Promise<AaPanelClient> {
  const apiSk = decryptSecret(server.apiSkEnc, getEncryptionKey());
  const mode: TlsMode = usesTls(server.baseUrl) ? server.tlsMode : 'VERIFY';
  let pin = server.tlsPinSha256;

  if (mode === 'PINNED' && !pin) {
    pin = (await probeCertificate(server.baseUrl)).fingerprint;
    if (server.id) {
      await prisma.server.update({where: {id: server.id}, data: {tlsPinSha256: pin}});
      await recordAudit({
        serverId: server.id,
        action: 'server.tls.pin',
        target: formatFingerprint(pin),
        result: 'ok',
      });
    }
  }

  return new AaPanelClient({
    baseUrl: server.baseUrl,
    apiSk,
    tlsMode: mode,
    tlsPinSha256: pin,
    maxConcurrentRequests: parseEnv().PANEL_MAX_CONCURRENCY,
  });
}

export {AaPanelClient} from './client';
export {AaPanelError, describeError, describeSourceFailure} from './types';
export {PanelBusyError, panelOrigin} from './rate-limit';
export {
  TlsPinMismatchError,
  formatFingerprint,
  normalizeFingerprint,
  probeCertificate,
} from './tls';
export type {TlsMode, CertificateInfo} from './tls';
export type {
  SystemTotal,
  ServerSnapshot,
  ServerMetrics,
  AaPanelErrorKind,
  NodeProject,
  ProjectOperation,
  RunScript,
  ProjectPreEnv,
  NodeProjectConfig,
  ProjectModifyInput,
  ProjectCreateInput,
  Database,
  DbEngine,
  DbCreateInput,
  PartialResult,
  SourceFailure,
} from './types';
