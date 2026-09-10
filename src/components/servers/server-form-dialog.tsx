'use client';
import {useState, useTransition} from 'react';
import {useTranslations} from 'next-intl';
import {useActionError} from '@/components/use-action-error';
import {toast} from 'sonner';
import type {ServerRow} from '@/lib/servers/query';
import {
  createServerAction,
  updateServerAction,
  testConnectionAction,
  inspectCertificateAction,
  type ActionState,
  type CertificateView,
} from '@/server/actions/servers';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Switch} from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

const INITIAL: ActionState = {ok: false, error: ''};

/** AA:BB:… for reading off against the panel. Local so this client component
 *  does not pull in the server-only TLS module. */
const groupHex = (hex: string): string => hex.replace(/(.{2})(?=.)/g, '$1:');

export interface ServerFormDialogProps {
  mode: 'create' | 'edit';
  server?: ServerRow;
  trigger: React.ReactElement;
}

export function ServerFormDialog({mode, server, trigger}: ServerFormDialogProps) {
  const t = useTranslations('servers');
  // An action refuses for its own reasons too — wrong role, a form that did
  // not validate — and those arrived as bare English tokens (Д-23).
  const actionError = useActionError();
  const action = mode === 'create' ? createServerAction : updateServerAction;
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState((server?.tlsMode ?? 'PINNED') === 'PINNED');
  const [pin, setPin] = useState(server?.tlsPinSha256 ? groupHex(server.tlsPinSha256) : '');
  const [cert, setCert] = useState<CertificateView | null>(null);
  const [result, setResult] = useState<ActionState>(INITIAL);
  const [pending, startSubmit] = useTransition();
  const [testing, startTest] = useTransition();
  const [inspecting, startInspect] = useTransition();

  // Call the action directly (no useActionState) so success handling lives in a
  // transition callback, not an effect — avoids set-state-in-effect cascades.
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startSubmit(async () => {
      const res = await action(INITIAL, fd);
      setResult(res);
      if (res.ok) {
        toast.success(t(res.message ?? 'saved'));
        setOpen(false);
      }
    });
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setResult(INITIAL); // clear stale errors when the dialog closes
      setCert(null); // a certificate read a while ago says nothing about now
    }
  }

  const fieldErr = (name: string): string | undefined =>
    !result.ok && result.fieldErrors ? result.fieldErrors[name]?.[0] : undefined;

  /** Shows what the panel presents right now; pinning stays an explicit choice. */
  function inspectCertificate(form: HTMLFormElement | null) {
    if (!form) return;
    const fd = new FormData(form);
    startInspect(async () => {
      const res = await inspectCertificateAction(fd);
      if (res.ok) {
        setCert(res.certificate);
      } else {
        setCert(null);
        toast.error(actionError(res.message));
      }
    });
  }

  function runTest(form: HTMLFormElement | null) {
    if (!form) return;
    const fd = new FormData(form);
    startTest(async () => {
      const res = await testConnectionAction(fd);
      if (res.ok) toast.success(res.message);
      else toast.error(actionError(res.message));
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? t('add') : t('edit')}</DialogTitle>
          <DialogDescription>{t('formHint')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          {mode === 'edit' && server ? <input type="hidden" name="id" value={server.id} /> : null}
          <input type="hidden" name="tlsMode" value={pinned ? 'PINNED' : 'VERIFY'} />

          {!result.ok && result.error && result.error !== 'validation' ? (
            <p className="text-sm text-destructive" role="alert">
              {result.error}
            </p>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="sf-name">{t('name')}</Label>
            <Input id="sf-name" name="name" defaultValue={server?.name} required />
            {fieldErr('name') ? <p className="text-xs text-destructive">{fieldErr('name')}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sf-baseUrl">{t('baseUrl')}</Label>
            <Input id="sf-baseUrl" name="baseUrl" defaultValue={server?.baseUrl} placeholder="https://host:8888" required />
            {fieldErr('baseUrl') ? <p className="text-xs text-destructive">{fieldErr('baseUrl')}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sf-apiSk">{t('apiSk')}</Label>
            <Input
              id="sf-apiSk"
              name="apiSk"
              type="password"
              autoComplete="off"
              placeholder={mode === 'edit' ? t('apiSkKeep') : undefined}
              required={mode === 'create'}
            />
            {fieldErr('apiSk') ? <p className="text-xs text-destructive">{fieldErr('apiSk')}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sf-tag">{t('tag')}</Label>
            <Input id="sf-tag" name="tag" defaultValue={server?.tag ?? ''} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Switch id="sf-tls-pinned" checked={pinned} onCheckedChange={setPinned} />
              <Label htmlFor="sf-tls-pinned">{t('tlsPinned')}</Label>
            </div>

            {pinned ? (
              <div className="space-y-1.5">
                <Label htmlFor="sf-tls-pin">{t('tlsPin')}</Label>
                <Input
                  id="sf-tls-pin"
                  name="tlsPinSha256"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder={t('tlsPinNone')}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-xs"
                />
                {fieldErr('tlsPinSha256') ? (
                  <p className="text-xs text-destructive">{fieldErr('tlsPinSha256')}</p>
                ) : null}
                <p className="text-xs text-muted-foreground">{t('tlsPinHint')}</p>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={inspecting}
                  onClick={(e) => inspectCertificate((e.currentTarget as HTMLButtonElement).form)}
                >
                  {inspecting ? t('tlsInspecting') : t('tlsInspect')}
                </Button>

                {cert ? (
                  <div className="space-y-1 rounded-md border p-2 text-xs">
                    <p className="break-all font-mono">{cert.fingerprint}</p>
                    <p className="text-muted-foreground">
                      {t('tlsSubject')}: {cert.subject || '—'}
                    </p>
                    <p className="text-muted-foreground">
                      {t('tlsIssuer')}: {cert.issuer || '—'}
                    </p>
                    <p className="text-muted-foreground">
                      {t('tlsValidTo')}: {cert.validTo || '—'}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => setPin(cert.fingerprint)}
                    >
                      {t('tlsUseFingerprint')}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={testing}
              onClick={(e) => runTest((e.currentTarget as HTMLButtonElement).form)}
            >
              {testing ? t('testing') : t('test')}
            </Button>
            <Button type="submit" disabled={pending}>
              {t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
