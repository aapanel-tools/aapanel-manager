import {requireUser} from '@/lib/auth/guards';
import {getServerMetricsAction} from '@/server/actions/projects';
import {ServerOverview} from '@/components/servers/detail/server-overview';

export default async function OverviewPage({params}: {params: Promise<{id: string}>}) {
  await requireUser();
  const {id} = await params;
  const initial = await getServerMetricsAction(id);
  return <ServerOverview id={id} initial={initial} />;
}
