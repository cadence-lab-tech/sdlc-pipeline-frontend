// Библиотека инструкций на «Пайплайне» (CLAB-351, решение 0069, design.spec
// CLAB-351 §4): раздел в обзоре, панель инструкции, формы «Новая
// инструкция» и «Новая версия», диалоги «Обновить в ролях», «В библиотеку» и
// «Добавить из библиотеки». Правила — library.ts без React; здесь разметка и
// запросы. Ключи инструкций и ролей приходят данными.
import {useEffect, useMemo, useState} from 'react';
import {BookMarked, ChevronRight, Info, Plus, UserRound} from 'lucide-react';
import {toast} from 'sonner';

import {cn} from '@/lib/utils';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Checkbox} from '@/components/ui/checkbox';
import {Label} from '@/components/ui/label';
import {Skeleton} from '@/components/ui/skeleton';
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';
import {Selector, TextArea, TextInput} from '@/components/fields';
import {EmptyState, Markdown, Note, Row, RowList, Section, Spinner, Timestamp, Token} from '@/components/kit';

import {ApiError, api} from '../../api/client';
import type {
  ApplyResult,
  Instruction,
  InstructionDetail,
  InstructionUsage,
  InstructionVersion,
  RoleDocument,
  RoleDocumentPin,
} from '../../api/types';
import {useResource} from '../../api/useResource';
import {Failure, Loading} from '../Feedback';
import {DiffEntry} from './DocumentDiff';
import {
  CANDIDATE_TOKEN,
  KEY_RULE,
  allCurrent,
  applyButtonLabel,
  byteLength,
  candidateLine,
  candidateState,
  chosen,
  conflictRole,
  docName,
  keyFromDocName,
  keyIsBad,
  kindChoices,
  laggingCount,
  laggingLabel,
  newerLabel,
  pinLabel,
  pinnedCaption,
  pinnedOn,
  plainNote,
  repick,
  unchangedVersion,
  usageState,
  versionOptionLabel,
} from './libraryRules';
import {diffVersions, lineDiff} from './roleDocs';

const toApiError = (err: unknown) => (err instanceof ApiError ? err : new ApiError('internal', String(err)));
// Сервер без библиотеки: 404 маршрута, а не «нет такой инструкции».
const noLibrary = (e: ApiError) => (e.details as {library?: boolean} | undefined)?.library === false;
// Сколько строк «Где используется» видно до «Показать все».
const USAGE_SHOWN = 5;

// Метки закрепления: «библиотека: git v1» (коротко «git v1») и «есть v2».
export function PinTokens({pin, latest, short}: {pin: RoleDocumentPin; latest?: number; short?: boolean}) {
  const newer = newerLabel(pin, latest);
  return (
    <>
      <Token color="blue" label={pinLabel(pin, short)} className="max-w-full" />
      {newer ? <Token color="orange" label={newer} /> : null}
    </>
  );
}

// ── E1: раздел в обзоре ─────────────────────────────────────────────────────

export function LibrarySection({
  projectKey,
  canEdit,
  reloadKey,
  onOpen,
  onNew,
}: {
  projectKey: string;
  canEdit: boolean;
  reloadKey?: unknown;
  onOpen: (key: string) => void;
  onNew: () => void;
}) {
  const r = useResource(() => api.listInstructions(projectKey), [projectKey, reloadKey]);
  const list = r.data;
  return (
    <Section
      title="Библиотека инструкций"
      description="Общие правила, которые роли берут версией"
      actions={
        canEdit && !(r.error && noLibrary(r.error)) ? (
          <Button size="sm" variant="secondary" onClick={onNew} data-library-new>
            <Plus /> Новая инструкция
          </Button>
        ) : undefined
      }>
      <div data-library>
        {r.error ? (
          noLibrary(r.error) ? (
            <div data-library-absent>
              <Note
                tone="info"
                title="Библиотеки на этом сервере нет"
                description={`${r.error.message}. Роли и их документы работают как раньше`}
              />
            </div>
          ) : (
            <Failure error={r.error} title="Библиотека не загрузилась" reload={r.reload} />
          )
        ) : !list ? (
          <div role="status" aria-label="Загружаем библиотеку" className="space-y-2" data-library-loading>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : list.length === 0 ? (
          <div data-library-empty>
            <EmptyState
              title="Инструкций нет"
              description="Правило, повторяющееся в нескольких ролях, можно вынести в библиотеку: «В библиотеку» у документа роли или «Новая инструкция». Роли от этого не меняются"
            />
          </div>
        ) : (
          <RowList>
            {list.map((i) => (
              <LibraryRow key={i.key} inst={i} onOpen={() => onOpen(i.key)} />
            ))}
          </RowList>
        )}
      </div>
    </Section>
  );
}

function LibraryRow({inst, onOpen}: {inst: Instruction; onOpen: () => void}) {
  return (
    <div data-library-row={inst.key}>
      <Row
        onClick={onOpen}
        start={<BookMarked className="text-muted-foreground size-4" aria-hidden />}
        end={
          <>
            {inst.lagging_roles ? <Token color="orange" label={laggingLabel(inst.lagging_roles)} /> : null}
            <span className="text-muted-foreground text-xs">v{inst.latest_version}</span>
          </>
        }>
        <p className="truncate font-medium" title={inst.name}>
          {inst.name}
        </p>
        <p className="text-muted-foreground truncate text-xs">
          <span className="font-mono">{inst.key}</span> · {pinnedCaption(inst)}
        </p>
      </Row>
    </div>
  );
}

// ── E3: панель инструкции ───────────────────────────────────────────────────

export type InstructionNotice = {kind: 'created' | 'version'; key: string; version: number};

export function InstructionPanel({
  projectKey,
  instKey,
  version,
  view,
  canEdit,
  reloadKey,
  notice,
  onVersion,
  onView,
  onRole,
  onApply,
  onNewVersion,
  onBackToLibrary,
  onChanged,
}: {
  projectKey: string;
  instKey: string;
  // Раскрытая версия из адреса (?iv=); нет или нет такой — последняя.
  version?: number;
  view: 'docs' | 'diff';
  canEdit: boolean;
  reloadKey?: unknown;
  // Плашка после заведения инструкции или версии.
  notice?: InstructionNotice;
  onVersion: (v?: number) => void;
  onView: (v: 'docs' | 'diff') => void;
  onRole: (key: string) => void;
  onApply: () => void;
  onNewVersion: (detail: InstructionDetail) => void;
  onBackToLibrary: () => void;
  onChanged: () => void;
}) {
  const r = useResource(() => api.getInstruction(projectKey, instKey), [projectKey, instKey, reloadKey]);
  const detail = r.data;
  const latestN = detail?.instruction.latest_version ?? 0;
  const shownN = detail && version && version !== latestN && detail.versions.some((v) => v.version === version) ? version : latestN;
  const other = useResource(
    () => (detail && shownN !== latestN ? api.getInstruction(projectKey, instKey, shownN) : Promise.resolve(undefined)),
    [projectKey, instKey, shownN, latestN, reloadKey],
  );
  const [all, setAll] = useState(false);
  const [editing, setEditing] = useState(false);

  if (r.error) {
    const missing = r.error.httpStatus === 404 && !noLibrary(r.error);
    return (
      <div className="space-y-3 p-4" data-instruction-panel={instKey} data-instruction-error>
        <Failure
          error={r.error}
          title={missing ? 'Инструкции нет' : 'Инструкция не загрузилась'}
          reload={r.error.httpStatus === 404 ? undefined : r.reload}
        />
        {r.error.httpStatus === 404 ? (
          <Button variant="secondary" onClick={onBackToLibrary}>
            К библиотеке
          </Button>
        ) : null}
      </div>
    );
  }
  if (!detail) return <Loading />;

  const {instruction: inst, usage, versions} = detail;
  const shownDetail = shownN === latestN ? detail : other.data;
  const lagging = laggingCount(usage, inst.latest_version);
  const rows = all ? usage : usage.slice(0, USAGE_SHOWN);

  return (
    <div className="space-y-5 p-4" data-instruction-panel={inst.key}>
      {notice && notice.key === inst.key ? (
        <div data-created-banner={notice.kind}>
          <Note
            tone="success"
            title={notice.kind === 'created' ? `Инструкция ${inst.key} заведена` : `Версия ${notice.version} заведена`}
            description={
              notice.kind === 'created'
                ? 'Роли не изменились: документы в них пока обычные.'
                : lagging
                  ? `Роли не изменились. Отстают от v${notice.version}: ${lagging}.`
                  : 'Роли не изменились: ни одна не закрепила предыдущую версию.'
            }>
            {canEdit ? (
              <Button size="sm" variant="secondary" onClick={onApply}>
                Обновить в ролях
              </Button>
            ) : null}
          </Note>
        </div>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <h2 className="text-lg font-semibold break-words">{inst.name}</h2>
          <p className="text-muted-foreground text-xs break-all">
            <span className="font-mono">{inst.key}</span>
            {inst.summary ? ` · ${inst.summary}` : ''}
          </p>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={onApply} data-instruction-apply>
              Обновить в ролях
            </Button>
            <Button size="sm" onClick={() => onNewVersion(detail)} data-instruction-new-version>
              Новая версия
            </Button>
          </div>
        ) : null}
      </div>
      {canEdit ? (
        editing ? (
          <MetaForm
            projectKey={projectKey}
            inst={inst}
            onDone={(saved) => {
              setEditing(false);
              if (saved) {
                r.reload();
                onChanged();
              }
            }}
          />
        ) : (
          <div>
            <Button size="xs" variant="ghost" onClick={() => setEditing(true)} data-instruction-meta>
              Название и описание
            </Button>
          </div>
        )
      ) : null}

      <Section title={`Где используется (${usage.length})`} description={`Последние версии ролей с документом ${docName(inst.key)}`}>
        <div className="space-y-2" data-instruction-usage>
          {usage.length === 0 ? (
            <p className="text-muted-foreground text-sm" data-usage-empty>
              Ни у одной роли нет документа {docName(inst.key)}. Добавить инструкцию в роль: «Новая версия» роли → «Из
              библиотеки»
            </p>
          ) : (
            <>
              {lagging ? (
                <p className="text-sm" data-usage-lagging={lagging}>
                  Отстают от v{inst.latest_version}: <span className="font-medium">{lagging}</span>. Роли не меняются, пока
                  их не обновят
                </p>
              ) : null}
              <RowList>
                {rows.map((u) => (
                  <UsageRow key={u.role_key} u={u} inst={inst} onRole={onRole} />
                ))}
              </RowList>
              {usage.length > USAGE_SHOWN ? (
                <Button size="sm" variant="ghost" onClick={() => setAll(!all)}>
                  {all ? 'Свернуть' : `Показать все (${usage.length})`}
                </Button>
              ) : null}
            </>
          )}
        </div>
      </Section>

      <div className="space-y-2" data-instruction-versions>
        {versions.map((v) =>
          v.version === shownN ? (
            <VersionCard
              key={v.version}
              inst={inst}
              head={v}
              detail={shownDetail}
              error={shownN === latestN ? undefined : other.error}
              onRetry={other.reload}
              usage={usage}
              view={view}
              onView={onView}
              onCollapse={() => onVersion(undefined)}
            />
          ) : (
            <button
              key={v.version}
              type="button"
              onClick={() => onVersion(v.version === latestN ? undefined : v.version)}
              aria-expanded={false}
              data-inst-version-row={v.version}
              className="hover:bg-accent/60 flex min-h-10 w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm">
              <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
              <span className="font-medium whitespace-nowrap">Версия {v.version}</span>
              {v.version === latestN ? <Badge>актуальная</Badge> : null}
              <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">{v.changelog ?? ''}</span>
              <Timestamp value={v.created_at} format="relative" className="shrink-0 text-xs" />
            </button>
          ),
        )}
      </div>
    </div>
  );
}

function UsageRow({u, inst, onRole}: {u: InstructionUsage; inst: Instruction; onRole: (key: string) => void}) {
  const state = usageState(u, inst.latest_version);
  return (
    <div data-usage-row={u.role_key} data-usage-pinned={u.pinned_version ?? 'no'}>
      <Row
        onClick={() => onRole(u.role_key)}
        start={<UserRound className="text-muted-foreground size-4" aria-hidden />}
        end={
          <>
            {state === 'plain' ? (
              <Token label="не закреплён" className="border-dashed" />
            ) : state === 'lag' ? (
              <PinTokens pin={{key: inst.key, version: u.pinned_version!}} latest={inst.latest_version} short />
            ) : (
              <Token color="green" label={`${inst.key} v${u.pinned_version} · актуальна`} />
            )}
            <span className="text-muted-foreground text-xs">v{u.role_version}</span>
          </>
        }>
        <p className="truncate font-medium">{u.role_name}</p>
        <p className="text-muted-foreground truncate font-mono text-xs">{u.role_key}</p>
      </Row>
    </div>
  );
}

function VersionCard({
  inst,
  head,
  detail,
  error,
  onRetry,
  usage,
  view,
  onView,
  onCollapse,
}: {
  inst: Instruction;
  head: InstructionVersion;
  detail?: InstructionDetail;
  error?: ApiError;
  onRetry: () => void;
  usage: InstructionUsage[];
  view: 'docs' | 'diff';
  onView: (v: 'docs' | 'diff') => void;
  onCollapse: () => void;
}) {
  const shown = detail?.version;
  const prev = detail?.previous;
  const on = pinnedOn(usage, head.version);
  const diffMode = view === 'diff' && head.version > 1;
  const name = docName(inst.key);
  const diff = useMemo(
    () =>
      shown && prev
        ? diffVersions(
            [{name, kind: prev.kind, position: 0, content: prev.content ?? '', sha256: prev.sha256}],
            [{name, kind: shown.kind, position: 0, content: shown.content ?? '', sha256: shown.sha256}],
          ).docs[0]
        : undefined,
    [shown, prev, name],
  );
  return (
    <Card className="gap-3 p-4" data-inst-version={head.version}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="font-semibold whitespace-nowrap" onClick={onCollapse} aria-label="Свернуть версию">
          Версия {head.version}
        </button>
        {head.version === inst.latest_version ? <Badge>актуальная</Badge> : null}
        <Token label={head.kind} />
        <Timestamp value={head.created_at} format="relative" className="ml-auto text-xs" />
      </div>
      <p className="text-muted-foreground text-sm">
        {head.changelog ?? 'без описания'}
        {head.created_by_handle ? ` · ${head.created_by_handle}` : ''}
      </p>
      <p className="text-xs" data-inst-version-roles>
        {on.length ? (
          <>
            <span className="text-muted-foreground">Закреплена в ролях: </span>
            {on.join(', ')}
          </>
        ) : (
          <span className="text-muted-foreground">Ни одна роль не закрепила эту версию</span>
        )}
      </p>
      {head.version > 1 ? (
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={diffMode ? 'diff' : 'docs'}
          onValueChange={(x) => x && onView(x as 'docs' | 'diff')}
          aria-label="Что показать"
          className="max-w-full flex-wrap"
          data-inst-view={diffMode ? 'diff' : 'text'}>
          <ToggleGroupItem value="docs">Текст</ToggleGroupItem>
          <ToggleGroupItem value="diff">Изменения против v{head.version - 1}</ToggleGroupItem>
        </ToggleGroup>
      ) : (
        <p className="text-muted-foreground text-xs" data-inst-version-first>
          Первая версия: сравнивать не с чем
        </p>
      )}
      {error ? (
        <Failure error={error} title={`Версия ${head.version} не загрузилась`} reload={error.httpStatus === 404 ? undefined : onRetry} />
      ) : !shown ? (
        <div role="status" aria-label="Загружаем версию" className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : diffMode && diff ? (
        <div className="space-y-2" data-inst-diff>
          <DiffEntry d={diff} />
        </div>
      ) : (
        <div className="max-h-96 overflow-y-auto rounded-md border px-3 py-2" data-inst-text>
          <Markdown>{shown.content ?? ''}</Markdown>
        </div>
      )}
    </Card>
  );
}

function MetaForm({projectKey, inst, onDone}: {projectKey: string; inst: Instruction; onDone: (saved: boolean) => void}) {
  const [name, setName] = useState(inst.name);
  const [summary, setSummary] = useState(inst.summary ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError>();
  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.updateInstruction(projectKey, inst.key, {name: name.trim(), summary: summary.trim()});
      toast.success(`Инструкция ${inst.key} сохранена`);
      onDone(true);
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="gap-3 p-3" data-meta-form>
      {error ? <Failure error={error} title="Не сохранено" /> : null}
      <TextInput label="Название" value={name} onChange={setName} isRequired isDisabled={busy} />
      <TextInput label="Описание" value={summary} onChange={setSummary} isDisabled={busy} />
      <p className="text-muted-foreground text-xs">Ключ {inst.key} и версии не меняются</p>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => onDone(false)} disabled={busy}>
          Отмена
        </Button>
        <Button size="sm" disabled={busy || !name.trim()} onClick={save}>
          {busy ? <Spinner /> : null} Сохранить
        </Button>
      </div>
    </Card>
  );
}

// ── E4, E5: формы «Новая инструкция» и «Новая версия» ───────────────────────

export function InstructionForm({
  projectKey,
  mode,
  detail,
  onCancel,
  onDone,
}: {
  projectKey: string;
  mode: 'create' | 'version';
  // Инструкция с последней версией и её текстом (для «Новая версия»).
  detail?: InstructionDetail;
  onCancel: () => void;
  onDone: (key: string, version: number) => void;
}) {
  const base = detail?.version;
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [kind, setKind] = useState(base?.kind ?? 'instructions');
  const [content, setContent] = useState(base?.content ?? '');
  const [changelog, setChangelog] = useState('');
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);

  const same = mode === 'version' && unchangedVersion(base, kind, content);
  const d = mode === 'version' && base && !same ? lineDiff(base.content ?? '', content) : undefined;
  const keyBad = keyIsBad(key);
  const ready = mode === 'create' ? Boolean(key && name.trim() && content.trim() && !keyBad) : Boolean(content.trim() && !same);

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (mode === 'create') {
        const out = await api.createInstruction(projectKey, {key, name: name.trim(), summary: summary.trim() || undefined, kind, content});
        toast.success(`Инструкция ${out.instruction.key} заведена, версия ${out.version.version}`);
        onDone(out.instruction.key, out.version.version);
      } else {
        const out = await api.createInstructionVersion(projectKey, detail!.instruction.key, {
          kind,
          content,
          changelog: changelog.trim() || undefined,
        });
        toast.success(`Версия ${out.version.version} инструкции ${out.instruction.key} создана`);
        onDone(out.instruction.key, out.version.version);
      }
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="@container space-y-4 p-4" data-instruction-form={mode}>
      <h2 className="text-lg font-semibold break-words">
        {mode === 'create' ? 'Новая инструкция' : `${detail!.instruction.name}: новая версия после v${base?.version}`}
      </h2>
      {error ? (
        <div className="space-y-1.5" role="alert" data-form-failure>
          <Failure error={error} title={mode === 'create' ? 'Инструкция не заведена' : 'Версия не создана'} />
          <p className="text-muted-foreground text-xs">Введённое осталось в форме: исправьте и сохраните ещё раз.</p>
        </div>
      ) : null}
      {mode === 'create' ? (
        <>
          <KeyField value={key} onChange={setKey} isDisabled={busy} />
          <TextInput label="Название" value={name} onChange={setName} isRequired isDisabled={busy} />
          <TextInput label="Описание" value={summary} onChange={setSummary} isDisabled={busy} />
        </>
      ) : null}
      <div className="grid gap-3 @sm:grid-cols-[170px_minmax(0,1fr)]">
        <Selector
          label="Тип"
          options={kindChoices(base?.kind).map((k) => ({value: k, label: k}))}
          value={kind}
          onChange={(k) => k && setKind(k)}
          isDisabled={busy}
        />
        {mode === 'version' ? <TextInput label="Что изменилось" value={changelog} onChange={setChangelog} isDisabled={busy} /> : null}
      </div>
      <div className="space-y-1.5">
        <TextArea
          id="instruction-content"
          label="Содержимое"
          value={content}
          onChange={setContent}
          rows={12}
          className="font-mono text-xs break-words"
        />
        <p className="text-muted-foreground flex flex-wrap justify-between gap-2 text-xs" aria-live="polite" data-form-counter>
          <span>{byteLength(content)} байт</span>
          {mode === 'version' ? (
            same ? (
              <span data-form-same>Текст и тип не изменились: сохранять нечего</span>
            ) : d ? (
              <span data-form-delta>
                Против v{base?.version}: <span className="text-emerald-700 dark:text-emerald-300">+{d.plus}</span>{' '}
                <span className="text-red-700 dark:text-red-300">−{d.minus}</span> строк
              </span>
            ) : null
          ) : null}
        </p>
      </div>
      {mode === 'version' ? (
        <p className="text-muted-foreground text-xs">
          Новая версия роли не затрагивает: «Где используется» покажет «есть v{(base?.version ?? 0) + 1}», а обновлять роли —
          отдельным действием
        </p>
      ) : null}
      <div className="bg-background sticky bottom-0 z-10 -mx-4 flex justify-end gap-2 border-t px-4 py-3" data-form-footer>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Отмена
        </Button>
        <Button onClick={save} disabled={busy || !ready}>
          {busy ? (
            <>
              <Spinner /> Сохраняем…
            </>
          ) : mode === 'create' ? (
            'Завести инструкцию'
          ) : (
            `Сохранить версию ${(base?.version ?? 0) + 1}`
          )}
        </Button>
      </div>
    </div>
  );
}

function KeyField({
  value,
  onChange,
  isDisabled,
  description = 'Латиницей: по нему документ называется «ключ.md» в ролях, и по нему инструкция приходит в связке. Изменить ключ потом нельзя',
}: {
  value: string;
  onChange: (v: string) => void;
  isDisabled?: boolean;
  description?: string;
}) {
  return (
    <div className="space-y-1.5">
      <TextInput label="Ключ" value={value} onChange={onChange} isRequired isDisabled={isDisabled} isInvalid={keyIsBad(value)} description={description} className="font-mono" />
      {keyIsBad(value) ? (
        <p className="text-destructive text-xs" role="alert" data-key-bad>
          {KEY_RULE}
        </p>
      ) : value ? (
        <p className="text-muted-foreground text-xs">
          В ролях документ будет называться <span className="font-mono">{docName(value)}</span>
        </p>
      ) : null}
    </div>
  );
}

// ── E6: «Обновить в ролях» ──────────────────────────────────────────────────

export function ApplyDialog({
  projectKey,
  instKey,
  preRoles,
  onClose,
  onApplied,
}: {
  projectKey: string;
  instKey: string;
  // Открыт из плашки роли: отмечена только она.
  preRoles?: string[];
  onClose: () => void;
  onApplied: () => void;
}) {
  const [detail, setDetail] = useState<InstructionDetail>();
  const [loadErr, setLoadErr] = useState<ApiError>();
  const [target, setTarget] = useState<number>();
  const [picks, setPicks] = useState<Record<string, boolean>>({});
  const [touched, setTouched] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError>();
  const [notice, setNotice] = useState<string>();
  const [result, setResult] = useState<ApplyResult>();

  const shaOf = (d: InstructionDetail | undefined, n: number | undefined) => d?.versions.find((v) => v.version === n)?.sha256;

  const load = (after409?: string) => {
    api.getInstruction(projectKey, instKey).then(
      (d) => {
        setLoadErr(undefined);
        setDetail(d);
        const t = target ?? d.instruction.latest_version;
        setTarget(t);
        setPicks((p) => repick(d.usage, p, touched, t, shaOf(d, t), preRoles));
        if (after409) setNotice(after409);
      },
      (err) => setLoadErr(toApiError(err)),
    );
  };
  // Кандидаты — один раз при открытии; перечитываются после 409.
  useEffect(() => load(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const candidates = detail?.usage ?? [];
  const latest = detail?.instruction.latest_version ?? 0;
  const t = target ?? latest;
  const targetSha = shaOf(detail, t);
  const sent = chosen(candidates, picks, t);

  const pick = (key: string, value: boolean) => {
    setTouched(true);
    setPicks({...picks, [key]: value});
  };
  const setVersion = (n: number) => {
    setTarget(n);
    setPicks(repick(candidates, picks, touched, n, shaOf(detail, n), preRoles));
  };

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const res = await api.applyInstruction(projectKey, instKey, {
        version: t,
        roles: sent.map((c) => ({key: c.role_key, from_version: c.role_version})),
        changelog: note.trim() || undefined,
      });
      setResult(res);
      onApplied();
    } catch (err) {
      const e = toApiError(err);
      setError(e);
      if (e.httpStatus === 409) {
        const role = conflictRole(e.details);
        load(`Список обновлён${role ? `: у роли ${role} появилась новая версия` : ''}. Проверьте отметки и подтвердите ещё раз`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent
        className="max-h-[90svh] gap-3 overflow-y-auto sm:max-w-lg [&>*]:min-w-0"
        data-apply-dialog
        onEscapeKeyDown={(e) => busy && e.preventDefault()}
        onPointerDownOutside={(e) => busy && e.preventDefault()}>
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>
                Готово: {result.instruction} v{result.version}
              </DialogTitle>
              <DialogDescription>Идущие этапы доработают на прежних версиях ролей. Новые захваты возьмут новые версии</DialogDescription>
            </DialogHeader>
            <ul className="space-y-1.5" data-apply-result>
              {result.roles.map((r) => (
                <li
                  key={r.role}
                  className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
                  data-result-row={r.role}
                  data-result-status={r.outcome}>
                  <span className="font-medium">{candidates.find((c) => c.role_key === r.role)?.role_name ?? r.role}</span>
                  <span className="text-muted-foreground font-mono text-xs">{r.role}</span>
                  {r.outcome === 'created' ? (
                    <Token color="green" label={`v${r.role_version} · ${result.instruction} v${r.to_version}`} className="ml-auto" />
                  ) : (
                    <Token label={`без изменений · уже на v${r.to_version}`} className="ml-auto" />
                  )}
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button onClick={onClose}>Закрыть</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Обновить «{instKey}» в ролях</DialogTitle>
              <DialogDescription>
                Каждая отмеченная роль получит новую версию: документ {docName(instKey)} станет версией инструкции, остальное
                останется как есть. Неотмеченные роли не изменятся
              </DialogDescription>
            </DialogHeader>
            {error ? (
              <div role="alert" data-apply-failure={error.code}>
                <Failure error={error} title={error.httpStatus === 409 ? 'Роли не обновлены: список устарел' : 'Роли не обновлены'} />
              </div>
            ) : null}
            {notice ? (
              <div data-apply-notice>
                <Note tone="warning" title={notice} />
              </div>
            ) : null}
            {detail ? (
              <Selector
                label="Версия инструкции"
                options={detail.versions.map((v) => ({value: String(v.version), label: versionOptionLabel(v, latest)}))}
                value={String(t)}
                onChange={(x) => x && setVersion(Number(x))}
                isDisabled={busy}
              />
            ) : null}
            {loadErr ? (
              <Failure
                error={loadErr}
                title="Роли не загрузились"
                reload={() => {
                  setLoadErr(undefined);
                  load();
                }}
              />
            ) : !detail ? (
              <div role="status" aria-label="Загружаем роли" className="space-y-2" data-apply-loading>
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : candidates.length === 0 ? (
              <div data-apply-empty>
                <EmptyState
                  title={`Ни у одной роли нет документа ${docName(instKey)}`}
                  description="Добавить инструкцию в роль: «Новая версия» роли → «Из библиотеки». Это правка роли, а не это действие"
                />
              </div>
            ) : (
              <>
                <fieldset className="space-y-1.5" disabled={busy}>
                  <legend className="sr-only">Роли</legend>
                  <ul className="max-h-72 space-y-1.5 overflow-y-auto" data-apply-candidates>
                    {candidates.map((c) => {
                      const state = candidateState(c, t);
                      const current = state === 'current';
                      const id = `apply-${c.role_key}`;
                      const token = CANDIDATE_TOKEN[state];
                      return (
                        <li
                          key={c.role_key}
                          className={cn('flex items-start gap-3 rounded-md border px-3 py-2', current && 'bg-muted/40')}
                          data-candidate={c.role_key}
                          data-candidate-state={state}>
                          <Checkbox
                            id={id}
                            className="mt-0.5"
                            checked={current ? false : Boolean(picks[c.role_key])}
                            disabled={current || busy}
                            onCheckedChange={(v) => pick(c.role_key, v === true)}
                          />
                          <Label htmlFor={id} className="block min-w-0 flex-1 cursor-pointer space-y-0.5 leading-snug font-normal">
                            <span className="flex flex-wrap items-center gap-x-2">
                              <span className="font-medium">{c.role_name}</span>
                              <span className="text-muted-foreground font-mono text-xs">{c.role_key}</span>
                            </span>
                            <span className="text-muted-foreground block text-xs">{candidateLine(c, instKey, t)}</span>
                            {state === 'plain' ? (
                              <span className="text-muted-foreground block text-xs" data-candidate-note>
                                {plainNote(c, targetSha)}
                              </span>
                            ) : null}
                          </Label>
                          <Token color={token.color} label={token.label} className={state === 'plain' ? 'border-dashed' : undefined} />
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>
                {allCurrent(candidates, t) ? (
                  <p className="text-muted-foreground text-sm" data-apply-all-current>
                    Все роли уже на v{t}: обновлять нечего
                  </p>
                ) : null}
                <TextInput
                  label="Что изменилось"
                  description={`Допишется к описанию версии каждой роли: «инструкция ${instKey}: vN → v${t}. …»`}
                  value={note}
                  onChange={setNote}
                  isDisabled={busy}
                />
              </>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                Отмена
              </Button>
              <Button onClick={submit} disabled={busy || sent.length === 0} data-apply-submit>
                {busy ? (
                  <>
                    <Spinner /> Обновляем…
                  </>
                ) : (
                  applyButtonLabel(sent.length)
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── «В библиотеку» из документа роли ────────────────────────────────────────

export function ToLibraryDialog({
  projectKey,
  roleKey,
  doc,
  onClose,
  onCreated,
  onApply,
}: {
  projectKey: string;
  roleKey: string;
  doc: RoleDocument;
  onClose: () => void;
  onCreated: () => void;
  onApply: (key: string) => void;
}) {
  const [key, setKey] = useState(keyFromDocName(doc.name));
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError>();
  const [created, setCreated] = useState<string>();
  const content = doc.content ?? '';

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const out = await api.createInstruction(projectKey, {
        key,
        name: name.trim(),
        summary: summary.trim() || undefined,
        kind: doc.kind,
        content,
      });
      setCreated(out.instruction.key);
      toast.success(`Инструкция ${out.instruction.key} заведена, версия 1`);
      onCreated();
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="gap-3 sm:max-w-md [&>*]:min-w-0" data-to-library>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Инструкция {created} заведена</DialogTitle>
              <DialogDescription>
                Версия 1 — текст документа {doc.name}. Документы в ролях пока обычные: чтобы они ссылались на библиотеку,
                закрепите их кнопкой ниже
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                Позже
              </Button>
              <Button
                onClick={() => {
                  onClose();
                  onApply(created);
                }}>
                Обновить в ролях
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Вынести {doc.name} в библиотеку</DialogTitle>
              <DialogDescription>
                Тип ({doc.kind}) и текст ({byteLength(content)} байт) — из документа роли {roleKey}. Роли от этого не меняются
              </DialogDescription>
            </DialogHeader>
            {error ? (
              <div role="alert" data-form-failure>
                <Failure error={error} title="Инструкция не заведена" />
              </div>
            ) : null}
            <KeyField value={key} onChange={setKey} isDisabled={busy} description="Из имени документа. Изменить ключ потом нельзя" />
            <TextInput label="Название" value={name} onChange={setName} isRequired isDisabled={busy} />
            <TextInput label="Описание" value={summary} onChange={setSummary} isDisabled={busy} />
            <DialogFooter>
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                Отмена
              </Button>
              <Button onClick={save} disabled={busy || !key || keyIsBad(key) || !name.trim()}>
                {busy ? (
                  <>
                    <Spinner /> Заводим…
                  </>
                ) : (
                  'Завести инструкцию'
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── «Добавить из библиотеки» в форме версии роли ────────────────────────────

export interface PickedVersion {
  pin: RoleDocumentPin;
  kind: string;
  content: string;
}

export function LibraryPicker({
  projectKey,
  taken,
  onPick,
  onClose,
}: {
  projectKey: string;
  // Документы набора по имени: закреплённый — его закрепление.
  taken: Map<string, RoleDocumentPin | undefined>;
  onPick: (v: PickedVersion) => void;
  onClose: () => void;
}) {
  const list = useResource(() => api.listInstructions(projectKey), [projectKey]);
  const [ver, setVer] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<ApiError>();

  const add = async (inst: Instruction, version: number) => {
    setBusy(inst.key);
    setError(undefined);
    try {
      const v = await api.getInstructionVersion(projectKey, inst.key, version);
      onPick({pin: {key: inst.key, version: v.version}, kind: v.kind, content: v.content ?? ''});
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85svh] gap-3 overflow-y-auto sm:max-w-lg [&>*]:min-w-0" data-library-picker>
        <DialogHeader>
          <DialogTitle>Добавить из библиотеки</DialogTitle>
          <DialogDescription>
            Документ ляжет в набор под именем «ключ.md», с текстом выбранной версии. Править его здесь нельзя: только
            «Отвязать».
          </DialogDescription>
        </DialogHeader>
        {error ? <Failure error={error} title="Версия не загрузилась" /> : null}
        {list.error ? (
          <Failure error={list.error} title="Библиотека не загрузилась" reload={noLibrary(list.error) ? undefined : list.reload} />
        ) : !list.data ? (
          <div role="status" aria-label="Загружаем библиотеку" className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : list.data.length === 0 ? (
          <EmptyState
            title="В библиотеке нет инструкций"
            description="Заведите инструкцию в разделе «Библиотека инструкций» на «Пайплайне» или вынесите в неё документ роли кнопкой «В библиотеку»"
          />
        ) : (
          <ul className="space-y-2">
            {list.data.map((i) => {
              const name = docName(i.key);
              const has = taken.has(name);
              const pin = taken.get(name);
              const chosenV = Number(ver[i.key] ?? i.latest_version);
              return (
                <li key={i.key} className={cn('rounded-lg border p-3', has && 'bg-muted/40')} data-picker-row={i.key}>
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-sm font-medium break-all">{i.key}</span>
                    <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">{i.name}</span>
                  </div>
                  {has ? (
                    <p className="text-muted-foreground mt-1.5 flex gap-1.5 text-xs" data-picker-taken>
                      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      {pin
                        ? `Уже в наборе: ${name} (${pin.key} v${pin.version})`
                        : `В наборе уже есть обычный документ ${name}. Закрепить его можно в разделе «Библиотека инструкций» → «Обновить в ролях»`}
                    </p>
                  ) : (
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <div className="w-44">
                        <Selector
                          label="Версия"
                          options={Array.from({length: i.latest_version}, (_, n) => i.latest_version - n).map((n) => ({
                            value: String(n),
                            label: `v${n}${n === i.latest_version ? ' · последняя' : ''}`,
                          }))}
                          value={String(chosenV)}
                          onChange={(x) => x && setVer({...ver, [i.key]: x})}
                        />
                      </div>
                      <Button size="sm" className="ml-auto" disabled={Boolean(busy)} onClick={() => add(i, chosenV)}>
                        {busy === i.key ? <Spinner /> : null} Добавить {name}
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Закрыть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
