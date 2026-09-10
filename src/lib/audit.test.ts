import {describe, it, expect, afterAll} from 'vitest';
import {prisma} from '@/lib/db/prisma';
import {AUDIT_STARTED, recordAudit, listAuditLog} from './audit';
import {auditListParamsSchema} from '@/lib/validation/audit';

const createdIds: string[] = [];

afterAll(async () => {
  if (createdIds.length) await prisma.auditLog.deleteMany({where: {id: {in: createdIds}}});
});

describe('recordAudit', () => {
  it('persists an audit row and returns it', async () => {
    const row = await recordAudit({action: 'server.test', result: 'ok', target: 'unit'});
    expect(row).not.toBeNull();
    if (row) {
      createdIds.push(row.id);
      expect(row.action).toBe('server.test');
      expect(row.result).toBe('ok');
    }
  });

  it('never throws even if the write fails (returns null on FK violation)', async () => {
    await expect(
      recordAudit({action: 'x', result: 'ok', userId: 'definitely-missing-user-id'}),
    ).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Reading the journal (Ф-2)
// ---------------------------------------------------------------------------

describe('listAuditLog', () => {
  const params = (over: Record<string, unknown> = {}) => auditListParamsSchema.parse(over);
  const tag = `flt-${Math.random().toString(36).slice(2, 8)}`;

  async function seed(): Promise<void> {
    for (const [action, result] of [
      [`${tag}.alpha`, 'ok'],
      [`${tag}.beta`, 'error'],
      [`${tag}.gamma`, 'ok'],
      // The rest of the vocabulary, which the journal really does hold: a batch
      // that finished with some servers unhappy, one an operator stopped, and
      // one irreversible act that never reported back (Д-19, Д-20).
      [`${tag}.delta`, 'failed'],
      [`${tag}.epsilon`, 'cancelled'],
      [`${tag}.zeta`, AUDIT_STARTED],
    ] as const) {
      const row = await recordAudit({action, result, target: `${tag}-target`});
      if (row) createdIds.push(row.id);
    }
  }

  it('returns the seeded rows newest first', async () => {
    await seed();
    const {rows, total} = await listAuditLog(params({q: tag, pageSize: 10}));
    expect(total).toBe(6);
    expect(rows).toHaveLength(6);
    const times = rows.map((r) => r.createdAt.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('filters by result, counting anything that is not "ok" as a failure', async () => {
    // Four of the six are not a plain success — error, failed, cancelled and
    // the unresolved one. All four belong in front of somebody looking for
    // problems, which is why the bucket is "not ok" rather than a list.
    const failed = await listAuditLog(params({q: tag, result: 'error'}));
    expect(failed.total).toBe(4);

    const succeeded = await listAuditLog(params({q: tag, result: 'ok'}));
    expect(succeeded.total).toBe(2);
  });

  it('finds the rows that never reported an outcome, on their own', async () => {
    // The forensic filter (Д-20). Without it the one line worth chasing can
    // only be found by eye among everything else that is not a success.
    const unresolved = await listAuditLog(params({q: tag, result: 'started'}));
    expect(unresolved.total).toBe(1);
    expect(unresolved.rows[0]?.action).toBe(`${tag}.zeta`);
    expect(unresolved.rows[0]?.result).toBe(AUDIT_STARTED);
  });

  it('searches the action and the target', async () => {
    expect((await listAuditLog(params({q: `${tag}.alpha`}))).total).toBe(1);
    expect((await listAuditLog(params({q: `${tag}-target`}))).total).toBe(6);
  });

  it('pages without losing the total', async () => {
    const first = await listAuditLog(params({q: tag, pageSize: 10, page: 1}));
    const second = await listAuditLog(params({q: tag, pageSize: 10, page: 2}));
    expect(first.rows).toHaveLength(6);
    expect(second.rows).toHaveLength(0);
    expect(second.total).toBe(6);
  });

  it('honours the date bounds', async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    expect((await listAuditLog(params({q: tag, from: tomorrow.toISOString()}))).total).toBe(0);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect((await listAuditLog(params({q: tag, from: yesterday.toISOString()}))).total).toBe(6);
  });

  // A journal line must outlive the things it refers to: a deleted server or user
  // cannot be allowed to erase the record of what was done.
  it('reports a missing server and user as null rather than dropping the row', async () => {
    const {rows} = await listAuditLog(params({q: `${tag}.alpha`}));
    expect(rows[0]?.serverName).toBeNull();
    expect(rows[0]?.userEmail).toBeNull();
  });
});
