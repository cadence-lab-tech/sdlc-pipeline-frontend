import {useEffect, useId, useState} from 'react';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {TextArea} from '@/components/fields';
import {ConfirmButton, Note, Token} from '@/components/kit';

import {ApiError, api} from '../../api/client';
import type {AgentSettingsView} from '../../api/types';
import {Failure} from '../Feedback';
import {DiffPanel} from './DiffView';
import {fieldElement} from './dom';
import {TableEditor} from './TableEditor';
import {Warnings} from './VersionView';
import {
  ACTIVATION_RUNS_LINE,
  P,
  activationConflict,
  activationConflictText,
  activationFirstLine,
  activationPreview,
  activationToast,
  canonicalDocument,
  changelogOf,
  denyReason,
  denyReasonText,
  diffDocuments,
  errorPath,
  fieldPaths,
  normalizeView,
  parseJsonDocument,
  pathLabel,
  putBody,
  sameDocument,
  summaryText,
  type Doc,
  type JsonParse,
} from './rules';

// Черновик: редактор «Таблица / JSON / Разница», сохранение, проверка сервера,
// активация и удаление (design.spec §4–§7). Буфер — разобранный документ;
// сервер проверяет, клиент — нет.

export type Notice = {tone: 'info' | 'warning'; title: string; description?: string};

type Failed =
  | {kind: 'invalid'; op: 'save' | 'activate'; message: string; path: string | undefined}
  | {kind: 'deny'; message: string; reason: string | undefined}
  | {kind: 'failure'; error: ApiError};

type Tab = 'table' | 'json' | 'diff';

function asApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError('internal', String(err));
}

export function DraftEditor({
  projectKey,
  server,
  active,
  onReload,
  onNotice,
  onOrphan,
  onActivated,
  onDiscarded,
  onDirtyChange,
}: {
  projectKey: string;
  // Черновик, каким его отдал сервер при последнем чтении.
  server: AgentSettingsView;
  active: AgentSettingsView | null;
  onReload: () => void;
  onNotice: (n: Notice) => void;
  onOrphan: (buffer: {doc: Doc; changelog: string}) => void;
  onActivated: () => void;
  onDiscarded: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [base, setBase] = useState(server);
  const [doc, setDoc] = useState<Doc>(() => structuredClone(server.document) as Doc);
  const [changelog, setChangelog] = useState(changelogOf(server));
  const [tab, setTab] = useState<Tab>('table');
  const [jsonText, setJsonText] = useState(() => canonicalDocument(server.document));
  const [jsonError, setJsonError] = useState<Extract<JsonParse, {ok: false}> | null>(null);
  const [dup, setDup] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState<'save' | 'activate' | 'discard' | null>(null);
  const [failed, setFailed] = useState<Failed | null>(null);
  const [announce, setAnnounce] = useState('');
  const [incoming, setIncoming] = useState<AgentSettingsView | null>(null);
  const [seen, setSeen] = useState(server);
  const hintId = useId();

  const dirty = !sameDocument(doc, base.document) || changelog !== changelogOf(base);

  const adopt = (view: AgentSettingsView) => {
    setBase(view);
    setDoc(structuredClone(view.document) as Doc);
    setChangelog(changelogOf(view));
    setJsonText(canonicalDocument(view.document));
    setJsonError(null);
    setDup(false);
    setIncoming(null);
    setResetKey((k) => k + 1);
  };

  // Сервер отдал черновик заново (перечитывание раздела, гонка). Свои правки
  // не затираем: если черновик сменился, а правки есть, — предупреждение.
  if (server !== seen) {
    setSeen(server);
    if (server.version !== base.version || server.sha256 !== base.sha256) {
      if (dirty) setIncoming(server);
      else adopt(server);
    } else {
      setBase(server);
    }
  }

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  // Первое поле с ошибкой получает фокус.
  useEffect(() => {
    if (failed?.kind === 'invalid' && failed.path !== undefined) fieldElement(failed.path)?.focus();
  }, [failed]);

  const errorAt = (path: string): string | undefined =>
    failed?.kind === 'invalid' && failed.path === path ? failed.message : undefined;

  const touch = (path?: string) => {
    if (failed?.kind === 'invalid' && path !== undefined && failed.path === path) setFailed(null);
  };

  const edit = (next: Doc, touched?: string) => {
    setDoc(next);
    touch(touched);
  };

  const failure = (err: unknown, op: 'save' | 'activate' | 'discard') => {
    const e = asApiError(err);
    if (e.code === 'invalid_input' && op !== 'discard') {
      setFailed({kind: 'invalid', op, message: e.message, path: errorPath(e.details)});
      toast.error(op === 'save' ? 'Черновик не сохранён' : 'Версия не активирована');
      setAnnounce(op === 'save' ? 'Черновик не сохранён' : 'Версия не активирована');
    } else if (e.code === 'forbidden') {
      setFailed({kind: 'deny', message: e.message, reason: denyReason(e.details)});
    } else if (e.code === 'not_found') {
      if (op === 'save') onOrphan({doc, changelog});
      else if (op === 'activate') onNotice({tone: 'info', title: 'Черновика уже нет. Раздел перечитан.'});
      else toast.info('Черновика уже нет');
      onReload();
    } else if (e.code === 'conflict') {
      if (op === 'activate') {
        onNotice({
          tone: 'warning',
          title: 'Черновик изменился',
          description: activationConflictText(activationConflict(e.details)),
        });
      } else {
        onNotice({tone: 'warning', title: e.message});
      }
      onReload();
    } else {
      setFailed({kind: 'failure', error: e});
    }
  };

  const save = async () => {
    setBusy('save');
    setFailed(null);
    try {
      const view = normalizeView(await api.agentSettingsPutDraft(projectKey, putBody(doc, changelog)));
      adopt(view);
      toast.success('Черновик сохранён');
      setAnnounce('Черновик сохранён');
    } catch (err) {
      failure(err, 'save');
    } finally {
      setBusy(null);
    }
  };

  const activate = async () => {
    setFailed(null);
    setBusy('activate');
    try {
      const res = await api.agentSettingsActivate(projectKey, base.version);
      toast.success(activationToast(base.version, res.retired));
      onActivated();
    } catch (err) {
      failure(err, 'activate');
    } finally {
      setBusy(null);
    }
  };

  const discard = async () => {
    setFailed(null);
    setBusy('discard');
    try {
      await api.agentSettingsDiscardDraft(projectKey);
      toast.success('Черновик удалён');
      onDiscarded();
    } catch (err) {
      failure(err, 'discard');
    } finally {
      setBusy(null);
    }
  };

  const changeTab = (next: string) => {
    if (jsonError || dup) return;
    const to = next as Tab;
    if (to === 'json') setJsonText(canonicalDocument(doc));
    if (tab === 'json' && to !== 'json') setResetKey((k) => k + 1);
    setTab(to);
  };

  const onJson = (text: string) => {
    setJsonText(text);
    const parsed = parseJsonDocument(text);
    if (parsed.ok) {
      setJsonError(null);
      setDoc(parsed.doc);
    } else {
      setJsonError(parsed);
    }
  };

  const blocked = jsonError !== null || dup;
  const locked = busy !== null;
  const canSave = dirty && !blocked && !locked;
  const rows = diffDocuments(active?.document ?? {}, base.document);
  const preview = activationPreview(rows);
  const hint = dirty || blocked ? 'Сначала сохраните правки.' : undefined;
  const pathHasField = (path: string | undefined) =>
    path !== undefined && tab === 'table' && fieldPaths(doc).has(path);

  return (
    <Card className="gap-3 p-4" data-draft data-state="draft" data-version={base.version} data-dirty={dirty}>
      <div className="flex flex-wrap items-center gap-2">
        <h3
          id="agent-settings-draft-title"
          tabIndex={-1}
          className="text-sm font-semibold outline-none">
          Черновик · версия {base.version}
        </h3>
        {dirty ? <Token color="orange" label="изменено" /> : null}
        <span role="status" className="sr-only">
          {dirty ? 'Есть несохранённые правки' : ''}
        </span>
      </div>
      <p className="text-muted-foreground text-xs" title={base.sha256}>
        sha256 {base.sha256.slice(0, 7)}
        {base.created_by ? ` · заведён ${base.created_by}` : ''}
      </p>
      <Warnings warnings={base.warnings} />

      {incoming ? (
        <Note
          tone="warning"
          title="Черновик на сервере изменился"
          description="Его изменили в другой вкладке или из CLI. Ваши правки сохранены в форме; сохранение перезапишет серверный черновик.">
          <ConfirmButton
            variant="outline"
            title="Заменить правки серверным черновиком?"
            description="Несохранённые правки пропадут."
            confirmLabel="Заменить"
            confirmVariant="default"
            onConfirm={() => adopt(incoming)}>
            Взять серверный
          </ConfirmButton>
        </Note>
      ) : null}

      <TextArea
        label="Changelog черновика (необязательно)"
        rows={2}
        value={changelog}
        isDisabled={locked}
        dataPath={P.changelog}
        error={errorAt(P.changelog)}
        onChange={(v) => {
          setChangelog(v);
          touch(P.changelog);
        }}
      />

      {failed?.kind === 'invalid' ? (
        <div role="alert">
          <Note
            tone="error"
            title={failed.op === 'save' ? 'Черновик не сохранён' : 'Версия не активирована'}
            description={
              failed.op === 'save'
                ? 'Сервер отклонил документ. Черновик на сервере остался прежним, ваши правки — в форме. Сервер показывает по одной ошибке: после исправления сохраните снова.'
                : 'Сервер отклонил документ. Активной осталась прежняя версия. Сервер показывает по одной ошибке: исправьте, сохраните и активируйте снова.'
            }>
            <p data-error-message>{failed.message}</p>
            {failed.path !== undefined ? <p className="font-mono text-xs">Путь: {pathLabel(failed.path)}</p> : null}
            {pathHasField(failed.path) ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={() => failed.path !== undefined && fieldElement(failed.path)?.focus()}>
                Перейти к полю
              </Button>
            ) : null}
          </Note>
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList>
          <TabsTrigger value="table" aria-disabled={blocked && tab !== 'table'} title={blockTitle(jsonError, dup)}>
            Таблица
          </TabsTrigger>
          <TabsTrigger value="json" aria-disabled={blocked && tab !== 'json'} title={blockTitle(jsonError, dup)}>
            JSON
          </TabsTrigger>
          <TabsTrigger value="diff" aria-disabled={blocked && tab !== 'diff'} title={blockTitle(jsonError, dup)}>
            Разница
          </TabsTrigger>
        </TabsList>
        <TabsContent value="table" className="pt-2">
          <TableEditor
            key={resetKey}
            doc={doc}
            disabled={locked}
            onChange={edit}
            errorAt={errorAt}
            onDuplicates={setDup}
          />
        </TabsContent>
        <TabsContent value="json" className="space-y-2 pt-2">
          <TextArea
            label="Документ (JSON)"
            rows={24}
            value={jsonText}
            isDisabled={locked}
            isInvalid={jsonError !== null}
            dataPath="document"
            className="font-mono text-xs"
            onChange={onJson}
          />
          {jsonError ? (
            <div role="alert">
              <Note tone="error" title={jsonError.title} description={jsonError.detail} />
            </div>
          ) : null}
        </TabsContent>
        <TabsContent value="diff" className="pt-2">
          <DiffPanel active={active} other={base} kind="draft" unsavedNote={dirty} />
        </TabsContent>
      </Tabs>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" data-action="save" disabled={!canSave} onClick={() => void save()}>
          Сохранить
        </Button>
        <ConfirmButton
          variant="ghost"
          size="default"
          disabled={!dirty || locked}
          title="Сбросить правки?"
          description="Несохранённые правки пропадут; черновик на сервере останется как есть."
          confirmLabel="Сбросить"
          triggerProps={{'data-action': 'reset'}}
          onConfirm={() => adopt(base)}>
          Сбросить правки
        </ConfirmButton>
        <span className="flex-1" />
        <ConfirmButton
          variant="default"
          size="default"
          disabled={dirty || blocked || locked}
          title={`Активировать версию ${base.version}?`}
          confirmLabel="Активировать"
          confirmVariant="default"
          triggerProps={{'data-action': 'activate', 'aria-describedby': hint ? hintId : undefined}}
          description={
            <>
              <span className="block">{activationFirstLine(base.version, active?.version ?? null)}</span>
              <span className="mt-1 block">
                {ACTIVATION_RUNS_LINE} версию {base.version}.
              </span>
              <span className="mt-1 block" data-activation-changes>
                {rows.length === 0
                  ? 'Документ не отличается от активной версии: изменится только номер.'
                  : `Изменения: ${summaryText(rows).toLowerCase()}`}
              </span>
              {preview.lines.map((l) => (
                <span key={l} className="block font-mono text-xs break-all">
                  {l}
                </span>
              ))}
              {preview.more > 0 ? (
                <span className="block">…и ещё {preview.more}, см. вкладку «Разница»</span>
              ) : null}
            </>
          }
          onConfirm={activate}>
          Активировать
        </ConfirmButton>
        <ConfirmButton
          variant="ghost"
          size="default"
          disabled={locked}
          title={`Удалить черновик версии ${base.version}?`}
          description="Черновик и несохранённые правки пропадут. Активная версия не изменится. Номер может достаться следующему черновику."
          confirmLabel="Удалить"
          triggerProps={{'data-action': 'discard'}}
          onConfirm={discard}>
          Удалить черновик
        </ConfirmButton>
      </div>
      {hint ? (
        <p id={hintId} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
      <div aria-live="polite" className="sr-only">
        {announce}
      </div>

      {failed?.kind === 'deny' ? <DenyNote message={failed.message} reason={failed.reason} /> : null}
      {failed?.kind === 'failure' ? <Failure error={failed.error} /> : null}
    </Card>
  );
}

function blockTitle(jsonError: unknown, dup: boolean): string | undefined {
  if (jsonError) return 'Сначала исправьте JSON';
  if (dup) return 'Сначала исправьте дубль id модели в прайсе';
  return undefined;
}

// Отказ записи: текст сервера как есть и строка по причине (design.spec §3.2).
export function DenyNote({message, reason}: {message: string; reason: string | undefined}) {
  const extra = denyReasonText(reason === 'level' || reason === 'human_action' ? reason : undefined);
  return (
    <div role="alert" data-deny={reason ?? ''}>
      <Note tone="error" title="Нет права на это действие" description={message}>
        {extra ? <p>{extra}</p> : null}
      </Note>
    </div>
  );
}
