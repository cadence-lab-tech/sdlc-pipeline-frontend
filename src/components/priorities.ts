// Приоритеты — перечень схемы (`CHECK` в `migrations/000003_tasks.up.sql`), а
// не данные проекта: в отличие от статусов и ролей их набор фиксирован, и
// выбор из четырёх значений строится по нему. Список один на все формы, где
// приоритет задаётся: заводится задача или правится её постановка.
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

export const PRIORITY_OPTIONS = PRIORITIES.map((p) => ({value: p, label: p}));

// Приоритет — перечень схемы, поэтому подпись и цвет по нему выбирать можно
// (в отличие от ключа статуса и роли, которые придумывает проект). У каждого
// цвета есть пара для тёмной темы; «низкий» и «обычный» окрашены токенами
// темы, так что читаемы в обеих без отдельной пары.
const PRIORITY_LABELS: Record<string, string> = {
  urgent: 'срочный',
  high: 'высокий',
  normal: 'обычный',
  low: 'низкий',
};

const PRIORITY_CLASS: Record<string, string> = {
  urgent: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
  high: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  normal: '',
  low: 'text-muted-foreground',
};

export function priorityLabel(priority: string): string {
  return PRIORITY_LABELS[priority] ?? priority;
}

export function priorityClass(priority: string): string {
  return PRIORITY_CLASS[priority] ?? '';
}
