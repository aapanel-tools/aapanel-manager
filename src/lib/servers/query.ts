import 'server-only';
import type {Prisma} from '@prisma/client';
import {prisma} from '@/lib/db/prisma';
import type {TlsMode} from '@/lib/aapanel/tls';
import type {ServerListParams} from '@/lib/validation/server';

export interface ServerRow {
  id: string;
  name: string;
  tag: string | null;
  baseUrl: string;
  tlsMode: TlsMode;
  /** Null until the certificate is pinned on first connection (ADR-0002). */
  tlsPinSha256: string | null;
  createdAt: Date;
  online: boolean | null;
  cpu: number | null;
  mem: number | null;
  disk: number | null;
  projectCount: number | null;
  error: string | null;
  lastCheckedAt: Date | null;
}

export interface ListServersResult {
  rows: ServerRow[];
  total: number;
}

function buildWhere(p: ServerListParams): Prisma.ServerWhereInput {
  const where: Prisma.ServerWhereInput = {};
  if (p.q) {
    where.OR = [
      {name: {contains: p.q, mode: 'insensitive'}},
      {baseUrl: {contains: p.q, mode: 'insensitive'}},
      {tag: {contains: p.q, mode: 'insensitive'}},
    ];
  }
  if (p.tag) where.tag = p.tag;
  if (p.status === 'online') where.status = {is: {online: true}};
  else if (p.status === 'offline') where.status = {is: {online: false}};
  else if (p.status === 'unknown') where.status = {is: null};
  return where;
}

function buildOrderBy(p: ServerListParams): Prisma.ServerOrderByWithRelationInput {
  switch (p.sort) {
    case 'cpu': return {status: {cpu: p.dir}};
    case 'mem': return {status: {mem: p.dir}};
    case 'disk': return {status: {disk: p.dir}};
    case 'lastCheckedAt': return {status: {lastCheckedAt: p.dir}};
    case 'tag': return {tag: p.dir};
    case 'createdAt': return {createdAt: p.dir};
    default: return {name: p.dir};
  }
}

export async function listServers(p: ServerListParams): Promise<ListServersResult> {
  const where = buildWhere(p);
  const [records, total] = await Promise.all([
    prisma.server.findMany({
      where,
      orderBy: buildOrderBy(p),
      skip: (p.page - 1) * p.pageSize,
      take: p.pageSize,
      // Explicit select — apiSkEnc is intentionally excluded.
      select: {
        id: true, name: true, tag: true, baseUrl: true, tlsMode: true, tlsPinSha256: true, createdAt: true,
        status: {select: {online: true, cpu: true, mem: true, disk: true, projectCount: true, error: true, lastCheckedAt: true}},
      },
    }),
    prisma.server.count({where}),
  ]);

  const rows: ServerRow[] = records.map((r) => ({
    id: r.id, name: r.name, tag: r.tag, baseUrl: r.baseUrl, tlsMode: r.tlsMode,
    tlsPinSha256: r.tlsPinSha256, createdAt: r.createdAt,
    online: r.status?.online ?? null,
    cpu: r.status?.cpu ?? null,
    mem: r.status?.mem ?? null,
    disk: r.status?.disk ?? null,
    projectCount: r.status?.projectCount ?? null,
    error: r.status?.error ?? null,
    lastCheckedAt: r.status?.lastCheckedAt ?? null,
  }));
  return {rows, total};
}

export interface ServerOption {
  id: string;
  name: string;
  tag: string | null;
}

/**
 * Lightweight list of every server (id, name, tag) for the detail-page switcher.
 * No secrets, no status — ordered by name; the client filters locally.
 */
export async function listServerOptions(): Promise<ServerOption[]> {
  return prisma.server.findMany({
    orderBy: {name: 'asc'},
    select: {id: true, name: true, tag: true},
  });
}
