import {requireUser} from '@/lib/auth/guards';
import {listCronTasksAction} from '@/server/actions/cron';
import {CronTable} from '@/components/servers/detail/cron-table';

export default async function CronPage({params}: {params: Promise<{id: string}>}) {
  const user = await requireUser();
  const {id} = await params;
  const initial = await listCronTasksAction(id);
  // When the rows were fetched, so the section can say how old they are (У-8).
  const fetchedAt = new Date().toISOString();
  return <CronTable id={id} initial={initial} initialFetchedAt={fetchedAt} isAdmin={user.role === 'admin'} />;
}
