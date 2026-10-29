import type {Status} from '../api/types';

// Подписи отметки «необязательный этап» (решение 0066): один словарь на список
// статусов редактора и подписи диалога. Функции без разметки, чтобы e2e/labels.mjs
// проверял их без браузера. Правила цикла (какие статусы можно отметить, что
// держит активацию) здесь не повторяются: их проверяет сервер.
export const OPTIONAL_LABEL = 'необязательный';
export const DISABLED_BY_DEFAULT_LABEL = 'выключен по умолчанию';

type Marks = Pick<Status, 'is_optional' | 'enabled_by_default'>;

// Бейджи строки статуса по порядку: сначала отметка, потом умолчание, и умолчание
// только у необязательного статуса. Поля, которых нет в ответе, читаются как у
// обычного статуса: обязательный, без бейджей.
export function optionalBadges(status: Partial<Marks>): string[] {
  if (!status.is_optional) return [];
  return status.enabled_by_default === false
    ? [OPTIONAL_LABEL, DISABLED_BY_DEFAULT_LABEL]
    : [OPTIONAL_LABEL];
}

// Пара полей для тела запроса. У обязательного статуса умолчание «выключен»
// сервер отбивает 400, поэтому снятая отметка всегда уходит с умолчанием
// «включён» — ровно так пару вернул бы сам сервер.
export function optionalFields(isOptional: boolean, enabledByDefault: boolean): Marks {
  return {is_optional: isOptional, enabled_by_default: isOptional ? enabledByDefault : true};
}
