// Правила «Обзора» (CLAB-365, переработка CLAB-488 по design.spec): какие
// запросы дают блоки, правило «одна задача — один блок», склейка записей
// /approvals со строками списка, «Можно брать сейчас» по порядку бэклога,
// группы «Что делается сейчас» по статусам циклов, потолки, состояния
// страницы. Без разметки и без запросов: страница рисует то, что вернули эти
// функции, а проверяются они без браузера (e2e/overview-rules.mjs).
//
// Статусов, ролей и типов проекта модуль не знает. Блок задачи определяют
// данные движка (причины внимания, текущий прогон, in_work, категория и
// признаки статуса, дети); коды причин в запросах — словарь движка (решение
// 0070), категории — перечень схемы. Подписи групп — имена статусов и ролей
// из версии цикла, родитель — задача с детьми, а не тип.
import type {Approval, ListTasksQuery, TaskListPage, TaskRow, Workflow} from '../../api/types';
import {normalizeRowFields} from '../../api/taskRow';
import type {ApprovalHint} from '../taskrow/rules';
import {taskTypeOf} from '../taskrow/rules';

// Блоки страницы. Ключ хранения свёрнутости — COLLAPSE_KEYS.
export type ZoneKey = 'summary' | 'decisions' | 'blocked' | 'work' | 'ready' | 'done';

export const ZONE_TITLES: Record<ZoneKey, string> = {
  summary: 'Сводка',
  decisions: 'Требуют решения',
  blocked: 'Заблокировано',
  work: 'Что делается сейчас',
  ready: 'Можно брать сейчас',
  done: 'Завершено недавно',
};

export const ZONE_EMPTY = {
  decisions: 'Ничего не ждёт вашего решения',
  decisionsViewer: 'Ничего не ждёт решения',
  blocked: 'Ничего не заблокировано',
  work: 'Сейчас ничего не делается — следующее можно взять в «Можно брать сейчас»',
  done: 'Завершённых задач пока нет',
} as const;

// Тексты блока «Можно брать сейчас» (design.spec §4.5).
export const READY_TEXTS = {
  stages: 'Этапы ждут исполнителя',
  assigned: 'Назначены другому · не входят в счётчик',
  unstarted: 'Неначатые по порядку бэклога',
  unstartedInParent: 'Неначатые внутри задачи',
  free: 'свободных',
  waiting: 'Ждут блокирующих · не входят в счётчик',
  all: 'Весь бэклог',
  emptyUnstarted: 'Неначатых свободных задач нет',
  empty: 'Сейчас брать нечего: неначатых свободных задач и этапов без исполнителя нет',
  partial: 'Проект большой: сервер не отобрал заблокированные — они пропущены здесь, счётчик неполный.',
} as const;

export const viaText = (parentKey: string) => `внутри ${parentKey} — она уже в работе`;
// Ребёнок начатого родителя, который сам заблокирован (подсписок «Ждут
// блокирующих»).
export const viaBlockedText = (parentKey: string) => `внутри заблокированного ${parentKey}`;

// Подпись группы «Что делается сейчас» у статуса без роли.
export const NO_ROLE_GROUP = 'этап без роли исполнителя — ведут люди';

// Свёрнутость в браузере (useCollapsed). Хук знает одно умолчание —
// «развёрнуто»; «Завершено недавно» по умолчанию свёрнута, поэтому у неё ключ
// хранит обратное — «развёрнуто», а хук не меняется. Прежние ключи
// overview.stuck, overview.queue, overview.backlog не читаются.
export const COLLAPSE_KEYS: Record<ZoneKey, {key: string; inverted: boolean}> = {
  summary: {key: 'overview.summary', inverted: false},
  decisions: {key: 'overview.decisions', inverted: false},
  blocked: {key: 'overview.blocked', inverted: false},
  work: {key: 'overview.work', inverted: false},
  ready: {key: 'overview.ready', inverted: false},
  done: {key: 'overview.done.open', inverted: true},
};

// Свёрнута ли зона по значению хука: у прямого ключа «1» — свёрнута, у
// обратного «1» — развёрнута.
export function isCollapsed(zone: ZoneKey, stored: boolean): boolean {
  return COLLAPSE_KEYS[zone].inverted ? !stored : stored;
}

// Потолки (design.spec §4.3–§4.6).
export const CAPS = {
  decisions: 4,
  blocked: 4,
  work: 12,
  readyOwn: 5,
  readyOther: 2,
  readyAssigned: 2,
  readyWaiting: 2,
  readyInParent: 10,
  done: 5,
  donePage: 20,
} as const;

// Предел строк развёрнутой зоны и выборки этапов: тот же, что у списка без
// limit, но передаётся явно — запроса без limit страница не делает.
export const EXPANDED_LIMIT = 200;
// /approvals: по умолчанию — умолчание сервера, «Показать все» — его потолок.
export const APPROVALS_LIMIT = 100;
// Список задач с детьми для фильтра родителя: верхний уровень, открытые.
export const PARENTS_LIMIT = 200;
// Сколько строк верхнего уровня бэклога читает «Можно брать сейчас»: из них
// пропускаются заблокированные и начатые, поэтому больше, чем показывается.
export const READY_SCAN = 50;

// Категории статуса — перечень схемы, по нему ветвиться можно. «Начатая»
// задача вне правила in_work сервера — на статусе любой категории, кроме
// backlog (design.spec §3).
export const CATEGORIES = ['backlog', 'active', 'waiting', 'done', 'cancelled'] as const;
export const STARTED_CATEGORIES = CATEGORIES.filter((c) => c !== 'backlog').join(',');

// Порог колонки «Дальше» — ширина области страницы, а не окна: она зависит от
// меню.
export const NEXT_COLUMN_MIN_WIDTH = 1100;

export function nextContainer(width: number): 'column' | 'sheet' {
  return width >= NEXT_COLUMN_MIN_WIDTH ? 'column' : 'sheet';
}

// ── фильтры ─────────────────────────────────────────────────────────────────

// Фильтры страницы живут только в адресе: type, parent, q.
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

// «Тип: T · Родитель: KEY · Поиск: «q»» — только включённые фильтры.
export function filterSummary(f: OverviewFilters): string {
  const parts: string[] = [];
  if (f.type) parts.push(`Тип: ${f.type}`);
  if (f.parent) parts.push(`Родитель: ${f.parent}`);
  if (f.q) parts.push(`Поиск: «${f.q}»`);
  return parts.join(' · ');
}

// Типы для фильтра «Все типы», групп и новой задачи: типы с действующим
// циклом в порядке taskTypes; объявленный в перечне без цикла (задачу такого
// типа не завести) добавляется, только если он уже стоит в фильтре.
export function cycleTypes(all: string[], withCycle: string[], current: string): string[] {
  return all.filter((t) => withCycle.includes(t) || t === current);
}

// Тип новой задачи: выбранный фильтр, иначе первый тип данных проекта.
export function defaultNewTaskType(filterType: string, projectTypes: string[]): string | undefined {
  if (filterType && projectTypes.includes(filterType)) return filterType;
  return projectTypes[0];
}

// ── запросы блоков ──────────────────────────────────────────────────────────

export const common = (f: OverviewFilters): ListTasksQuery => ({
  type: f.type || undefined,
  parent: f.parent || undefined,
  q: f.q || undefined,
});

// Причины, при которых начатая задача стоит в «Заблокировано»: любая, кроме
// ожидания человека, возврата и «можно забрать», включая коды, которых клиент
// не знает; ждущая человека сюда не попадает.
const BLOCKED_ATTENTION = {attention_except: 'awaits_human,returned,unclaimed', attention_not: 'awaits_human'} as const;

// «Требуют решения»: строки к записям /approvals и строки наблюдателя.
export function decisionsQuery(f: OverviewFilters): ListTasksQuery {
  return {...common(f), attention: 'awaits_human', limit: EXPANDED_LIMIT};
}

// «Заблокировано» — две выборки (design.spec §4.4): начатые по правилу
// сервера (in_work) и начатые на этапе без роли (не in_work, категория не
// backlog). Сервер «начатую» по категории не отбирает, поэтому так.
export function blockedQueries(f: OverviewFilters, expanded = false): [ListTasksQuery, ListTasksQuery] {
  const limit = expanded ? EXPANDED_LIMIT : CAPS.blocked;
  return [
    {...common(f), in_work: true, ...BLOCKED_ATTENTION, limit},
    {...common(f), in_work: false, terminal: false, category: STARTED_CATEGORIES, ...BLOCKED_ATTENTION, limit},
  ];
}

// «Что делается сейчас» — те же две части, из причин допустим только возврат.
export function workQueries(f: OverviewFilters, expanded = false): [ListTasksQuery, ListTasksQuery] {
  const limit = expanded ? EXPANDED_LIMIT : CAPS.work;
  return [
    {...common(f), in_work: true, attention_within: 'returned', limit},
    {...common(f), in_work: false, terminal: false, category: STARTED_CATEGORIES, attention_within: 'returned', limit},
  ];
}

// Этапы, ждущие исполнителя: других причин, кроме возврата, нет. Одним
// запросом: счётчик «можно брать» считается по строкам.
export function stagesQuery(f: OverviewFilters): ListTasksQuery {
  return {...common(f), attention: 'unclaimed', attention_within: 'unclaimed,returned', limit: EXPANDED_LIMIT};
}

// Запасной путь, когда сервер отказал фильтру по причинам (AC-7): этапы с
// ролью без фильтра причин, отбор — на клиенте (stageWaits).
export function stagesFallbackQuery(f: OverviewFilters): ListTasksQuery {
  return {...common(f), in_work: true, terminal: false, limit: EXPANDED_LIMIT};
}

// Строка верхнего уровня бэклога в порядке сервера (как clab backlog):
// неначатые и родители «в работе» с неначатыми детьми. С ?parent= — дети
// этого родителя, неначатые. Заблокированные и начатые на этапе без роли
// отсеивает unstartedModel: фильтра причин здесь нет, и отказа 400 тоже.
export function readyTopQuery(f: OverviewFilters, limit = READY_SCAN): ListTasksQuery {
  const base = {type: f.type || undefined, q: f.q || undefined, order: 'backlog' as const, limit};
  if (f.parent) return {...base, parent: f.parent, terminal: false, in_work: false, category: 'backlog'};
  return {...base, backlog: true, top_level: true};
}

// Неначатые дети начатых и заблокированных родителей (kidsParents) — одним
// запросом по списку ключей.
export function readyKidsQuery(f: OverviewFilters, parents: string[]): ListTasksQuery {
  return {
    type: f.type || undefined,
    q: f.q || undefined,
    parent: parents.join(','),
    terminal: false,
    in_work: false,
    category: 'backlog',
    order: 'backlog',
    limit: EXPANDED_LIMIT,
  };
}

// Все свободные неначатые задачи (любого уровня) — total для счётчика.
export function freeCountQuery(f: OverviewFilters): ListTasksQuery {
  return {...common(f), terminal: false, in_work: false, category: 'backlog', attention_not: 'blocked', limit: 1};
}

// Число строк неначатых — настройка вида в браузере по проекту: 5 или 10,
// по умолчанию 5. Серверной настройки нет. Ключ не с префиксом свёрнутости
// (`sdlc.collapsed.`): это другая настройка, а не свёрнутость секции.
export const BACKLOG_SIZES = [5, 10] as const;
export type BacklogSize = (typeof BACKLOG_SIZES)[number];
export const BACKLOG_SIZE_DEFAULT: BacklogSize = 5;
export const BACKLOG_SIZE_PREFIX = 'sdlc.backlog.size.';

export const backlogSizeKey = (projectKey: string) => BACKLOG_SIZE_PREFIX + projectKey;

export function parseBacklogSize(raw: string | null | undefined): BacklogSize {
  const n = Number(raw);
  return (BACKLOG_SIZES as readonly number[]).includes(n) ? (n as BacklogSize) : BACKLOG_SIZE_DEFAULT;
}

// Хранилище отдаёт функция, а не значение: обращение к localStorage в
// приватном режиме бросает. Недоступно — умолчание, запись молча пропускается.
export function readBacklogSize(storage: () => Pick<Storage, 'getItem'>, projectKey: string): BacklogSize {
  try {
    return parseBacklogSize(storage().getItem(backlogSizeKey(projectKey)));
  } catch {
    return BACKLOG_SIZE_DEFAULT;
  }
}

export function writeBacklogSize(storage: () => Pick<Storage, 'setItem'>, projectKey: string, size: BacklogSize): void {
  try {
    storage().setItem(backlogSizeKey(projectKey), String(size));
  } catch {
    // Выбор живёт до перезагрузки страницы.
  }
}

export function doneQuery(f: OverviewFilters, page: number | null): ListTasksQuery {
  const base = {...common(f), terminal: true, order: 'updated' as const};
  if (page === null) return {...base, limit: CAPS.done};
  return {...base, limit: CAPS.donePage, offset: page * CAPS.donePage};
}

export const PARENTS_QUERY: ListTasksQuery = {top_level: true, terminal: false, limit: PARENTS_LIMIT};

// Две страницы одной выборки (части «с ролью» и «без роли»): строки подряд,
// total — сумма.
export function mergePages(a: TaskListPage, b: TaskListPage): TaskListPage {
  return {tasks: [...a.tasks, ...b.tasks], total: a.total + b.total};
}

// Сервер отказал запросу по смыслу (400): у этих выборок параметры
// постоянные, поэтому отказ — потолок фильтра по причинам (больше 1000
// незавершённых в выборке) или сервер, не знающий параметра.
export function isRejected(err: unknown): boolean {
  return (err as {httpStatus?: number} | null)?.httpStatus === 400;
}

// Сервер, не знающий порядка бэклога, отвечает 400 на параметр order.
export function isOrderRejected(err: unknown): boolean {
  const e = err as {httpStatus?: number; message?: string} | null;
  return e?.httpStatus === 400 && /order|backlog/i.test(e.message ?? '');
}

// ── правило «одна задача — один блок» (design.spec §3) ──────────────────────

export type BlockKey = 'decisions' | 'blocked' | 'ready-stage' | 'ready-waiting' | 'ready-unstarted' | 'work';

// Признаки незавершённой задачи, по которым решается блок.
export interface BlockFacts {
  codes: string[];
  in_work: boolean;
  category: string | undefined;
}

// Начатая — in_work сервера или категория статуса не backlog. Категории нет
// (сервер прежней версии) — только in_work.
export function isStarted(t: Pick<BlockFacts, 'in_work' | 'category'>): boolean {
  return t.in_work || (t.category !== undefined && t.category !== 'backlog');
}

// Блок задачи по первому совпадению таблицы §3. Страница блоки не считает
// этой функцией — их отбирают запросы выше; функция — правило, с которым
// запросы сверяются в проверках.
export function blockOf(t: BlockFacts): BlockKey {
  if (t.codes.includes('awaits_human')) return 'decisions';
  const started = isStarted(t);
  if (started && t.codes.some((c) => c !== 'returned' && c !== 'unclaimed')) return 'blocked';
  if (t.codes.includes('unclaimed')) return 'ready-stage';
  if (!started) return t.codes.includes('blocked') ? 'ready-waiting' : 'ready-unstarted';
  return 'work';
}

const codesOf = (t: Pick<TaskRow, 'attention'>) => (t.attention ?? []).map((a) => a.code);

export function isBlocked(t: Pick<TaskRow, 'blocked_by' | 'attention'>): boolean {
  return (t.blocked_by ?? []).length > 0 || codesOf(t).includes('blocked');
}

const rowStarted = (t: Pick<TaskRow, 'in_work' | 'status_category'>) =>
  isStarted({in_work: t.in_work === true, category: t.status_category});

// Этап ждёт исполнителя: есть «можно забрать», других причин, кроме
// возврата, нет — отбор запасного пути на клиенте.
export function stageWaits(t: Pick<TaskRow, 'attention'>): boolean {
  const codes = codesOf(t);
  return codes.includes('unclaimed') && codes.every((c) => c === 'unclaimed' || c === 'returned');
}

// ── «Требуют решения» ───────────────────────────────────────────────────────

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

// «Требуют решения» у того, кто вправе решать: строго записи /approvals.
// Одна задача — одна строка, сколько бы гейтов у неё ни ждало; порядок —
// порядок записей. Строка — элемент списка той же задачи, нет его — строка
// из записи. Подписи гейта и перехода записи идут в строку: они из версии
// цикла задачи, и читать её ради них не нужно.
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
    approvals: records.map((r) => ({
      transition_key: r.transition.key,
      transition_name: r.transition.name,
      lands_in_name: r.transition.lands_in_name,
      gate_key: r.gate.gate_key,
      gate_name: r.gate.gate_name,
      gate_type: r.gate.type,
      can_decide: r.can_decide,
    })),
  }));
}

// ── «Что делается сейчас» ───────────────────────────────────────────────────

// Есть ли у задачи дети: любая категория, включая отменённые.
export function hasChildren(t: Pick<TaskRow, 'child_counts'>): boolean {
  return Object.keys(t.child_counts ?? {}).length > 0;
}

export interface WorkGroup {
  // `<тип>:<ключ статуса>` — опора data-work-group.
  id: string;
  type: string;
  statusKey: string;
  name: string;
  // Цвет статуса из версии; нет — точка цвета категории.
  color?: string;
  category?: string;
  optional: boolean;
  // Статуса нет в действующей версии цикла типа.
  old: boolean;
  // Подпись: «<роль>» или «<роль> · проверяет <проверяющий>»; null — статус
  // без роли («этап без роли исполнителя — ведут люди»).
  roles: string | null;
  // Подпись типа в заголовке — когда типов больше одного и нет фильтра типа.
  showType: boolean;
  rows: TaskRow[];
}

// Подпись ролей статуса из версии: основная, затем проверяющие.
export function rolesLine(roles: {role_name: string; role_key: string; is_primary: boolean; position: number}[] | undefined): string | null {
  const list = [...(roles ?? [])].sort((a, b) => a.position - b.position);
  if (list.length === 0) return null;
  const name = (r: (typeof list)[number]) => r.role_name || r.role_key;
  const primary = list.filter((r) => r.is_primary).map(name);
  const reviewers = list.filter((r) => !r.is_primary).map(name);
  if (primary.length === 0) return `проверяет ${reviewers.join(', ')}`;
  return reviewers.length > 0 ? `${primary.join(', ')} · проверяет ${reviewers.join(', ')}` : primary.join(', ');
}

// Группы по паре (тип, статус) в порядке типов проекта и позиций статусов
// действующей версии цикла типа; статусы, которых в ней нет, — в конце типа
// с пометкой. Ось — статус цикла, роль — подпись группы (AC-13, AC-14).
// versionOf — действующая версия цикла типа (undefined — не прочиталась или
// цикла нет: подписи тогда из строки).
export function workGroups(
  rows: TaskRow[],
  o: {types: string[]; versionOf: (type: string) => Workflow | undefined; showType: boolean},
): WorkGroup[] {
  const groups = new Map<string, WorkGroup & {order: number}>();
  const typeOrder = (type: string) => {
    const i = o.types.indexOf(type);
    return i < 0 ? o.types.length : i;
  };
  for (const t of rows) {
    const type = taskTypeOf(t);
    const id = `${type}:${t.status_key}`;
    const g = groups.get(id);
    if (g) {
      g.rows.push(t);
      continue;
    }
    const version = o.versionOf(type);
    const status = version?.statuses.find((s) => s.key === t.status_key);
    const old = version !== undefined && status === undefined;
    const position = status ? status.position : Number.MAX_SAFE_INTEGER;
    groups.set(id, {
      id,
      type,
      statusKey: t.status_key,
      name: status?.name || t.status_name || t.status_key,
      color: status?.color || undefined,
      category: status?.category ?? t.status_category,
      optional: status?.is_optional === true,
      old,
      roles: status ? rolesLine(status.roles) : (t.current_run?.role_name ?? t.current_run?.role_key ?? null),
      showType: o.showType,
      rows: [t],
      order: typeOrder(type) * 1e6 + Math.min(position, 1e6 - 1),
    });
  }
  return [...groups.values()]
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ru'))
    .map((g) => {
      const {order, ...rest} = g;
      void order;
      return rest;
    });
}

// ── «Можно брать сейчас» ────────────────────────────────────────────────────

export interface StagesModel {
  // Есть ли у смотрящего ограничение ролями специалиста: тогда свои роли
  // первыми и метка «ваша роль».
  grouped: boolean;
  own: TaskRow[];
  other: TaskRow[];
  // Назначены другому (claimable: false): в блоке с пометкой, но не в счётчике.
  assigned: TaskRow[];
  // Этапы с claimable: true.
  claimable: number;
  // Строк в ответе больше загруженных или выборка — запасной путь: «N+».
  partial: boolean;
}

const enteredAt = (t: TaskRow) => {
  const v = t.current_run?.entered_at ? Date.parse(t.current_run.entered_at) : NaN;
  return Number.isNaN(v) ? Infinity : v;
};

// roleKeys — роли специалиста участника (ProjectMember.role_keys): null —
// любые, пустой список — ни одной; в обоих случаях деления нет.
export function stagesModel(
  rows: TaskRow[],
  total: number,
  roleKeys: string[] | null | undefined,
  fallback = false,
): StagesModel {
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
    partial: fallback || total > rows.length,
  };
}

// Видимая часть этапов под потолком: 5 своих + 2 остальных (без деления — 7
// подряд) и до двух «назначенных другому»; hidden — сколько под «Ещё N».
export function visibleStages(
  m: StagesModel,
  expanded: boolean,
): {own: TaskRow[]; other: TaskRow[]; assigned: TaskRow[]; hidden: number} {
  if (expanded) return {own: m.own, other: m.other, assigned: m.assigned, hidden: 0};
  const ownCap = m.grouped ? CAPS.readyOwn : CAPS.readyOwn + CAPS.readyOther;
  const own = m.own.slice(0, ownCap);
  const other = m.other.slice(0, CAPS.readyOther);
  const assigned = m.assigned.slice(0, CAPS.readyAssigned);
  const hidden = m.own.length + m.other.length + m.assigned.length - own.length - other.length - assigned.length;
  return {own, other, assigned, hidden};
}

export interface UnstartedEntry {
  task: TaskRow;
  // Начатый родитель, чьё место заняла строка (↳ внутри KEY); null —
  // строка верхнего уровня (или ребёнок родителя из фильтра).
  via: string | null;
  // Родитель via сам заблокирован: строка стоит в «Ждут блокирующих» с
  // пометкой «внутри заблокированного KEY», вне счётчика.
  viaBlocked: boolean;
}

export interface UnstartedModel {
  free: UnstartedEntry[];
  waiting: UnstartedEntry[];
  // Свободные неначатые, которые выборка счётчика (freeCountQuery) считает,
  // а блок взять не даёт: дети заблокированных родителей. Вычитаются из
  // счётчика (freeCount), чтобы шапка сходилась со строками.
  held: number;
}

// Неначатые по правилу clab backlog --next (AC-3) и «одна задача — один
// блок» (AC-17): строки верхнего уровня в порядке сервера.
// - Неначатая строка — сама: свободная в «Неначатых», заблокированная — в
//   «Ждут блокирующих». Её неначатые дети — её поддерево, отдельных строк у
//   них нет; у заблокированной они и в счётчик не входят (held).
// - Начатая строка — in_work сервера или категория статуса не backlog (этап
//   без роли тоже) — стоит в «Что делается сейчас» или «Заблокировано», а
//   здесь отдаёт место своим неначатым детям в их порядке: свободные — в
//   «Неначатые» с «↳ внутри KEY», ждущие блокирующих — в «Ждут
//   блокирующих». Заблокирована она сама — все её неначатые дети в «Ждут
//   блокирующих» с «внутри заблокированного KEY» и вне счётчика.
// kids — дети родителей из kidsParents (readyKidsQuery), порядок внутри
// родителя — сервера. inParent — строки уже дети родителя из фильтра.
export function unstartedModel(top: TaskRow[], kids: TaskRow[], inParent: boolean): UnstartedModel {
  const free: UnstartedEntry[] = [];
  const waiting: UnstartedEntry[] = [];
  let held = 0;
  const byParent = new Map<string, TaskRow[]>();
  for (const k of kids) {
    const p = k.parent_key ?? '';
    const g = byParent.get(p);
    if (g) g.push(k);
    else byParent.set(p, [k]);
  }
  const unstartedKids = (key: string) => (byParent.get(key) ?? []).filter((k) => !rowStarted(k));
  const place = (t: TaskRow, via: string | null) => {
    if (rowStarted(t)) return;
    if (isBlocked(t)) waiting.push({task: t, via, viaBlocked: false});
    else free.push({task: t, via, viaBlocked: false});
  };
  for (const t of top) {
    if (inParent) {
      place(t, null);
      continue;
    }
    const blocked = isBlocked(t);
    if (!rowStarted(t)) {
      place(t, null);
      if (blocked) held += unstartedKids(t.key).filter((k) => !isBlocked(k)).length;
      continue;
    }
    for (const k of unstartedKids(t.key)) {
      if (!blocked) {
        place(k, t.key);
        continue;
      }
      waiting.push({task: k, via: t.key, viaBlocked: true});
      if (!isBlocked(k)) held++;
    }
  }
  return {free, waiting, held};
}

// Ключи строк верхнего уровня, чьи дети нужны блоку: начатые (дети займут
// их место) и заблокированные (дети не входят в счётчик). Неначатый
// свободный родитель представляет поддерево сам — его дети не читаются.
export function kidsParents(top: TaskRow[], inParent: boolean): string[] {
  if (inParent) return [];
  return top.filter((t) => hasChildren(t) && (rowStarted(t) || isBlocked(t))).map((t) => t.key);
}

// Свободных неначатых для счётчика и подзаголовка: total выборки без детей
// заблокированных родителей. null — сервер отказал фильтру причин.
export function freeCount(freeTotal: number | null, m: Pick<UnstartedModel, 'held'>): number | null {
  return freeTotal === null ? null : Math.max(0, freeTotal - m.held);
}

export interface ReadyCount {
  n: number;
  partial: boolean;
}

// Счётчик блока: этапы с claimable: true + свободные неначатые (freeCount:
// total выборки без детей заблокированных родителей). freeTotal null —
// сервер отказал фильтру причин, тогда число показанных и «+».
export function readyCount(stages: StagesModel | null, freeTotal: number | null, shownFree: number): ReadyCount | null {
  if (!stages) return null;
  const free = freeTotal ?? shownFree;
  return {n: stages.claimable + free, partial: stages.partial || freeTotal === null};
}

// ── счётчики и состояния ────────────────────────────────────────────────────

// Текст счётчика зоны: «—» — данных нет из-за ошибки, «N+» — неполный.
export function counterText(n: number | null, partial = false): string {
  if (n === null) return '—';
  return partial ? `${n}+` : String(n);
}

// Задачи с детьми для фильтра родителя: открытые задачи верхнего уровня с
// детьми, отбор на клиенте. truncated — верхний уровень длиннее загруженного.
export function parentOptions(rows: TaskRow[], total: number): {parents: TaskRow[]; truncated: boolean} {
  return {parents: rows.filter(hasChildren), truncated: total > rows.length};
}

// Поле фильтра родителя показывается, только если есть открытые задачи
// верхнего уровня с детьми или родитель уже в адресе (UC-6 1а).
export function showParentFilter(parents: TaskRow[], parentInAddress: string): boolean {
  return parents.length > 0 || parentInAddress !== '';
}

export type PageState = 'zones' | 'empty-project' | 'no-results' | 'pending';

// Что показать вместо блоков. zoneTotals — числа задач блоков, null — блок
// ещё не пришёл или упал (тогда показываются блоки). projectTotal — число
// задач проекта без фильтров (запрос с limit=1), undefined — ещё не
// спрашивали.
export function pageState(filtered: boolean, zoneTotals: (number | null)[], projectTotal?: number | null): PageState {
  if (zoneTotals.some((n) => n === null)) return 'zones';
  if (zoneTotals.some((n) => (n ?? 0) > 0)) return 'zones';
  if (filtered) return 'no-results';
  if (projectTotal === undefined) return 'pending';
  return projectTotal === 0 ? 'empty-project' : 'zones';
}
