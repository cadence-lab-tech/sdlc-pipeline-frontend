// Перевод в статус вне цикла (CLAB-407, эпик CLAB-404, design.spec): право на
// кнопку, строки списка статусов, пояснение под списком, проверки полей
// диалога, подпись события task.moved и исхода «переведена вручную». Право
// считает сервер (actor_rights.move, CLAB-408): уровень доступа, роль участника
// и ключ статуса здесь не сравниваются ни с чем, названия и признаки статусов
// приходят из версии цикла задачи.
//
// Модуль без разметки и без путей '@/': e2e/task-move-rules.mjs проверяет его
// node без сборщика.
import type {Status, TaskRights} from '../../api/types';
import {OPTIONAL_STAGES_TITLE, STAGE_CURRENT_HINT, STAGES_READONLY_HINT, TASK_CLOSED_HINT, stageEnabled, stageLockHint} from '../optionalStage';
import {rightOf} from './taskRights';

export const MOVED_LABEL = 'переведена вручную';
export const MOVE_BUTTON = 'Перевести в статус';
export const MOVE_DISABLED_NOTE = 'этап выключен у задачи';
export const MOVE_CLOSED_NOTE = 'пока задача закрыта, включить его нельзя: сначала переведите её в другой статус';

// Кнопка есть, только когда сервер сказал move: true. Нет объекта или поля
// (сервер прежней версии, ответ без актора) — кнопки нет: действие новое, и
// «как раньше» для него значит «не было». Текст отказа сервера не выводится:
// у бота, токена задачи и наблюдателя кнопки просто нет (решение Q2).
export function moveAllowed(rights: TaskRights | undefined): boolean {
  return rightOf(rights, 'move', false);
}

// Что делать со ссылкой/текстом у выключенного этапа.
export interface DisabledNote {
  kind: 'link' | 'closed' | 'readonly';
  text: string;
}

export interface MoveStatusRow {
  key: string;
  name: string;
  current: boolean;
  terminal: boolean;
  optional: boolean;
  // Выключенный необязательный этап: выбрать нельзя.
  disabled: boolean;
  note?: DisabledNote;
}

type StatusLike = Pick<Status, 'key' | 'name' | 'position'> &
  Partial<Pick<Status, 'is_optional' | 'enabled_by_default' | 'is_terminal'>>;
type TaskLike = {status_key: string; closed_at?: string; optional_stages?: Record<string, boolean>};

// Строки списка «Новый статус»: статусы версии цикла задачи по position. Текущий
// выбирается, как остальные: сервер разрешает перевод в текущий статус («начать
// этап заново»). Выключенный этап не выбирается; рядом либо ссылка «Выбор
// этапов» (актору это доступно и задача открыта), либо текст.
export function moveStatuses(
  statuses: StatusLike[] | undefined,
  task: TaskLike,
  rights: TaskRights | undefined,
): MoveStatusRow[] {
  const sorted = [...(statuses ?? [])].sort((a, b) => a.position - b.position);
  const canChoose = rightOf(rights, 'stage_choice', false);
  return sorted.map((s) => {
    const disabled = !stageEnabled(s, task.optional_stages, s.key);
    const row: MoveStatusRow = {
      key: s.key,
      name: s.name,
      current: s.key === task.status_key,
      terminal: s.is_terminal === true,
      optional: s.is_optional === true,
      disabled,
    };
    if (disabled) {
      const lock = stageLockHint(s.key, task, sorted);
      if (lock === TASK_CLOSED_HINT) row.note = {kind: 'closed', text: MOVE_CLOSED_NOTE};
      else if (!canChoose) {
        row.note = {kind: 'readonly', text: rights?.actor_deny?.stage_choice?.message || STAGES_READONLY_HINT};
      } else if (lock === STAGE_CURRENT_HINT) row.note = {kind: 'readonly', text: STAGE_CURRENT_HINT};
      else row.note = {kind: 'link', text: OPTIONAL_STAGES_TITLE};
    }
    return row;
  });
}

function nameOfStatus(statuses: StatusLike[] | undefined, key: string): string {
  return statuses?.find((s) => s.key === key)?.name ?? key;
}

// Пояснение под списком по выбранному статусу — подсказка по данным цикла, не
// проверка. Ничего не выбрано — undefined.
export function moveEffect(
  task: TaskLike,
  statuses: StatusLike[] | undefined,
  toKey: string | undefined,
): string | undefined {
  if (!toKey) return undefined;
  const target = statuses?.find((s) => s.key === toKey);
  if (!target) return undefined;
  const closed = Boolean(task.closed_at);
  if (toKey === task.status_key) return `Текущая попытка закроется как «${MOVED_LABEL}», начнётся новая.`;
  if (target.is_terminal === true) return closed ? undefined : 'Статус завершающий: задача будет закрыта.';
  if (closed) return 'Задача снова станет открытой.';
  return `Текущая попытка ${nameOfStatus(statuses, task.status_key)} закроется как «${MOVED_LABEL}», в ${target.name} откроется новая.`;
}

// Причина обязательна: пусто и одни пробелы не годятся.
export function reasonValid(text: string): boolean {
  return text.trim().length > 0;
}

// Подтверждение — ввод ключа задачи: пробелы по краям допускаются, регистр
// важен (как у confirmPhrase в ConfirmButton).
export function confirmMatches(taskKey: string, input: string): boolean {
  return input.trim() === taskKey;
}

// Ключ введён, но не совпал: подсказка под полем. Пустое поле подсказки не
// получает.
export function confirmMismatch(taskKey: string, input: string): boolean {
  return input.trim() !== '' && !confirmMatches(taskKey, input);
}

// Чего не хватает для отправки, по порядку: статус, причина, ключ.
export function moveMissing(f: {selected: string | undefined; reason: string; confirm: string; taskKey: string}): string[] {
  const out: string[] = [];
  if (!f.selected) out.push('выбрать статус');
  if (!reasonValid(f.reason)) out.push('указать причину');
  if (!confirmMatches(f.taskKey, f.confirm)) out.push('ввести ключ');
  return out;
}

export function moveMissingLine(missing: string[]): string {
  return missing.length > 0 ? `Осталось: ${missing.join(', ')}` : '';
}

// Тело запроса: to — ключ статуса, reason — без пробелов по краям.
export function moveBody(to: string, reason: string): {to: string; reason: string} {
  return {to, reason: reason.trim()};
}
