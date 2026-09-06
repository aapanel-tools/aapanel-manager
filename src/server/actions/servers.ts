'use server';
import {revalidatePath} from 'next/cache';
import {requireUser, requireAdmin, AuthError} from '@/lib/auth/guards';
import type {SessionUser} from '@/lib/auth/guards';
import {encryptSecret} from '@/lib/crypto/secret-box';
import {getEncryptionKey} from '@/lib/config/secrets';
import {
  createClientForServer,
  AaPanelError,
  formatFingerprint,
  probeCertificate,
} from '@/lib/aapanel';
import {recordAudit} from '@/lib/audit';
import {mapLimit} from '@/lib/utils/concurrency';
import {prisma} from '@/lib/db/prisma';
import {log} from '@/log';
import {
  certificateInspectSchema,
  serverCreateSchema,
  serverUpdateSchema,
  testConnectionSchema,
} from '@/lib/validation/server';
import {refreshServerStatus} from '@/lib/servers/status';

export type ActionState =
  | {ok: true; message?: string}
  | {ok: false; error: string; fieldErrors?: Record<string, string[]>};

export interface SimpleResult {
  ok: boolean;
  message: string;
}

/** What the panel's certificate says, for an operator deciding whether to trust it. */
export interface CertificateView {
  /** SHA-256, grouped as AA:BB:… for reading off against the panel. */
  fingerprint: string;
  subject: string;
  issuer: string;
  validTo: string;
  selfSigned: boolean;
}

export type CertificateInspectResult =
  | {ok: true; certificate: CertificateView}
  | {ok: false; message: string};

function fieldErrorState(error: string, fieldErrors?: Record<string, string[]>): ActionState {
  return {ok: false, error, fieldErrors};
}

function describeError(err: unknown): string {
  if (err instanceof AaPanelError) return `${err.kind}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return 'Unknown error';
}

export async function createServerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let user: SessionUser;
  try {
    user = await requireAdmin();
  } catch (e) {
    return fieldErrorState(e instanceof AuthError ? e.code : 'forbidden');
  }
  const parsed = serverCreateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrorState('validation', parsed.error.flatten().fieldErrors as Record<string, string[]>);

  const {name, baseUrl, apiSk, tag, tlsMode, tlsPinSha256} = parsed.data;
  try {
    const apiSkEnc = encryptSecret(apiSk, getEncryptionKey());
    // No fingerprint given: it is recorded on the first connection (ADR-0002).
    const server = await prisma.server.create({
      data: {name, baseUrl, apiSkEnc, tag, tlsMode, tlsPinSha256: tlsPinSha256 ?? null},
    });
    await recordAudit({userId: user.id, serverId: server.id, action: 'server.create', target: name, result: 'ok'});
    if (tlsPinSha256) {
      await recordAudit({
        userId: user.id,
        serverId: server.id,
        action: 'server.tls.pin',
        target: formatFingerprint(tlsPinSha256),
        result: 'ok',
      });
    }
    revalidatePath('/servers');
    return {ok: true, message: 'created'};
  } catch (err) {
    log.error({err}, 'createServerAction failed');
    await recordAudit({userId: user.id, action: 'server.create', target: name, result: 'error'});
    return fieldErrorState(describeError(err));
  }
}

export async function updateServerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let user: SessionUser;
  try {
    user = await requireAdmin();
  } catch (e) {
    return fieldErrorState(e instanceof AuthError ? e.code : 'forbidden');
  }
  const parsed = serverUpdateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrorState('validation', parsed.error.flatten().fieldErrors as Record<string, string[]>);

  const {id, name, baseUrl, apiSk, tag, tlsMode, tlsPinSha256} = parsed.data;
  try {
    const data: Record<string, unknown> = {name, baseUrl, tag, tlsMode};
    if (apiSk) data.apiSkEnc = encryptSecret(apiSk, getEncryptionKey()); // blank = keep existing

    // An explicitly entered fingerprint wins. Otherwise a changed address or a
    // switch away from pinning invalidates the stored pin: it identified the
    // previous panel, and keeping it would either block a legitimate server or
    // silently vouch for a different one.
    const before = await prisma.server.findUniqueOrThrow({
      where: {id},
      select: {baseUrl: true, tlsPinSha256: true},
    });
    if (tlsPinSha256) data.tlsPinSha256 = tlsPinSha256;
    else if (tlsMode === 'VERIFY' || before.baseUrl !== baseUrl) data.tlsPinSha256 = null;
    await prisma.server.update({where: {id}, data});
    await recordAudit({userId: user.id, serverId: id, action: 'server.update', target: name, result: 'ok'});
    // A changed pin is a trust decision, not a field edit: it gets its own entry so
    // the journal answers "who decided to trust this certificate, and when".
    if (tlsPinSha256 && tlsPinSha256 !== before.tlsPinSha256) {
      await recordAudit({
        userId: user.id,
        serverId: id,
        action: 'server.tls.repin',
        target: formatFingerprint(tlsPinSha256),
        result: 'ok',
      });
    }
    revalidatePath('/servers');
    return {ok: true, message: 'updated'};
  } catch (err) {
    log.error({err, id}, 'updateServerAction failed');
    await recordAudit({userId: user.id, serverId: id, action: 'server.update', target: name, result: 'error'});
    return fieldErrorState(describeError(err));
  }
}

export async function deleteServerAction(formData: FormData): Promise<SimpleResult> {
  let user: SessionUser;
  try {
    user = await requireAdmin();
  } catch {
    return {ok: false, message: 'forbidden'};
  }
  const id = String(formData.get('id') ?? '');
  if (!id) return {ok: false, message: 'missing id'};
  try {
    const server = await prisma.server.delete({where: {id}}); // ServerStatus cascades
    // Audit WITHOUT serverId: the row is already gone, so an FK reference would
    // fail the insert (best-effort audit would then silently drop the delete
    // record). Identity is preserved in `target` instead.
    await recordAudit({
      userId: user.id,
      action: 'server.delete',
      target: `${server.name} (${id})`,
      result: 'ok',
    });
    revalidatePath('/servers');
    return {ok: true, message: 'deleted'};
  } catch (err) {
    log.error({err, id}, 'deleteServerAction failed');
    await recordAudit({userId: user.id, action: 'server.delete', target: id, result: 'error'});
    return {ok: false, message: describeError(err)};
  }
}

/** Tests connectivity for a (possibly unsaved) server. Read-only on the panel. */
export async function testConnectionAction(formData: FormData): Promise<SimpleResult> {
  try {
    await requireAdmin();
  } catch {
    return {ok: false, message: 'forbidden'};
  }
  const parsed = testConnectionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return {ok: false, message: 'validation'};
  const {id, baseUrl, apiSk, tlsMode} = parsed.data;

  try {
    let apiSkEnc: string;
    if (apiSk) {
      apiSkEnc = encryptSecret(apiSk, getEncryptionKey());
    } else if (id) {
      const existing = await prisma.server.findUniqueOrThrow({where: {id}, select: {apiSkEnc: true}});
      apiSkEnc = existing.apiSkEnc;
    } else {
      return {ok: false, message: 'api_sk required'};
    }

    // Probing first shows the operator which certificate answered, so a pin can
    // be compared against the panel before the server is saved. Nothing is stored
    // here: this server may not exist yet.
    const fingerprint =
      tlsMode === 'PINNED' && baseUrl.startsWith('https:')
        ? (await probeCertificate(baseUrl)).fingerprint
        : null;
    const client = await createClientForServer({baseUrl, apiSkEnc, tlsMode, tlsPinSha256: fingerprint});
    const total = await client.getSystemTotal();
    const cert = fingerprint ? ` · cert ${formatFingerprint(fingerprint)}` : '';
    return {
      ok: true,
      message: `online · cpu ${total.cpu ?? '?'}% · mem ${Math.round(total.mem ?? 0)}%${cert}`,
    };
  } catch (err) {
    return {ok: false, message: describeError(err)};
  }
}

/**
 * Reads the certificate a panel currently presents, without trusting it.
 *
 * Two jobs, one mechanism (ADR-0002). Adding a server: the operator compares the
 * fingerprint against the panel and pins it by hand, which closes the one window
 * trust-on-first-use leaves open. Certificate rotated: the operator sees what the
 * panel offers now and re-pins deliberately — the pin is never overwritten on its own,
 * or it would not be a pin.
 *
 * Read-only and admin-only. It reaches the same operator-supplied address as
 * testConnectionAction and adds no new outbound surface; api_sk is not involved.
 */
export async function inspectCertificateAction(formData: FormData): Promise<CertificateInspectResult> {
  try {
    await requireAdmin();
  } catch {
    return {ok: false, message: 'forbidden'};
  }
  const parsed = certificateInspectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return {ok: false, message: 'validation'};

  const {baseUrl} = parsed.data;
  try {
    const cert = await probeCertificate(baseUrl);
    return {
      ok: true,
      certificate: {
        fingerprint: formatFingerprint(cert.fingerprint),
        subject: cert.subject,
        issuer: cert.issuer,
        validTo: cert.validTo,
        selfSigned: cert.selfSigned,
      },
    };
  } catch (err) {
    log.warn({err, baseUrl}, 'inspectCertificateAction failed');
    return {ok: false, message: describeError(err)};
  }
}

/** Live-polls one server and writes its status to the cache. */
export async function refreshServerStatusAction(serverId: string): Promise<SimpleResult> {
  let user: SessionUser;
  try {
    user = await requireUser();
  } catch {
    return {ok: false, message: 'unauthenticated'};
  }
  if (!serverId) return {ok: false, message: 'missing id'};
  try {
    const r = await refreshServerStatus(serverId);
    await recordAudit({userId: user.id, serverId, action: 'server.refresh', result: r.ok ? 'ok' : 'error'});
    revalidatePath('/servers');
    return {ok: r.ok, message: r.ok ? 'refreshed' : (r.message ?? 'error')};
  } catch (err) {
    await recordAudit({userId: user.id, serverId, action: 'server.refresh', result: 'error'});
    revalidatePath('/servers');
    return {ok: false, message: describeError(err)};
  }
}

/** Live-polls the visible page of servers (bounded concurrency) — the "live visible page" hybrid. */
export async function refreshVisibleStatusesAction(
  serverIds: string[],
): Promise<{ok: boolean; refreshed: number; failed: number}> {
  try {
    await requireUser();
  } catch {
    return {ok: false, refreshed: 0, failed: serverIds.length};
  }
  const ids = serverIds.filter((id) => typeof id === 'string' && id.length > 0).slice(0, 100);
  const results = await mapLimit(ids, 8, (id) => refreshServerStatus(id));
  const refreshed = results.filter((r) => r.ok && r.value.ok).length;
  revalidatePath('/servers');
  return {ok: true, refreshed, failed: results.length - refreshed};
}
