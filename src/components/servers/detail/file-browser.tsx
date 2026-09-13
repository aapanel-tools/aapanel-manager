'use client';

import {useTransition} from 'react';
import Link, {useLinkStatus} from 'next/link';
import {useRouter} from 'next/navigation';
import type {Route} from 'next';
import {useTranslations} from 'next-intl';
import {
  CornerLeftUp,
  File,
  FileSymlink,
  Folder,
  FolderSymlink,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react';
import type {FileEntry} from '@/lib/aapanel';
import type {DirectoryResult} from '@/server/actions/files';
import {
  DEFAULT_BROWSE_PATH,
  joinPath,
  parentPath,
  pathCrumbs,
  printableName,
} from '@/lib/files/paths';
import {FILE_VIEW_MAX_BYTES} from '@/lib/files/viewing';
import {formatTimestamp} from '@/lib/format/datetime';
import {cn} from '@/lib/utils';
import {useActionError} from '@/components/use-action-error';
import {useFileSize} from '@/components/servers/detail/use-file-size';
import {FileViewDialog} from '@/components/servers/detail/file-view-dialog';
import {ListIntegrityNotice} from '@/components/servers/detail/list-integrity-notice';
import {Button} from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export interface FileBrowserProps {
  id: string;
  serverName: string;
  /** Null when the address named a path this app will not send (ADR-0008). */
  path: string | null;
  /** Null exactly when `path` is: nothing was asked of the panel. */
  result: DirectoryResult | null;
}

/**
 * The address of a directory in this section.
 *
 * The directory lives in the address rather than in component state, so that
 * Back goes up a level, a link can be sent to a colleague, and a refresh shows
 * the same place. Slashes are left readable; everything else is encoded.
 */
export function filesHref(id: string, path: string): Route {
  return `/servers/${id}/files?path=${encodeURIComponent(path).replace(/%2F/g, '/')}` as Route;
}

/**
 * One directory on one server, read-only.
 *
 * Rendered from the address on the server; this component only draws it and
 * links onward. Nothing here reads a directory — so there is exactly one place
 * that does, and what the screen shows is always what that place was asked.
 */
export function FileBrowser({id, serverName, path, result}: FileBrowserProps) {
  const t = useTranslations('files');
  const actionError = useActionError();
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();

  const header = (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-semibold">{t('title')}</h2>
      <Button
        variant="outline"
        size="sm"
        disabled={refreshing || path === null}
        onClick={() => startRefresh(() => router.refresh())}
      >
        <RefreshCw className={cn('mr-1 h-3.5 w-3.5', refreshing && 'animate-spin')} />
        {t('refresh')}
      </Button>
    </div>
  );

  if (path === null || result === null) {
    return (
      <div>
        {header}
        <div
          className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          role="alert"
        >
          <p className="font-medium">{t('badPath')}</p>
          <p className="mt-1 text-xs opacity-80">{t('badPathHint')}</p>
        </div>
        <Link
          href={filesHref(id, DEFAULT_BROWSE_PATH)}
          className="mt-3 inline-block text-sm underline underline-offset-4"
        >
          {t('goDefault', {path: DEFAULT_BROWSE_PATH})}
        </Link>
      </div>
    );
  }

  const crumbs = <Breadcrumbs id={id} path={path} />;

  if (!result.ok) {
    // The breadcrumbs stay: a directory that could not be read is still a
    // place with a parent, and the way out should not depend on it.
    return (
      <div>
        {header}
        {crumbs}
        <div
          className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          role="alert"
        >
          <p className="font-medium">{t('loadFailed')}</p>
          <p className="mt-1 text-xs opacity-80">{actionError(result.message)}</p>
        </div>
      </div>
    );
  }

  const parent = parentPath(path);

  return (
    <div>
      {header}
      {crumbs}
      {/* A directory cut at the row limit that looks complete is how an
          operator concludes a file is gone (ADR-0003). */}
      <ListIntegrityNotice
        failures={[]}
        truncations={result.truncations}
        labelSource={() => t('title')}
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('name')}</TableHead>
            <TableHead className="text-right">{t('size')}</TableHead>
            <TableHead>{t('modified')}</TableHead>
            <TableHead>{t('mode')}</TableHead>
            <TableHead>{t('owner')}</TableHead>
            <TableHead className="w-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {parent !== null && (
            <TableRow>
              <TableCell colSpan={6}>
                <Link
                  href={filesHref(id, parent)}
                  aria-label={t('parent')}
                  title={t('parent')}
                  className="inline-flex items-center gap-2 font-mono text-sm hover:underline"
                >
                  <CornerLeftUp className="h-4 w-4 text-muted-foreground" aria-hidden />
                  ..
                  <PendingMark />
                </Link>
              </TableCell>
            </TableRow>
          )}
          {result.entries.map((entry, index) => (
            <EntryRow
              key={`${entry.kind}:${index}:${entry.name}`}
              id={id}
              serverName={serverName}
              dir={path}
              entry={entry}
            />
          ))}
        </TableBody>
      </Table>
      {result.entries.length === 0 && result.truncations.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">{t('empty')}</p>
      )}
    </div>
  );
}

/** Each step of the path, every one but the last a link. */
function Breadcrumbs({id, path}: {id: string; path: string}) {
  const t = useTranslations('files');
  const crumbs = pathCrumbs(path);

  return (
    <nav
      aria-label={t('breadcrumbs')}
      className="mb-3 flex flex-wrap items-center gap-x-1 break-all font-mono text-sm"
    >
      {crumbs.map((crumb, index) => {
        const last = index === crumbs.length - 1;
        return (
          <span key={crumb.path} className="inline-flex items-center gap-1">
            {index > 1 && (
              <span className="text-muted-foreground" aria-hidden>
                /
              </span>
            )}
            {last ? (
              <span aria-current="page" className="font-semibold">
                {printableName(crumb.name)}
              </span>
            ) : (
              <Link
                href={filesHref(id, crumb.path)}
                className="text-muted-foreground hover:text-foreground hover:underline"
              >
                {printableName(crumb.name)}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

/** A spinner beside the link that was just followed; panels can take seconds to list. */
function PendingMark() {
  const {pending} = useLinkStatus();
  return pending ? (
    <LoaderCircle className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />
  ) : null;
}

/**
 * When the entry last changed, or a dash.
 *
 * The number comes from the panel, and a Date built from an absurd one throws
 * when formatted; one malformed row must not take the directory down with it.
 */
function modifiedText(seconds: number | null): string {
  if (seconds === null) return '—';
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? '—' : formatTimestamp(date, 'minutes');
}

interface EntryRowProps {
  id: string;
  serverName: string;
  dir: string;
  entry: FileEntry;
}

function EntryRow({id, serverName, dir, entry}: EntryRowProps) {
  const t = useTranslations('files');
  const fileSize = useFileSize();

  // Null for a name that cannot be part of a path. The row is still shown —
  // leaving it out would make this console a good place to hide a file — but
  // it offers nothing to click.
  const target = joinPath(dir, entry.name);
  const isLink = entry.linkTarget !== '';
  const Icon =
    entry.kind === 'dir' ? (isLink ? FolderSymlink : Folder) : isLink ? FileSymlink : File;
  // Judged from the listing, which can be stale; the server checks again.
  const tooLarge = entry.size !== null && entry.size > FILE_VIEW_MAX_BYTES;

  const label = (
    <>
      <Icon
        className={cn(
          'h-4 w-4 shrink-0',
          entry.kind === 'dir' ? 'text-sky-600 dark:text-sky-400' : 'text-muted-foreground',
        )}
        aria-hidden
      />
      <span className="break-all">{printableName(entry.name) || '—'}</span>
    </>
  );

  return (
    <TableRow>
      <TableCell className="max-w-[28rem] whitespace-normal">
        {entry.kind === 'dir' && target !== null ? (
          <Link
            href={filesHref(id, target)}
            className="inline-flex items-center gap-2 font-medium hover:underline"
          >
            {label}
            <PendingMark />
          </Link>
        ) : (
          <span
            className="inline-flex items-center gap-2"
            title={target === null ? t('unusableName') : undefined}
          >
            {label}
          </span>
        )}
        {isLink && (
          <span
            className="ml-6 block truncate text-xs text-muted-foreground"
            title={t('symlink', {target: printableName(entry.linkTarget)})}
          >
            → {printableName(entry.linkTarget)}
          </span>
        )}
      </TableCell>
      <TableCell className="text-right text-xs tabular-nums">
        {entry.kind === 'dir' ? '—' : fileSize(entry.size)}
      </TableCell>
      <TableCell className="text-xs tabular-nums">{modifiedText(entry.modifiedAt)}</TableCell>
      <TableCell className="font-mono text-xs">{entry.mode || '—'}</TableCell>
      <TableCell className="text-xs">{entry.owner || '—'}</TableCell>
      <TableCell className="text-right">
        {entry.kind === 'file' &&
          target !== null &&
          (tooLarge ? (
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              {t('tooLargeToOpen', {limit: fileSize(FILE_VIEW_MAX_BYTES)})}
            </span>
          ) : (
            <FileViewDialog
              id={id}
              serverName={serverName}
              path={target}
              name={entry.name}
              trigger={
                <Button variant="ghost" size="sm">
                  {t('open')}
                </Button>
              }
            />
          ))}
      </TableCell>
    </TableRow>
  );
}
