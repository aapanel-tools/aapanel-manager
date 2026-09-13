'use client';

import {useRef, useState, useTransition} from 'react';
import {useTranslations} from 'next-intl';
import {RefreshCw} from 'lucide-react';
import type {FileReadResult} from '@/server/actions/files';
import {readFileAction} from '@/server/actions/files';
import {printableName} from '@/lib/files/paths';
import {cn} from '@/lib/utils';
import {useActionError} from '@/components/use-action-error';
import {useFileSize} from '@/components/servers/detail/use-file-size';
import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export interface FileViewDialogProps {
  id: string;
  serverName: string;
  /** The full path, already built by joinPath(); this dialog never assembles one. */
  path: string;
  name: string;
  trigger: React.ReactElement;
}

/**
 * One file, read-only.
 *
 * Which machine and which file are shown large, above the contents, rather
 * than in the title bar: on a fleet the same `wp-config.php` exists on every
 * server, and the one question that must never need answering from memory is
 * whose it is (ROADMAP Ф-3). The writing slice will inherit this header.
 *
 * Every opening is a fresh read and a fresh journal line — nothing is kept
 * between openings, and the contents are dropped the moment the dialog closes.
 * A secret that stays in a component's memory after the person stopped looking
 * at it is a secret on an unattended screen for no benefit.
 */
export function FileViewDialog({id, serverName, path, name, trigger}: FileViewDialogProps) {
  const t = useTranslations('files');
  const actionError = useActionError();
  const fileSize = useFileSize();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<FileReadResult | null>(null);
  const [loading, startLoad] = useTransition();
  // Bumped on every read and on close, so an answer that arrives after the
  // dialog was closed — or after a newer read was started — is thrown away
  // instead of landing in state nobody is looking at.
  const request = useRef(0);

  function load() {
    const token = ++request.current;
    startLoad(async () => {
      const res = await readFileAction(id, path);
      if (request.current === token) setResult(res);
    });
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      load();
    } else {
      request.current += 1;
      setResult(null);
    }
  }

  let body: React.ReactNode;
  if (result === null) {
    body = <p className="text-sm text-muted-foreground">{t('reading')}</p>;
  } else if (!result.ok) {
    body = (
      <div
        className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        role="alert"
      >
        <p className="font-medium">{t('readFailed')}</p>
        <p className="mt-1 text-xs opacity-80">{actionError(result.message)}</p>
      </div>
    );
  } else if (result.file.kind === 'tooLarge') {
    body = <p className="text-sm">{t('tooLarge', {limit: fileSize(result.file.limit)})}</p>;
  } else if (result.file.kind === 'binary') {
    body = <p className="text-sm">{t('binary', {size: fileSize(result.file.size)})}</p>;
  } else if (result.file.text === '') {
    body = <p className="text-sm text-muted-foreground">{t('emptyFile')}</p>;
  } else {
    body = (
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">
          {result.file.encoding
            ? t('meta', {size: fileSize(result.file.size), encoding: result.file.encoding})
            : fileSize(result.file.size)}
        </p>
        <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed [tab-size:4]">
          {result.file.text}
        </pre>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="break-all font-mono">{printableName(name)}</DialogTitle>
        </DialogHeader>

        <div className="rounded-md border bg-muted/40 px-3 py-2">
          <p className="text-sm">
            <span className="text-muted-foreground">{t('server')}: </span>
            <span className="font-semibold">{serverName}</span>
          </p>
          <p className="mt-0.5 break-all font-mono text-sm">{printableName(path)}</p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{t('journalNote')}</p>
          <Button variant="outline" size="sm" disabled={loading} onClick={load}>
            <RefreshCw className={cn('mr-1 h-3.5 w-3.5', loading && 'animate-spin')} />
            {t('reread')}
          </Button>
        </div>

        {body}
      </DialogContent>
    </Dialog>
  );
}
