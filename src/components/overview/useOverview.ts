import {useCallback, useEffect, useState} from 'react';

import {api, type ApiError} from '../../api/client';
import {APPROVALS_MAX_LIMIT, type Approvals, type TaskListPage, type TaskRow} from '../../api/types';
import {useBacklogSize} from '../../hooks/useBacklogSize';
import {useZoneData, type ZoneData} from './useZoneData';
import {APPROVALS_LIMIT, EPICS_QUERY, fetchBacklog, zoneQuery, type BacklogSize, type OverviewFilters} from './zones';

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
  // Блок «Приоритетные из бэклога» (CLAB-366): первые backlogSize строк
  // бэклога в порядке сервера, total — весь бэклог выборки.
  backlog: ZoneData<TaskListPage>;
  backlogSize: BacklogSize;
  setBacklogSize: (size: BacklogSize) => void;
  done: ZoneData<TaskListPage>;
  epics: ZoneData<TaskListPage>;
  // Ключ эпика из адреса: null — такого в проекте нет; undefined — ещё ищем
  // или фильтра нет.
  epic: ZoneData<EpicInfo | null>;
  // Роли специалиста смотрящего в этом проекте: null — любые, undefined —
  // неизвестно (участие через команду или /auth/me не ответил).
  roleKeys: string[] | null | undefined;
  // Перечитать все зоны разом: «Обновить» и события проекта (CLAB-367) идут
  // этим одним путём.
  reloadAll: () => void;
  refreshing: boolean;
  // Какая-нибудь зона сейчас читается (в том числе первая загрузка).
  loading: boolean;
  // Последнее чтение не удалось из-за сети или 5xx (не отказ по смыслу:
  // 400 на order, 403 и т. п.): «Нет связи» в шапке.
  unreachable: boolean;
  // Когда зоны последний раз пришли целиком; null — ещё ни разу.
  updatedAt: number | null;
}

// Ответа не было вовсе или сервер упал: сеть, 5xx. Отказы по смыслу (4xx) —
// не «нет связи», их зона показывает сама.
function isUnreachable(err: ApiError): boolean {
  return err.httpStatus === undefined || err.httpStatus === 0 || err.httpStatus >= 500;
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
  // Блок входит в общий tick: «Обновить» (и события CLAB-367) перечитывают
  // его вместе с зонами. N — вид, как «Ещё N»: прежние строки на месте, пока
  // не придут новые.
  const [backlogSize, setBacklogSize] = useBacklogSize(projectKey);
  const backlog = useZoneData(
    () => fetchBacklog((q) => api.listTasks(projectKey, q), filters, backlogSize),
    scope,
    String(backlogSize),
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
  const zones = [approvals, decisionsList, stuck, work, queue, backlog, done, epics];
  const loading = zones.some((z) => z.loading);
  const refreshing = tick > 0 && loading;
  const unreachable = zones.some((z) => z.error !== undefined && isUnreachable(z.error));

  // Время последнего полного чтения — для подсказки у «Обновить» и подписи
  // «Нет связи · данные на HH:MM». Чужого проекта не показываем.
  const [stamp, setStamp] = useState<{key: string; at: number} | null>(null);
  const settled = enabled && !loading && !unreachable && approvals.data !== undefined;
  useEffect(() => {
    // Часы — внешняя система: момент прихода данных в состоянии не выразить.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (settled) setStamp({key: projectKey, at: Date.now()});
  }, [settled, loading, projectKey]);

  return {
    view,
    setView,
    approvals,
    decisionsList,
    stuck,
    work,
    queue,
    backlog,
    backlogSize,
    setBacklogSize,
    done,
    epics,
    epic,
    roleKeys: roleKeys?.key === projectKey ? roleKeys.value : undefined,
    reloadAll,
    refreshing,
    loading,
    unreachable,
    updatedAt: stamp?.key === projectKey ? stamp.at : null,
  };
}
