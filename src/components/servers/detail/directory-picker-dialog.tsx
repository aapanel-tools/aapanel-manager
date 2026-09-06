'use client';

import {useState, useTransition} from 'react';
import {useTranslations} from 'next-intl';
import {Folder, ArrowUp, Loader2} from 'lucide-react';
import {listDirAction} from '@/server/actions/projects';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

const DEFAULT_PATH = '/www';

/** Normalizes to an absolute path without a trailing slash (except root). */
function normalizePath(p: string): string {
  const trimmed = p.trim();
  if (!trimmed) return '/';
  const abs = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return abs.length > 1 ? abs.replace(/\/+$/, '') : '/';
}

function joinPath(base: string, name: string): string {
  const b = normalizePath(base);
  return b === '/' ? `/${name}` : `${b}/${name}`;
}

function parentPath(p: string): string {
  const b = normalizePath(p);
  if (b === '/') return '/';
  const idx = b.lastIndexOf('/');
  return idx <= 0 ? '/' : b.slice(0, idx);
}

export interface DirectoryPickerDialogProps {
  serverId: string;
  /** Path to start browsing from (falls back to /www). */
  initialPath?: string;
  trigger: React.ReactElement;
  onSelect: (path: string) => void;
}

/**
 * Browse the server's directory tree (via the panel's GetDirNew) and pick a
 * folder — used to fill the project path without typing it by hand. Lists only
 * folders; navigation is by clicking into a folder or going up.
 */
export function DirectoryPickerDialog({serverId, initialPath, trigger, onSelect}: DirectoryPickerDialogProps) {
  const t = useTranslations('projects');
  const [open, setOpen] = useState(false);
  const [currentPath, setCurrentPath] = useState(DEFAULT_PATH);
  const [dirs, setDirs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();

  function load(path: string) {
    startLoad(async () => {
      const res = await listDirAction(serverId, path);
      if (res.ok) {
        setCurrentPath(res.path);
        setDirs(res.dirs);
        setError(null);
      } else {
        setError(res.message);
        setDirs([]);
      }
    });
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      const start = normalizePath(initialPath?.trim() || DEFAULT_PATH);
      setCurrentPath(start);
      setDirs([]);
      setError(null);
      load(start);
    }
  }

  function choose() {
    onSelect(normalizePath(currentPath));
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('pickFolder')}</DialogTitle>
          <DialogDescription>{t('pickFolderHint')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={currentPath}
              onChange={(e) => setCurrentPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  load(currentPath);
                }
              }}
              aria-label={t('path')}
              autoComplete="off"
            />
            <Button type="button" variant="outline" disabled={loading} onClick={() => load(currentPath)}>
              {t('go')}
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={loading || normalizePath(currentPath) === '/'}
              onClick={() => load(parentPath(currentPath))}
            >
              <ArrowUp className="mr-1 size-4" />
              {t('up')}
            </Button>
            {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          </div>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : (
            <div className="max-h-72 overflow-y-auto rounded-md border">
              {dirs.length === 0 && !loading ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">{t('noFolders')}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {dirs.map((d) => (
                    <li key={d}>
                      <button
                        type="button"
                        onClick={() => load(joinPath(currentPath, d))}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
                      >
                        <Folder className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{d}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button type="button" onClick={choose} disabled={loading}>
            {t('selectFolder')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
