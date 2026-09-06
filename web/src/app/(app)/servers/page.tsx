import {getTranslations} from 'next-intl/server';
import {requireUser} from '@/lib/auth/guards';
import {serverListParamsSchema} from '@/lib/validation/server';
import {listServers} from '@/lib/servers/query';
import {ServersTable} from '@/components/servers/servers-table';
import {ServersToolbar} from '@/components/servers/servers-toolbar';
import {ServersLive} from '@/components/servers/servers-live';

export default async function ServersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const params = serverListParamsSchema.parse(sp);
  const {rows, total} = await listServers(params);
  const t = await getTranslations('servers');
  const isAdmin = user.role === 'admin';

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
      </div>
      <ServersToolbar
        params={params}
        isAdmin={isAdmin}
        visible={rows.map((r) => ({id: r.id, name: r.name}))}
      />
      <ServersLive />
      {rows.length === 0 ? (
        <p className="text-muted-foreground">{t('noServers')}</p>
      ) : (
        <ServersTable data={rows} total={total} params={params} isAdmin={isAdmin} />
      )}
    </section>
  );
}
