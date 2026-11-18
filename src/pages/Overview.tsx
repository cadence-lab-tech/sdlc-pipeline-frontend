import {Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {Link, useLocation, useParams, useSearchParams} from 'react-router-dom';
import {AlertTriangle, ArrowRight, ChevronLeft, ChevronRight, PanelRight, Plus, RefreshCw, Search, UserCheck, Users, X} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput} from '@/components/ui/input-group';
import {Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue} from '@/components/ui/select';
import {Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger} from '@/components/ui/sheet';
import {EmptyState, Note, Token} from '@/components/kit';
import {cn} from '@/lib/utils';

import {api} from '../api/client';
import type {ProjectDetail, TaskListPage, Workflow} from '../api/types';
import {useResource} from '../api/useResource';
import {Failure} from '../components/Feedback';
import {NewTaskDialog} from '../components/NewTaskDialog';
import {docsHref} from '../components/cli';
import {taskTypes} from '../components/taskTypes';
import {TaskRow} from '../components/taskrow/TaskRow';
import {progressOf} from '../components/taskrow/rules';
import {WorkflowVersionsProvider} from '../components/taskrow/versions';
import {clockLabel} from '../hooks/liveFeed';
import {useProjectEvents} from '../hooks/useProjectEvents';
import {blockedAction, decisionAction, type RowAction} from '../components/overview/actions';
import {LiveIndicator} from '../components/overview/LiveIndicator';
import {ReadyZone, type RowProps} from '../components/overview/ReadyZone';
import {StatusColorDot, SummaryZone} from '../components/overview/SummaryZone';
import {headOf} from '../components/overview/summary';
import {MoreButton, MoreFailed, Zone} from '../components/overview/Zone';
import {useFocusKeeper} from '../components/overview/useFocusKeeper';
import {useOverview, type OverviewData, type ParentInfo} from '../components/overview/useOverview';
import {
  CAPS,
  NO_ROLE_GROUP,
  ZONE_EMPTY,
  decisionRows,
  cycleTypes,
  defaultNewTaskType,
  filterApprovals,
  filterSummary,
  isFiltered,
  nextContainer,
  pageState,
  parentOptions,
  freeCount,
  readyCount,
  readFilters,
  showParentFilter,
  stagesModel,
  unstartedModel,
  withFilter,
  withoutFilters,
  workGroups,
  type OverviewFilters,
} from '../components/overview/zones';

// Значение «все» у выбора типа и родителя: у Radix Select пустого значения
// пункта нет, а в адрес оно не попадает — снимает параметр.
const ALL = '__all__';

// «Обзор» (CLAB-365, переработка CLAB-488): что можно брать, сколько задач в
// каких статусах, что делается, что ждёт решения и что заблокировано — на
// любом цикле. Блок задачи определяют данные движка (components/overview/
// zones.ts), страница его только рисует; ни одного сравнения с ключами
// статусов, ролей и типов здесь нет.
export function Overview() {
  const {projectKey = ''} = useParams();
  const project = useResource(() => api.getProject(projectKey), [projectKey]);

  if (project.error) {
    return (
      <div className="mx-auto w-full max-w-[1440px] p-4 sm:p-6">
        <div className="space-y-3">
          <Failure error={project.error} title={`Проект ${projectKey} не открылся`} />
          <Button asChild variant="outline">
            <Link to="/projects">К проектам</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <WorkflowVersionsProvider>
      <OverviewPage projectKey={projectKey} project={project.data} />
    </WorkflowVersionsProvider>
  );
}

function OverviewPage({projectKey, project}: {projectKey: string; project?: ProjectDetail}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const filters = readFilters(searchParams);
  const declared = project ? taskTypes(project) : [];
  const unknownType = Boolean(project && filters.type && !declared.includes(filters.type));
  const types = project
    ? cycleTypes(declared, project.active_workflows.flatMap((w) => w.task_types ?? []), filters.type)
    : [];

  // Живое обновление (CLAB-367): событие проекта будит ту же функцию, что
  // «Обновить», — reloadAll. Блоки читаются после рукопожатия с лентой, чтобы
  // событие между чтением и подпиской не потерялось.
  const reloadRef = useRef<() => void>(() => {});
  const live = useProjectEvents(projectKey, () => reloadRef.current());
  const data = useOverview(projectKey, project, filters, !unknownType && live.ready);
  // Строка в фокусе при переезде между блоками пересоздаётся: фокус
  // возвращается на строку той же задачи.
  useFocusKeeper(data.loading);
  useEffect(() => {
    reloadRef.current = data.reloadAll;
  });
  const {reloadResult} = live;
  useEffect(() => {
    if (live.ready && !data.loading) reloadResult(!data.unreachable);
  }, [live.ready, data.loading, data.unreachable, reloadResult]);
  const updatedClock = clockLabel(data.updatedAt);
  const parentMissing = Boolean(filters.parent) && data.parent.data === null && !data.parent.loading && !data.parent.error;

  // Контейнер «Дальше» — по ширине области страницы, а не окна: с
  // развёрнутым меню область уже. Первое измерение — до отрисовки.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'column' | 'sheet'>(() => nextContainer(window.innerWidth));
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setMode(nextContainer(el.getBoundingClientRect().width));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Панель закрывается при переходе через порог и при смене адреса.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetScope, setSheetScope] = useState(`${mode}:${location.key}`);
  if (sheetScope !== `${mode}:${location.key}`) {
    setSheetScope(`${mode}:${location.key}`);
    if (sheetOpen) setSheetOpen(false);
  }

  const setFilter = (name: 'type' | 'parent' | 'q', value: string, replace = false) =>
    setSearchParams(withFilter(searchParams, name, value), {replace});
  const resetFilters = () => setSearchParams(withoutFilters(searchParams));

  const filtered = isFiltered(filters);
  const inParent = Boolean(filters.parent);
  const stagesData = data.stages.data;
  const stages = stagesData
    ? stagesModel(stagesData.page.tasks, stagesData.page.total, data.roleKeys, stagesData.fallback)
    : null;
  const unstarted = data.unstarted.data ? unstartedModel(data.unstarted.data.top.tasks, data.unstarted.data.kids, inParent) : null;
  const ready =
    data.stages.error || data.unstarted.error || !data.unstarted.data
      ? null
      : readyCount(stages, freeCount(data.unstarted.data.freeTotal, unstarted ?? {held: 0}), unstarted?.free.length ?? 0);

  const canDecide = data.approvals.data?.can_decide;
  const decisionsTotal = decisionsCount(data, filters);
  const zoneTotals = [
    decisionsTotal,
    data.blocked.error ? null : (data.blocked.data?.total ?? null),
    data.work.error ? null : (data.work.data?.total ?? null),
    // «Можно брать» целиком: этапы (и назначенные другому), свободные и
    // ждущие блокирующих — пусто только при нулях везде.
    stagesData && unstarted && data.unstarted.data && !data.stages.error && !data.unstarted.error
      ? stagesData.page.tasks.length + (freeCount(data.unstarted.data.freeTotal, unstarted) ?? unstarted.free.length) + unstarted.waiting.length
      : null,
    data.done.error ? null : (data.done.data?.total ?? null),
  ];
  const state = pageState(filtered, zoneTotals, undefined);
  const probe = useResource(
    () => (state === 'pending' ? api.listTasks(projectKey, {limit: 1}) : Promise.resolve(null)),
    [projectKey, state === 'pending'],
  );
  const finalState =
    state === 'pending' ? pageState(filtered, zoneTotals, probe.data ? probe.data.total : undefined) : state;

  const newTaskType = defaultNewTaskType(filters.type, types);
  const newTask = (label: boolean) =>
    project ? (
      <NewTaskDialog
        key={newTaskType}
        project={project}
        defaultType={newTaskType}
        onCreated={data.reloadAll}
        trigger={
          <Button aria-label="Новая задача" size={label ? 'default' : undefined} className={label ? undefined : 'max-sm:size-8 max-sm:px-0'}>
            <Plus aria-hidden />
            <span className={label ? undefined : 'max-sm:sr-only'}>Новая задача</span>
          </Button>
        }
      />
    ) : null;

  const onPickEpic = (key: string) => setFilter('parent', key);
  const rowProps: RowProps = {projectKey, project, onPickEpic, hideEpic: inParent};
  const versionOf = (type: string): Workflow | undefined => {
    const head = project ? headOf(project, type) : undefined;
    return head ? (data.versions.get(head.id) ?? undefined) : undefined;
  };

  // Блоки «Дальше» монтируются один раз: колонкой на широкой области или
  // содержимым панели на узкой, но не обеими сразу.
  const next = (
    <>
      <ReadyZone data={data} stages={stages} count={ready} rowProps={rowProps} inParent={inParent} />
      <DoneZone data={data} rowProps={rowProps} />
    </>
  );

  const nextCount = ready;
  const showZones = !unknownType && !parentMissing && finalState !== 'empty-project';

  let body: ReactNode;
  if (unknownType) {
    body = (
      <Note
        tone="error"
        title={`Типа ${filters.type} в проекте нет`}
        description="Доступные типы — в списке «Все типы». Блоки не показаны.">
        <Button variant="outline" size="sm" onClick={() => setFilter('type', '')}>
          Сбросить фильтр
        </Button>
      </Note>
    );
  } else if (parentMissing) {
    body = (
      <Note
        tone="error"
        title={`Задачи ${filters.parent} в проекте нет`}
        description="Ссылка устарела или ключ набран с ошибкой. Блоки не показаны, чтобы не принять пустую страницу за пустой проект.">
        <Button variant="outline" size="sm" onClick={() => setFilter('parent', '')}>
          Сбросить фильтр
        </Button>
      </Note>
    );
  } else if (filters.parent && data.parent.data && !data.parent.data.hasChildren) {
    body = (
      <EmptyState
        title={`У задачи ${filters.parent} пока нет дочерних задач`}
        description={`Дочерние задачи заводят в карточке задачи или командой clab create --parent ${filters.parent}.`}
      />
    );
  } else if (finalState === 'empty-project') {
    body = (
      <EmptyState
        title="В проекте пока нет задач"
        description="Заведите первую задачу. Этапы с ролью забирают исполнители — люди или агенты, подключённые на странице «Подключение»; этапы без роли ведут участники проекта."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {newTask(true)}
            <Button asChild variant="outline">
              <Link to={docsHref(projectKey)}>Подключение</Link>
            </Button>
          </div>
        }
      />
    );
  } else if (finalState === 'no-results') {
    body = (
      <EmptyState
        title="Ничего не найдено по фильтрам"
        description={`${filterSummary(filters)}. Ни в одном блоке и в сводке нет подходящих задач — это не пустой проект.`}
        action={
          <Button variant="outline" onClick={resetFilters}>
            Сбросить
          </Button>
        }
      />
    );
  } else {
    body = (
      <div className={cn('grid gap-6', mode === 'column' && 'grid-cols-[minmax(0,1fr)_340px]')}>
        <div className="min-w-0 space-y-8">
          <SummaryZone data={data} projectKey={projectKey} filters={filters} narrow={mode === 'sheet'} />
          <DecisionsZone data={data} filters={filters} canDecide={canDecide} rowProps={rowProps} />
          <BlockedZone data={data} rowProps={rowProps} />
          <WorkZone
            data={data}
            rowProps={rowProps}
            types={types}
            versionOf={versionOf}
            showType={types.length > 1 && !filters.type}
          />
        </div>
        {mode === 'column' ? (
          <aside aria-label="Дальше" className="min-w-0 space-y-8" data-next-column>
            {next}
          </aside>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="mx-auto w-full max-w-[1440px] space-y-5 p-4 sm:p-6" data-overview>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Обзор</h1>
          <p className="text-muted-foreground text-sm">
            {project?.project.name ?? projectKey} · что можно брать, что идёт и что ждёт решения
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {mode === 'sheet' && showZones ? (
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" data-next-button>
                  <PanelRight aria-hidden />
                  Дальше
                  <span
                    aria-label={`можно брать: ${nextCount ? (nextCount.partial ? `${nextCount.n}+` : nextCount.n) : '—'}`}
                    className={cn(
                      'rounded-full px-1.5 text-xs tabular-nums',
                      nextCount?.n ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                    )}>
                    {nextCount === null ? '—' : nextCount.partial ? `${nextCount.n}+` : nextCount.n}
                  </span>
                </Button>
              </SheetTrigger>
              <SheetContent
                side="right"
                showCloseButton={false}
                className="gap-0 data-[side=right]:w-[min(24rem,calc(100%-3rem))] data-[side=right]:sm:max-w-none"
                data-next-sheet>
                <SheetHeader className="border-b pr-12">
                  <SheetTitle>Дальше</SheetTitle>
                  <SheetDescription>Можно брать сейчас и завершённые</SheetDescription>
                  <SheetClose asChild>
                    <Button variant="ghost" size="icon-sm" className="absolute top-3 right-3" aria-label="Закрыть">
                      <X aria-hidden />
                    </Button>
                  </SheetClose>
                </SheetHeader>
                <div className="min-h-0 flex-1 space-y-8 overflow-y-auto p-4">{next}</div>
              </SheetContent>
            </Sheet>
          ) : null}
          <LiveIndicator
            connection={live.connection}
            updatedAt={data.updatedAt}
            stopReason={live.state.stopReason}
            onRetry={live.refresh}
          />
          <Button
            variant="outline"
            onClick={() => {
              // Не disabled: заблокированная кнопка теряет фокус при каждом
              // автообновлении. Повторное нажатие во время чтения не нужно —
              // чтение уже идёт. Сводка по кнопке — сразу, без окна.
              if (data.refreshing) return;
              data.refreshNow();
              live.refresh();
            }}
            aria-busy={data.refreshing || undefined}
            aria-label="Обновить"
            title={updatedClock ? `Обновить · данные на ${updatedClock}` : 'Обновить'}
            className="max-sm:size-8 max-sm:px-0"
            data-refresh>
            <RefreshCw aria-hidden className={cn(data.refreshing && 'animate-spin')} />
            <span className="max-sm:sr-only">Обновить</span>
          </Button>
          {newTask(false)}
        </div>
      </div>

      {finalState !== 'empty-project' || filtered ? (
        <FiltersBar
          filters={filters}
          types={types}
          parents={data.parents.data}
          parentInfo={data.parent.data ?? null}
          onType={(v) => setFilter('type', v)}
          onParent={(v) => setFilter('parent', v)}
          onQuery={(v) => setFilter('q', v, true)}
          onReset={resetFilters}
        />
      ) : null}

      {filters.parent && data.parent.data ? (
        <ParentStrip projectKey={projectKey} info={data.parent.data} onReset={() => setFilter('parent', '')} />
      ) : null}
      {filters.parent && data.parent.error ? (
        <Failure error={data.parent.error} title={`Задача ${filters.parent} не прочиталась`} reload={data.parent.retry} />
      ) : null}

      {body}
    </div>
  );
}

// Число задач в «Требуют решения»: у того, кто решает, — разные задачи
// записей /approvals после фильтров; у наблюдателя — total списка.
function decisionsCount(data: OverviewData, f: OverviewFilters): number | null {
  const a = data.approvals;
  if (a.error || !a.data) return null;
  if (a.data.can_decide) {
    return new Set(filterApprovals(a.data.approvals, f).map((x) => x.task.key)).size;
  }
  if (data.decisionsList.error || !data.decisionsList.data) return null;
  return data.decisionsList.data.total;
}

function Rows({children}: {children: ReactNode}) {
  return <div className="space-y-2">{children}</div>;
}

// Строка «кто и что делает»: стрелка, части текста, ключи блокирующих —
// ссылками в карточки (после ссылки строки по Tab).
function ActionLine({action, projectKey}: {action: RowAction; projectKey: string}) {
  return (
    <p className="flex items-start gap-1.5" data-row-action-code={action.code}>
      <ArrowRight aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0">
        {action.parts.map((p, i) =>
          'keys' in p ? (
            <Fragment key={i}>
              {p.keys.map((k, j) => (
                <Fragment key={k}>
                  {j > 0 ? ', ' : null}
                  <Link
                    to={`/p/${projectKey}/tasks/${k}`}
                    className="focus-visible:ring-ring/50 relative z-10 rounded-sm underline underline-offset-2 focus-visible:ring-[3px] focus-visible:outline-none"
                    data-action-key>
                    {k}
                  </Link>
                </Fragment>
              ))}
            </Fragment>
          ) : p.strong ? (
            <strong key={i} className="font-semibold">
              {p.text}
            </strong>
          ) : (
            <Fragment key={i}>{p.text}</Fragment>
          ),
        )}
      </span>
    </p>
  );
}

// ── Требуют решения ─────────────────────────────────────────────────────────

function DecisionsZone({
  data,
  filters,
  canDecide,
  rowProps,
}: {
  data: OverviewData;
  filters: OverviewFilters;
  canDecide: boolean | undefined;
  rowProps: RowProps;
}) {
  const a = data.approvals;
  const list = data.decisionsList;
  const viewer = a.data?.can_decide === false;
  const rows = a.data
    ? viewer
      ? (list.data?.tasks ?? []).map((task) => ({task, approvals: []}))
      : decisionRows(filterApprovals(a.data.approvals, filters), list.data?.tasks ?? [])
    : [];
  // У того, кто решает, набор блока — записи /approvals: упавший список строк
  // не роняет блок, строки тогда строятся из записей.
  const error = a.error ?? (viewer ? list.error : undefined);
  // Пока список не пришёл, строки строились бы из записей — ждём оба ответа.
  const pending = !a.data || (!list.data && !list.error);
  const count = decisionsCount(data, filters);
  const truncated = a.data?.truncated === true;
  const shown = data.view.decisionsMore ? rows : rows.slice(0, CAPS.decisions);
  const hidden = rows.length - shown.length;

  return (
    <Zone
      zone="decisions"
      count={error ? null : count}
      partial={truncated}
      tone="blue"
      pending={pending && !error}
      error={error}
      retry={() => {
        a.retry();
        list.retry();
      }}
      busy={a.loading || list.loading}
      isEmpty={rows.length === 0}
      emptyText={viewer ? ZONE_EMPTY.decisionsViewer : ZONE_EMPTY.decisions}
      note={
        viewer ? (
          <p className="text-muted-foreground flex items-center gap-1.5 text-sm" data-viewer-note>
            <UserCheck aria-hidden className="size-4" />
            Решать может уровень сопровождающего и выше
          </p>
        ) : null
      }>
      {shown.length > 0 ? (
        <Rows>
          {shown.map((r) => (
            <TaskRow
              key={r.task.key}
              task={r.task}
              zone="decisions"
              density="card"
              approvals={r.approvals}
              canDecide={canDecide !== false}
              action={<ActionLine action={decisionAction(r.approvals, canDecide !== false)} projectKey={rowProps.projectKey} />}
              {...rowProps}
            />
          ))}
        </Rows>
      ) : null}
      {hidden > 0 ? <MoreButton label={`Ещё ${hidden}`} onClick={() => data.setView({decisionsMore: true})} /> : null}
      {data.view.decisionsMore && rows.length > CAPS.decisions ? (
        <MoreButton label="Показать меньше" onClick={() => data.setView({decisionsMore: false})} />
      ) : null}
      {truncated ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-amber-700 dark:text-amber-300" data-truncated>
          <AlertTriangle aria-hidden className="size-4" />
          {data.view.approvalsAll ? (
            'Больше 200 — показаны первые 200'
          ) : (
            <>
              Показаны не все ожидающие решения.
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={() => data.setView({approvalsAll: true, decisionsMore: true})}>
                Показать все
              </Button>
            </>
          )}
        </p>
      ) : null}
      {a.moreFailed ? <MoreFailed retry={a.retry} /> : null}
    </Zone>
  );
}

// ── Заблокировано ───────────────────────────────────────────────────────────

function BlockedZone({data, rowProps}: {data: OverviewData; rowProps: RowProps}) {
  const z = data.blocked;
  const all = z.data?.tasks ?? [];
  // Две выборки по CAPS строк: видимых — не больше потолка, пока не нажато
  // «Ещё N».
  const rows = data.view.blockedMore ? all : all.slice(0, CAPS.blocked);
  const total = z.data?.total ?? 0;
  const hidden = total - rows.length;
  return (
    <Zone
      zone="blocked"
      count={z.error && !z.moreFailed ? null : z.data ? total : null}
      tone="red"
      pending={!z.data && !z.error}
      error={z.moreFailed ? undefined : z.error}
      retry={z.retry}
      busy={z.loading}
      isEmpty={rows.length === 0}
      emptyText={ZONE_EMPTY.blocked}>
      {rows.length > 0 ? (
        <Rows>
          {rows.map((t) => (
            <TaskRow
              key={t.key}
              task={t}
              zone="stuck"
              density="card"
              action={<ActionLine action={blockedAction(t, data.versions.get(t.workflow_id) ?? null)} projectKey={rowProps.projectKey} />}
              {...rowProps}
            />
          ))}
        </Rows>
      ) : null}
      <ZoneMore
        hidden={hidden}
        expanded={data.view.blockedMore}
        busy={z.loading}
        label={(n) => `Ещё ${n}`}
        onMore={() => data.setView({blockedMore: true})}
        onLess={() => data.setView({blockedMore: false})}
        canLess={rows.length > CAPS.blocked}
      />
      {z.moreFailed ? <MoreFailed retry={z.retry} /> : null}
    </Zone>
  );
}

function ZoneMore({
  hidden,
  expanded,
  busy,
  label,
  onMore,
  onLess,
  canLess,
}: {
  hidden: number;
  expanded: boolean;
  busy: boolean;
  label: (n: number) => string;
  onMore: () => void;
  onLess: () => void;
  canLess: boolean;
}) {
  if (hidden > 0 && !expanded) return <MoreButton label={label(hidden)} onClick={onMore} busy={busy} />;
  if (hidden > 0 && expanded) return <MoreButton label={label(hidden)} onClick={onMore} busy />;
  if (expanded && canLess) return <MoreButton label="Показать меньше" onClick={onLess} busy={busy} />;
  return null;
}

// ── Что делается сейчас ─────────────────────────────────────────────────────

function WorkZone({
  data,
  rowProps,
  types,
  versionOf,
  showType,
}: {
  data: OverviewData;
  rowProps: RowProps;
  types: string[];
  versionOf: (type: string) => Workflow | undefined;
  showType: boolean;
}) {
  const z = data.work;
  const all = z.data?.tasks ?? [];
  const rows = data.view.workMore ? all : all.slice(0, CAPS.work);
  const total = z.data?.total ?? 0;
  const groups = workGroups(rows, {types, versionOf, showType});
  return (
    <Zone
      zone="work"
      count={z.error && !z.moreFailed ? null : z.data ? total : null}
      aside="по статусам циклов"
      pending={!z.data && !z.error}
      error={z.moreFailed ? undefined : z.error}
      retry={z.retry}
      busy={z.loading}
      isEmpty={rows.length === 0}
      emptyText={ZONE_EMPTY.work}>
      {groups.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(340px,100%),1fr))] gap-x-6 gap-y-5">
          {groups.map((g) => (
            <div key={g.id} className="min-w-0 space-y-2" data-work-group={g.id}>
              <div className="space-y-0.5">
                <h3 className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                  <StatusColorDot color={g.color} category={g.category} />
                  <span className="min-w-0 truncate" title={g.name}>
                    {g.name}
                  </span>
                  {g.showType ? <span className="text-muted-foreground shrink-0 font-normal">· {g.type}</span> : null}
                  <span className="text-muted-foreground shrink-0 font-normal">· {g.rows.length}</span>
                  {g.optional ? <Token label="необязательный" className="shrink-0 border-dashed" /> : null}
                  {g.old ? <Token label="прежняя версия цикла" color="orange" className="shrink-0" /> : null}
                </h3>
                <p className="text-muted-foreground flex items-center gap-1 text-xs" data-work-group-roles>
                  <Users aria-hidden className="size-3 shrink-0" />
                  <span className="truncate" title={g.roles ?? NO_ROLE_GROUP}>
                    {g.roles ?? NO_ROLE_GROUP}
                  </span>
                </p>
              </div>
              <Rows>
                {g.rows.map((t) => (
                  <TaskRow key={t.key} task={t} zone="working" density="card" {...rowProps} />
                ))}
              </Rows>
            </div>
          ))}
        </div>
      ) : null}
      <ZoneMore
        hidden={total - rows.length}
        expanded={data.view.workMore}
        busy={z.loading}
        label={(n) => `Показать ещё ${n}`}
        onMore={() => data.setView({workMore: true})}
        onLess={() => data.setView({workMore: false})}
        canLess={rows.length > CAPS.work}
      />
      {z.moreFailed ? <MoreFailed retry={z.retry} /> : null}
    </Zone>
  );
}

// ── Завершено недавно ───────────────────────────────────────────────────────

function DoneZone({data, rowProps}: {data: OverviewData; rowProps: RowProps}) {
  const z = data.done;
  const rows = z.data?.tasks ?? [];
  const total = z.data?.total ?? 0;
  const page = data.view.donePage;
  const from = page === null ? 0 : page * CAPS.donePage;
  const lastPage = Math.max(0, Math.ceil(total / CAPS.donePage) - 1);
  return (
    <Zone
      zone="done"
      count={z.error && !z.moreFailed ? null : z.data ? total : null}
      pending={!z.data && !z.error}
      error={z.moreFailed ? undefined : z.error}
      retry={z.retry}
      busy={z.loading}
      density="row"
      isEmpty={rows.length === 0}
      emptyText={ZONE_EMPTY.done}>
      {rows.length > 0 ? (
        <Rows>
          {rows.map((t) => (
            <TaskRow key={t.key} task={t} zone="done" density="row" {...rowProps} />
          ))}
        </Rows>
      ) : null}
      {page === null && total > rows.length ? (
        <Button variant="link" size="sm" className="h-auto p-0" onClick={() => data.setView({donePage: 0})} data-done-all>
          Все {total}
          <ChevronRight aria-hidden />
        </Button>
      ) : null}
      {page !== null ? (
        <div className="space-y-2" data-done-pager>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground text-xs tabular-nums">
              Показано {total === 0 ? 0 : from + 1}–{Math.min(from + CAPS.donePage, total)} из {total}
            </span>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 0 || z.loading}
                onClick={() => data.setView({donePage: page - 1})}>
                <ChevronLeft aria-hidden />
                Назад
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= lastPage || z.loading}
                onClick={() => data.setView({donePage: page + 1})}>
                Вперёд
                <ChevronRight aria-hidden />
              </Button>
            </div>
          </div>
          <Button variant="link" size="sm" className="h-auto p-0" onClick={() => data.setView({donePage: null})}>
            Свернуть до 5
          </Button>
        </div>
      ) : null}
      {z.moreFailed ? <MoreFailed retry={z.retry} /> : null}
    </Zone>
  );
}

// ── шапка: фильтры ──────────────────────────────────────────────────────────

function FiltersBar({
  filters,
  types,
  parents,
  parentInfo,
  onType,
  onParent,
  onQuery,
  onReset,
}: {
  filters: OverviewFilters;
  types: string[];
  parents: TaskListPage | undefined;
  parentInfo: ParentInfo | null;
  onType: (v: string) => void;
  onParent: (v: string) => void;
  onQuery: (v: string) => void;
  onReset: () => void;
}) {
  const {parents: options, truncated} = parentOptions(parents?.tasks ?? [], parents?.total ?? 0);
  // Родитель из адреса, которого нет среди открытых с детьми (завершённый,
  // без детей), остаётся выбранным значением, а не пропадает из поля.
  const current = filters.parent && !options.some((e) => e.key === filters.parent) ? filters.parent : null;
  const selectedOutline = 'border-ring';
  const parentTitle = filters.parent
    ? `Родитель: ${filters.parent}${parentInfo?.title ? ` ${parentInfo.title}` : ''}`
    : 'Родитель: любой';

  return (
    <div className="flex flex-wrap items-center gap-2" data-filters>
      <SearchField value={filters.q} onChange={onQuery} />
      {types.length > 1 ? (
        <Select value={filters.type || ALL} onValueChange={(v) => onType(v === ALL ? '' : v)}>
          <SelectTrigger aria-label="Тип задач" className={cn('w-auto min-w-32', filters.type && selectedOutline)} data-filter-type>
            <SelectValue placeholder="Все типы" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Все типы</SelectItem>
            {types.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {showParentFilter(options, filters.parent) ? (
        <Select value={filters.parent || ALL} onValueChange={(v) => onParent(v === ALL ? '' : v)}>
          <SelectTrigger
            aria-label="Родительская задача"
            className={cn('w-auto max-w-72 min-w-32', filters.parent && selectedOutline)}
            data-filter-parent>
            <SelectValue>
              <span className="truncate">{parentTitle}</span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="max-w-sm">
            <SelectItem value={ALL}>Любой родитель</SelectItem>
            {options.length > 0 || current ? <SelectSeparator /> : null}
            <SelectGroup>
              {options.length > 0 ? <SelectLabel>Открытые задачи с детьми</SelectLabel> : null}
              {current ? (
                <SelectItem value={current}>
                  <span className="font-mono text-xs">{current}</span>
                </SelectItem>
              ) : null}
              {options.map((e) => (
                <SelectItem key={e.key} value={e.key}>
                  <span className="text-muted-foreground font-mono text-xs">{e.key}</span>
                  <span className="truncate">{e.title}</span>
                </SelectItem>
              ))}
            </SelectGroup>
            {truncated ? (
              <>
                <SelectSeparator />
                <p className="flex gap-1.5 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-300" data-parents-truncated>
                  <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  Показаны задачи с детьми среди первых 200 задач верхнего уровня. Другую откройте по адресу ?parent=КЛЮЧ;
                  завершённые здесь не показаны.
                </p>
              </>
            ) : null}
          </SelectContent>
        </Select>
      ) : null}
      {isFiltered(filters) ? (
        <Button variant="link" size="sm" className="px-1" onClick={onReset} data-filters-reset>
          Сбросить
        </Button>
      ) : null}
    </div>
  );
}

// Поиск по ключу и заголовку (Д-3): ввод с паузой 300 мс уходит в ?q= через
// replace — история не копится; «×» и Esc очищают.
function SearchField({value, onChange}: {value: string; onChange: (v: string) => void}) {
  const id = useId();
  const [text, setText] = useState(value);
  const [synced, setSynced] = useState(value);
  // Адрес поменялся снаружи (сброс, назад) — поле за ним.
  if (synced !== value) {
    setSynced(value);
    setText(value);
  }
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  useEffect(() => {
    if (text.trim() === value) return;
    const t = window.setTimeout(() => onChangeRef.current(text), 300);
    return () => window.clearTimeout(t);
  }, [text, value]);

  const clear = () => {
    setText('');
    onChange('');
  };

  return (
    <div role="search" className="w-full sm:w-70 sm:min-w-50 sm:shrink">
      <label htmlFor={id} className="sr-only">
        Ключ или заголовок
      </label>
      <InputGroup className={cn(value && 'border-ring')}>
        <InputGroupAddon>
          <Search aria-hidden />
        </InputGroupAddon>
        <InputGroupInput
          id={id}
          type="search"
          value={text}
          placeholder="Ключ или заголовок"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && text) {
              e.preventDefault();
              clear();
            }
          }}
          data-filter-q
          className="[&::-webkit-search-cancel-button]:hidden"
        />
        {text ? (
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="icon-xs" aria-label="Очистить поиск" onClick={clear}>
              <X aria-hidden />
            </InputGroupButton>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
    </div>
  );
}

// Полоса родителя под шапкой (?parent=): какие задачи сейчас на странице.
function ParentStrip({projectKey, info, onReset}: {projectKey: string; info: ParentInfo; onReset: () => void}) {
  const progress = info.row ? progressOf(info.row.child_counts) : null;
  const pct = (n: number) => (progress ? `${(n / progress.total) * 100}%` : '0');
  return (
    <div
      className="bg-muted/40 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 py-2 text-sm"
      data-parent-strip>
      <span className="text-muted-foreground">Внутри задачи</span>
      <Link to={`/p/${projectKey}/tasks/${info.key}`} className="font-mono text-xs hover:underline">
        {info.key}
      </Link>
      <span className="min-w-0 font-medium">{info.title}</span>
      {progress ? (
        <>
          <span role="img" aria-label={progress.aria} className="bg-muted flex h-1.5 w-16 overflow-hidden rounded-full">
            <span className="bg-primary h-full" style={{width: pct(progress.done)}} />
            <span className="bg-primary/50 h-full" style={{width: pct(progress.active)}} />
          </span>
          <span className="text-muted-foreground text-xs">{progress.label}</span>
        </>
      ) : null}
      <Button variant="link" size="sm" className="ml-auto h-auto p-0" onClick={onReset}>
        Сбросить
      </Button>
    </div>
  );
}
