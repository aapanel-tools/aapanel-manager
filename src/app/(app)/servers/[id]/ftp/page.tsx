import {requireUser} from '@/lib/auth/guards';
import {listFtpUsersAction} from '@/server/actions/ftp';
import {FtpTable} from '@/components/servers/detail/ftp-table';

export default async function FtpPage({params}: {params: Promise<{id: string}>}) {
  const user = await requireUser();
  const {id} = await params;
  const initial = await listFtpUsersAction(id);
  // When the rows were fetched, so the section can say how old they are (У-8).
  const fetchedAt = new Date().toISOString();
  return <FtpTable id={id} initial={initial} initialFetchedAt={fetchedAt} isAdmin={user.role === 'admin'} />;
}
