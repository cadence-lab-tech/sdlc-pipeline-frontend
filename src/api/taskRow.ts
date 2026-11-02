// Поля строки списка задач (CLAB-364, CLAB-375) и их умолчания. Отдельный
// модуль без запросов: правила читают те же функции, что клиент, и
// проверяются без браузера (e2e/task-row-rules.mjs).
//
// Сервер без CLAB-375 этих полей не отдаёт, а испорченное значение читается
// как «нет поля»: строка тогда рисует ключ, заголовок, приоритет и статус,
// сигналов нет, ошибок тоже.
import type {Attention, Task, TaskCurrentRun, TaskRow, TaskRowCost} from './types';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// Дети по категориям статуса. Нулевые и нечисловые значения отбрасываются:
// «0 в работе» от отсутствия детей в этой категории не отличить, а строке
// нужны только непустые.
function childCounts(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObject(v)) return out;
  for (const [category, n] of Object.entries(v)) {
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) out[category] = n;
  }
  return out;
}

// Поля строки сверх задачи.
export type TaskRowFields = Omit<TaskRow, keyof Task>;

export function normalizeRowFields(t: {[K in keyof TaskRowFields]?: unknown}): TaskRowFields {
  return {
    status_category: typeof t.status_category === 'string' ? t.status_category : undefined,
    awaiting_approval: t.awaiting_approval === true,
    blocked_by: Array.isArray(t.blocked_by)
      ? t.blocked_by.filter((k): k is string => typeof k === 'string')
      : [],
    last_moved_at: typeof t.last_moved_at === 'string' ? t.last_moved_at : null,
    current_run: isObject(t.current_run) ? (t.current_run as unknown as TaskCurrentRun) : null,
    attention: Array.isArray(t.attention)
      ? t.attention.filter((a): a is Attention => isObject(a) && typeof a.code === 'string')
      : [],
    cost: isObject(t.cost) ? (t.cost as unknown as TaskRowCost) : null,
    child_counts: childCounts(t.child_counts),
    subtree_last_moved_at: typeof t.subtree_last_moved_at === 'string' ? t.subtree_last_moved_at : null,
    subtree_cost_usd: typeof t.subtree_cost_usd === 'number' ? t.subtree_cost_usd : null,
  };
}
