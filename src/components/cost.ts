// Стоимость на экранах словами (CLAB-223): формат денег, подписи двух видов
// стоимости, состояние учёта прогона и тип оплаты. Без разметки — правила
// читают метрики, карточка задачи, панель этапа и бюджет команды, а
// проверяются они без браузера (e2e/cost.mjs).
//
// Деньги и условная стоимость (решение 0062) — разные величины и нигде не
// складываются: деньги — это строки отчётов с оплатой `api` и без признака,
// условная стоимость — строки `subscription`, цена по тарифу API за работу,
// которую оплачивает подписка. Сумма `cost_usd` у API остаётся, но экраны
// стоимости главной цифрой её не делают.
//
// Перечни ниже — перечни движка (разрез метрик, состояние учёта, оплата);
// ключей статусов, ролей и моделей проекта в модуле нет и быть не должно.
import type {RunUsage, UsageState} from '../api/types';

export const MONEY_LABEL = 'Деньги (API)';
export const SUBSCRIPTION_LABEL = 'Условно (подписка)';
export const NO_DATA = 'нет данных';

// «Неизвестно» на месте суммы: не «0.00 $» и не пустая строка.
export const UNKNOWN = '—';

// Подсказка к пометке «без признака» (решение 0062).
export const UNSPECIFIED_HINT = 'тип оплаты не указан, считается как API (решение 0062)';

// Что значит предел бюджета и условная сумма рядом с ним.
export const BUDGET_INFO_NOTE = 'информативно, в бюджет не входит';

// Доллары: два знака, а у суммы меньше доллара три — иначе разница между
// моделями и ролями округляется в ноль. Ноль, о котором сообщили, — «0.00 $».
// Неизвестное (null, undefined, не число) — ровно «—»: см. moneyOrUnknown.
export function money(v: number): string {
  return `${v.toFixed(v > 0 && v < 1 ? 3 : 2)} $`;
}

export function moneyOrUnknown(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? money(v) : UNKNOWN;
}

// «из них без признака оплаты: 0.500 $» — только если такая часть есть.
export function unspecifiedNote(v: number | null | undefined): string | null {
  return typeof v === 'number' && v > 0 ? `из них без признака оплаты: ${money(v)}` : null;
}

// Доля 0..1 в процентах: целое без дроби, иначе один знак.
export function percent(share: number): string {
  const p = Math.round(share * 1000) / 10;
  return `${p} %`;
}

// ── разрез метрик ───────────────────────────────────────────────────────────
const DIMENSION_LABEL: Record<string, string> = {
  status: 'Статус',
  role: 'Роль',
  model: 'Модель',
};

// Разрез по-русски; незнакомый показывается как есть.
export function dimensionLabel(dimension: string): string {
  return DIMENSION_LABEL[dimension] ?? dimension;
}

// В разрезе «модель» прогонов без учёта не бывает: модель известна только из
// отчёта, и прогон без отчёта в нём не появляется.
export const MODEL_SILENT_HINT = 'модель известна только из отчёта';

// «Без учёта» строки метрик: прогонов `missing` из прогонов `reported` и
// `missing`. Разрез модели — «—» с подсказкой, а не ноль.
export interface SilentCell {
  text: string;
  hint?: string;
  // Есть прогоны без учёта: сумма строки — нижняя граница.
  incomplete: boolean;
}

export function silentCell(
  row: {dimension: string; reported_runs: number; silent_runs: number},
): SilentCell {
  if (row.dimension === 'model') return {text: UNKNOWN, hint: MODEL_SILENT_HINT, incomplete: false};
  return {
    text: `${row.silent_runs} из ${row.reported_runs + row.silent_runs}`,
    incomplete: row.silent_runs > 0,
  };
}

// Строка метрик без единого отчёта: суммы нечем подтвердить, и ноль на их
// месте был бы ответом «ничего не стоило». Прогон учтён или не вёлся — «—».
export function hasReports(row: {reported_runs: number}): boolean {
  return row.reported_runs > 0;
}

// ── закрытые задачи (CLAB-220) ──────────────────────────────────────────────
export function incompleteNote(row: {incomplete_tasks: number; closed_tasks: number}): string | null {
  if (!(row.incomplete_tasks > 0)) return null;
  return `неполных: ${row.incomplete_tasks} из ${row.closed_tasks} — стоимость занижена`;
}

// «2 из 9 (22.2 %)» — прогоны без учёта закрытых задач и их доля.
export function closedSilentLine(row: {
  reported_runs: number;
  silent_runs: number;
  silent_share: number;
}): string {
  return `${row.silent_runs} из ${row.reported_runs + row.silent_runs} (${percent(row.silent_share)})`;
}

// ── учёт прогона ────────────────────────────────────────────────────────────
// Состояние учёта (CLAB-219). Ответа без `state` (сервер старее) или самого
// объекта usage нет — прогон без отчёта считается `missing`, как и раньше.
export function usageState(usage: Pick<RunUsage, 'reported' | 'state'> | undefined): UsageState {
  if (usage?.state) return usage.state;
  return usage?.reported ? 'reported' : 'missing';
}

const STATE_LABEL: Record<string, string> = {
  reported: 'учёт есть',
  missing: 'без учёта',
  not_applicable: 'учёт не ведётся: прогон никто не забирал',
};

export function usageStateLabel(state: string): string {
  return STATE_LABEL[state] ?? state;
}

const EPS = 1e-9;

// Тип оплаты прогона по трём суммам: «API», «подписка», «API и подписка»,
// с «без признака» для денег, у которых тип не указан. Суммы null — строк с
// такой стоимостью нет, и вида из них не выводится. Деньги целиком без
// признака — только «без признака», а не «API»: этого никто не сообщал.
export function billingLabel(
  usage: Pick<RunUsage, 'api_cost_usd' | 'unspecified_cost_usd' | 'subscription_cost_usd'>,
): string | null {
  const api = usage.api_cost_usd;
  const unspecified = usage.unspecified_cost_usd;
  const parts: string[] = [];
  if (typeof api === 'number') {
    const explicit = api - (unspecified ?? 0);
    if (typeof unspecified !== 'number' || explicit > EPS) parts.push('API');
  }
  if (typeof usage.subscription_cost_usd === 'number') parts.push('подписка');
  if (typeof unspecified === 'number' && unspecified > 0) parts.push('без признака');
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} и ${parts[parts.length - 1]}`;
}

// Деньги и условная стоимость одной строкой; неизвестная сторона (null) не
// выводится. Обе неизвестны — null, и вызывающий пишет «нет данных».
export function costPair(api: number | null | undefined, subscription: number | null | undefined): string | null {
  const parts: string[] = [];
  if (typeof api === 'number') parts.push(`${MONEY_LABEL} ${money(api)}`);
  if (typeof subscription === 'number') parts.push(`${SUBSCRIPTION_LABEL} ${money(subscription)}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}
