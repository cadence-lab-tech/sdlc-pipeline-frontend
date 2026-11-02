// Правила строки задачи (CLAB-364): что показывать у задачи в зоне «Обзора» —
// по данным списка (CLAB-375), без разметки. Компонент TaskRow только
// рисует то, что вернул `buildRowModel`, поэтому одни и те же правила
// работают на «Обзоре», в блоке приоритетных (CLAB-366) и на странице
// бэклога (CLAB-368), а проверяются без браузера (e2e/task-row-rules.mjs).
//
// Статусов, ролей и типов проекта модуль не знает: подписи приходят из
// данных (имя статуса, имя роли прогона, версия цикла задачи), а ветвления
// идут по словарю движка — коды причин, категории статуса, виды прогона.
import type {TaskRow, WorkflowHead} from '../../api/types';
import {priorityClass, priorityLabel} from '../priorities';
import {agoText, dollars, exactTime, sinceText} from './format';
import {describeReasons, type Reason, type VersionLabels} from './reasons';

// Зона, в которой стоит строка. Зону определяет страница (правило «одна
// задача — одна зона», design.spec §2.1), строка по ней выбирает, что
// показывать: у «Ждут решения» нет стоимости, у «Завершено» нет причин.
export type RowZone = 'decisions' | 'stuck' | 'working' | 'queue' | 'backlog' | 'done';

// Запись /approvals по задаче: куда приведёт переход по апруву. Клиент
// пропуски этапов сам не считает — это правило движка (решение 0066).
export interface ApprovalHint {
  transition_key: string;
  lands_in_name?: string;
}

export interface RowOptions {
  zone: RowZone;
  // «Сейчас» в миллисекундах; параметр, а не Date.now(), чтобы правила
  // проверялись на фиксированном моменте.
  now: number;
  // Версия цикла задачи для подписей гейтов и переходов.
  version?: VersionLabels | null;
  // Версию запросили и не прочитали: токен «версия цикла не прочиталась».
  versionFailed?: boolean;
  // Типы проекта (`taskTypes(project)`); тип показывается, когда их больше одного.
  projectTypes?: string[];
  // Действующие циклы проекта: по ним строка узнаёт прежнюю версию.
  activeWorkflows?: Pick<WorkflowHead, 'id' | 'task_types'>[];
  approvals?: ApprovalHint[];
  // Вправе ли смотрящий решать гейты; по умолчанию да. Наблюдатель вместо
  // гейта видит «ждёт решения человека».
  canDecide?: boolean;
  // Не показывать токен эпика — страница уже внутри нарезки этого эпика.
  hideEpic?: boolean;
}

interface ZoneRules {
  // Первая причина — заголовок строки (значок и текст), остальные — токены.
  headline: boolean;
  reasons: 'all' | 'actionable' | 'none';
  waiting: 'decision' | 'queue' | null;
  onStage: boolean;
  movement: 'moved' | 'ago' | null;
  cost: boolean;
}

const ZONES: Record<RowZone, ZoneRules> = {
  decisions: {headline: true, reasons: 'all', waiting: 'decision', onStage: false, movement: null, cost: false},
  stuck: {headline: true, reasons: 'all', waiting: null, onStage: false, movement: 'moved', cost: false},
  working: {headline: false, reasons: 'none', waiting: null, onStage: true, movement: 'moved', cost: true},
  queue: {headline: false, reasons: 'actionable', waiting: 'queue', onStage: false, movement: null, cost: false},
  backlog: {headline: false, reasons: 'actionable', waiting: null, onStage: false, movement: null, cost: false},
  done: {headline: false, reasons: 'none', waiting: null, onStage: false, movement: 'ago', cost: false},
};

// Причины «ждёт N» и «возврат, попытка N» в зонах без заголовка показываются
// не токеном причины, а своими местами (ожидание, попытка).
const OWN_PLACE = ['unclaimed', 'returned'];

// Тип по умолчанию, когда у задачи нет `properties.type` (DefaultTaskType движка).
const DEFAULT_TYPE = 'task';

export interface RowToken {
  label: string;
  title?: string;
}

export interface RowModel {
  key: string;
  title: string;
  zone: RowZone;
  priority: {label: string; className: string} | null;
  type: string | null;
  epic: string | null;
  oldVersion: boolean;
  versionFailed: boolean;
  // Главная причина строки (значок, текст) — в зонах с заголовком.
  primary: Reason | null;
  // Остальные причины токенами в порядке сервера.
  reasons: Reason[];
  stage: {text: string; title: string};
  holder: {handle: string; live: boolean} | null;
  review: boolean;
  attempt: number | null;
  onStage: {text: string; title: string} | null;
  movement: {text: string; title: string} | null;
  waiting: {text: string; title: string} | null;
  cost: {text: string; title: string; hasData: boolean} | null;
  progress: ProgressModel | null;
}

export interface ProgressModel {
  done: number;
  active: number;
  backlog: number;
  total: number;
  label: string;
  aria: string;
}

export function taskTypeOf(task: Pick<TaskRow, 'properties'>): string {
  const t = task.properties?.type;
  return typeof t === 'string' && t !== '' ? t : DEFAULT_TYPE;
}

// Задача идёт по версии цикла, которая уже не действующая для её типа.
// Нет сведений о действующих циклах или о цикле её типа — не утверждаем.
export function isOldVersion(
  task: Pick<TaskRow, 'properties' | 'workflow_id'>,
  active: Pick<WorkflowHead, 'id' | 'task_types'>[] | undefined,
): boolean {
  if (!active) return false;
  const type = taskTypeOf(task);
  const head = active.find((w) => (w.task_types ?? []).includes(type));
  return head !== undefined && head.id !== task.workflow_id;
}

// Прогресс эпика: готово = done, в работе = active + waiting, в бэклоге =
// backlog. Отменённые в прогресс не входят (решение человека 2026-11-02).
export function progressOf(counts: Record<string, number> | undefined): ProgressModel | null {
  if (!counts) return null;
  const n = (c: string) => (typeof counts[c] === 'number' && counts[c] > 0 ? counts[c] : 0);
  const done = n('done');
  const active = n('active') + n('waiting');
  const backlog = n('backlog');
  const total = done + active + backlog;
  if (total === 0) return null;
  return {
    done,
    active,
    backlog,
    total,
    label: `${done} готово · ${active} в работе · ${backlog} в бэклоге`,
    aria: `готово ${done}, в работе ${active}, в бэклоге ${backlog}`,
  };
}

// Стоимость задачи одной цифрой — сумма по всем её этапам (решение человека
// 2026-11-02): без деления на деньги и условную стоимость. У эпика без
// собственного учёта — сумма по нарезке. Учёта нет совсем — «нет учёта», а
// не ноль: «не вели» и «бесплатно» — разные ответы.
export function costOf(
  task: Pick<TaskRow, 'cost' | 'subtree_cost_usd'>,
): {text: string; title: string; hasData: boolean} {
  if (task.cost) {
    return {text: dollars(task.cost.cost_usd), title: 'Стоимость задачи по всем этапам', hasData: true};
  }
  if (typeof task.subtree_cost_usd === 'number' && task.subtree_cost_usd > 0) {
    return {
      text: `в нарезке ${dollars(task.subtree_cost_usd)}`,
      title: 'У эпика нет собственного учёта: сумма по его нарезке',
      hasData: true,
    };
  }
  return {text: 'нет учёта', title: 'Учёта стоимости нет', hasData: false};
}

function latest(a: string | null | undefined, b: string | null | undefined): string | null {
  const ta = a ? new Date(a).getTime() : NaN;
  const tb = b ? new Date(b).getTime() : NaN;
  if (Number.isNaN(ta) && Number.isNaN(tb)) return null;
  if (Number.isNaN(tb) || ta >= tb) return a ?? null;
  return b ?? null;
}

export function buildRowModel(task: TaskRow, o: RowOptions): RowModel {
  const rules = ZONES[o.zone];
  const canDecide = o.canDecide ?? true;
  const run = task.current_run ?? null;
  const approvals = o.approvals ?? [];

  const landsIn = (transition: string): string | undefined => {
    const exact = approvals.find((a) => a.transition_key === transition && a.lands_in_name);
    if (exact) return exact.lands_in_name;
    // Одна запись /approvals по задаче — стрелка её; несколько — без догадок.
    const named = approvals.filter((a) => a.lands_in_name);
    return named.length === 1 ? named[0].lands_in_name : undefined;
  };

  const all = describeReasons(task.attention ?? [], {
    now: o.now,
    version: o.version,
    canDecide,
    landsIn,
    blockedBy: task.blocked_by ?? [],
  });
  let shown: Reason[];
  if (rules.reasons === 'all') shown = all;
  else if (rules.reasons === 'actionable') shown = all.filter((r) => !OWN_PLACE.includes(r.code));
  else shown = [];
  const primary = rules.headline && shown.length > 0 ? shown[0] : null;
  const tokens = primary ? shown.slice(1) : shown;

  const types = o.projectTypes ?? [];
  const roleName = run?.role_name ?? null;
  const stageText = roleName ? `${task.status_name} · ${roleName}` : task.status_name;

  const hasChildren = progressOf(task.child_counts) !== null;
  const movedAt = hasChildren ? latest(task.last_moved_at, task.subtree_last_moved_at) : task.last_moved_at;

  let waiting: RowModel['waiting'] = null;
  if (rules.waiting === 'decision') {
    const since = (task.attention ?? []).find((a) => a.code === 'awaits_human')?.since ?? null;
    const text = sinceText(since, o.now);
    if (text) waiting = {text: `ждёт ${text}`, title: `Ждёт решения с ${exactTime(since)}`};
  } else if (rules.waiting === 'queue' && run) {
    const text = sinceText(run.entered_at, o.now);
    if (text) waiting = {text: `ждёт ${text}`, title: `Этап открыт ${exactTime(run.entered_at)}, никто не взял`};
  }

  let movement: RowModel['movement'] = null;
  if (rules.movement && movedAt) {
    const ago = agoText(movedAt, o.now);
    if (ago) {
      movement = {
        text: rules.movement === 'moved' ? `движение ${ago}` : ago,
        title: `Последнее движение: ${exactTime(movedAt)}`,
      };
    }
  }

  let onStage: RowModel['onStage'] = null;
  if (rules.onStage && run) {
    const text = sinceText(run.entered_at, o.now);
    if (text) onStage = {text, title: `На этапе с ${exactTime(run.entered_at)}`};
  }

  const attempt = run && run.attempt > 1 && !shown.some((r) => r.code === 'returned') ? run.attempt : null;
  const handle = run?.claimed_by_handle;

  return {
    key: task.key,
    title: task.title,
    zone: o.zone,
    priority:
      task.priority !== 'normal'
        ? {label: priorityLabel(task.priority), className: priorityClass(task.priority)}
        : null,
    type: types.length > 1 ? taskTypeOf(task) : null,
    epic: !o.hideEpic && task.parent_key ? task.parent_key : null,
    oldVersion: isOldVersion(task, o.activeWorkflows),
    versionFailed: o.versionFailed === true,
    primary,
    reasons: tokens,
    stage: {text: stageText, title: stageText},
    holder: handle ? {handle, live: run?.lease_alive === true} : null,
    review: run?.kind === 'review',
    attempt,
    onStage,
    movement,
    waiting,
    cost: rules.cost ? costOf(task) : null,
    progress: progressOf(task.child_counts),
  };
}
