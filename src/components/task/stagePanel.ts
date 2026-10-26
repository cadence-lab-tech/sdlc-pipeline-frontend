// Правила панели выбранного этапа (CLAB-285): попытки статуса, перепроверки,
// возвраты, итог стоимости и этап, который ещё не начинался. Без разметки,
// чтобы правила проверялись в e2e/stage-panel.mjs без браузера.
//
// Всё считается по уже полученному ответу карточки (`stage_runs`,
// `artifacts`) и версии цикла задачи. Ключи статусов и ролей здесь только
// сравниваются с данными версии — своих литералов у модуля нет; вердикты
// гейтов показываются как их записал движок, без пересчёта.
import type {
  Artifact,
  Gate,
  RunExit,
  RunUsage,
  StageRun,
  Status,
  StatusRole,
  Transition,
  Workflow,
} from '../../api/types';
import {NO_DATA, billingLabel, costPair, usageState, usageStateLabel} from '../cost';

// Попытка этапа: прогон верхнего уровня и его вложенные перепроверки
// (решение 0017) — они живут внутри попытки и попытками не считаются.
export interface StageAttempt {
  run: StageRun;
  reviews: StageRun[];
}

// Попытки статуса, новые сверху; перепроверки внутри — по времени входа.
export function stageAttempts(runs: StageRun[], statusKey: string): StageAttempt[] {
  const reviews = new Map<string, StageRun[]>();
  for (const run of runs) {
    if (!run.parent_run_id) continue;
    const list = reviews.get(run.parent_run_id);
    if (list) list.push(run);
    else reviews.set(run.parent_run_id, [run]);
  }
  return runs
    .filter((r) => !r.parent_run_id && r.status_key === statusKey)
    .sort((a, b) => b.entered_at.localeCompare(a.entered_at))
    .map((run) => ({
      run,
      reviews: (reviews.get(run.id) ?? []).sort((a, b) => a.entered_at.localeCompare(b.entered_at)),
    }));
}

// Роль прогона с версией: «analytics v7». Версии нет (прогон без роли или
// бэкенд старше CLAB-283) — только ключ; роли нет — пустая строка.
export function roleWithVersion(run: Pick<StageRun, 'role_key' | 'role_version'>): string {
  if (!run.role_key) return '';
  return typeof run.role_version === 'number' ? `${run.role_key} v${run.role_version}` : run.role_key;
}

// Стоимость прогона одной строкой (R7, CLAB-223). Состояние учёта — от
// сервера: «без учёта» (`missing`) и «учёт не ведётся» (`not_applicable`)
// разные вещи, и ни то ни другое не «0.00 $». Деньги и условная стоимость
// раздельно, показывается только та сторона, о которой сообщили.
export function usageTokens(usage: RunUsage): number | null {
  const parts = [usage.input_tokens, usage.output_tokens, usage.cache_read_tokens, usage.cache_write_tokens];
  if (parts.every((p) => p === null || p === undefined)) return null;
  return parts.reduce<number>((sum, p) => sum + (p ?? 0), 0);
}

export function runCostLine(run: Pick<StageRun, 'usage'>): string {
  const usage = run.usage;
  const state = usageState(usage);
  if (state !== 'reported' || !usage) return usageStateLabel(state);
  const parts: string[] = [];
  parts.push(costPair(usage.api_cost_usd, usage.subscription_cost_usd) ?? `стоимость: ${NO_DATA}`);
  const tokens = usageTokens(usage);
  parts.push(tokens === null ? `токенов: ${NO_DATA}` : `токенов ${tokens.toLocaleString('ru')}`);
  const billing = billingLabel(usage);
  if (billing) parts.push(`оплата: ${billing}`);
  return parts.join(' · ');
}

// Итог этапа: суммы отчитавшихся прогонов статуса (попытки и их
// перепроверки) — деньги и условная стоимость раздельно — и число прогонов
// без учёта. Их стоимость неизвестна, и к сумме они не прибавляются нулём;
// прогоны `not_applicable` (агент не работал) не считаются ни там, ни там.
// Сторона суммы null, пока ни один прогон не сообщил такой стоимости.
export interface StageTotal {
  api_usd: number | null;
  unspecified_usd: number | null;
  subscription_usd: number | null;
  tokens: number;
  reported: number;
  silent: number;
  not_applicable: number;
}

export function stageTotal(attempts: StageAttempt[]): StageTotal {
  const total: StageTotal = {
    api_usd: null,
    unspecified_usd: null,
    subscription_usd: null,
    tokens: 0,
    reported: 0,
    silent: 0,
    not_applicable: 0,
  };
  const add = (sum: number | null, v: number | null | undefined) => (typeof v === 'number' ? (sum ?? 0) + v : sum);
  for (const a of attempts) {
    for (const run of [a.run, ...a.reviews]) {
      const state = usageState(run.usage);
      if (state === 'missing') {
        total.silent++;
        continue;
      }
      if (state !== 'reported' || !run.usage) {
        total.not_applicable++;
        continue;
      }
      total.reported++;
      total.api_usd = add(total.api_usd, run.usage.api_cost_usd);
      total.unspecified_usd = add(total.unspecified_usd, run.usage.unspecified_cost_usd);
      total.subscription_usd = add(total.subscription_usd, run.usage.subscription_cost_usd);
      total.tokens += usageTokens(run.usage) ?? 0;
    }
  }
  return total;
}

export function stageTotalLine(total: StageTotal): string {
  if (total.reported === 0) {
    if (total.silent > 0) return `стоимость этапа: ${usageStateLabel('missing')}`;
    if (total.not_applicable > 0) return `стоимость этапа: ${usageStateLabel('not_applicable')}`;
    return `стоимость этапа: ${NO_DATA}`;
  }
  const tokens = `токенов ${total.tokens.toLocaleString('ru')}`;
  const pair = costPair(total.api_usd, total.subscription_usd);
  return `стоимость этапа ${pair ? `${pair} · ${tokens}` : `${NO_DATA} · ${tokens}`}`;
}

function statusName(statuses: Status[] | undefined, key: string): string {
  return statuses?.find((s) => s.key === key)?.name ?? key;
}

// Чем попытка закончена — по выходу из карточки (`exit`). Вид выхода —
// перечень движка (тип события перехода), а не данные проекта; незнакомый
// показывается как есть. Возврат — своей строкой «вернула в …», см.
// returnedTo.
const EXIT_LABEL: Record<RunExit['kind'], (transition: string, to: string) => string> = {
  advanced: (transition, to) => `ушла в «${to}» переходом ${transition}`,
  rejected: (transition, to) => `вернула в «${to}» переходом ${transition}`,
  cancelled: (transition) => `отменена переходом ${transition}`,
};

export function exitLabel(exit: RunExit, statuses: Status[] | undefined): string {
  const to = statusName(statuses, exit.to_status);
  const label = EXIT_LABEL[exit.kind];
  return label ? label(exit.transition, to) : `${exit.kind}: ${exit.transition} → ${to}`;
}

// Возврат с обеих сторон (UC-2). Попытка, закрытая возвратом, — «вернула в
// <статус>» с комментарием перехода; попытка, начатая возвратом
// (`rejected_from_run_id`), — «вернулась с <статус>» с тем же комментарием.
// Комментария нет — строка без текста, выдумывать его нельзя.
export interface ReturnNote {
  text: string;
  comment: string | null;
  // Статус по другую сторону возврата — чтобы сослаться на его панель;
  // прогон, из которого вернули, не найден — undefined.
  statusKey?: string;
  statusName?: string;
  // Описание проблемы, с которым задача ушла назад, — артефакт прогона,
  // закрытого возвратом.
  problemReport?: Artifact;
}

// Описание проблемы — соглашение об именовании, как у движка
// (workflow/agents.go, isProblemReport): префикс problem. зарезервирован
// под описание проблемы, с которым задача уходит назад.
export function isProblemReport(kind: string): boolean {
  return kind.startsWith('problem.');
}

export function problemReportOf(artifacts: Artifact[], runId: string): Artifact | undefined {
  return currentArtifacts(artifacts)
    .filter((a) => a.stage_run_id === runId && isProblemReport(a.kind))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

export function returnedTo(run: StageRun, artifacts: Artifact[], statuses: Status[] | undefined): ReturnNote | null {
  if (run.exit?.kind !== 'rejected') return null;
  return {
    text: `вернула в «${statusName(statuses, run.exit.to_status)}»`,
    comment: run.exit.comment || null,
    statusKey: run.exit.to_status,
    statusName: statusName(statuses, run.exit.to_status),
    problemReport: problemReportOf(artifacts, run.id),
  };
}

export function returnedFrom(
  run: StageRun,
  runs: StageRun[],
  artifacts: Artifact[],
  statuses: Status[] | undefined,
): ReturnNote | null {
  if (!run.rejected_from_run_id) return null;
  const from = runs.find((r) => r.id === run.rejected_from_run_id);
  if (!from) return {text: 'вернулась с предыдущего этапа', comment: null};
  return {
    text: `вернулась с «${statusName(statuses, from.status_key)}»`,
    comment: from.exit?.kind === 'rejected' ? from.exit.comment || null : null,
    statusKey: from.status_key,
    statusName: statusName(statuses, from.status_key),
    problemReport: problemReportOf(artifacts, from.id),
  };
}

// Заменённые версии артефактов в панели не показываются: артефакт
// иммутабелен, правка — новая версия через supersedes_id, и читать нужно её.
export function currentArtifacts(artifacts: Artifact[]): Artifact[] {
  const superseded = new Set(artifacts.map((a) => a.supersedes_id).filter(Boolean));
  return artifacts.filter((a) => !superseded.has(a.id));
}

export function runArtifacts(artifacts: Artifact[], runId: string): Artifact[] {
  return currentArtifacts(artifacts).filter((a) => a.stage_run_id === runId);
}

// Есть ли у статуса роль-исполнитель: только у такого этапа есть уровень
// модели. У начального и конечного статусов ролей обычно нет — но решает
// версия цикла, а не ключ статуса.
export function stageRoles(status: Status | undefined): StatusRole[] {
  return [...(status?.roles ?? [])].sort(
    (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.position - b.position,
  );
}

export function hasExecutor(status: Status | undefined): boolean {
  return stageRoles(status).length > 0;
}

// Выход из статуса по версии цикла: переходы из него (`from_status_id`) с
// гейтами — для этапа, который ещё не начинался. Переходы «из любого
// статуса» (отмена) сюда не входят: они не про этот этап. Своего расчёта
// гейтов нет — только их определения из версии.
export interface StageExit {
  transition: Transition;
  to: Status | undefined;
  gates: Gate[];
}

export function stageExits(workflow: Workflow | undefined, statusKey: string): StageExit[] {
  if (!workflow) return [];
  const status = workflow.statuses.find((s) => s.key === statusKey);
  if (!status) return [];
  return workflow.transitions
    .filter((t) => t.from_status_id === status.id)
    .sort((a, b) => a.position - b.position)
    .map((transition) => ({
      transition,
      to: workflow.statuses.find((s) => s.id === transition.to_status_id),
      gates: [...(transition.gates ?? [])].sort((a, b) => a.position - b.position),
    }));
}

// Уровень этапа для PATCH /v1/tasks/:key: слияние по ключу статуса,
// «авто» — пустая строка (снимает уровень).
export function stageLevelPatch(statusKey: string, level: string | null): {
  stage_settings: Record<string, {model_level: string}>;
} {
  return {stage_settings: {[statusKey]: {model_level: level ?? ''}}};
}
