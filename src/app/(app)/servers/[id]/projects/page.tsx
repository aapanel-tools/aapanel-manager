import {requireUser} from '@/lib/auth/guards';
import {listNodeProjectsAction} from '@/server/actions/projects';
import {ProjectsTable} from '@/components/servers/detail/projects-table';

export default async function ProjectsPage({params}: {params: Promise<{id: string}>}) {
  const user = await requireUser();
  const {id} = await params;
  const initial = await listNodeProjectsAction(id);
  return <ProjectsTable id={id} initial={initial} isAdmin={user.role === 'admin'} />;
}
