import {requireUser} from '@/lib/auth/guards';
import {listNodeProjectsAction} from '@/server/actions/projects';
import {ProjectsTable} from '@/components/servers/detail/projects-table';

export default async function ProjectsPage({params}: {params: Promise<{id: string}>}) {
  const user = await requireUser();
  const {id} = await params;
  const initial = await listNodeProjectsAction(id);
  // When the rows were fetched, so the section can say how old they are (У-8).
  const fetchedAt = new Date().toISOString();
  return <ProjectsTable id={id} initial={initial} initialFetchedAt={fetchedAt} isAdmin={user.role === 'admin'} />;
}
