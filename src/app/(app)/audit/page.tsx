import {redirect} from 'next/navigation';
import {getTranslations} from 'next-intl/server';
import {requireUser} from '@/lib/auth/guards';
import {listAuditLog} from '@/lib/audit';
import {listServerOptions} from '@/lib/servers/query';
import {auditListParamsSchema} from '@/lib/validation/audit';
import {listUsersAction} from '@/server/actions/users';
import {AuditTable} from '@/components/audit/audit-table';
import {AuditToolbar} from '@/components/audit/audit-toolbar';

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  // The journal names who did what to which customer's machine. That is
  // administrative information: viewers do not get it (PROJECT_RULES.md §16,
  // "запрещено по умолчанию").
  if (user.role !== 'admin') redirect('/servers');

  const sp = await searchParams;
  const params = auditListParamsSchema.parse(sp);

  const [page, servers, users] = await Promise.all([
    listAuditLog(params),
    listServerOptions(),
    listUsersAction(),
  ]);
  const t = await getTranslations('audit');

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <AuditToolbar
        params={params}
        servers={servers.map((s) => ({id: s.id, name: s.name}))}
        users={users.ok ? users.users.map((u) => ({id: u.id, email: u.email})) : []}
      />

      <AuditTable rows={page.rows} total={page.total} params={params} />
    </section>
  );
}
