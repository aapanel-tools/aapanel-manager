import {requireUser} from '@/lib/auth/guards';
import {listSitesAction} from '@/server/actions/sites';
import {SitesTable} from '@/components/servers/detail/sites-table';

export default async function SitesPage({params}: {params: Promise<{id: string}>}) {
  await requireUser();
  const {id} = await params;
  const initial = await listSitesAction(id);
  return <SitesTable id={id} initial={initial} />;
}
