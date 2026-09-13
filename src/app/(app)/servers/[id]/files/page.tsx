import {redirect} from 'next/navigation';
import type {Route} from 'next';
import {requireUser} from '@/lib/auth/guards';
import {getServerForDetail} from '@/lib/servers/detail';
import {DEFAULT_BROWSE_PATH, normalizeBrowsePath} from '@/lib/files/paths';
import {listDirectoryAction} from '@/server/actions/files';
import {FileBrowser} from '@/components/servers/detail/file-browser';

export default async function FilesPage({
  params,
  searchParams,
}: {
  params: Promise<{id: string}>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const {id} = await params;
  // A file manager's subject is the client's secrets, and PROJECT_RULES.md §16
  // grants rights to files explicitly. Nobody has been granted them, so the
  // section is an administrator's (ADR-0008).
  if (user.role !== 'admin') redirect(`/servers/${id}` as Route);

  const sp = await searchParams;
  // No path means "open where the sites live". A path that is present but
  // unusable is reported as such rather than quietly replaced with the default:
  // the address is what the operator typed or followed, and showing another
  // directory under it would be a lie about where they are.
  const path = normalizeBrowsePath(sp.path === undefined ? DEFAULT_BROWSE_PATH : sp.path);

  const [server, result] = await Promise.all([
    getServerForDetail(id),
    path ? listDirectoryAction(id, path) : Promise.resolve(null),
  ]);

  return (
    <FileBrowser
      // A new directory is a new screen: an open file dialog must not survive
      // the move into a directory the file is not in.
      key={path ?? ''}
      id={id}
      serverName={server?.name ?? id}
      path={path}
      result={result}
    />
  );
}
