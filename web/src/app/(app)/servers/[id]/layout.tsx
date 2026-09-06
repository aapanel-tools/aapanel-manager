import Link from 'next/link';
import {notFound} from 'next/navigation';
import {getTranslations} from 'next-intl/server';
import {requireUser} from '@/lib/auth/guards';
import {getServerForDetail} from '@/lib/servers/detail';
import {listServerOptions} from '@/lib/servers/query';
import {SectionNav} from '@/components/servers/detail/section-nav';
import {ServerSwitcher} from '@/components/servers/detail/server-switcher';

export default async function ServerDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{id: string}>;
}) {
  const {id} = await params;
  const user = await requireUser();
  const [server, servers] = await Promise.all([getServerForDetail(id), listServerOptions()]);
  if (!server) notFound();
  const t = await getTranslations('detail');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <nav className="text-sm text-muted-foreground">
            <Link href="/servers" className="hover:underline">
              {t('backToServers')}
            </Link>
            <span className="px-1">/</span>
            <span className="text-foreground">{server.name}</span>
          </nav>
          <h1 className="mt-1 text-xl font-semibold">{server.name}</h1>
          <p className="text-sm text-muted-foreground">
            {server.tag ? `${server.tag} · ` : ''}
            {server.baseUrl}
          </p>
        </div>
        <ServerSwitcher currentId={id} servers={servers} />
      </div>
      <div className="flex flex-col gap-4 md:flex-row">
        <aside className="md:w-48 shrink-0">
          <SectionNav id={id} isAdmin={user.role === 'admin'} />
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
