// «Сводка» «Обзора» (CLAB-488, design.spec §4.2): сколько задач каждого типа
// в каких статусах его действующего цикла. Без разметки и без React: план
// запросов, суммы, остаток на статусах прежних версий, разрез по категориям,
// адрес списка по счётчику и притормаживание перечитывания. Проверяется без
// браузера (e2e/overview-rules.mjs).
//
// Типы — taskTypes(project), статусы — версия цикла из active_workflows, имена
// и цвета — из неё же. Ветвление — по категории и признакам статуса.
import type {ListTasksQuery, ProjectDetail, Status, TaskListPage, Workflow} from '../../api/types';
import {taskTypes} from '../taskTypes';
import {CATEGORIES, type OverviewFilters} from './zones';

// Окно притормаживания: события проекта перечитывают сводку не чаще (Т-8).
export const SUMMARY_WINDOW_MS = 30_000;
// На узкой области тип с числом статусов больше этого свёрнут до кнопки.
export const NARROW_STATUSES = 4;
// Типов 8 и больше — после шестого «Ещё N типов».
export const TYPES_FOLD_AT = 8;
export const TYPES_SHOWN = 6;

// Подписи категорий в разрезе — со строчной буквы (перечень схемы).
export const CATEGORY_TEXT: Record<string, string> = {
  backlog: 'бэклог',
  active: 'в работе',
  waiting: 'ожидание',
  done: 'готово',
  cancelled: 'отменено',
};
export const categoryText = (c: string) => CATEGORY_TEXT[c] ?? c;

export const SUMMARY_TEXTS = {
  aside: 'по типам задач и статусам их циклов',
  open: 'Незавершённые',
  closed: 'Завершённые',
  old: 'на статусах прежних версий',
  oldTitle:
    'Статусов этих задач нет в действующей версии цикла. Список — незавершённые задачи типа, у таких строк метка «прежняя версия цикла»',
  oldTitleClosed:
    'Статусов этих задач нет в действующей версии цикла. Список — завершённые задачи типа, у таких строк метка «прежняя версия цикла»',
  categoryTitle: 'Включая задачи на прежних версиях цикла',
  noCycle: 'У типа нет действующего цикла — статусы не разложены. Число ведёт к списку задач типа.',
  others: 'Задачи типов, которых нет среди типов проекта: всего в проекте больше, чем сумма по типам.',
  versionFailed: 'Статусы цикла не прочитались.',
  legend: 'цвет статуса — из цикла, без цвета — по категории · пунктир — необязательный этап · число ведёт к списку задач с этим отбором',
  optional: 'необязательный этап',
} as const;

// ── план запросов ───────────────────────────────────────────────────────────

// Счётчик сводки: что он считает и каким запросом.
export type CountKey =
  | {kind: 'project'}
  | {kind: 'type'; type: string}
  | {kind: 'terminal'; type: string}
  | {kind: 'status'; type: string; status: string};

export const countId = (k: CountKey): string =>
  k.kind === 'project' ? 'project' : k.kind === 'status' ? `status:${k.type}:${k.status}` : `${k.kind}:${k.type}`;

const scoped = (f: OverviewFilters): ListTasksQuery => ({parent: f.parent || undefined, q: f.q || undefined});

export function countQuery(k: CountKey, f: OverviewFilters): ListTasksQuery {
  const base = {...scoped(f), limit: 1};
  switch (k.kind) {
    case 'project':
      return base;
    case 'type':
      return {...base, type: k.type};
    case 'terminal':
      return {...base, type: k.type, terminal: true};
    case 'status':
      return {...base, type: k.type, status: k.status};
  }
}

// Типы сводки: с фильтром типа — только он.
export function summaryTypes(project: ProjectDetail, f: OverviewFilters): string[] {
  const all = taskTypes(project);
  return f.type ? [f.type] : all;
}

// Действующая версия цикла типа (голова из active_workflows).
export function headOf(project: ProjectDetail, type: string) {
  return project.active_workflows.find((w) => (w.task_types ?? []).includes(type));
}

// Статусы версии в порядке position.
export function orderedStatuses(v: Pick<Workflow, 'statuses'>): Status[] {
  return [...v.statuses].sort((a, b) => a.position - b.position);
}

// Все счётчики одного чтения: проект (без фильтра типа), на тип — всего и
// завершённых, на статус версии — по одному. Не больше Σ статусов + 2·типов +
// 1 (AC-12). versions — версии по id цикла; нет версии — у типа только итоги.
export function summaryPlan(
  project: ProjectDetail,
  f: OverviewFilters,
  versions: Map<string, Workflow | null>,
): CountKey[] {
  const out: CountKey[] = [];
  if (!f.type) out.push({kind: 'project'});
  for (const type of summaryTypes(project, f)) {
    out.push({kind: 'type', type}, {kind: 'terminal', type});
    const head = headOf(project, type);
    const v = head ? versions.get(head.id) : undefined;
    if (v) for (const s of orderedStatuses(v)) out.push({kind: 'status', type, status: s.key});
  }
  return out;
}

// ── модель ──────────────────────────────────────────────────────────────────

export interface SummaryStatus {
  key: string;
  name: string;
  color?: string;
  category: string;
  terminal: boolean;
  optional: boolean;
  // null — счётчик не прочитался («—»).
  count: number | null;
}

export interface SummaryCategory {
  category: string;
  count: number;
}

export interface SummaryType {
  type: string;
  // Цикл типа: имя и номер версии; null — у типа нет действующего цикла.
  cycle: {name: string; version: number} | null;
  // Версия цикла есть, но не прочиталась: только итоги.
  versionFailed: boolean;
  total: number | null;
  closed: number | null;
  open: number | null;
  statuses: SummaryStatus[];
  // На статусах прежних версий: незавершённые и завершённые; null — не
  // посчитать (не прочитался какой-то счётчик).
  oldOpen: number | null;
  oldClosed: number | null;
  categories: SummaryCategory[];
  // Разрез по категориям виден, только если в какой-то категории больше
  // одного статуса — иначе он повторяет чипы.
  showCategories: boolean;
  // Не прочиталось чисел этого типа.
  failed: number;
}

export interface SummaryModel {
  types: SummaryType[];
  // Типы без задач по отбору parent/q — одной строкой «Нет задач по отбору».
  emptyTypes: string[];
  // Задачи типов, которых нет среди типов проекта; null — не посчитать или 0.
  others: number | null;
  total: number | null;
  failed: number;
}

const nonNeg = (n: number) => Math.max(0, n);

// Модель сводки по результатам счётчиков (id → total или null при ошибке).
// filtered — фильтр parent или q: типы без задач не рисуются.
export function summaryModel(
  project: ProjectDetail,
  f: OverviewFilters,
  versions: Map<string, Workflow | null>,
  counts: Map<string, number | null>,
): SummaryModel {
  const get = (k: CountKey) => {
    const v = counts.get(countId(k));
    return v === undefined ? null : v;
  };
  const types: SummaryType[] = [];
  const emptyTypes: string[] = [];
  let failed = 0;
  for (const type of summaryTypes(project, f)) {
    const head = headOf(project, type);
    const v = head ? versions.get(head.id) : undefined;
    const total = get({kind: 'type', type});
    const closed = get({kind: 'terminal', type});
    let typeFailed = (total === null ? 1 : 0) + (closed === null ? 1 : 0);
    const statuses: SummaryStatus[] = v
      ? orderedStatuses(v).map((s) => {
          const count = get({kind: 'status', type, status: s.key});
          if (count === null) typeFailed++;
          return {
            key: s.key,
            name: s.name || s.key,
            color: s.color || undefined,
            category: s.category,
            terminal: s.is_terminal,
            optional: s.is_optional === true,
            count,
          };
        })
      : [];
    const sum = (list: SummaryStatus[]) =>
      list.some((s) => s.count === null) ? null : list.reduce((n, s) => n + (s.count ?? 0), 0);
    const openSum = sum(statuses.filter((s) => !s.terminal));
    const closedSum = sum(statuses.filter((s) => s.terminal));
    const open = total !== null && closed !== null ? nonNeg(total - closed) : null;
    const oldOpen = v && open !== null && openSum !== null ? nonNeg(open - openSum) : null;
    const oldClosed = v && closed !== null && closedSum !== null ? nonNeg(closed - closedSum) : null;
    const present = [...new Set(statuses.map((s) => s.category))].sort((a, b) => {
      const ia = (CATEGORIES as readonly string[]).indexOf(a);
      const ib = (CATEGORIES as readonly string[]).indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    const categories = present.map((category) => ({
      category,
      count: statuses.filter((s) => s.category === category).reduce((n, s) => n + (s.count ?? 0), 0),
    }));
    const showCategories = present.some((c) => statuses.filter((s) => s.category === c).length > 1);
    failed += typeFailed;
    const row: SummaryType = {
      type,
      cycle: head ? {name: head.name, version: head.version} : null,
      versionFailed: Boolean(head) && versions.get(head!.id) === null,
      total,
      closed,
      open,
      statuses,
      oldOpen,
      oldClosed,
      categories,
      showCategories,
      failed: typeFailed,
    };
    // Тип из перечня без действующего цикла и без задач — пустая строка без
    // смысла (сервер объявляет тип по умолчанию всегда): не рисуется.
    if (!head && total === 0 && !f.type) continue;
    if ((f.parent || f.q) && total === 0) emptyTypes.push(type);
    else types.push(row);
  }
  let others: number | null = null;
  const projectTotal = f.type ? null : get({kind: 'project'});
  if (!f.type) {
    if (projectTotal === null) failed++;
    const byTypes = [...types].map((t) => t.total);
    if (projectTotal !== null && byTypes.every((n) => n !== null)) {
      const rest = projectTotal - byTypes.reduce((n: number, x) => n + (x ?? 0), 0);
      others = rest > 0 ? rest : null;
    }
  }
  const total = f.type ? (types[0]?.total ?? 0) : projectTotal;
  return {types, emptyTypes, others, total, failed};
}

// Загрузка сводки: версии (getVersion кэширует — версия иммутабельна), затем
// все счётчики разом. Ни один не прочитался — ошибка наружу (Failure блока);
// часть — «—» на месте чисел. list — api.listTasks проекта.
export async function fetchSummary(
  list: (q: ListTasksQuery) => Promise<TaskListPage>,
  getVersion: (id: string) => Promise<Workflow>,
  project: ProjectDetail,
  f: OverviewFilters,
): Promise<SummaryModel> {
  const versions = new Map<string, Workflow | null>();
  const heads = [...new Set(summaryTypes(project, f).map((t) => headOf(project, t)?.id).filter(Boolean) as string[])];
  await Promise.all(
    heads.map((id) =>
      getVersion(id).then(
        (v) => versions.set(id, v),
        () => versions.set(id, null),
      ),
    ),
  );
  const plan = summaryPlan(project, f, versions);
  const settled = await Promise.allSettled(plan.map((k) => list(countQuery(k, f))));
  const counts = new Map<string, number | null>();
  settled.forEach((r, i) => counts.set(countId(plan[i]), r.status === 'fulfilled' ? r.value.total : null));
  if (plan.length > 0 && settled.every((r) => r.status === 'rejected')) {
    throw (settled[0] as PromiseRejectedResult).reason;
  }
  return summaryModel(project, f, versions, counts);
}

// ── адрес списка по счётчику ────────────────────────────────────────────────

export type Selection =
  | {type: string; status: string}
  | {type: string; category: string}
  | {type: string; terminal: boolean}
  | {type: string};

// /p/:key/tasks?type=…&(status|category|terminal)=…&parent=…&q=… — отбор живёт
// в адресе, фильтры страницы переходят с «Обзора».
export function summaryHref(projectKey: string, sel: Selection, f: Pick<OverviewFilters, 'parent' | 'q'>): string {
  const sp = new URLSearchParams();
  sp.set('type', sel.type);
  if ('status' in sel) sp.set('status', sel.status);
  else if ('category' in sel) sp.set('category', sel.category);
  else if ('terminal' in sel) sp.set('terminal', String(sel.terminal));
  if (f.parent) sp.set('parent', f.parent);
  if (f.q) sp.set('q', f.q);
  return `/p/${projectKey}/tasks?${sp}`;
}

// Число с разделителем тысяч; null — «—».
export function countText(n: number | null): string {
  return n === null ? '—' : n.toLocaleString('ru-RU');
}

// «N задач» с согласованием.
export function tasksWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'задача';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'задачи';
  return 'задач';
}

// ── притормаживание ─────────────────────────────────────────────────────────

// Решение по просьбе перечитать сводку событием: первое после тишины — сразу,
// в окне — одно перечитывание по концу окна (хвост не теряется). lastAt —
// начало прошлого чтения, null — ещё не читали.
export function throttleStep(lastAt: number | null, now: number, windowMs = SUMMARY_WINDOW_MS): {run: true} | {run: false; wait: number} {
  if (lastAt === null || now - lastAt >= windowMs) return {run: true};
  return {run: false, wait: lastAt + windowMs - now};
}
