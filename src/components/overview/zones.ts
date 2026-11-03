// Правила «Обзора» (CLAB-365, design.spec варианта B): какие запросы дают
// зоны, как запись /approvals склеивается со строкой списка, дорожки «В
// работе», очередь по ролям смотрящего, потолки, состояния страницы. Без
// разметки и без запросов: страница рисует то, что вернули эти функции, а
// проверяются они без браузера (e2e/overview-rules.mjs).
//
// Статусов, ролей и типов проекта модуль не знает. Зону задачи определяет
// сервер по данным движка (причины внимания, текущий прогон, in_work,
// terminal, top_level, дети); коды причин в запросах — словарь движка
// (решение 0070). Подписи дорожек — имя роли из прогона, эпик — задача с
// детьми, а не тип.
import type {Approval, ListTasksQuery, TaskRow} from '../../api/types';
import {normalizeRowFields} from '../../api/taskRow';
import type {ApprovalHint} from '../taskrow/rules';

// Шесть зон страницы. Ключ хранения свёрнутости — `overview.<ключ>`.
export type ZoneKey = 'decisions' | 'stuck' | 'work' | 'queue' | 'backlog' | 'done';

export const ZONE_TITLES: Record<ZoneKey, string> = {
  decisions: 'Ждут решения',
  stuck: 'Застряло',
  work: 'В работе',
  queue: 'Очередь',
  backlog: 'Приоритетные из бэклога',
  done: 'Завершено недавно',
};

export const ZONE_EMPTY: Record<Exclude<ZoneKey, 'backlog'>, string> = {
  decisions: 'Ничего не ждёт вашего решения',
  stuck: 'Ничего не застряло',
  work: 'Агенты сейчас ничего не делают — следующее можно взять из очереди или бэклога',
  queue: 'Нет прогонов, которые можно забрать',
  done: 'Завершённых задач пока нет',
};

// Свёрнутость в браузере (useCollapsed). Хук знает одно умолчание —
// «развёрнуто»; «Завершено недавно» по умолчанию свёрнута, поэтому у неё ключ
// хранит обратное — «развёрнуто» (design.spec §3.2), а хук не меняется.
export const COLLAPSE_KEYS: Record<ZoneKey, {key: string; inverted: boolean}> = {
  decisions: {key: 'overview.decisions', inverted: false},
  stuck: {key: 'overview.stuck', inverted: false},
  work: {key: 'overview.work', inverted: false},
  queue: {key: 'overview.queue', inverted: false},
  backlog: {key: 'overview.backlog', inverted: false},
  done: {key: 'overview.done.open', inverted: true},
};

// Свёрнута ли зона по значению хука: у прямого ключа «1» — свёрнута, у
// обратного «1» — развёрнута.
export function isCollapsed(zone: ZoneKey, stored: boolean): boolean {
  return COLLAPSE_KEYS[zone].inverted ? !stored : stored;
}

// Потолки (design.spec §2.6, вариант B).
export const CAPS = {
  decisions: 4,
  stuck: 4,
  work: 9,
  queueOwn: 5,
  queueOther: 2,
  queueAssigned: 2,
  done: 5,
  donePage: 20,
} as const;

// Предел строк развёрнутой зоны и списка очереди: тот же, что у списка без
// limit, но передаётся явно — запроса без limit страница не делает.
export const EXPANDED_LIMIT = 200;
// /approvals: по умолчанию — умолчание сервера, «Показать все» — его потолок.
export const APPROVALS_LIMIT = 100;
// Список эпиков для фильтра: верхний уровень, открытые (В-3).
export const EPICS_LIMIT = 200;

// Порог колонки «Дальше» — ширина области страницы, а не окна: она зависит от
// меню (Д-1).
export const NEXT_COLUMN_MIN_WIDTH = 1100;

export function nextContainer(width: number): 'column' | 'sheet' {
  return width >= NEXT_COLUMN_MIN_WIDTH ? 'column' : 'sheet';
}

// ── фильтры ─────────────────────────────────────────────────────────────────

// Фильтры страницы живут только в адресе: type, parent, q (В-5).
export interface OverviewFilters {
  type: string;
  parent: string;
  q: string;
}

export const FILTER_PARAMS = ['type', 'parent', 'q'] as const;

export function readFilters(sp: URLSearchParams): OverviewFilters {
  const get = (name: string) => (sp.get(name) ?? '').trim();
  return {type: get('type'), parent: get('parent'), q: get('q')};
}

// Новая строка адреса с одним фильтром: пустое значение убирает параметр,
// остальные параметры (в том числе чужие) остаются как были.
export function withFilter(sp: URLSearchParams, name: (typeof FILTER_PARAMS)[number], value: string): URLSearchParams {
  const next = new URLSearchParams(sp);
  const v = value.trim();
  if (v) next.set(name, v);
  else next.delete(name);
  return next;
}

// Без фильтров страницы: чужие параметры адреса остаются.
export function withoutFilters(sp: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(sp);
  for (const name of FILTER_PARAMS) next.delete(name);
  return next;
}

export function isFiltered(f: OverviewFilters): boolean {
  return Boolean(f.type || f.parent || f.q);
}

// «Тип: bug · Эпик: CLAB-85 · Поиск: «zzz»» — только включённые фильтры.
export function filterSummary(f: OverviewFilters): string {
  const parts: string[] = [];
  if (f.type) parts.push(`Тип: ${f.type}`);
  if (f.parent) parts.push(`Эпик: ${f.parent}`);
  if (f.q) parts.push(`Поиск: «${f.q}»`);
  return parts.join(' · ');
}

// Тип новой задачи: выбранный фильтр, иначе первый тип данных проекта.
export function defaultNewTaskType(filterType: string, projectTypes: string[]): string | undefined {
  if (filterType && projectTypes.includes(filterType)) return filterType;
  return projectTypes[0];
}

// ── источники зон ───────────────────────────────────────────────────────────

const common = (f: OverviewFilters): ListTasksQuery => ({
  type: f.type || undefined,
  parent: f.parent || undefined,
  q: f.q || undefined,
});

// Запрос списка для зоны. expanded — «Ещё N» нажато; donePage — номер страницы
// листания «Завершено» (null — окно из пяти последних).
export function zoneQuery(
  zone: Exclude<ZoneKey, 'backlog'>,
  f: OverviewFilters,
  o: {expanded?: boolean; donePage?: number | null} = {},
): ListTasksQuery {
  const base = common(f);
  switch (zone) {
    // Строки к записям /approvals и строки наблюдателя.
    case 'decisions':
      return {...base, attention: 'awaits_human', limit: EXPANDED_LIMIT};
    // Любая причина, кроме ожидания человека, возврата и «можно забрать»,
    // включая коды, которых клиент не знает; ждущая человека сюда не попадает.
    case 'stuck':
      return {
        ...base,
        attention_except: 'awaits_human,returned,unclaimed',
        attention_not: 'awaits_human',
        limit: o.expanded ? EXPANDED_LIMIT : CAPS.stuck,
      };
    // Прогон забран и аренда жива или эпик с детьми в работе; из причин
    // допустим только возврат.
    case 'work':
      return {...base, in_work: true, attention_within: 'returned', limit: o.expanded ? EXPANDED_LIMIT : CAPS.work};
    // Этап ждёт исполнителя, других причин, кроме возврата, нет. Строки
    // очереди — одним запросом: счётчик «можно забрать» считается по ним.
    case 'queue':
      return {...base, attention: 'unclaimed', attention_within: 'unclaimed,returned', limit: EXPANDED_LIMIT};
    case 'done': {
      const page = o.donePage ?? null;
      if (page === null) return {...base, terminal: true, order: 'updated', limit: CAPS.done};
      return {...base, terminal: true, order: 'updated', limit: CAPS.donePage, offset: page * CAPS.donePage};
    }
  }
}

// Запрос блока «Приоритетные из бэклога» (CLAB-366): здесь только его форма,
// чтобы блок встал в ту же систему фильтров.
export function backlogQuery(f: OverviewFilters, limit: number): ListTasksQuery {
  return {...common(f), terminal: false, in_work: false, top_level: true, order: 'backlog', limit};
}

export const EPICS_QUERY: ListTasksQuery = {top_level: true, terminal: false, limit: EPICS_LIMIT};

// ── «Ждут решения» ──────────────────────────────────────────────────────────

// Фильтры страницы для записей /approvals: у ручки этих параметров нет, они
// применяются здесь так же, как у сервера списка (подстрока без регистра).
export function filterApprovals(approvals: Approval[], f: OverviewFilters): Approval[] {
  const q = f.q.toLowerCase();
  return approvals.filter((a) => {
    if (f.type && a.task.type !== f.type) return false;
    if (f.parent && a.task.parent_key !== f.parent) return false;
    if (q && !a.task.key.toLowerCase().includes(q) && !a.task.title.toLowerCase().includes(q)) return false;
    return true;
  });
}

// Строка из записи /approvals, когда в списке её задачи нет: поля задачи —
// из записи, поля строки — умолчания normalizeRowFields, причина — ожидание
// человека с гейтами записей.
export function rowFromApprovals(records: Approval[]): TaskRow {
  const t = records[0].task;
  return {
    id: t.key,
    project_id: '',
    project_key: '',
    parent_key: t.parent_key,
    key: t.key,
    seq: 0,
    title: t.title,
    workflow_id: t.workflow_id,
    status_id: '',
    status_key: t.status_key,
    status_name: t.status_name,
    priority: t.priority,
    external_ref: {},
    labels: [],
    properties: t.type ? {type: t.type} : {},
    repositories: [],
    stage_settings: {},
    optional_stages: {},
    created_at: '',
    updated_at: '',
    ...normalizeRowFields({
      awaiting_approval: true,
      attention: [
        {
          code: 'awaits_human',
          since: null,
          gates: records.map((r) => ({transition: r.transition.key, gate: r.gate.gate_key})),
        },
      ],
    }),
  };
}

export interface DecisionRow {
  task: TaskRow;
  approvals: ApprovalHint[];
}

// Зона «Ждут решения» у того, кто вправе решать: строго записи /approvals.
// Одна задача — одна строка, сколько бы гейтов у неё ни ждало; порядок —
// порядок записей. Строка — элемент списка той же задачи, нет его — строка
// из записи.
export function decisionRows(approvals: Approval[], listed: TaskRow[]): DecisionRow[] {
  const byKey = new Map(listed.map((t) => [t.key, t]));
  const groups = new Map<string, Approval[]>();
  for (const a of approvals) {
    const g = groups.get(a.task.key);
    if (g) g.push(a);
    else groups.set(a.task.key, [a]);
  }
  return [...groups.values()].map((records) => ({
    task: byKey.get(records[0].task.key) ?? rowFromApprovals(records),
    approvals: records.map((r) => ({transition_key: r.transition.key, lands_in_name: r.transition.lands_in_name})),
  }));
}

// ── «В работе» ──────────────────────────────────────────────────────────────

// Есть ли у задачи дети: любая категория, включая отменённые.
export function hasChildren(t: Pick<TaskRow, 'child_counts'>): boolean {
  return Object.keys(t.child_counts ?? {}).length > 0;
}

export interface Lane {
  id: string;
  label: string;
  kind: 'epics' | 'role' | 'none';
  rows: TaskRow[];
}

export const LANE_EPICS = 'Эпики в работе';
export const LANE_NO_ROLE = 'Без роли';

// Дорожки по роли текущего этапа (Д-4): эпики в работе первыми, затем по
// числу карточек по убыванию (при равенстве — по имени), «Без роли»
// последней. Группировка — по роли прогона, подпись — её имя из данных.
export function workLanes(rows: TaskRow[]): Lane[] {
  const epics: TaskRow[] = [];
  const none: TaskRow[] = [];
  const roles = new Map<string, Lane>();
  for (const t of rows) {
    if (hasChildren(t)) {
      epics.push(t);
      continue;
    }
    const run = t.current_run;
    const id = run?.role_key ?? null;
    if (!id) {
      none.push(t);
      continue;
    }
    const lane = roles.get(id);
    if (lane) lane.rows.push(t);
    else roles.set(id, {id: `role:${id}`, label: run?.role_name || id, kind: 'role', rows: [t]});
  }
  const sorted = [...roles.values()].sort(
    (a, b) => b.rows.length - a.rows.length || a.label.localeCompare(b.label, 'ru'),
  );
  const out: Lane[] = [];
  if (epics.length > 0) out.push({id: 'epics', label: LANE_EPICS, kind: 'epics', rows: epics});
  out.push(...sorted);
  if (none.length > 0) out.push({id: 'none', label: LANE_NO_ROLE, kind: 'none', rows: none});
  return out;
}

// ── «Очередь» ───────────────────────────────────────────────────────────────

export interface QueueModel {
  // Есть ли у смотрящего ограничение ролями специалиста: тогда подзаголовки
  // «Ваши роли» / «Остальные роли».
  grouped: boolean;
  own: TaskRow[];
  other: TaskRow[];
  // Назначены другому (claimable: false): в очереди с пометкой, но не в
  // счётчике (В-2).
  assigned: TaskRow[];
  // «Можно забрать» — прогоны с claimable: true.
  claimable: number;
  // В ответе строк больше загруженных — счётчик «N+».
  partial: boolean;
}

const enteredAt = (t: TaskRow) => {
  const v = t.current_run?.entered_at ? Date.parse(t.current_run.entered_at) : NaN;
  return Number.isNaN(v) ? Infinity : v;
};

// roleKeys — роли специалиста участника (ProjectMember.role_keys): null —
// любые, пустой список — ни одной; в обоих случаях подзаголовков нет.
export function queueModel(rows: TaskRow[], total: number, roleKeys: string[] | null | undefined): QueueModel {
  const byWait = [...rows].sort((a, b) => enteredAt(a) - enteredAt(b));
  const claimable = byWait.filter((t) => t.current_run?.claimable === true);
  const assigned = byWait.filter((t) => t.current_run?.claimable !== true);
  const grouped = Array.isArray(roleKeys) && roleKeys.length > 0;
  const mine = (t: TaskRow) => grouped && roleKeys!.includes(t.current_run?.role_key ?? '');
  return {
    grouped,
    own: grouped ? claimable.filter(mine) : claimable,
    other: grouped ? claimable.filter((t) => !mine(t)) : [],
    assigned,
    claimable: claimable.length,
    partial: total > rows.length,
  };
}

// Видимая часть очереди под потолком: 5 по своим ролям + 2 остальных (без
// групп — 7 подряд) и до двух «назначенных другому»; hidden — сколько
// спрятано под «Ещё N».
export function visibleQueue(m: QueueModel, expanded: boolean): {own: TaskRow[]; other: TaskRow[]; assigned: TaskRow[]; hidden: number} {
  if (expanded) return {own: m.own, other: m.other, assigned: m.assigned, hidden: 0};
  const ownCap = m.grouped ? CAPS.queueOwn : CAPS.queueOwn + CAPS.queueOther;
  const own = m.own.slice(0, ownCap);
  const other = m.other.slice(0, CAPS.queueOther);
  const assigned = m.assigned.slice(0, CAPS.queueAssigned);
  const hidden = m.own.length + m.other.length + m.assigned.length - own.length - other.length - assigned.length;
  return {own, other, assigned, hidden};
}

// ── счётчики и состояния ────────────────────────────────────────────────────

// Текст счётчика зоны: «—» — данных нет из-за ошибки, «N+» — неполный.
export function counterText(n: number | null, partial = false): string {
  if (n === null) return '—';
  return partial ? `${n}+` : String(n);
}

// Эпики для фильтра: открытые задачи верхнего уровня с детьми, клиентский
// отбор (В-3). truncated — верхний уровень длиннее загруженного.
export function epicOptions(rows: TaskRow[], total: number): {epics: TaskRow[]; truncated: boolean} {
  return {epics: rows.filter(hasChildren), truncated: total > rows.length};
}

export type PageState = 'zones' | 'empty-project' | 'no-results' | 'pending';

// Что показать вместо зон. zoneTotals — числа задач зон, null — зона ещё не
// пришла или упала (тогда показываются зоны). projectTotal — число задач
// проекта без фильтров (запрос с limit=1), undefined — ещё не спрашивали.
export function pageState(filtered: boolean, zoneTotals: (number | null)[], projectTotal?: number | null): PageState {
  if (zoneTotals.some((n) => n === null)) return 'zones';
  if (zoneTotals.some((n) => (n ?? 0) > 0)) return 'zones';
  if (filtered) return 'no-results';
  if (projectTotal === undefined) return 'pending';
  return projectTotal === 0 ? 'empty-project' : 'zones';
}
