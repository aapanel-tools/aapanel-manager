import {requireUser} from '@/lib/auth/guards';
import {listFtpUsersAction} from '@/server/actions/ftp';
import {FtpTable} from '@/components/servers/detail/ftp-table';

export default async function FtpPage({params}: {params: Promise<{id: string}>}) {
  const user = await requireUser();
  const {id} = await params;
  const initial = await listFtpUsersAction(id);
  return <FtpTable id={id} initial={initial} isAdmin={user.role === 'admin'} />;
}
