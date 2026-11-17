import type {Role} from '../../api/types';

// Уровни участия — фиксированный перечень схемы (project_members.role), в
// отличие от ролей специалистов, которые придумывает проект.
export const LEVELS = [
  {value: 'viewer', label: 'viewer — только чтение'},
  {value: 'agent', label: 'agent — работа над задачами'},
  {value: 'maintainer', label: 'maintainer — роли, цикл, апрувы, импорт'},
  {value: 'admin', label: 'admin — участники и токены'},
];

// Роли, которые участник может забирать, задаются на участии, а токен их
// только сужает (решение 0030). Пустой выбор — любые роли проекта: та же
// договорённость, что у токена.
export function roleOptions(roles: Role[]) {
  return roles.filter((r) => !r.archived_at).map((r) => ({value: r.key, label: `${r.name} (${r.key})`}));
}
