import {createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {Link, useParams} from 'react-router-dom';
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  ChevronRight,
  Info,
  MoreHorizontal,
  Plus,
  RefreshCw,
} from 'lucide-react';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger} from '@/components/ui/select';
import {Skeleton} from '@/components/ui/skeleton';
import {EmptyState, Note, Spinner} from '@/components/kit';
import {cn} from '@/lib/utils';

import {api} from '../api/client';
import type {ProjectDetail, RankTaskBody, TaskRow as TaskRowData} from '../api/types';
import {useResource} from '../api/useResource';
import {Failure} from '../components/Feedback';
import {NewTaskDialog} from '../components/NewTaskDialog';
import {PRIORITIES, priorityClass, priorityLabel} from '../components/priorities';
import {taskTypes} from '../components/taskTypes';
import {TaskRow} from '../components/taskrow/TaskRow';
import {WorkflowVersionsProvider} from '../components/taskrow/versions';
import {LiveIndicator} from '../components/overview/LiveIndicator';
import {MoreButton, MoreFailed} from '../components/overview/Zone';
import {defaultNewTaskType} from '../components/overview/zones';
import {
  ECHO_MS,
  MOVE_ERRORS,
  MOVE_LABELS,
  PAGE_TEXTS,
  VIEWER_NOTE,
  childrenQuery,
  createReloadGate,
  dropRows,
  epicListLabel,
  expandLabel,
  expandedKey,
  groupTitle,
  hasChildren,
  isBacklogRejected,
  isUnreachable,
  lacksRank,
  menuLabel,
  moreLabel,
  moveEdges,
  moveFailure,
  moveRows,
  movedAnnouncement,
  needsNextNeighbor,
  planDrop,
  priorityError,
  priorityLabelFor,
  rankBody,
  reloadAfterFailure,
  summaryText,
  topQuery,
  type MoveKind,
  type ReloadGate,
} from '../components/backlog/rules';
import {GroupDnd, HandleGap, OverlayGrip, SortableItem} from '../components/backlog/dnd';
import {useBacklogFocus, type BacklogFocus} from '../components/backlog/useBacklogFocus';
import {useBacklogGroup, type BacklogGroup} from '../components/backlog/useBacklogGroup';
import {clockLabel} from '../hooks/liveFeed';
import {useBacklogEditable} from '../hooks/useBacklogEditable';
import {useCollapsed} from '../hooks/useCollapsed';
import {useProjectEvents} from '../hooks/useProjectEvents';

// Страница «Бэклог» (CLAB-402, эпик CLAB-368, design.spec §2–§8): все
// неначатые задачи проекта верхнего уровня в порядке ранга сервера, эпики
// раскрываются на один уровень. Порядок меняет меню строки (POST …/rank),
// приоритет — выбор прямо в строке (PATCH). Строки переставляются и
// перетаскиванием за ручку (CLAB-403, components/backlog/dnd.tsx) — тем же
// запросом. Правила — components/backlog/rules.ts; ключей статусов, ролей и
// типов здесь нет: состав бэклога решает сервер (backlog=true), эпик — строка
// с детьми.
export function Backlog() {
  const {projectKey = ''} = useParams();
  const project = useResource(() => api.getProject(projectKey), [projectKey]);

  if (project.error) {
    return (
      <div className="mx-auto w-full max-w-[1100px] p-4 sm:p-6">
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
      <BacklogPage projectKey={projectKey} project={project.data} />
    </WorkflowVersionsProvider>
  );
}

// Общее для групп страницы: верхнего уровня и детей раскрытых эпиков.
interface BacklogContext {
  projectKey: string;
  project?: ProjectDetail;
  editable: boolean;
  recheck: () => void;
  gate: ReloadGate;
  focus: BacklogFocus;
  announce: (text: string) => void;
  tick: number;
  ready: boolean;
}

const Ctx = createContext<BacklogContext | null>(null);

function useBacklogContext(): BacklogContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('BacklogContext вне страницы бэклога');
  return ctx;
}

function BacklogPage({projectKey, project}: {projectKey: string; project?: ProjectDetail}) {
  const [tick, setTick] = useState(0);
  const reloadAll = useCallback(() => setTick((n) => n + 1), []);
  // Перечитывание откладывается, пока открыто меню или выбор приоритета и
  // пока ждёт свой запрос (design.spec §6).
  const [gate] = useState(() => createReloadGate(reloadAll));
  const live = useProjectEvents(projectKey, () => gate.wake());

  const top = useBacklogGroup(
    (offset, limit) => api.listTasks(projectKey, topQuery(offset, limit)),
    projectKey,
    tick,
    live.ready,
  );
  const focus = useBacklogFocus(top.loading);
  const owner = project?.project.owner_team_key;
  const {editable, recheck} = useBacklogEditable(projectKey, owner);

  const unreachable = top.error !== undefined && isUnreachable(top.error);
  const {reloadResult} = live;
  useEffect(() => {
    if (live.ready && !top.loading) reloadResult(!unreachable);
  }, [live.ready, top.loading, unreachable, reloadResult]);

  // Время последнего полного чтения — подпись «Нет связи · данные на HH:MM».
  const [stamp, setStamp] = useState<{key: string; at: number} | null>(null);
  const settled = live.ready && top.loaded && !top.loading && !unreachable;
  useEffect(() => {
    // Часы — внешняя система: момент прихода данных в состоянии не выразить.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (settled) setStamp({key: projectKey, at: Date.now()});
  }, [settled, top.loading, projectKey]);
  const updatedAt = stamp?.key === projectKey ? stamp.at : null;
  const updatedClock = clockLabel(updatedAt);

  const [message, setMessage] = useState('');
  const announce = useCallback((text: string) => setMessage(text), []);

  const types = project ? taskTypes(project) : [];
  const newTask = (label: boolean) =>
    project ? (
      <NewTaskDialog
        project={project}
        defaultType={defaultNewTaskType('', types)}
        onCreated={() => gate.wake()}
        trigger={
          <Button aria-label="Новая задача" className={label ? undefined : 'max-sm:size-8 max-sm:px-0'}>
            <Plus aria-hidden />
            <span className={label ? undefined : 'max-sm:sr-only'}>Новая задача</span>
          </Button>
        }
      />
    ) : null;

  const oldServer = (top.error !== undefined && isBacklogRejected(top.error)) || (top.loaded && lacksRank({tasks: top.rows}));
  const refreshing = tick > 0 && top.loading;

  let body: ReactNode;
  if (oldServer) {
    body = (
      <div data-backlog-old-server>
        <Note tone="warning" title={PAGE_TEXTS.oldServer} description={PAGE_TEXTS.oldServerHint} />
      </div>
    );
  } else if (!top.loaded && top.error) {
    body = <Failure error={top.error} title={PAGE_TEXTS.failed} reload={top.retry} />;
  } else if (!top.loaded) {
    body = (
      <div className="space-y-2" data-backlog-skeleton aria-busy>
        <p className="h-4" aria-hidden />
        {Array.from({length: 6}, (_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  } else if (top.total === 0 && top.rows.length === 0) {
    body = (
      <div data-backlog-empty>
        <EmptyState
          title={PAGE_TEXTS.empty}
          description={PAGE_TEXTS.emptyHint}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {newTask(true)}
              <Button asChild variant="outline">
                <Link to={`/p/${projectKey}/overview`}>На обзор</Link>
              </Button>
            </div>
          }
        />
      </div>
    );
  } else {
    body = (
      <div className="space-y-3">
        {editable ? null : (
          <div data-backlog-viewer>
            <Note
              title={
                <span className="inline-flex items-center gap-2">
                  <Info aria-hidden className="size-4 shrink-0" />
                  {VIEWER_NOTE}
                </span>
              }
            />
          </div>
        )}
        <p className="text-muted-foreground text-xs" data-backlog-summary>
          {summaryText(top.total)}
        </p>
        <GroupList group={top} parent={null} label={PAGE_TEXTS.listLabel} topLevel />
      </div>
    );
  }

  const ctx: BacklogContext = {projectKey, project, editable, recheck, gate, focus, announce, tick, ready: live.ready};

  return (
    <Ctx.Provider value={ctx}>
      <div className="mx-auto w-full max-w-[1100px] space-y-5 p-4 sm:p-6" data-backlog-page>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">{PAGE_TEXTS.title}</h1>
            <p className="text-muted-foreground text-sm">
              {project?.project.name ?? projectKey} · {PAGE_TEXTS.subtitle}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LiveIndicator
              connection={live.connection}
              updatedAt={updatedAt}
              stopReason={live.state.stopReason}
              onRetry={live.refresh}
            />
            <Button
              variant="outline"
              onClick={() => {
                // Не disabled: кнопка в фокусе теряла бы его при каждом
                // автообновлении.
                if (!refreshing) live.refresh();
              }}
              aria-busy={refreshing || undefined}
              aria-label="Обновить"
              title={updatedClock ? `Обновить · данные на ${updatedClock}` : 'Обновить'}
              className="max-sm:size-8 max-sm:px-0"
              data-refresh>
              <RefreshCw aria-hidden className={cn(refreshing && 'animate-spin')} />
              <span className="max-sm:sr-only">Обновить</span>
            </Button>
            {newTask(false)}
          </div>
        </div>
        <span aria-live="polite" className="sr-only" data-backlog-announce>
          {message}
        </span>
        {body}
      </div>
    </Ctx.Provider>
  );
}

// ── группа: верхний уровень или дети эпика ──────────────────────────────────

function GroupList({
  group,
  parent,
  label,
  topLevel,
  onDragging,
}: {
  group: BacklogGroup;
  parent: string | null;
  label: string;
  topLevel?: boolean;
  // Группу начали и закончили перетаскивать (подсветка блока эпика).
  onDragging?: (dragging: boolean) => void;
}) {
  const ctx = useBacklogContext();
  const olRef = useRef<HTMLOListElement>(null);
  // Зона броска: у детей — блок эпика, у верхнего уровня — весь список.
  const zone = useCallback(
    () => olRef.current?.closest<HTMLElement>('[data-backlog-children]') ?? olRef.current,
    [],
  );
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const dragHold = useRef<(() => void) | null>(null);
  useEffect(() => () => dragHold.current?.(), []);
  const [busy, setBusy] = useState<Record<string, 'move' | 'priority'>>({});
  const mark = (key: string, what: 'move' | 'priority' | null) =>
    setBusy((b) => {
      const next = {...b};
      if (what) next[key] = what;
      else delete next[key];
      return next;
    });

  // Дети эпика рисуются своим компонентом: фокус после их перестановки
  // возвращается отсюда.
  const {check} = ctx.focus;
  useLayoutEffect(() => {
    check();
  });

  const move = async (key: string, kind: MoveKind) => {
    const rows = group.rows;
    const index = rows.findIndex((r) => r.key === key);
    if (index < 0 || busy[key]) return;
    const release = ctx.gate.hold();
    mark(key, 'move');
    ctx.focus.expect(key, 'menu');
    try {
      let next: TaskRowData | undefined;
      if (needsNextNeighbor(kind, index, rows.length, group.total)) {
        try {
          next = await group.peekNext();
        } catch (err) {
          const failure = moveFailure(err);
          toast.error(MOVE_ERRORS[failure]);
          if (reloadAfterFailure(failure)) ctx.gate.wake();
          return;
        }
      }
      const body = rankBody(
        kind,
        rows.map((r) => r.key),
        index,
        next?.key,
      );
      if (!body) {
        // Сосед ниже не нашёлся: группа короче, чем казалось.
        ctx.gate.wake();
        return;
      }
      await commit(key, body, (cur) => moveRows(cur, cur.findIndex((r) => r.key === key), kind, group.total, next), rows);
    } finally {
      mark(key, null);
      release();
    }
  };

  // Общий хвост перемещения — из меню и броском: строка встаёт на новое место
  // до ответа, при отказе возвращается. Удержание перечитывания и пометка
  // «занята» — у вызывающего.
  const commit = async (
    key: string,
    body: RankTaskBody,
    apply: (rows: TaskRowData[]) => TaskRowData[],
    before: TaskRowData[],
  ) => {
    group.mutate(apply);
    try {
      const result = await api.rankTask(key, body);
      ctx.announce(movedAnnouncement(key, body, result));
      // Событие этого же перемещения придёт следом: список перечитывается
      // один раз — по нему, а нет его — по окончании окна (CLAB-403, К-12).
      if (result.changed) ctx.gate.echo(ECHO_MS);
      // То же место: событий нет, перечитывать нечего — строка на прежнем.
      else group.mutate(() => before);
    } catch (err) {
      group.mutate(() => before);
      const failure = moveFailure(err);
      toast.error(MOVE_ERRORS[failure]);
      if (failure === 'forbidden') ctx.recheck();
      if (reloadAfterFailure(failure)) ctx.gate.wake();
    }
  };

  // Бросок строки key на место строки over той же группы.
  const drop = async (key: string, over: string) => {
    const rows = group.rows;
    const plan = planDrop(rows.map((r) => r.key), key, over);
    if (!plan.body || busy[key]) return;
    const release = ctx.gate.hold();
    mark(key, 'move');
    try {
      await commit(
        key,
        plan.body,
        (cur) => dropRows(cur, cur.findIndex((r) => r.key === key), cur.findIndex((r) => r.key === over)),
        rows,
      );
    } finally {
      mark(key, null);
      release();
    }
  };

  const onDragStart = (key: string) => {
    setDraggingKey(key);
    // Пока строку тянут, список под курсором не перечитывается.
    dragHold.current = ctx.gate.hold();
    onDragging?.(true);
  };
  const onDragEnd = (key: string, over: string | null) => {
    const release = dragHold.current;
    dragHold.current = null;
    setDraggingKey(null);
    onDragging?.(false);
    // Фокус остаётся на ручке этой строки на новом месте.
    ctx.focus.expect(key, 'handle');
    // Своё удержание бросок берёт до того, как отпустится удержание жеста.
    if (over) void drop(key, over);
    release?.();
  };

  const setPriority = async (row: TaskRowData, value: string) => {
    if (value === row.priority || busy[row.key]) return;
    const prev = row.priority;
    const priority = value as TaskRowData['priority'];
    const release = ctx.gate.hold();
    mark(row.key, 'priority');
    group.mutate((cur) => cur.map((r) => (r.key === row.key ? {...r, priority} : r)));
    try {
      await api.updateTask(row.key, {priority});
      ctx.gate.wake();
    } catch (err) {
      group.mutate((cur) => cur.map((r) => (r.key === row.key ? {...r, priority: prev} : r)));
      toast.error(priorityError(row.key, err));
      if ((err as {httpStatus?: number}).httpStatus === 403) ctx.recheck();
      if (!isUnreachable(err)) ctx.gate.wake();
    } finally {
      mark(row.key, null);
      release();
    }
  };

  const loaded = group.rows.length;
  const more = moreLabel(loaded, group.total);
  // Ручка — у редактора в группе из двух строк и больше.
  const sortable = ctx.editable && loaded > 1;
  const overlay = (key: string) => {
    const row = group.rows.find((r) => r.key === key);
    return row ? (
      <TaskRow
        task={row}
        projectKey={ctx.projectKey}
        project={ctx.project}
        zone="backlog"
        density="row"
        hideEpic
        showInWork
        leading={<OverlayGrip />}
      />
    ) : null;
  };

  return (
    <div className="space-y-2">
      <GroupDnd
        keys={group.rows.map((r) => r.key)}
        enabled={ctx.editable}
        zone={zone}
        onStart={onDragStart}
        onEnd={onDragEnd}
        overlay={overlay}>
        <ol
          ref={olRef}
          aria-label={label}
          className="space-y-2"
          data-backlog-list={topLevel ? '' : undefined}
          data-backlog-group={parent ?? ''}>
          {group.rows.map((row, index) => (
            <BacklogRow
              key={row.key}
              row={row}
              parent={parent}
              edges={moveEdges(index, loaded, group.total)}
              busy={busy[row.key]}
              topLevel={Boolean(topLevel)}
              sortable={sortable}
              dragging={draggingKey === row.key}
              onMove={(kind) => void move(row.key, kind)}
              onPriority={(value) => void setPriority(row, value)}
            />
          ))}
        </ol>
      </GroupDnd>
      {group.moreFailed ? <MoreFailed retry={group.more} /> : null}
      {more ? <MoreButton label={more} onClick={group.more} busy={group.moreBusy} /> : null}
    </div>
  );
}

// ── строка ──────────────────────────────────────────────────────────────────

function BacklogRow({
  row,
  parent,
  edges,
  busy,
  topLevel,
  sortable,
  dragging,
  onMove,
  onPriority,
}: {
  row: TaskRowData;
  parent: string | null;
  edges: Record<MoveKind, boolean>;
  busy?: 'move' | 'priority';
  topLevel: boolean;
  // У строки есть ручка: редактор, в группе две строки и больше.
  sortable: boolean;
  // Строку сейчас тянут: на её месте пунктирная рамка, дети эпика скрыты.
  dragging: boolean;
  onMove: (kind: MoveKind) => void;
  onPriority: (value: string) => void;
}) {
  const ctx = useBacklogContext();
  const withChildren = topLevel && hasChildren(row.child_counts);
  // Хук хранит «свёрнуто»; здесь запись значит «раскрыт» — по умолчанию
  // эпик свёрнут (design.spec §4.3).
  const [expanded, setExpanded] = useCollapsed(expandedKey(ctx.projectKey, row.key));
  const childrenId = useId();
  const open = withChildren && expanded;

  const chevron = topLevel ? (
    withChildren ? (
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        // Раскрытый шеврон без фона: состояние показывает поворот значка.
        className="aria-expanded:bg-transparent hover:aria-expanded:bg-muted max-sm:size-8"
        aria-expanded={open}
        aria-controls={open ? childrenId : undefined}
        aria-label={expandLabel(row.key, open)}
        title={expandLabel(row.key, open)}
        onClick={() => setExpanded(!open)}
        data-row-control="expand"
        data-backlog-expand>
        <ChevronRight aria-hidden className={cn('transition-transform', open && 'rotate-90')} />
      </Button>
    ) : (
      // Место шеврона пустое: ключи строк стоят ровно.
      <span aria-hidden className="block size-6 max-sm:size-8" />
    )
  ) : null;
  // Колонка ручки есть у редактора; в группе из одной строки она пустая —
  // ключи стоят ровно (design.spec §4.1).
  const leadingOf = (handle: ReactNode) => {
    const grip = ctx.editable ? (handle ?? <HandleGap />) : null;
    return grip || chevron ? (
      <>
        {grip}
        {chevron}
      </>
    ) : undefined;
  };

  return (
    <SortableItem rowKey={row.key} enabled={sortable} busy={busy === 'move'}>
      {(handle) => (
        <>
          <TaskRow
            task={row}
            projectKey={ctx.projectKey}
            project={ctx.project}
            zone="backlog"
            density="row"
            hideEpic
            showInWork
            busy={busy === 'move'}
            leading={leadingOf(handle)}
            priorityControl={
              ctx.editable ? (
                <PriorityPicker row={row} busy={busy === 'priority'} onChange={onPriority} />
              ) : undefined
            }
            trailing={
              ctx.editable ? <RowMenu rowKey={row.key} parent={parent} edges={edges} busy={busy === 'move'} onMove={onMove} /> : undefined
            }
          />
          {open ? <EpicChildren epic={row.key} id={childrenId} hidden={dragging} /> : null}
        </>
      )}
    </SortableItem>
  );
}

// Меню «Порядок в бэклоге» (design.spec §5.1). Пока строка ждёт ответа, на
// месте значка — спиннер, меню не открывается; кнопка не disabled, чтобы не
// терять фокус.
function RowMenu({
  rowKey,
  parent,
  edges,
  busy,
  onMove,
}: {
  rowKey: string;
  parent: string | null;
  edges: Record<MoveKind, boolean>;
  busy: boolean;
  onMove: (kind: MoveKind) => void;
}) {
  const ctx = useBacklogContext();
  const [open, setOpen] = useState(false);
  const releaseRef = useRef<(() => void) | null>(null);
  const picked = useRef(false);
  useEffect(() => () => releaseRef.current?.(), []);

  const onOpenChange = (next: boolean) => {
    if (next && busy) return;
    setOpen(next);
    if (next) {
      picked.current = false;
      releaseRef.current = ctx.gate.hold();
    } else {
      releaseRef.current?.();
      releaseRef.current = null;
    }
  };

  const item = (kind: MoveKind, Icon: typeof ArrowUp) => (
    <DropdownMenuItem
      disabled={!edges[kind]}
      onSelect={() => {
        picked.current = true;
        onMove(kind);
      }}
      data-backlog-move={kind}>
      <Icon aria-hidden />
      {MOVE_LABELS[kind]}
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="max-sm:size-8 aria-disabled:cursor-default"
          aria-label={menuLabel(rowKey)}
          title="Порядок"
          aria-disabled={busy || undefined}
          data-row-control="menu"
          data-backlog-menu>
          {busy ? <Spinner /> : <MoreHorizontal aria-hidden />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56"
        onCloseAutoFocus={(e) => {
          // После выбора строка переезжает: фокус вернёт хранитель страницы
          // на кнопку меню этой строки на новом месте.
          if (picked.current) {
            e.preventDefault();
            ctx.focus.restore(rowKey, 'menu');
          }
        }}
        data-backlog-menu-content>
        <DropdownMenuLabel>{groupTitle(parent)}</DropdownMenuLabel>
        {item('up', ArrowUp)}
        {item('down', ArrowDown)}
        <DropdownMenuSeparator />
        {item('top', ArrowUpToLine)}
        {item('bottom', ArrowDownToLine)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Приоритет в строке (design.spec §5.2): токен-выбор. У редактора «обычный»
// показывается (иначе его нечем открыть), «низкий» — с пунктирной рамкой.
// Пока ждёт ответа — aria-busy и не открывается (aria-disabled, без
// disabled, чтобы не терять фокус).
function PriorityPicker({row, busy, onChange}: {row: TaskRowData; busy: boolean; onChange: (value: string) => void}) {
  const ctx = useBacklogContext();
  const [open, setOpen] = useState(false);
  const releaseRef = useRef<(() => void) | null>(null);
  useEffect(() => () => releaseRef.current?.(), []);

  const onOpenChange = (next: boolean) => {
    if (next && busy) return;
    setOpen(next);
    if (next) releaseRef.current = ctx.gate.hold();
    else {
      releaseRef.current?.();
      releaseRef.current = null;
    }
  };

  const tokenClass = (p: string) =>
    cn(priorityClass(p), p === 'normal' && 'text-muted-foreground', p === 'low' && 'border-dashed border-border');

  return (
    <Select value={row.priority} onValueChange={onChange} open={open} onOpenChange={onOpenChange}>
      <SelectTrigger
        size="sm"
        aria-label={priorityLabelFor(row.key, priorityLabel(row.priority))}
        aria-busy={busy || undefined}
        aria-disabled={busy || undefined}
        className={cn(
          'relative z-10 h-5! gap-0.5 rounded-4xl py-0 pr-1.5 pl-2 text-xs font-normal dark:bg-transparent [&>svg]:size-3!',
          tokenClass(row.priority),
        )}
        data-row-control="priority"
        data-backlog-priority={row.priority}>
        {priorityLabel(row.priority)}
      </SelectTrigger>
      <SelectContent position="popper" align="start" data-backlog-priority-content>
        <SelectGroup>
          <SelectLabel>Приоритет {row.key}</SelectLabel>
          {[...PRIORITIES].reverse().map((p) => (
            <SelectItem key={p} value={p} data-backlog-priority-option={p}>
              <span className={cn('rounded-4xl border px-2 py-0.5 text-xs', tokenClass(p))}>{priorityLabel(p)}</span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

// ── дети эпика ──────────────────────────────────────────────────────────────

function EpicChildren({epic, id, hidden}: {epic: string; id: string; hidden: boolean}) {
  const ctx = useBacklogContext();
  // Ребёнка тянут: блок эпика — зона броска, он подсвечен (design.spec §5.3).
  const [dragging, setDragging] = useState(false);
  const group = useBacklogGroup(
    (offset, limit) => api.listTasks(ctx.projectKey, childrenQuery(epic, offset, limit)),
    `${ctx.projectKey}:${epic}`,
    ctx.tick,
    ctx.ready,
  );

  let body: ReactNode;
  if (!group.loaded && group.error) {
    body = (
      <p
        className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
        data-backlog-children-failed>
        {PAGE_TEXTS.epicFailed}
        <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={group.retry}>
          Повторить
        </Button>
      </p>
    );
  } else if (!group.loaded) {
    body = (
      <div className="space-y-2" data-backlog-children-skeleton aria-busy>
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  } else if (group.rows.length === 0) {
    body = (
      <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-2.5 text-sm" data-backlog-children-empty>
        {PAGE_TEXTS.epicEmpty}
      </p>
    );
  } else {
    body = <GroupList group={group} parent={epic} label={epicListLabel(epic)} onDragging={setDragging} />;
  }

  return (
    <div
      id={id}
      className={cn(
        'border-border mt-2 ml-[18px] border-l-2 pl-2.5 max-sm:ml-0',
        dragging && 'bg-muted rounded-lg outline-1 outline-dashed outline-border',
        hidden && 'hidden',
      )}
      data-backlog-children={epic}
      data-backlog-zone={dragging ? '' : undefined}>
      {body}
    </div>
  );
}
