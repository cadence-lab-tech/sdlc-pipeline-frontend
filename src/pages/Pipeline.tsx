// Страница «Пайплайн» (CLAB-346, решение 0068 §7, design.spec v2 эпика
// CLAB-341): цикл и роли на одной странице. Схема выбранной версии цикла
// выбранного типа задач и панель справа — обзор, статус, переход, роль.
// Всё состояние — в адресе (components/pipeline/params.ts).
//
// Правила версий прежние: черновик цикла правится, активная и выведенные
// версии только читаются (решение 0016), версия роли иммутабельна. Права
// проверяет бэкенд: кнопки по уровню участника не прячутся, 403 виден у
// действия.
import {useCallback, useEffect, useRef, useState} from 'react';
import {useParams, useSearchParams} from 'react-router-dom';
import {ChevronDown, Route as RouteIcon} from 'lucide-react';
import {toast} from 'sonner';

import {cn} from '@/lib/utils';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Skeleton} from '@/components/ui/skeleton';
import {Tabs, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {Sheet, SheetContent, SheetTitle} from '@/components/ui/sheet';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Switch} from '@/components/fields';
import {ConfirmButton, EmptyState, StatusDot} from '@/components/kit';

import {ApiError, api} from '../api/client';
import type {ActivationResult, InstructionDetail, RoleDocument, UUID, Workflow, WorkflowHead} from '../api/types';
import {useResource} from '../api/useResource';
import {Failure} from '../components/Feedback';
import {GateDialog} from '../components/GateDialog';
import {StatusDialog} from '../components/StatusDialog';
import {TransitionDialog} from '../components/TransitionDialog';
import {WorkflowDraftDialog} from '../components/WorkflowDraftDialog';
import {LAYERED_COMPACT, LAYERED_DEFAULTS, disabledIds, layoutLayered} from '../components/cycle/layered';
import {
  ActivationReport,
  CycleOverview,
  InspectorHeader,
  StatusInspector,
  TransitionInspector,
  type PipelineDialog,
} from '../components/pipeline/Inspector';
import {Minimap, PipelineCanvas, ZoomControls} from '../components/pipeline/PipelineCanvas';
import {RolePanel} from '../components/pipeline/RolePanel';
import {
  ApplyDialog,
  InstructionForm,
  InstructionPanel,
  ToLibraryDialog,
  type InstructionNotice,
} from '../components/pipeline/InstructionLibrary';
import {useTaskLevelEditable} from '../hooks/useTaskLevelEditable';
import {cycleControls} from '../components/pipeline/cycleRights';
import {activateText, activateTitle, stateLabel, versionLabel} from '../components/pipeline/labels';
import {
  ZOOM_FIT_MAX,
  ZOOM_MIN,
  isViewPatch,
  parsePipelineParams,
  patchParams,
  zoomParam,
  type ParamPatch,
} from '../components/pipeline/params';
import {taskTypes} from '../components/taskTypes';
import {useIsMobile} from '../hooks/use-mobile';

const toApiError = (err: unknown) => (err instanceof ApiError ? err : new ApiError('internal', String(err)));

const STATE_DOT = {draft: 'accent', active: 'success', retired: 'neutral'} as const;

// Выбор в панели взаимоисключающий: статус, переход, роль или инструкция
// библиотеки (CLAB-351) — выбор одного снимает остальные.
const NO_SELECTION: ParamPatch = {
  status: undefined,
  transition: undefined,
  role: undefined,
  v: undefined,
  view: undefined,
  doc: undefined,
  instruction: undefined,
  iv: undefined,
};

export function Pipeline() {
  const {projectKey = ''} = useParams();
  const [q, setQ] = useSearchParams();
  const p = parsePipelineParams(q);
  const mobile = useIsMobile();
  // Выбор, тип и версия — в историю; вид холста — без записи (replace).
  const set = useCallback(
    (patch: ParamPatch, replace?: boolean) =>
      setQ((prev) => patchParams(prev, patch), {replace: replace ?? isViewPatch(patch)}),
    [setQ],
  );

  const project = useResource(() => api.getProject(projectKey), [projectKey]);
  // Подсказка по уровню доступа, общая для библиотеки инструкций и правки
  // цикла: знает, что права нет, — кнопок нет (библиотека) или они неактивны с
  // пояснением (цикл, CLAB-409); не знает — кнопки есть, отказ покажет сервер
  // (design.spec CLAB-351 §3).
  const canEditLibrary = useTaskLevelEditable(projectKey, project.data?.project.owner_team_key);
  const versions = useResource(() => api.listWorkflows(projectKey), [projectKey]);
  const roles = useResource(() => api.listRoles(projectKey, true), [projectKey]);

  const types = project.data ? taskTypes(project.data) : [];
  const heads = versions.data ?? [];
  const wfHead = p.wf ? heads.find((w) => w.id === p.wf) : undefined;
  const type = p.type && types.includes(p.type) ? p.type : (wfHead?.task_types[0] ?? types[0] ?? 'task');
  const activeOf = (t: string) => heads.find((w) => w.state === 'active' && w.task_types.includes(t));
  const selectedId: UUID | undefined = p.wf ?? activeOf(type)?.id;
  const wfUnknown = Boolean(p.wf && versions.data && !wfHead);

  const workflow = useResource(
    () => (selectedId && !wfUnknown ? api.getWorkflowVersion(selectedId) : Promise.resolve(undefined)),
    [selectedId, wfUnknown],
  );
  const wf = workflow.data;
  const isDraft = wf?.state === 'draft';
  const validation = useResource(
    () => (wf && isDraft ? api.validateWorkflow(wf.id) : Promise.resolve(undefined)),
    [wf?.id, isDraft],
  );
  // Активные циклы других типов — для подписи «на других циклах: N».
  const otherIds = heads.filter((w) => w.state === 'active' && w.id !== selectedId).map((w) => w.id);
  const others = useResource(() => Promise.all(otherIds.map((id) => api.getWorkflowVersion(id))), [otherIds.join()]);

  // Ссылка со старого адреса несёт только версию: тип подставляется по ней.
  useEffect(() => {
    if (p.wf && wfHead && !p.type) set({type: wfHead.task_types[0]}, true);
  }, [p.wf, p.type, wfHead, set]);

  const [dialog, setDialog] = useState<PipelineDialog>();
  const [showArchived, setShowArchived] = useState(false);
  // Форма новой версии открыта у этой роли: панель шире.
  const [wideFor, setWideFor] = useState<string>();
  const [headError, setHeadError] = useState<{title: string; error: ApiError}>();
  const [activation, setActivation] = useState<{id: UUID; result: ActivationResult}>();
  const [isBusy, setIsBusy] = useState(false);
  const [confirmActivate, setConfirmActivate] = useState(false);
  // Узкий экран: обзор цикла (проверка, роли) открывается кнопкой в Sheet.
  const [overviewOpen, setOverviewOpen] = useState(false);
  // Библиотека (CLAB-351): формы — состояние страницы, не адрес; диалоги
  // «Обновить в ролях» и «В библиотеку»; знак перечитать после действий.
  const [libraryForm, setLibraryForm] = useState<{kind: 'create'} | {kind: 'version'; detail: InstructionDetail}>();
  const [notice, setNotice] = useState<InstructionNotice>();
  const [applyFor, setApplyFor] = useState<{key: string; roles?: string[]}>();
  const [toLibrary, setToLibrary] = useState<{role: string; doc: RoleDocument}>();
  const [libraryRev, setLibraryRev] = useState(0);
  // Название инструкции для крошек: «Библиотека / <название>».
  const libraryList = useResource(
    () => (p.instruction ? api.listInstructions(projectKey).catch(() => []) : Promise.resolve([])),
    [projectKey, p.instruction, libraryRev],
  );
  const libraryChanged = () => {
    setLibraryRev((n) => n + 1);
    roles.reload();
  };

  const refresh = () => {
    workflow.reload();
    validation.reload();
    versions.reload();
  };

  // Холст: прокрутка, видимая часть для мини-карты и «Вписать».
  const scroller = useRef<HTMLDivElement>(null);
  const zoom = mobile ? 1 : p.zoom;
  const [viewport, setViewport] = useState({top: 0, height: 800});
  // Раскладка — чистая функция и считается быстро: без мемоизации.
  const layout = wf
    ? layoutLayered(wf, {
        ...(mobile ? LAYERED_COMPACT : LAYERED_DEFAULTS),
        showReturns: !mobile && p.showReturns,
        returnLabels: !mobile && Boolean(p.status),
        disabled: disabledIds(wf.statuses, p.off),
      })
    : undefined;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const on = () => setViewport({top: el.scrollTop / zoom, height: el.clientHeight / zoom});
    on();
    el.addEventListener('scroll', on);
    return () => el.removeEventListener('scroll', on);
  }, [zoom, wf]);

  const fit = () => {
    const el = scroller.current;
    if (!el || !layout) return;
    const k = Math.min(ZOOM_FIT_MAX, (el.clientWidth - 32) / layout.width, (el.clientHeight - 32) / layout.height);
    set({zoom: zoomParam(Math.max(ZOOM_MIN, Math.floor(k * 10) / 10))});
  };

  const loadError = project.error ?? versions.error ?? roles.error;
  if (loadError) {
    return (
      <div className="p-6" data-pipeline-page>
        <Failure
          error={loadError}
          title="Пайплайн не загрузился"
          reload={() => {
            project.reload();
            versions.reload();
            roles.reload();
          }}
        />
      </div>
    );
  }
  if (!project.data || !versions.data || !roles.data) return <PageSkeleton />;

  const roleList = roles.data;
  const latest = new Map(roleList.map((r) => [r.key, r.latest_version]));
  const missing = wfUnknown || workflow.error?.code === 'not_found';
  if (missing) {
    return (
      <div className="space-y-3 p-6" data-pipeline-page data-pipeline-missing>
        <Failure error={workflow.error ?? new ApiError('not_found', 'версия цикла не найдена')} title="Версии цикла нет" />
        <Button variant="secondary" onClick={() => set({wf: undefined, ...NO_SELECTION})}>
          Открыть активную версию
        </Button>
      </div>
    );
  }
  if (workflow.error) {
    return (
      <div className="p-6" data-pipeline-page>
        <Failure error={workflow.error} title="Пайплайн не загрузился" reload={workflow.reload} />
      </div>
    );
  }
  if (selectedId && !wf) return <PageSkeleton />;

  const typeHeads = heads.filter((w) => w.task_types.includes(type)).sort((a, b) => b.version - a.version);
  const draftOfType = typeHeads.find((w) => w.state === 'draft');
  // Кнопки правки цикла неактивны, если права нет; сервер проверяет всё равно.
  const {editable, locked, hint: lockedHint} = cycleControls(Boolean(isDraft), canEditLibrary);

  const createDraft = async (body: {from: string; task_types: string[]}) => {
    setHeadError(undefined);
    try {
      const created = await api.createDraft(projectKey, body);
      toast.success(`Черновик ${created.name} · v${created.version} создан`);
      versions.reload();
      set({wf: created.id, type: body.task_types[0] ?? type, ...NO_SELECTION});
    } catch (err) {
      setHeadError({title: 'Черновик не создан', error: toApiError(err)});
    }
  };
  // Копия активной — тем же запросом, что в прежнем редакторе: с типом; копия
  // выведенной — по её идентификатору.
  const copyThis = () =>
    wf && createDraft(wf.state === 'active' ? {from: 'active', task_types: [type]} : {from: wf.id, task_types: wf.task_types});
  const emptyDraft = () => createDraft({from: 'empty', task_types: [type]});

  const deleteDraft = async () => {
    if (!wf) return;
    setHeadError(undefined);
    try {
      await api.deleteWorkflow(wf.id);
      toast.success(`Черновик ${versionLabel(wf)} удалён`);
      versions.reload();
      set({wf: undefined, ...NO_SELECTION});
    } catch (err) {
      setHeadError({title: 'Черновик не удалён', error: toApiError(err)});
    }
  };

  const activate = async () => {
    if (!wf) return;
    setHeadError(undefined);
    setIsBusy(true);
    try {
      const result = await api.activateWorkflow(wf.id);
      setActivation({id: wf.id, result});
      toast.success(`Версия ${result.workflow.version} активирована`);
      refresh();
      others.reload();
    } catch (err) {
      setHeadError({title: `Версия ${wf.version} не активирована`, error: toApiError(err)});
    } finally {
      setIsBusy(false);
      setConfirmActivate(false);
    }
  };

  // «Активировать» выключается в четырёх разных случаях, и по самой кнопке они
  // неразличимы: запрос уже идёт, проверка ещё не ответила, проверку не
  // удалось выполнить, цикл проверку не прошёл. Причина называется подсказкой.
  const blockedReason = isBusy
    ? 'Запрос уже идёт'
    : validation.loading || (!validation.data && !validation.error)
      ? 'Идёт проверка цикла'
      : validation.error
        ? 'Проверку не удалось выполнить'
        : validation.data?.valid
          ? undefined
          : 'Цикл не проходит проверку';

  // ── что в панели ──────────────────────────────────────────────────────────
  const status = wf?.statuses.find((s) => s.key === p.status);
  const transition = wf?.transitions.find((t) => t.key === p.transition);
  const role = roleList.find((r) => r.key === p.role);
  const instructionKey = !role && !libraryForm ? p.instruction : undefined;
  const instructionName = libraryList.data?.find((i) => i.key === instructionKey)?.name ?? instructionKey;
  const hasSelection = Boolean(status || transition || role || instructionKey || libraryForm);
  const closePanel = () => {
    setLibraryForm(undefined);
    setNotice(undefined);
    set(NO_SELECTION);
  };
  const openInstruction = (key: string, version?: number) => {
    setLibraryForm(undefined);
    setNotice(undefined);
    set({...NO_SELECTION, instruction: key, iv: version ? String(version) : undefined});
  };
  const selectStatus = (key: string) => set({...NO_SELECTION, status: key});
  const selectTransition = (key: string) => set({...NO_SELECTION, transition: key});

  let crumbs: string[] = [wf ? versionLabel(wf) : 'Пайплайн'];
  let body: React.ReactNode;
  let back: (() => void) | undefined;
  if (libraryForm) {
    const formFor = libraryForm.kind === 'version' ? libraryForm.detail : undefined;
    crumbs = [...crumbs, 'Библиотека', ...(formFor ? [formFor.instruction.name, 'Новая версия'] : ['Новая инструкция'])];
    back = () => setLibraryForm(undefined);
    body = (
      <InstructionForm
        key={formFor ? `v:${formFor.instruction.key}` : 'create'}
        projectKey={projectKey}
        mode={libraryForm.kind}
        detail={formFor}
        onCancel={() => setLibraryForm(undefined)}
        onDone={(key, version) => {
          setLibraryForm(undefined);
          libraryChanged();
          set({...NO_SELECTION, instruction: key});
          setNotice({kind: formFor ? 'version' : 'created', key, version});
        }}
      />
    );
  } else if (instructionKey) {
    crumbs = [...crumbs, 'Библиотека', instructionName ?? instructionKey];
    back = () => {
      setNotice(undefined);
      set({instruction: undefined, iv: undefined, view: undefined});
    };
    body = (
      <InstructionPanel
        key={instructionKey}
        projectKey={projectKey}
        instKey={instructionKey}
        version={p.iv}
        view={p.view}
        canEdit={canEditLibrary}
        reloadKey={libraryRev}
        notice={notice}
        onVersion={(v) => set({iv: v ? String(v) : undefined, view: undefined})}
        onView={(v) => set({view: v === 'diff' ? 'diff' : undefined}, true)}
        onRole={(key) => set({...NO_SELECTION, role: key})}
        onApply={() => setApplyFor({key: instructionKey})}
        onNewVersion={(detail) => setLibraryForm({kind: 'version', detail})}
        onBackToLibrary={closePanel}
        onChanged={libraryChanged}
      />
    );
  } else if (role) {
    crumbs = [...crumbs, ...(status ? [status.name] : []), role.name];
    back = () => set({role: undefined, v: undefined, view: undefined, doc: undefined});
    body = (
      <RolePanel
        key={role.key}
        projectKey={projectKey}
        roleKey={role.key}
        workflow={wf}
        expanded={p.v}
        view={p.view}
        doc={p.doc}
        onVersion={(v, view, doc) =>
          set({v: v ? String(v) : undefined, view: view === 'diff' ? 'diff' : undefined, doc: doc || undefined})
        }
        onStatus={(key) => set({...NO_SELECTION, status: key})}
        onChanged={() => {
          roles.reload();
          others.reload();
        }}
        onForm={(open) => setWideFor(open ? role.key : undefined)}
        canEdit={canEditLibrary}
        reloadKey={libraryRev}
        ownerTeamKey={project.data?.project.owner_team_key}
        onInstruction={openInstruction}
        onApply={(key, keys) => setApplyFor({key, roles: keys})}
        onToLibrary={(roleKey, doc) => setToLibrary({role: roleKey, doc})}
      />
    );
  } else if (wf && transition) {
    crumbs = [...crumbs, `Переход «${transition.name}»`];
    back = () => set({transition: undefined});
    body = (
      <TransitionInspector
        key={transition.id}
        workflow={wf}
        transition={transition}
        editable={editable}
        onChanged={refresh}
        onDeleted={() => {
          refresh();
          set({transition: undefined});
        }}
        onDialog={setDialog}
        onStatus={selectStatus}
      />
    );
  } else if (wf && status) {
    crumbs = [...crumbs, status.name];
    back = () => set({status: undefined});
    body = (
      <StatusInspector
        key={status.id}
        projectKey={projectKey}
        workflow={wf}
        status={status}
        latest={latest}
        editable={editable}
        onChanged={refresh}
        onDeleted={() => {
          refresh();
          set({status: undefined});
        }}
        onDialog={setDialog}
        onRole={(key) => set({role: key, v: undefined, view: undefined, doc: undefined})}
        onTransition={selectTransition}
      />
    );
  } else {
    body = (
      <CycleOverview
        projectKey={projectKey}
        workflow={wf}
        roles={roleList}
        otherCycles={others.data ?? []}
        validation={isDraft ? validation : undefined}
        showArchived={showArchived}
        onArchived={setShowArchived}
        onRole={(key) => set({...NO_SELECTION, role: key})}
        onStatus={selectStatus}
        onRoleCreated={(key) => {
          roles.reload();
          set({...NO_SELECTION, role: key});
        }}
        library={{
          canEdit: canEditLibrary,
          reloadKey: libraryRev,
          onOpen: (key) => openInstruction(key),
          onNew: () => setLibraryForm({kind: 'create'}),
        }}
      />
    );
  }

  const otherActive = types.map((t) => activeOf(t)).find((w): w is WorkflowHead => Boolean(w));

  return (
    <div className="flex h-[calc(100svh-3.5rem)] flex-col" data-pipeline-page>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        {types.length ? (
          <Tabs value={type} onValueChange={(t) => set({type: t, wf: undefined, ...NO_SELECTION})}>
            <TabsList>
              {types.map((t) => (
                <TabsTrigger key={t} value={t}>
                  {t}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : null}
        {wf ? (
          <VersionMenu
            workflow={wf}
            type={type}
            heads={typeHeads}
            onPick={(id) => set({wf: id, status: undefined, transition: undefined})}
            locked={locked}
            onCopy={() => void copyThis()}
            onEmpty={() => void emptyDraft()}
          />
        ) : null}
        {wf && !isDraft && draftOfType && !mobile ? (
          <Button variant="link" size="sm" onClick={() => set({wf: draftOfType.id, status: undefined, transition: undefined})}>
            есть черновик v{draftOfType.version} — открыть
          </Button>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {wf && isDraft ? (
            <>
              <Button size="sm" variant="ghost" disabled={locked} onClick={() => setDialog({kind: 'draft-head'})}>
                Название и типы
              </Button>
              <ConfirmButton
                variant="secondary"
                disabled={locked}
                title="Удалить черновик?"
                description={`Черновик ${versionLabel(wf)} пропадёт вместе со всеми правками`}
                onConfirm={deleteDraft}>
                Удалить черновик
              </ConfirmButton>
              <ActivateButton
                blockedReason={locked ? lockedHint : blockedReason}
                busy={isBusy}
                onClick={() => setConfirmActivate(true)}
              />
            </>
          ) : wf && !mobile ? (
            <Button size="sm" variant="secondary" disabled={locked} onClick={() => void copyThis()}>
              Черновик копией этой версии
            </Button>
          ) : null}
        </div>
        {lockedHint ? (
          <p className="text-muted-foreground w-full text-xs" data-pipeline-cycle-hint>
            {lockedHint}
          </p>
        ) : null}
      </div>

      {headError ? (
        <div className="border-b px-4 py-2">
          <Failure error={headError.error} title={headError.title} />
        </div>
      ) : null}
      {activation && activation.id === wf?.id ? (
        <div className="border-b px-4 py-2" data-pipeline-activation>
          <ActivationReport result={activation.result} />
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {wf && layout ? (
            <>
              <div className="bg-background/95 absolute inset-x-0 top-0 z-10 flex h-11 items-center gap-3 border-b px-4">
                {mobile ? (
                  <Button size="sm" variant="outline" onClick={() => setOverviewOpen(true)}>
                    Обзор
                  </Button>
                ) : null}
                {isDraft ? (
                  <Button size="sm" variant="secondary" disabled={locked} onClick={() => setDialog({kind: 'status-new'})}>
                    Добавить статус
                  </Button>
                ) : null}
                {mobile ? null : (
                  <Switch label="Возвраты" value={p.showReturns} onChange={(v) => set({returns: v ? undefined : '0'})} />
                )}
                <PathPopover workflow={wf} off={p.off} onOff={(keys) => set({off: keys.join(',') || undefined})} />
                <div className="ml-auto">
                  {mobile ? null : (
                    <ZoomControls
                      zoom={zoom}
                      onZoom={(z) => set({zoom: zoomParam(z)})}
                      onFit={fit}
                      minimap={p.minimap}
                      onMinimap={(v) => set({minimap: v ? '1' : undefined})}
                    />
                  )}
                </div>
              </div>
              <div ref={scroller} className="absolute inset-0 top-11 overflow-auto p-4" data-pipeline-scroller>
                {wf.statuses.length === 0 ? (
                  <EmptyState
                    title="Статусов нет"
                    description={editable ? 'Начните с «Добавить статус»' : 'В этой версии цикла нет ни одного статуса'}
                  />
                ) : (
                  <PipelineCanvas
                    workflow={wf}
                    layout={layout}
                    latest={latest}
                    selection={{status: p.status, transition: p.transition, role: p.role}}
                    validation={isDraft ? validation.data : undefined}
                    editable={editable}
                    disabled={p.off}
                    zoom={zoom}
                    compact={mobile}
                    returnLabels={!mobile && Boolean(status)}
                    onSelectStatus={selectStatus}
                    onSelectTransition={selectTransition}
                    onSelectRole={(key) => set({...NO_SELECTION, role: key})}
                    onAddTransitionFrom={(key) => {
                      set({...NO_SELECTION, status: key});
                      setDialog({kind: 'transition-new', from: key});
                    }}
                  />
                )}
              </div>
              {!mobile && p.minimap ? (
                <div className="absolute right-4 bottom-4 z-10">
                  <Minimap layout={layout} selected={p.status} viewport={viewport} />
                </div>
              ) : null}
            </>
          ) : (
            <div className="p-6" data-pipeline-no-cycle>
              <EmptyState
                title={`Цикла для типа ${type} нет`}
                description="Задачи этого типа завести нельзя, пока у типа нет активного цикла. Начните с черновика: пустого или копией цикла другого типа"
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button disabled={locked} onClick={() => void emptyDraft()}>
                      Пустой черновик
                    </Button>
                    {otherActive ? (
                      <Button
                        variant="secondary"
                        disabled={locked}
                        onClick={() => void createDraft({from: otherActive.id, task_types: [type]})}>
                        Копией цикла {otherActive.task_types[0]}
                      </Button>
                    ) : null}
                  </div>
                }
              />
              {lockedHint ? <p className="text-muted-foreground mt-2 text-center text-xs">{lockedHint}</p> : null}
              {draftOfType ? (
                <div className="mt-3 text-center">
                  <Button variant="link" size="sm" onClick={() => set({wf: draftOfType.id, ...NO_SELECTION})}>
                    есть черновик v{draftOfType.version} — открыть
                  </Button>
                </div>
              ) : null}
              {/* На узком экране панели нет: роли проекта — под пустым состоянием. */}
              {mobile && !hasSelection ? <div className="-mx-4 mt-4">{body}</div> : null}
            </div>
          )}
        </div>

        {mobile ? (
          <Sheet
            open={hasSelection || overviewOpen}
            onOpenChange={(o) => {
              if (o) return;
              setOverviewOpen(false);
              if (hasSelection) closePanel();
            }}>
            <SheetContent
              side="right"
              className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-none"
              showCloseButton={false}
              data-pipeline-inspector>
              <SheetTitle className="sr-only">{crumbs[crumbs.length - 1]}</SheetTitle>
              <InspectorHeader
                crumbs={hasSelection ? crumbs.slice(1) : crumbs}
                onBack={back}
                onClose={() => {
                  setOverviewOpen(false);
                  if (hasSelection) closePanel();
                }}
              />
              {body}
            </SheetContent>
          </Sheet>
        ) : (
          <aside
            className={cn(
              'bg-background shrink-0 overflow-y-auto border-l transition-[width]',
              role && wideFor === role.key ? 'w-[780px] max-w-[60vw]' : 'w-[440px]',
            )}
            aria-label="Панель пайплайна"
            data-pipeline-inspector>
            <InspectorHeader crumbs={crumbs} onBack={back} onClose={back ? closePanel : undefined} />
            {body}
          </aside>
        )}
      </div>

      {applyFor ? (
        <ApplyDialog
          projectKey={projectKey}
          instKey={applyFor.key}
          preRoles={applyFor.roles}
          onClose={() => setApplyFor(undefined)}
          onApplied={libraryChanged}
        />
      ) : null}
      {toLibrary ? (
        <ToLibraryDialog
          projectKey={projectKey}
          roleKey={toLibrary.role}
          doc={toLibrary.doc}
          onClose={() => setToLibrary(undefined)}
          onCreated={libraryChanged}
          onApply={(key) => setApplyFor({key})}
        />
      ) : null}
      {wf && dialog?.kind === 'status-new' ? (
        <StatusDialog
          projectKey={projectKey}
          workflowID={wf.id}
          roles={roleList.filter((r) => !r.archived_at)}
          isOpen
          onClose={() => setDialog(undefined)}
          onSaved={refresh}
        />
      ) : null}
      {wf && dialog?.kind === 'status-edit' ? (
        <StatusDialog
          projectKey={projectKey}
          workflowID={wf.id}
          status={dialog.status}
          roles={roleList.filter((r) => !r.archived_at)}
          isOpen
          onClose={() => setDialog(undefined)}
          onSaved={refresh}
        />
      ) : null}
      {wf && dialog?.kind === 'transition-new' ? (
        <TransitionDialog
          workflowID={wf.id}
          statuses={wf.statuses}
          defaultFrom={dialog.from}
          isOpen
          onClose={() => setDialog(undefined)}
          onSaved={refresh}
        />
      ) : null}
      {wf && dialog?.kind === 'transition-edit' ? (
        <TransitionDialog
          workflowID={wf.id}
          transition={dialog.transition}
          statuses={wf.statuses}
          isOpen
          onClose={() => setDialog(undefined)}
          onSaved={refresh}
        />
      ) : null}
      {wf && dialog?.kind === 'gate-new' ? (
        <GateDialog
          workflowID={wf.id}
          transitionKey={dialog.transition.key}
          isOpen
          onClose={() => setDialog(undefined)}
          onSaved={refresh}
        />
      ) : null}
      {wf && dialog?.kind === 'gate-edit' ? (
        <GateDialog
          workflowID={wf.id}
          transitionKey={dialog.transition.key}
          gate={dialog.gate}
          isOpen
          onClose={() => setDialog(undefined)}
          onSaved={refresh}
        />
      ) : null}
      {wf && dialog?.kind === 'draft-head' ? (
        <WorkflowDraftDialog
          workflow={wf}
          types={types.length ? types : [type]}
          isOpen
          onClose={() => setDialog(undefined)}
          onSaved={refresh}
        />
      ) : null}
      {wf && isDraft ? (
        // Активация необратима: прежняя версия уходит в выведенные, бэклог
        // переезжает (design.spec v2, отступление 2). Пока запрос идёт,
        // диалог не закрывается и второй активации не отправить.
        <AlertDialog open={confirmActivate} onOpenChange={(o) => (isBusy ? undefined : setConfirmActivate(o))}>
          <AlertDialogContent onEscapeKeyDown={(e) => isBusy && e.preventDefault()}>
            <AlertDialogHeader>
              <AlertDialogTitle>{activateTitle(wf)}</AlertDialogTitle>
              <AlertDialogDescription>{activateText(wf.task_types)}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isBusy}>Отмена</AlertDialogCancel>
              <AlertDialogAction
                disabled={isBusy || Boolean(blockedReason)}
                onClick={(e) => {
                  e.preventDefault();
                  if (!isBusy) void activate();
                }}>
                Активировать
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
}

function VersionMenu({
  workflow,
  type,
  heads,
  onPick,
  locked,
  onCopy,
  onEmpty,
}: {
  workflow: Workflow;
  type: string;
  heads: WorkflowHead[];
  onPick: (id: UUID) => void;
  // Права на правку цикла нет: черновик не завести.
  locked: boolean;
  onCopy: () => void;
  onEmpty: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" data-pipeline-version={workflow.id} className="max-w-full">
          <StatusDot variant={STATE_DOT[workflow.state]} />
          <span className="truncate">
            {versionLabel(workflow)} · {stateLabel(workflow.state)}
          </span>
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Версии цикла {type}</DropdownMenuLabel>
        {heads.map((h) => (
          <DropdownMenuItem key={h.id} onSelect={() => onPick(h.id)} data-pipeline-version-item={h.id}>
            <StatusDot variant={STATE_DOT[h.state]} />
            {versionLabel(h)} · {stateLabel(h.state)}
            {h.task_types.length > 1 ? <span className="text-muted-foreground text-xs">· {h.task_types.join(', ')}</span> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={locked} onSelect={onCopy}>
          Черновик копией этой версии
        </DropdownMenuItem>
        <DropdownMenuItem disabled={locked} onSelect={onEmpty}>
          Пустой черновик
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ActivateButton({blockedReason, busy, onClick}: {blockedReason?: string; busy: boolean; onClick: () => void}) {
  const button = (
    <Button size="sm" disabled={Boolean(blockedReason)} onClick={onClick}>
      {busy ? 'Активируем…' : 'Активировать'}
    </Button>
  );
  if (!blockedReason) return button;
  // Выключенная кнопка не получает событий указателя, поэтому триггером
  // подсказки служит обёртка вокруг неё; tabIndex даёт ту же подсказку с
  // клавиатуры.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}>{button}</span>
      </TooltipTrigger>
      <TooltipContent>{blockedReason}</TooltipContent>
    </Tooltip>
  );
}

// «Путь задачи»: как пойдёт задача с выключенными необязательными этапами.
// Это просмотр — данные не меняются, выбор этапов задачи здесь не правится.
function PathPopover({workflow, off, onOff}: {workflow: Workflow; off: Set<string>; onOff: (keys: string[]) => void}) {
  const optional = workflow.statuses.filter((s) => s.is_optional);
  if (!optional.length) return null;
  const shown = optional.filter((s) => off.has(s.key)).length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" data-pipeline-path>
          <RouteIcon /> Путь задачи
          {shown ? <Badge variant="secondary">без {shown}</Badge> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">Путь задачи</p>
          <p className="text-muted-foreground text-xs">
            Посмотреть, как пойдёт задача, если выключить необязательные этапы. Схема не меняется — меняется только подсветка
          </p>
        </div>
        {optional.map((s) => (
          <Switch
            key={s.key}
            label={s.name}
            description={s.enabled_by_default ? 'включён по умолчанию' : 'выключен по умолчанию'}
            value={!off.has(s.key)}
            onChange={(v) => onOff(v ? [...off].filter((k) => k !== s.key) : [...off, s.key])}
          />
        ))}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onOff(optional.filter((s) => !s.enabled_by_default).map((s) => s.key))}>
          Как по умолчанию
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function PageSkeleton() {
  return (
    <div className="flex h-[calc(100svh-3.5rem)] flex-col" role="status" aria-label="Загрузка пайплайна" data-pipeline-skeleton>
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-8 w-40" />
      </div>
      <div className="flex flex-1">
        <div className="flex-1 space-y-6 p-8 pl-32">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-[92px] w-[300px] max-w-full" />
          ))}
        </div>
        <div className="hidden w-[440px] space-y-3 border-l p-4 md:block">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    </div>
  );
}
