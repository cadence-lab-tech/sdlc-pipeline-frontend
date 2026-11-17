import {useCallback, useEffect, useRef, useState} from 'react';

import {api, type ApiError} from '../../api/client';
import {
  APPROVALS_MAX_LIMIT,
  type Approvals,
  type ListTasksQuery,
  type ProjectDetail,
  type TaskListPage,
  type TaskRow,
  type Workflow,
} from '../../api/types';
import {useBacklogSize} from '../../hooks/useBacklogSize';
import {fetchSummary, throttleStep, type SummaryModel} from './summary';
import {useZoneData, type ZoneData} from './useZoneData';
import {
  APPROVALS_LIMIT,
  PARENTS_QUERY,
  blockedQueries,
  decisionsQuery,
  doneQuery,
  freeCountQuery,
  inWorkParents,
  isOrderRejected,
  isRejected,
  mergePages,
  readyKidsQuery,
  readyTopQuery,
  stageWaits,
  stagesFallbackQuery,
  stagesQuery,
  workQueries,
  type BacklogSize,
  type OverviewFilters,
} from './zones';

// Вид блоков, который не пишется в адрес: «Показать все» у решений, «Ещё N»
// у заблокированного, работы и этапов, листание «Завершено». Сбрасывается
// перезагрузкой и сменой фильтров; «Обновить» его сохраняет.
export interface OverviewView {
  approvalsAll: boolean;
  decisionsMore: boolean;
  blockedMore: boolean;
  workMore: boolean;
  stagesMore: boolean;
  waitingMore: boolean;
  // null — окно из пяти последних, число — страница листания по 20.
  donePage: number | null;
}

const INITIAL_VIEW: OverviewView = {
  approvalsAll: false,
  decisionsMore: false,
  blockedMore: false,
  workMore: false,
  stagesMore: false,
  waitingMore: false,
  donePage: null,
};

// Родитель из ?parent=: строка (с детьми по категориям) или только ключ и
// заголовок, если строка не нашлась среди совпадений поиска.
export interface ParentInfo {
  key: string;
  title: string;
  row: TaskRow | null;
  hasChildren: boolean;
}

// Этапы, ждущие исполнителя: строки и признак запасного пути (сервер отказал
// фильтру причин — отбор на клиенте, счётчик неполный).
export interface StagesData {
  page: TaskListPage;
  fallback: boolean;
}

// Неначатые для «Можно брать сейчас»: верхний уровень в порядке бэклога,
// дети родителей «в работе», total свободных (null — сервер отказал фильтру
// причин) и признак сервера без порядка бэклога.
export interface UnstartedData {
  top: TaskListPage;
  kids: TaskRow[];
  freeTotal: number | null;
}

export interface OverviewData {
  view: OverviewView;
  setView: (patch: Partial<OverviewView>) => void;
  approvals: ZoneData<Approvals>;
  decisionsList: ZoneData<TaskListPage>;
  blocked: ZoneData<TaskListPage>;
  work: ZoneData<TaskListPage>;
  stages: ZoneData<StagesData>;
  unstarted: ZoneData<UnstartedData>;
  backlogSize: BacklogSize;
  setBacklogSize: (size: BacklogSize) => void;
  done: ZoneData<TaskListPage>;
  summary: ZoneData<SummaryModel>;
  // Когда пришла показанная сводка; null — ещё ни разу.
  summaryAt: number | null;
  // Действующие версии циклов проекта по id (null — не прочиталась).
  versions: Map<string, Workflow | null>;
  parents: ZoneData<TaskListPage>;
  // Ключ родителя из адреса: null — такого в проекте нет; undefined — ещё
  // ищем или фильтра нет.
  parent: ZoneData<ParentInfo | null>;
  // Роли специалиста смотрящего в этом проекте: null — любые, undefined —
  // неизвестно (участие через команду или /auth/me не ответил).
  roleKeys: string[] | null | undefined;
  // Перечитать всё: события проекта (CLAB-367) — сводку с притормаживанием.
  reloadAll: () => void;
  // «Обновить»: следующее перечитывание сводки — сразу, без окна.
  refreshNow: () => void;
  refreshing: boolean;
  // Какой-нибудь блок сейчас читается (в том числе первая загрузка).
  loading: boolean;
  // Последнее чтение не удалось из-за сети или 5xx: «Нет связи» в шапке.
  unreachable: boolean;
  // Когда блоки последний раз пришли целиком; null — ещё ни разу.
  updatedAt: number | null;
}

// Ответа не было вовсе или сервер упал: сеть, 5xx. Отказы по смыслу (4xx) —
// не «нет связи», их блок показывает сам.
function isUnreachable(err: ApiError): boolean {
  return err.httpStatus === undefined || err.httpStatus === 0 || err.httpStatus >= 500;
}

// Поиск родителя по ключу: среди открытых задач с детьми фильтра, иначе
// поиском списка по ключу (точное совпадение), иначе карточкой задачи.
async function findParent(projectKey: string, key: string, known: TaskRow[]): Promise<ParentInfo | null> {
  const hasKids = (t: TaskRow) => Object.keys(t.child_counts).length > 0;
  const fromList = known.find((t) => t.key === key);
  if (fromList) return {key, title: fromList.title, row: fromList, hasChildren: hasKids(fromList)};
  const page = await api.listTasks(projectKey, {q: key, limit: 200});
  const exact = page.tasks.find((t) => t.key === key);
  if (exact) return {key, title: exact.title, row: exact, hasChildren: hasKids(exact)};
  if (page.total <= page.tasks.length) return null;
  try {
    const detail = await api.getTask(key);
    if (detail.task.project_key && detail.task.project_key !== projectKey) return null;
    return {key, title: detail.task.title, row: null, hasChildren: detail.children.length > 0};
  } catch {
    return null;
  }
}

async function both(projectKey: string, [a, b]: [ListTasksQuery, ListTasksQuery]): Promise<TaskListPage> {
  const [pa, pb] = await Promise.all([api.listTasks(projectKey, a), api.listTasks(projectKey, b)]);
  return mergePages(pa, pb);
}

async function loadStages(projectKey: string, f: OverviewFilters): Promise<StagesData> {
  try {
    return {page: await api.listTasks(projectKey, stagesQuery(f)), fallback: false};
  } catch (err) {
    if (!isRejected(err)) throw err;
    const page = await api.listTasks(projectKey, stagesFallbackQuery(f));
    const tasks = page.tasks.filter(stageWaits);
    return {page: {tasks, total: tasks.length}, fallback: true};
  }
}

async function loadUnstarted(projectKey: string, f: OverviewFilters): Promise<UnstartedData> {
  const list = (q: ListTasksQuery) => api.listTasks(projectKey, q);
  let top: TaskListPage;
  const q = readyTopQuery(f);
  try {
    top = await list(q);
  } catch (err) {
    // Сервер без порядка бэклога: строки в его порядке по умолчанию.
    if (!isOrderRejected(err)) throw err;
    top = await list({...q, order: undefined, backlog: undefined, ...(f.parent ? {} : {terminal: false, in_work: false})});
  }
  const parents = inWorkParents(top.tasks, Boolean(f.parent));
  const [kids, free] = await Promise.all([
    parents.length > 0 ? list(readyKidsQuery(f, parents)).then((p) => p.tasks) : Promise.resolve([] as TaskRow[]),
    list(freeCountQuery(f)).then(
      (p) => p.total as number | null,
      (err: unknown) => {
        if (isRejected(err)) return null;
        throw err;
      },
    ),
  ]);
  return {top, kids, freeTotal: free};
}

// Действующие версии циклов проекта: читаются один раз (версия иммутабельна,
// решение 0016) и нужны сводке и группам «Что делается сейчас».
function useActiveVersions(project: ProjectDetail | undefined) {
  const cache = useRef(new Map<string, Promise<Workflow>>());
  const [versions, setVersions] = useState<Map<string, Workflow | null>>(new Map());
  const get = useCallback((id: string) => {
    let p = cache.current.get(id);
    if (!p) {
      p = api.getWorkflowVersion(id);
      cache.current.set(id, p);
      p.then(
        (v) => setVersions((m) => new Map(m).set(id, v)),
        () => {
          // Отказ не запоминается навсегда: «Повторить» сводки спросит снова.
          cache.current.delete(id);
          setVersions((m) => new Map(m).set(id, null));
        },
      );
    }
    return p;
  }, []);
  const ids = (project?.active_workflows ?? []).map((w) => w.id).join(',');
  useEffect(() => {
    for (const id of ids.split(',').filter(Boolean)) void get(id).catch(() => undefined);
  }, [ids, get]);
  return {versions, get};
}

// Данные «Обзора»: блоки — запросами к списку с limit и к /approvals, у
// каждого своё состояние, ошибка одного не роняет остальные. enabled: false —
// блоки не запрашиваются (в адресе тип или родитель, которых нет).
export function useOverview(
  projectKey: string,
  project: ProjectDetail | undefined,
  filters: OverviewFilters,
  enabled: boolean,
): OverviewData {
  const [tick, setTick] = useState(0);
  const [summaryTick, setSummaryTick] = useState(0);
  const [view, setViewState] = useState<OverviewView>(INITIAL_VIEW);
  const scope = JSON.stringify([projectKey, filters]);

  // Смена фильтров сбрасывает вид: «Ещё N» и страница листания — про
  // прежнюю выборку.
  const [viewScope, setViewScope] = useState(scope);
  if (viewScope !== scope) {
    setViewScope(scope);
    setViewState(INITIAL_VIEW);
  }
  const setView = useCallback((patch: Partial<OverviewView>) => setViewState((v) => ({...v, ...patch})), []);

  const approvals = useZoneData(
    () => api.approvals(projectKey, {limit: view.approvalsAll ? APPROVALS_MAX_LIMIT : APPROVALS_LIMIT}),
    projectKey,
    String(view.approvalsAll),
    tick,
    enabled,
  );
  const decisionsList = useZoneData(() => api.listTasks(projectKey, decisionsQuery(filters)), scope, '', tick, enabled);
  const blocked = useZoneData(
    () => both(projectKey, blockedQueries(filters, view.blockedMore)),
    scope,
    String(view.blockedMore),
    tick,
    enabled,
  );
  const work = useZoneData(
    () => both(projectKey, workQueries(filters, view.workMore)),
    scope,
    String(view.workMore),
    tick,
    enabled,
  );
  const stages = useZoneData(() => loadStages(projectKey, filters), scope, '', tick, enabled);
  const [backlogSize, setBacklogSize] = useBacklogSize(projectKey);
  const unstarted = useZoneData(() => loadUnstarted(projectKey, filters), scope, '', tick, enabled);
  const done = useZoneData(
    () => api.listTasks(projectKey, doneQuery(filters, view.donePage)),
    scope,
    String(view.donePage),
    tick,
    enabled,
  );
  const parents = useZoneData(() => api.listTasks(projectKey, PARENTS_QUERY), projectKey, '', tick);
  const parent = useZoneData(
    () => (filters.parent ? findParent(projectKey, filters.parent, parents.data?.tasks ?? []) : Promise.resolve(null)),
    JSON.stringify([projectKey, filters.parent]),
    '',
    tick,
    Boolean(filters.parent) && parents.data !== undefined,
  );

  // Сводка: свой tick с окном притормаживания.
  const {versions, get} = useActiveVersions(project);
  const summary = useZoneData(
    () => fetchSummary((q) => api.listTasks(projectKey, q), get, project!, filters),
    scope,
    '',
    summaryTick,
    enabled && project !== undefined,
  );
  const [summaryStamp, setSummaryStamp] = useState<{scope: string; at: number} | null>(null);
  const summaryData = summary.data;
  useEffect(() => {
    // Часы — внешняя система: момент прихода данных в состоянии не выразить.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (summaryData) setSummaryStamp({scope, at: Date.now()});
  }, [summaryData, scope]);

  const lastSummary = useRef<number | null>(null);
  const timer = useRef<number | null>(null);
  const immediate = useRef(false);
  useEffect(() => {
    lastSummary.current = Date.now();
  }, [summaryTick, scope]);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  const reloadAll = useCallback(() => {
    setTick((n) => n + 1);
    if (immediate.current) {
      immediate.current = false;
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      setSummaryTick((n) => n + 1);
      return;
    }
    if (timer.current !== null) return;
    const step = throttleStep(lastSummary.current, Date.now());
    if (step.run) {
      setSummaryTick((n) => n + 1);
      return;
    }
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setSummaryTick((n) => n + 1);
    }, step.wait);
  }, []);
  const refreshNow = useCallback(() => {
    immediate.current = true;
  }, []);

  const [roleKeys, setRoleKeys] = useState<{key: string; value: string[] | null | undefined}>();
  useEffect(() => {
    let live = true;
    api.me().then(
      (me) => {
        if (!live) return;
        const m = me.memberships.find((x) => x.project_key === projectKey);
        setRoleKeys({key: projectKey, value: m ? m.role_keys : undefined});
      },
      () => live && setRoleKeys({key: projectKey, value: undefined}),
    );
    return () => {
      live = false;
    };
  }, [projectKey]);

  const zones = [approvals, decisionsList, blocked, work, stages, unstarted, done, parents];
  const loading = zones.some((z) => z.loading);
  const refreshing = tick > 0 && loading;
  const unreachable = [...zones, summary].some((z) => z.error !== undefined && isUnreachable(z.error));

  // Время последнего полного чтения — для подсказки у «Обновить» и подписи
  // «Нет связи · данные на HH:MM». Чужого проекта не показываем.
  const [stamp, setStamp] = useState<{key: string; at: number} | null>(null);
  const settled = enabled && !loading && !unreachable && approvals.data !== undefined;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (settled) setStamp({key: projectKey, at: Date.now()});
  }, [settled, loading, projectKey]);

  return {
    view,
    setView,
    approvals,
    decisionsList,
    blocked,
    work,
    stages,
    unstarted,
    backlogSize,
    setBacklogSize,
    done,
    summary,
    summaryAt: summaryStamp?.scope === scope ? summaryStamp.at : null,
    versions,
    parents,
    parent,
    roleKeys: roleKeys?.key === projectKey ? roleKeys.value : undefined,
    reloadAll,
    refreshNow,
    refreshing,
    loading,
    unreachable,
    updatedAt: stamp?.key === projectKey ? stamp.at : null,
  };
}
