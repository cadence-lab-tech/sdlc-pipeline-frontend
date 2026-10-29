// Состояние задачи на схеме цикла: какой статус текущий, какие пройдены,
// сколько было попыток и ждёт ли задача апрува. Без разметки, чтобы правила
// проверялись в e2e/cycle-layout.mjs без браузера, а панель этапа (CLAB-285)
// взяла их отсюда.
//
// Всё считается по уже полученному ответу карточки: прогоны (`stage_runs`) и
// вердикт гейтов переходов из текущего статуса (`transitions`). Своей
// проверки гейтов здесь нет — только подсчёт статусов, которые отдал бэкенд.
import type {GateCheck, Status, StageRun, TransitionOption} from '../../api/types';
import {stageEnabled} from '../optionalStage';

// «Пропущен» и «выключен» — состояния необязательных этапов (решение 0066):
// задача прошла мимо этапа / этап выключен у задачи, а она его ещё не прошла.
export type NodeState = 'current' | 'passed' | 'skipped' | 'disabled' | 'future';

export interface StatusProgress {
  state: NodeState;
  // Прогоны верхнего уровня на этом статусе; перепроверки (решение 0017)
  // живут внутри своего родителя и попытками не считаются.
  attempts: number;
  awaitingApproval: boolean;
}

export const STATE_LABEL: Record<NodeState, string> = {
  current: 'текущий статус',
  passed: 'пройден',
  skipped: 'пропущен',
  disabled: 'выключен',
  future: 'впереди',
};

// Тип гейта — перечень движка (десять типов), а не данные проекта: на него
// опираться можно.
const HUMAN_APPROVAL = 'human_approval';

// Гейт больше не держит переход: прошёл, снят решением человека (waived)
// или не относится к задаче (skipped) — как в «Действиях».
const resolved = (g: GateCheck) => g.status === 'passed' || g.status === 'waived' || g.status === 'skipped';

// «Ждёт апрува» — у перехода вперёд (`advance`) из текущего статуса всё
// блокирующее, кроме апрува человека, уже прошло, а сам апрув — нет.
export function awaitsApproval(transitions: TransitionOption[]): boolean {
  return transitions.some((t) => {
    if (t.kind !== 'advance') return false;
    const blocking = t.gates.filter((g) => g.blocking);
    const approvals = blocking.filter((g) => g.type === HUMAN_APPROVAL);
    const others = blocking.filter((g) => g.type !== HUMAN_APPROVAL);
    return approvals.some((g) => !resolved(g)) && others.every(resolved);
  });
}

// Статусы, мимо которых задача прошла: по событиям `stage.skipped` ленты. У
// события нет прогона, поэтому ручка ленты по статусу его не отдаёт — только
// общая лента, и вытесненное из неё событие просто не попадёт в набор.
export function skippedStages(events: {type: string; payload?: unknown}[] | undefined): Set<string> {
  const out = new Set<string>();
  for (const e of events ?? []) {
    if (e.type !== 'stage.skipped') continue;
    const p = e.payload;
    const status = typeof p === 'object' && p !== null ? (p as Record<string, unknown>).status : undefined;
    if (typeof status === 'string' && status) out.add(status);
  }
  return out;
}

// Приоритет, чтобы история не врала: текущий > пройден (завершённый прогон
// верхнего уровня) > пропущен (есть пропуск и выбор «выкл») > выключен
// (необязательный, выбор «выкл») > впереди. Включённый этап, когда-то
// пропущенный, — «впереди». Обязательный статус не бывает ни пропущенным, ни
// выключенным, даже если его ключ попал в выбор. Выбор и набор пропущенных
// необязательны: без них результат прежний.
export function cycleProgress(
  statuses: Status[],
  currentKey: string,
  runs: StageRun[],
  transitions: TransitionOption[],
  choice?: Record<string, boolean>,
  skipped?: Set<string>,
): Map<string, StatusProgress> {
  const top = runs.filter((r) => !r.parent_run_id);
  const approval = awaitsApproval(transitions);
  const result = new Map<string, StatusProgress>();
  for (const s of statuses) {
    const own = top.filter((r) => r.status_key === s.key);
    const current = s.key === currentKey;
    let state: NodeState = 'future';
    if (current) state = 'current';
    else if (own.some((r) => r.finished_at)) state = 'passed';
    else if (s.is_optional === true && !stageEnabled(s, choice, s.key)) {
      state = skipped?.has(s.key) ? 'skipped' : 'disabled';
    }
    result.set(s.key, {state, attempts: own.length, awaitingApproval: current && approval});
  }
  return result;
}

// Подпись узла для программ чтения с экрана: имя, состояние, попытки и
// апрув — то же, что видно глазами.
export function nodeLabel(name: string, progress: StatusProgress | undefined, selected: boolean): string {
  const parts = [name, STATE_LABEL[progress?.state ?? 'future']];
  if (progress && progress.attempts > 1) parts.push(`попыток: ${progress.attempts}`);
  if (progress?.awaitingApproval) parts.push('ждёт апрува');
  if (selected) parts.push('выбран');
  return parts.join(', ');
}

// Выбранный этап из адреса: ключ, которого нет в версии цикла задачи, — как
// без выбора, без ошибки.
export function resolveStage(param: string | null, statuses: Status[] | undefined): string | undefined {
  if (!param || !statuses) return undefined;
  return statuses.some((s) => s.key === param) ? param : undefined;
}

// Повторный выбор того же узла снимает выбор.
export function toggleStage(selected: string | undefined, clicked: string): string | undefined {
  return selected === clicked ? undefined : clicked;
}
