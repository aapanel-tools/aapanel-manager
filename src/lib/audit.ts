import 'server-only';
import type {AuditLog, Prisma} from '@prisma/client';
import {prisma} from '@/lib/db/prisma';
import type {AuditListParams} from '@/lib/validation/audit';
import {log} from '@/log';

export interface AuditInput {
  action: string;
  result: 'ok' | 'error' | string;
  userId?: string;
  serverId?: string;
  target?: string;
}

/**
 * Best-effort audit write. Returns the row, or null if persistence failed.
 *
 * Fine for anything that can be undone — a restart, a settings change, a
 * failed attempt. Losing that line costs a gap in the history; refusing the
 * work because the journal hiccuped would cost more.
 *
 * NOT fine for anything irreversible. Use beginAudit() or recordAuditIn()
 * there: an action nobody can undo must not happen unless it is recorded.
 */
export async function recordAudit(input: AuditInput): Promise<AuditLog | null> {
  try {
    return await prisma.auditLog.create({data: input});
  } catch (err) {
    log.error({err, action: input.action}, 'failed to write audit log');
    return null;
  }
}

/**
 * The result an action carries between being recorded and being finished.
 *
 * A row still holding this is not junk to be cleaned up — it is the most
 * important row in the journal: something irreversible was started on someone
 * else's production machine and nothing ever wrote down how it ended, which
 * means the process died in the middle of it.
 */
export const AUDIT_STARTED = 'started';

/** Raised when an irreversible action could not be journalled, so it did not happen. */
export class AuditUnavailableError extends Error {
  constructor(action: string, options?: {cause?: unknown}) {
    super(
      `Refused to run ${action}: the operations journal could not be written, ` +
        `and an action that cannot be undone must not happen unrecorded`,
      options,
    );
    this.name = 'AuditUnavailableError';
  }
}

export interface AuditHandle {
  /**
   * Records how the action ended. Best-effort on purpose: the act has already
   * happened and is already in the journal, so only the outcome is at stake,
   * and there is nothing left to refuse.
   */
  finish(result: 'ok' | 'error'): Promise<void>;
}

/**
 * Journals an irreversible action *before* it is attempted.
 *
 * For work that lands on someone else's production machine, where the
 * alternative ordering has a hole in it: act first, journal after, and a
 * journal that fails leaves a deleted database with nothing to say who deleted
 * it. Reporting that failure to whoever is looking at the screen does not
 * close the hole — the journal is read months later, by someone finding out
 * what happened.
 *
 * Throws AuditUnavailableError when the row cannot be written. The caller must
 * then refuse the action rather than perform it: the panel has not been
 * touched yet, so refusing costs an operator one retry, while proceeding costs
 * an unattributable destructive change on a client's server.
 */
export async function beginAudit(input: Omit<AuditInput, 'result'>): Promise<AuditHandle> {
  let row: AuditLog;
  try {
    row = await prisma.auditLog.create({data: {...input, result: AUDIT_STARTED}});
  } catch (err) {
    log.error(
      {err, action: input.action},
      'refused an irreversible action: it could not be journalled beforehand',
    );
    throw new AuditUnavailableError(input.action);
  }

  return {
    async finish(result) {
      try {
        await prisma.auditLog.update({where: {id: row.id}, data: {result}});
      } catch (err) {
        log.error(
          {err, action: input.action, auditId: row.id},
          'an irreversible action finished but its outcome could not be recorded',
        );
      }
    },
  };
}

/**
 * Writes the journal line inside the caller's transaction.
 *
 * For irreversible changes to our own database, where both halves can be made
 * to stand or fall together — stronger than journalling first, because there is
 * no window in which one exists without the other.
 *
 * A failure here aborts the caller's transaction, and that is the entire point.
 * It is re-thrown as AuditUnavailableError rather than passed on raw so that the
 * operator is told why nothing happened: a database constraint message quoted
 * into a toast explains the mechanism to someone asking about the outcome.
 */
export async function recordAuditIn(
  tx: Prisma.TransactionClient,
  input: AuditInput,
): Promise<AuditLog> {
  try {
    return await tx.auditLog.create({data: input});
  } catch (err) {
    log.error(
      {err, action: input.action},
      'rolling back an irreversible change: its journal line could not be written',
    );
    throw new AuditUnavailableError(input.action, {cause: err});
  }
}

/** One journal line as the interface shows it. Nothing here is a secret. */
export interface AuditRow {
  id: string;
  createdAt: Date;
  action: string;
  target: string | null;
  result: string;
  /** Null when the actor has since been deleted (onDelete: SetNull). */
  userEmail: string | null;
  serverId: string | null;
  /** Null when the server has since been deleted — the line itself survives. */
  serverName: string | null;
}

export interface ListAuditResult {
  rows: AuditRow[];
  total: number;
}

function buildWhere(p: AuditListParams): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  if (p.q) {
    where.OR = [
      {action: {contains: p.q, mode: 'insensitive'}},
      {target: {contains: p.q, mode: 'insensitive'}},
    ];
  }
  if (p.serverId) where.serverId = p.serverId;
  if (p.userId) where.userId = p.userId;
  // Anything that is not a plain success counts as a failure: actions write
  // 'error', but the column is a free string and must not silently swallow
  // a value nobody anticipated. That deliberately includes AUDIT_STARTED —
  // an irreversible action whose outcome was never recorded belongs in front
  // of whoever is looking for problems, not filed under success.
  if (p.result === 'ok') where.result = 'ok';
  else if (p.result === 'error') where.result = {not: 'ok'};
  if (p.from || p.to) {
    where.createdAt = {...(p.from ? {gte: p.from} : {}), ...(p.to ? {lte: p.to} : {})};
  }
  return where;
}

/**
 * A page of the operations journal, newest first.
 *
 * The journal answers "who did what, on which server, when, and with what result"
 * (PROJECT_RULES.md §16). Rows outlive the server and the user they refer to, so
 * both names are optional — a deleted server must not erase the history of what
 * was done to it.
 */
export async function listAuditLog(p: AuditListParams): Promise<ListAuditResult> {
  const where = buildWhere(p);
  const [records, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: {createdAt: 'desc'},
      skip: (p.page - 1) * p.pageSize,
      take: p.pageSize,
      select: {
        id: true,
        createdAt: true,
        action: true,
        target: true,
        result: true,
        serverId: true,
        user: {select: {email: true}},
        server: {select: {name: true}},
      },
    }),
    prisma.auditLog.count({where}),
  ]);

  const rows: AuditRow[] = records.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    action: r.action,
    target: r.target,
    result: r.result,
    userEmail: r.user?.email ?? null,
    serverId: r.serverId,
    serverName: r.server?.name ?? null,
  }));
  return {rows, total};
}
