import type {Status} from '../api/types';

// Категория статуса — фиксированный перечень схемы (workflow_statuses.category),
// в отличие от ключа статуса, который придумывает проект. Поэтому по категории
// выбирать вид можно, по ключу — нельзя.
export type DotVariant = 'success' | 'warning' | 'error' | 'accent' | 'neutral';

export function categoryVariant(category: string): DotVariant {
  switch (category) {
    case 'active':
      return 'accent';
    case 'waiting':
      return 'warning';
    case 'done':
      return 'success';
    case 'cancelled':
      return 'error';
    default:
      return 'neutral';
  }
}

// Цвет колонки задаёт проект в workflow_statuses.color. Если не задан —
// нейтральный из темы, но никогда не выведенный из имени статуса.
export function statusColor(status: Status): string {
  return status.color ?? 'var(--color-border)';
}

export function primaryRole(status: Status) {
  return status.roles?.find((r) => r.is_primary);
}
