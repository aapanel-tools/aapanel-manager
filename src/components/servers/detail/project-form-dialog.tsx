'use client';

import {useState, useTransition} from 'react';
import {useTranslations} from 'next-intl';
import {toast} from 'sonner';
import {Loader2, FolderOpen} from 'lucide-react';
import type {NodeProjectConfig, ProjectPreEnv, RunScript} from '@/lib/aapanel';
import {
  createProjectAction,
  modifyProjectAction,
  getProjectEditDataAction,
  getProjectCreateEnvAction,
  getRunListAction,
  type ProjectMutResult,
} from '@/server/actions/projects';
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
import {DirectoryPickerDialog} from '@/components/servers/detail/directory-picker-dialog';

const INITIAL: ProjectMutResult = {ok: false, error: ''};

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
const TEXTAREA_CLASS =
  'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring';

export interface ProjectFormDialogProps {
  mode: 'create' | 'edit';
  serverId: string;
  /** Required in edit mode — the project to load and modify. */
  projectName?: string;
  trigger: React.ReactElement;
  onDone: () => void;
}

/**
 * Create or edit a Node.js project.
 *
 * The headline control is the **start command** select, populated from the
 * project's `package.json` scripts (panel method `get_run_list`). In edit mode
 * the form loads the current config + scripts + Node versions on open; in create
 * mode it loads the panel's create-form metadata (`pre_env`) and fetches the
 * scripts once the user points at a directory.
 *
 * In edit mode the project name is read-only: the panel keys a project by its
 * directory, and renaming touches the generated nginx vhost — out of scope here.
 */
export function ProjectFormDialog({mode, serverId, projectName, trigger, onDone}: ProjectFormDialogProps) {
  const t = useTranslations('projects');
  const [open, setOpen] = useState(false);

  // Form-data loading (on open) — its own transition so the spinner is accurate.
  const [loading, startLoad] = useTransition();
  const [loadError, setLoadError] = useState<string | null>(null);

  // Edit-mode data.
  const [config, setConfig] = useState<NodeProjectConfig | null>(null);
  const [nodeVersions, setNodeVersions] = useState<string[]>([]);

  // Create-mode data.
  const [preEnv, setPreEnv] = useState<ProjectPreEnv | null>(null);
  const [cwd, setCwd] = useState('');
  const [scriptsLoading, startScriptsLoad] = useTransition();
  const [scriptsError, setScriptsError] = useState<string | null>(null);

  // Shared controlled fields.
  const [runScripts, setRunScripts] = useState<RunScript[]>([]);
  const [script, setScript] = useState('');
  const [powerOn, setPowerOn] = useState(false);
  const [bindExtranet, setBindExtranet] = useState(false);

  const [result, setResult] = useState<ProjectMutResult>(INITIAL);
  const [pending, startSubmit] = useTransition();

  function resetState() {
    setLoadError(null);
    setConfig(null);
    setNodeVersions([]);
    setPreEnv(null);
    setCwd('');
    setScriptsError(null);
    setRunScripts([]);
    setScript('');
    setPowerOn(false);
    setBindExtranet(false);
    setResult(INITIAL);
  }

  function loadFormData() {
    setLoadError(null);
    startLoad(async () => {
      if (mode === 'edit' && projectName) {
        const res = await getProjectEditDataAction(serverId, projectName);
        if (!res.ok) {
          setLoadError(res.message);
          return;
        }
        setConfig(res.config);
        // Keep the current script selectable even if get_run_list failed.
        const scripts =
          res.runScripts.length > 0
            ? res.runScripts
            : res.config.script
              ? [{key: res.config.script, command: ''}]
              : [];
        setRunScripts(scripts);
        setScript(res.config.script);
        const versions =
          res.nodeVersions.length > 0
            ? res.nodeVersions
            : res.config.nodejsVersion
              ? [res.config.nodejsVersion]
              : [];
        setNodeVersions(versions);
        setPowerOn(res.config.powerOn);
      } else {
        const res = await getProjectCreateEnvAction(serverId);
        if (!res.ok) {
          setLoadError(res.message);
          return;
        }
        setPreEnv(res.preEnv);
      }
    });
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      resetState();
      loadFormData();
    } else {
      resetState();
    }
  }

  function loadCommands(pathArg?: string) {
    const path = (pathArg ?? cwd).trim();
    if (!path) return;
    setScriptsError(null);
    startScriptsLoad(async () => {
      const res = await getRunListAction(serverId, path);
      if (res.ok) {
        setRunScripts(res.scripts);
        setScript(res.scripts[0]?.key ?? '');
      } else {
        setRunScripts([]);
        setScript('');
        setScriptsError(res.message);
      }
    });
  }

  // Picking a folder fills the path and loads its package.json scripts.
  function onPickDirectory(picked: string) {
    setCwd(picked);
    loadCommands(picked);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const action = mode === 'create' ? createProjectAction : modifyProjectAction;
    startSubmit(async () => {
      const res = await action(serverId, fd);
      setResult(res);
      if (res.ok) {
        toast.success(t(res.message ?? 'saved'));
        setOpen(false);
        resetState();
        onDone();
      } else if (res.error !== 'validation') {
        toast.error(res.error);
      }
    });
  }

  const fieldErr = (name: string): string | undefined =>
    !result.ok && result.fieldErrors ? result.fieldErrors[name]?.[0] : undefined;

  const scriptOptions = runScripts;
  // Render the form only once its data is loaded, so the uncontrolled fields'
  // defaultValue is set once at mount and never changes (avoids Base UI's
  // "changing the default value of an uncontrolled field" warning).
  const dataReady = mode === 'edit' ? config !== null : preEnv !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? t('add') : t('edit')}</DialogTitle>
          <DialogDescription>
            {mode === 'edit' && config ? config.name : t('formHint')}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('loading')}
          </div>
        ) : loadError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
            <p className="font-medium">{t('loadFailed')}</p>
            <p className="mt-1 text-xs opacity-80">{loadError}</p>
          </div>
        ) : dataReady ? (
          <form onSubmit={onSubmit} className="space-y-4">
            {mode === 'edit' && config ? (
              <>
                <input type="hidden" name="name" value={config.name} />
                <input type="hidden" name="cwd" value={config.cwd} />
              </>
            ) : null}
            <input type="hidden" name="powerOn" value={powerOn ? 'true' : 'false'} />
            {mode === 'create' ? (
              <input type="hidden" name="bindExtranet" value={bindExtranet ? 'true' : 'false'} />
            ) : null}

            {!result.ok && result.error && result.error !== 'validation' ? (
              <p className="text-sm text-destructive" role="alert">
                {result.error}
              </p>
            ) : null}

            {/* Two-column layout: long fields span both columns, short ones pair up. */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Name */}
              {mode === 'create' ? (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="pf-name">{t('name')}</Label>
                  <Input id="pf-name" name="name" required autoComplete="off" />
                  {fieldErr('name') ? <p className="text-xs text-destructive">{fieldErr('name')}</p> : null}
                </div>
              ) : config ? (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>{t('name')}</Label>
                  <p className="text-sm font-medium">{config.name}</p>
                </div>
              ) : null}

              {/* Path (create only) */}
              {mode === 'create' ? (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="pf-cwd">{t('path')}</Label>
                  <div className="flex gap-2">
                    <Input
                      id="pf-cwd"
                      name="cwd"
                      value={cwd}
                      onChange={(e) => setCwd(e.target.value)}
                      placeholder="/www/node-projects/myapp"
                      required
                      autoComplete="off"
                    />
                    <DirectoryPickerDialog
                      serverId={serverId}
                      initialPath={cwd}
                      onSelect={onPickDirectory}
                      trigger={
                        <Button type="button" variant="outline" title={t('browse')}>
                          <FolderOpen className="size-4" />
                          <span className="sr-only">{t('browse')}</span>
                        </Button>
                      }
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!cwd.trim() || scriptsLoading}
                      onClick={() => loadCommands()}
                    >
                      {scriptsLoading ? <Loader2 className="size-4 animate-spin" /> : t('loadCommands')}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">{t('pathHint')}</p>
                  {fieldErr('cwd') ? <p className="text-xs text-destructive">{fieldErr('cwd')}</p> : null}
                  {scriptsError ? <p className="text-xs text-destructive">{scriptsError}</p> : null}
                </div>
              ) : null}

              {/* Start command */}
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="pf-script">{t('startCommand')}</Label>
                <select
                  id="pf-script"
                  name="script"
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                  className={SELECT_CLASS}
                  required
                  disabled={scriptOptions.length === 0}
                >
                  {scriptOptions.length === 0 ? (
                    <option value="">{mode === 'create' ? t('loadCommandsFirst') : t('noScripts')}</option>
                  ) : (
                    scriptOptions.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.command ? `${s.key} — ${s.command}` : s.key}
                      </option>
                    ))
                  )}
                </select>
                <p className="text-xs text-muted-foreground">{t('startCommandHint')}</p>
                {fieldErr('script') ? <p className="text-xs text-destructive">{fieldErr('script')}</p> : null}
              </div>

              {/* Port */}
              <div className="space-y-1.5">
                <Label htmlFor="pf-port">{t('port')}</Label>
                <Input
                  id="pf-port"
                  name="port"
                  type="number"
                  min={1}
                  max={65535}
                  defaultValue={mode === 'edit' && config?.port != null ? config.port : undefined}
                  required
                  autoComplete="off"
                />
                {fieldErr('port') ? <p className="text-xs text-destructive">{fieldErr('port')}</p> : null}
              </div>

              {/* Node version */}
              <div className="space-y-1.5">
                <Label htmlFor="pf-node">{t('nodeVersion')}</Label>
                <select
                  id="pf-node"
                  name="nodejsVersion"
                  className={SELECT_CLASS}
                  defaultValue={mode === 'edit' ? (config?.nodejsVersion ?? '') : (preEnv?.nodejsVersions[0] ?? '')}
                  required
                >
                  {(mode === 'edit' ? nodeVersions : (preEnv?.nodejsVersions ?? [])).map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
                {fieldErr('nodejsVersion') ? (
                  <p className="text-xs text-destructive">{fieldErr('nodejsVersion')}</p>
                ) : null}
              </div>

              {/* Run user */}
              <div className="space-y-1.5">
                <Label htmlFor="pf-user">{t('runUser')}</Label>
                {mode === 'create' && preEnv && preEnv.userList.length > 0 ? (
                  <select
                    id="pf-user"
                    name="runUser"
                    className={SELECT_CLASS}
                    defaultValue={preEnv.userList.includes('www') ? 'www' : preEnv.userList[0]}
                    required
                  >
                    {preEnv.userList.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id="pf-user"
                    name="runUser"
                    defaultValue={config?.runUser ?? 'www'}
                    required
                    autoComplete="off"
                  />
                )}
                {fieldErr('runUser') ? <p className="text-xs text-destructive">{fieldErr('runUser')}</p> : null}
              </div>

              {/* Memory limit (create only) */}
              {mode === 'create' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="pf-mem">{t('memoryLimit')}</Label>
                  <Input
                    id="pf-mem"
                    name="maxMemoryLimit"
                    type="number"
                    min={0}
                    max={preEnv?.maximumMemory || undefined}
                    defaultValue={preEnv ? Math.min(4096, preEnv.maximumMemory || 4096) : 4096}
                    required
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('memoryLimitHint', {max: preEnv?.maximumMemory ?? 0})}
                  </p>
                  {fieldErr('maxMemoryLimit') ? (
                    <p className="text-xs text-destructive">{fieldErr('maxMemoryLimit')}</p>
                  ) : null}
                </div>
              ) : null}

              {/* Note */}
              <div className="space-y-1.5">
                <Label htmlFor="pf-note">{t('note')}</Label>
                <Input id="pf-note" name="note" defaultValue={config?.note ?? ''} autoComplete="off" />
              </div>

              {/* Domains (create only) */}
              {mode === 'create' ? (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="pf-domains">{t('domains')}</Label>
                  <textarea
                    id="pf-domains"
                    name="domains"
                    className={TEXTAREA_CLASS}
                    rows={2}
                    placeholder="myapp.example.com:80"
                  />
                  <p className="text-xs text-muted-foreground">{t('domainsHint')}</p>
                </div>
              ) : null}

              {/* Env (create only) */}
              {mode === 'create' ? (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="pf-env">{t('env')}</Label>
                  <textarea
                    id="pf-env"
                    name="env"
                    className={TEXTAREA_CLASS}
                    rows={3}
                    placeholder="KEY=value"
                  />
                  <p className="text-xs text-muted-foreground">{t('envHint')}</p>
                </div>
              ) : null}

              {/* Bind extranet (create only) */}
              {mode === 'create' ? (
                <div className="flex items-center gap-2">
                  <Switch id="pf-bind" checked={bindExtranet} onCheckedChange={setBindExtranet} />
                  <Label htmlFor="pf-bind">{t('bindExtranet')}</Label>
                </div>
              ) : null}

              {/* Autostart */}
              <div className="flex items-center gap-2">
                <Switch id="pf-power" checked={powerOn} onCheckedChange={setPowerOn} />
                <Label htmlFor="pf-power">{t('autostart')}</Label>
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={pending || !script}>
                {mode === 'create' ? t('create') : t('save')}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
