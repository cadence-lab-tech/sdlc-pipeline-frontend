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

// ── выбор этапов у задачи (CLAB-318) ─────────────────────────────────────────
//
// Выбор хранится на задаче полным набором «ключ → bool» (решение 0066, п. 7).
// Что значит «ключа нет» — решает цикл: умолчание статуса, как у движка. Ключей
// статусов здесь нет: набор этапов приходит из версии цикла.

export const OPTIONAL_STAGES_TITLE = 'Выбор этапов';
export const OPTIONAL_STAGES_FORM_TITLE = 'Необязательные этапы';
export const STAGE_CURRENT_HINT = 'этап идёт сейчас';
export const TASK_CLOSED_HINT = 'задача закрыта';
export const STAGES_READONLY_HINT = 'этапы задачи выбирает сопровождающий проекта';
export const TRANSITION_UNAVAILABLE_LABEL = 'Недоступен';
export const TRANSITION_UNAVAILABLE_TEXT = 'Переход недоступен';

type StageLike = Pick<Status, 'key' | 'name' | 'position'> & Partial<Marks> & {is_terminal?: boolean};

// Необязательные статусы версии цикла по порядку position; ответ без отметок
// даёт пустой список — блоки выбора скрыты.
export function optionalStatuses<T extends StageLike>(statuses: T[] | undefined): T[] {
  return (statuses ?? []).filter((s) => s.is_optional === true).sort((a, b) => a.position - b.position);
}

// Включён ли этап у задачи: явный выбор, иначе умолчание цикла. Обязательный
// статус всегда «включён» — выбора у него нет.
export function stageEnabled(status: Partial<Marks>, choice: Record<string, boolean> | undefined, key: string): boolean {
  if (!status.is_optional) return true;
  const own = choice?.[key];
  return typeof own === 'boolean' ? own : status.enabled_by_default !== false;
}

export interface StageToggle {
  key: string;
  name: string;
  value: boolean;
}

// Строки выбора: форма новой задачи (значения — умолчания) и «Детали»
// (значения — выбор задачи).
export function stageToggles(statuses: StageLike[] | undefined, choice?: Record<string, boolean>): StageToggle[] {
  return optionalStatuses(statuses).map((s) => ({
    key: s.key,
    name: s.name,
    value: stageEnabled(s, choice, s.key),
  }));
}

// Тело заведения: только ключи, значение которых человек поменял относительно
// показанного умолчания; без правок — undefined, и поля в запросе нет.
export function changedStages(
  shown: StageToggle[],
  edited: Record<string, boolean>,
): Record<string, boolean> | undefined {
  const out: Record<string, boolean> = {};
  for (const s of shown) {
    if (s.key in edited && edited[s.key] !== s.value) out[s.key] = edited[s.key];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// Подсказка, почему переключатель недоступен; undefined — переключать можно.
// Это подсказка интерфейса: отказ сервера (409) показывается в блоке.
export function stageLockHint(
  key: string,
  task: {status_key: string; closed_at?: string},
  statuses: StageLike[] | undefined,
): string | undefined {
  const current = statuses?.find((s) => s.key === task.status_key);
  if (task.closed_at || current?.is_terminal) return TASK_CLOSED_HINT;
  if (key === task.status_key) return STAGE_CURRENT_HINT;
  return undefined;
}

function stageName(key: string, statuses: StageLike[] | undefined): string {
  return statuses?.find((s) => s.key === key)?.name ?? key;
}

// «Design, Docs» — имена пропускаемых этапов по порядку.
export function skipNames(skips: string[] | undefined, statuses: StageLike[] | undefined): string {
  return (skips ?? []).map((k) => stageName(k, statuses)).join(', ');
}

export const SKIPS_PREFIX = 'пропуск';

// Фактическое назначение перехода: без поля — назначение в цикле.
export function landing(t: {to_status: string; lands_in?: string | null}): string | null {
  return t.lands_in === undefined ? t.to_status : t.lands_in;
}

// Строка перехода «→ Development (пропуск: Design)»; undefined у недоступного
// перехода — назначения нет.
export function transitionTarget(
  t: {to_status: string; lands_in?: string | null; skips?: string[]},
  statuses?: StageLike[],
): string | undefined {
  const to = landing(t);
  if (to === null) return undefined;
  const base = `→ ${stageName(to, statuses)}`;
  return t.skips && t.skips.length > 0 ? `${base} (${SKIPS_PREFIX}: ${skipNames(t.skips, statuses)})` : base;
}

// Подсказка «назначение в цикле», когда оно отличается от фактического.
export function cycleTargetNote(
  t: {to_status: string; lands_in?: string | null},
  statuses: StageLike[] | undefined,
): string | undefined {
  const to = landing(t);
  return to !== null && to !== t.to_status ? `в цикле переход ведёт в ${stageName(t.to_status, statuses)}` : undefined;
}

// Причина недоступности человеческим текстом. Код (`stage_disabled`) на экран
// не выводится, незнакомое значение — общий текст без показа значения (Q-2).
export function unavailableReason(
  t: {to_status: string; unavailable?: string},
  statuses: StageLike[] | undefined,
): string {
  if (t.unavailable === 'stage_disabled') {
    return `Этап ${stageName(t.to_status, statuses)} выключен у задачи; включите его в «Деталях»`;
  }
  return TRANSITION_UNAVAILABLE_TEXT;
}

// Недоступен переход по причине, не связанной с гейтами.
export function isUnavailable(t: {allowed: boolean; unavailable?: string}): boolean {
  return !t.allowed && Boolean(t.unavailable);
}

// Уведомление после перехода с пропуском; undefined — пропуска не было.
export function skippedNotice(
  landedName: string,
  skips: string[] | undefined,
  statuses: StageLike[] | undefined,
): string | undefined {
  if (!skips || skips.length === 0) return undefined;
  return `Задача перешла в ${landedName}, пропущено: ${skipNames(skips, statuses)}`;
}

// Подпись ребра схемы для перехода с пропуском:
// «Старт: A → B (пропуск: C; встанет в D)».
export function edgeLandingTitle(
  name: string,
  from: string,
  to: string,
  skips: string[],
  landed: string,
  statuses: StageLike[] | undefined,
): string {
  return `${name}: ${from} → ${to} (${SKIPS_PREFIX}: ${skipNames(skips, statuses)}; встанет в ${landed})`;
}

export interface LandingLine {
  key: string;
  kind: 'skips' | 'unavailable';
  text: string;
}

// Строки под схемой цикла: переходы из текущего статуса с пропуском и
// недоступные. Переход без пропуска и без недоступности строки не получает —
// схема совпадает с прежней.
export function landingLines(
  transitions: {key: string; name: string; to_status: string; lands_in?: string | null; skips?: string[]; unavailable?: string; allowed: boolean}[],
  statuses: StageLike[] | undefined,
): LandingLine[] {
  const lines: LandingLine[] = [];
  for (const t of transitions) {
    if (isUnavailable(t)) {
      const reason =
        t.unavailable === 'stage_disabled'
          ? `недоступен: этап ${stageName(t.to_status, statuses)} выключен`
          : 'недоступен';
      lines.push({key: t.key, kind: 'unavailable', text: `${t.name}: ${reason}`});
      continue;
    }
    const to = landing(t);
    if (t.skips && t.skips.length > 0 && to !== null) {
      lines.push({
        key: t.key,
        kind: 'skips',
        text: `${t.name} → ${stageName(to, statuses)} (${SKIPS_PREFIX}: ${skipNames(t.skips, statuses)})`,
      });
    }
  }
  return lines;
}

// Панель этапа без прогонов: что сказать о нём. «Ещё не начинался» — для
// обычного этапа впереди; пропущенный и выключенный говорят о себе сами.
export function notStartedTitle(state: string | undefined): string {
  if (state === 'skipped') return 'Этап пропущен';
  if (state === 'disabled') return 'Этап выключен у задачи';
  return 'Этап ещё не начинался';
}

export function notStartedNote(state: string | undefined): string | undefined {
  if (state === 'skipped') return 'Задача прошла мимо этого этапа: он был выключен.';
  if (state === 'disabled') return 'Задача этот этап пропустит. Включить его можно в «Деталях».';
  return undefined;
}
