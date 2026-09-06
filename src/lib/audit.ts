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

/** Best-effort audit write. Returns the row, or null if persistence failed. */
export async function recordAudit(input: AuditInput): Promise<AuditLog | null> {
  try {
    return await prisma.auditLog.create({data: input});
  } catch (err) {
    log.error({err, action: input.action}, 'failed to write audit log');
    return null;
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
  // a value nobody anticipated.
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
