import {requireUser} from '@/lib/auth/guards';
import {listCronTasksAction} from '@/server/actions/cron';
import {CronTable} from '@/components/servers/detail/cron-table';

export default async function CronPage({params}: {params: Promise<{id: string}>}) {
  await requireUser();
  const {id} = await params;
  const initial = await listCronTasksAction(id);
  return <CronTable id={id} initial={initial} />;
}
