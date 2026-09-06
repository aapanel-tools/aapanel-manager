import {requireUser} from '@/lib/auth/guards';
import {listDatabasesAction} from '@/server/actions/databases';
import {DatabasesTable} from '@/components/servers/detail/databases-table';

export default async function DatabasesPage({params}: {params: Promise<{id: string}>}) {
  const user = await requireUser();
  const {id} = await params;
  const initial = await listDatabasesAction(id);
  return <DatabasesTable id={id} initial={initial} isAdmin={user.role === 'admin'} />;
}
