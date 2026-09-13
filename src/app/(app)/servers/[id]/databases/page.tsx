import {requireUser} from '@/lib/auth/guards';
import {listDatabasesAction} from '@/server/actions/databases';
import {DatabasesTable} from '@/components/servers/detail/databases-table';

export default async function DatabasesPage({params}: {params: Promise<{id: string}>}) {
  const user = await requireUser();
  const {id} = await params;
  const initial = await listDatabasesAction(id);
  // When the rows were fetched, so the section can say how old they are (У-8).
  const fetchedAt = new Date().toISOString();
  return <DatabasesTable id={id} initial={initial} initialFetchedAt={fetchedAt} isAdmin={user.role === 'admin'} />;
}
