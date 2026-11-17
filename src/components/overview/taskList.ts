// Страница «Задачи» по счётчику «Сводки» (CLAB-488, design.spec §5): отбор
// живёт в адресе — тип и ровно одно из status, category, terminal, плюс
// фильтры «Обзора» parent и q. Без разметки, проверяется без браузера
// (e2e/overview-rules.mjs).
import type {ListTasksQuery, TaskRow} from '../../api/types';
import {categoryText} from './summary';

export const TASK_LIST_PAGE = 50;

export type TaskListSelection = {type: string; parent: string; q: string} & (
  | {by: 'status'; status: string}
  | {by: 'category'; category: string}
  | {by: 'terminal'; terminal: boolean}
  | {by: 'type'}
);

// Отбор из адреса; null — не задан или непонятен («Отбор не задан»). Без
// status, category и terminal — все задачи типа (число «N задач» сводки).
export function readSelection(sp: URLSearchParams): TaskListSelection | null {
  const get = (name: string) => (sp.get(name) ?? '').trim();
  const type = get('type');
  if (!type) return null;
  const base = {type, parent: get('parent'), q: get('q')};
  const status = get('status');
  const category = get('category');
  const terminal = get('terminal');
  const given = [status, category, terminal].filter(Boolean).length;
  if (given > 1) return null;
  if (status) return {...base, by: 'status', status};
  if (category) return {...base, by: 'category', category};
  if (terminal) {
    if (terminal !== 'true' && terminal !== 'false') return null;
    return {...base, by: 'terminal', terminal: terminal === 'true'};
  }
  return {...base, by: 'type'};
}

// Запрос страницы списка: по последнему движению, порциями по 50.
export function selectionQuery(sel: TaskListSelection, offset = 0): ListTasksQuery {
  const q: ListTasksQuery = {
    type: sel.type,
    parent: sel.parent || undefined,
    q: sel.q || undefined,
    order: 'updated',
    limit: TASK_LIST_PAGE,
    offset: offset || undefined,
  };
  if (sel.by === 'status') q.status = sel.status;
  else if (sel.by === 'category') q.category = sel.category;
  else if (sel.by === 'terminal') q.terminal = sel.terminal;
  return q;
}

// «← Обзор»: обратно с тем же типом и фильтрами.
export function overviewHref(projectKey: string, sel: Pick<TaskListSelection, 'type' | 'parent' | 'q'> | null): string {
  const sp = new URLSearchParams();
  if (sel?.type) sp.set('type', sel.type);
  if (sel?.parent) sp.set('parent', sel.parent);
  if (sel?.q) sp.set('q', sel.q);
  const s = sp.toString();
  return `/p/${projectKey}/overview${s ? `?${s}` : ''}`;
}

// Токены отбора над таблицей. statusName — имя статуса из действующей версии
// цикла типа (нет — ключ).
export function selectionTokens(sel: TaskListSelection, statusName?: string): string[] {
  const out = [`Тип: ${sel.type}`];
  if (sel.by === 'status') out.push(`Статус: ${statusName || sel.status}`);
  if (sel.by === 'category') out.push(`Категория: ${categoryText(sel.category)}`);
  if (sel.by === 'terminal') out.push(sel.terminal ? 'Завершённые' : 'Незавершённые');
  if (sel.parent) out.push(`Родитель: ${sel.parent}`);
  if (sel.q) out.push(`Поиск: «${sel.q}»`);
  return out;
}

// Исполнитель строки: живая аренда, назначенный, «ждёт исполнителя», «этап
// без роли». Пусто — «—».
export function executorText(t: Pick<TaskRow, 'current_run' | 'assignee_handle' | 'attention'>): string {
  const run = t.current_run;
  if (run?.claimed_by_handle && run.lease_alive) return run.claimed_by_handle;
  if (t.assignee_handle) return `назначена: ${t.assignee_handle}`;
  if (run && !run.role_key) return 'этап без роли';
  if ((t.attention ?? []).some((a) => a.code === 'unclaimed') || run?.claimable) return 'ждёт исполнителя';
  return '—';
}
