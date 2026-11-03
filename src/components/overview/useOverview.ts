import {useCallback, useEffect, useState} from 'react';

import {api} from '../../api/client';
import {APPROVALS_MAX_LIMIT, type Approvals, type TaskListPage, type TaskRow} from '../../api/types';
import {useZoneData, type ZoneData} from './useZoneData';
import {APPROVALS_LIMIT, EPICS_QUERY, zoneQuery, type OverviewFilters} from './zones';

// Вид зон, который не пишется в адрес (В-5): «Показать все» у решений,
// «Ещё N» у застрявшего, работы и очереди, листание «Завершено». Сбрасывается
// перезагрузкой и сменой фильтров; «Обновить» его сохраняет.
export interface OverviewView {
  approvalsAll: boolean;
  decisionsMore: boolean;
  stuckMore: boolean;
  workMore: boolean;
  queueMore: boolean;
  // null — окно из пяти последних, число — страница листания по 20.
  donePage: number | null;
}

const INITIAL_VIEW: OverviewView = {
  approvalsAll: false,
  decisionsMore: false,
  stuckMore: false,
  workMore: false,
  queueMore: false,
  donePage: null,
};

// Нарезка эпика из ?parent=: строка эпика (с детьми по категориям) или
// только ключ и заголовок, если строка не нашлась среди совпадений поиска.
export interface EpicInfo {
  key: string;
  title: string;
  row: TaskRow | null;
  hasChildren: boolean;
}

export interface OverviewData {
  view: OverviewView;
  setView: (patch: Partial<OverviewView>) => void;
  approvals: ZoneData<Approvals>;
  decisionsList: ZoneData<TaskListPage>;
  stuck: ZoneData<TaskListPage>;
  work: ZoneData<TaskListPage>;
  queue: ZoneData<TaskListPage>;
  done: ZoneData<TaskListPage>;
  epics: ZoneData<TaskListPage>;
  // Ключ эпика из адреса: null — такого в проекте нет; undefined — ещё ищем
  // или фильтра нет.
  epic: ZoneData<EpicInfo | null>;
  // Роли специалиста смотрящего в этом проекте: null — любые, undefined —
  // неизвестно (участие через команду или /auth/me не ответил).
  roleKeys: string[] | null | undefined;
  // Перечитать все зоны разом (кнопка «Обновить»; её возьмёт CLAB-367).
  reloadAll: () => void;
  refreshing: boolean;
}

// Поиск эпика по ключу: среди открытых эпиков фильтра, иначе поиском списка
// по ключу (точное совпадение), иначе карточкой задачи — она есть и у задачи,
// чей ключ — подстрока сотни других.
async function findEpic(projectKey: string, key: string, known: TaskRow[]): Promise<EpicInfo | null> {
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

// Данные «Обзора»: зоны — запросами к списку с limit и к /approvals, у каждой
// зоны своё состояние, ошибка одной не роняет остальные. enabled: false —
// зоны не запрашиваются (в адресе тип или эпик, которых нет).
export function useOverview(projectKey: string, filters: OverviewFilters, enabled: boolean): OverviewData {
  const [tick, setTick] = useState(0);
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
  const decisionsList = useZoneData(
    () => api.listTasks(projectKey, zoneQuery('decisions', filters)),
    scope,
    '',
    tick,
    enabled,
  );
  const stuck = useZoneData(
    () => api.listTasks(projectKey, zoneQuery('stuck', filters, {expanded: view.stuckMore})),
    scope,
    String(view.stuckMore),
    tick,
    enabled,
  );
  const work = useZoneData(
    () => api.listTasks(projectKey, zoneQuery('work', filters, {expanded: view.workMore})),
    scope,
    String(view.workMore),
    tick,
    enabled,
  );
  const queue = useZoneData(
    () => api.listTasks(projectKey, zoneQuery('queue', filters)),
    scope,
    '',
    tick,
    enabled,
  );
  const done = useZoneData(
    () => api.listTasks(projectKey, zoneQuery('done', filters, {donePage: view.donePage})),
    scope,
    String(view.donePage),
    tick,
    enabled,
  );
  const epics = useZoneData(() => api.listTasks(projectKey, EPICS_QUERY), projectKey, '', tick);
  const epic = useZoneData(
    () => (filters.parent ? findEpic(projectKey, filters.parent, epics.data?.tasks ?? []) : Promise.resolve(null)),
    JSON.stringify([projectKey, filters.parent]),
    '',
    tick,
    Boolean(filters.parent) && epics.data !== undefined,
  );

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

  const reloadAll = useCallback(() => setTick((n) => n + 1), []);
  const refreshing =
    tick > 0 &&
    [approvals, decisionsList, stuck, work, queue, done, epics].some((z) => z.loading);

  return {
    view,
    setView,
    approvals,
    decisionsList,
    stuck,
    work,
    queue,
    done,
    epics,
    epic,
    roleKeys: roleKeys?.key === projectKey ? roleKeys.value : undefined,
    reloadAll,
    refreshing,
  };
}
