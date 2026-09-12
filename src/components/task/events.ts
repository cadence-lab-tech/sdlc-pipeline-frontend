// Подписи типов событий ленты. Тип события — строка, которую пишет бэкенд
// (константы Event* в internal/domain), а не перечень схемы: словарь живёт
// здесь и обязан терпеть незнакомый ключ — событие, заведённое на бэкенде
// позже, показывается сырым ключом, а не роняет ленту и не пропадает из неё.
const EVENT_LABELS: Record<string, string> = {
  'task.created': 'задача заведена',
  'task.updated': 'постановка поправлена',
  'task.advanced': 'задача ушла дальше',
  'task.rejected': 'задача возвращена назад',
  'task.cancelled': 'задача снята',
  'task.assigned': 'исполнитель назначен',
  'task.linked': 'связь заведена',
  'task.unlinked': 'связь снята',
  'task.scope_updated': 'область задачи изменена',
  'stage.entered': 'этап начат',
  'stage.claimed': 'этап забран',
  'stage.released': 'этап отпущен',
  'lease.extended': 'аренда продлена',
  'lease.expired': 'аренда истекла',
  'artifact.submitted': 'артефакт сдан',
  'gate.decided': 'решение по гейту',
  'gate.failed': 'гейт не пропустил',
  'review.requested': 'перепроверка запрошена',
  'review.completed': 'перепроверка завершена',
  'repo_ref.linked': 'привязан PR, ветка или коммит',
  'drift.detected': 'найдено расхождение',
  'drift.resolved': 'расхождение разобрано',
  'usage.reported': 'отчёт о стоимости',
};

export function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? type;
}
