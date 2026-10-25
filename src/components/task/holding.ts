// Правила блока «Что держит» в обзоре задачи (CLAB-286): где задача сейчас,
// кто с ней работает и какие гейты не пускают дальше. Без разметки, чтобы
// правила проверялись в e2e/overview.mjs без браузера.
//
// Всё считается по уже полученному ответу карточки: прогоны (`stage_runs`) и
// вердикт гейтов переходов из текущего статуса (`transitions`). Своей проверки
// гейтов здесь нет — это подсчёт того, что отдал бэкенд; ключей статусов и
// ролей модуль не знает, терминальность берётся из версии цикла.
import type {GateCheck, StageRun, Status, TaskDetail, TransitionOption} from '../../api/types';
import {awaitsApproval} from '../cycle/state';
import {isLeaseLive} from './lease';

// Гейт держит переход, пока он блокирующий и не разрешился в пользу перехода:
// прошёл, снят решением человека (waived) или не относится к задаче (skipped).
const resolved = (g: GateCheck) => g.status === 'passed' || g.status === 'waived' || g.status === 'skipped';

// Вид перехода «вперёд» — перечень движка, а не данные проекта; возвраты и
// отмена не показываются: «что держит» — про то, что мешает идти вперёд.
const ADVANCE = 'advance';

export interface HoldingGate {
  transitionKey: string;
  transitionName: string;
  gateKey: string;
  gateName: string;
  type: string;
  status: GateCheck['status'];
}

// Исполнитель живого или истёкшего прогона: handle и срок аренды. Прогон без
// исполнителя в блок не попадает.
export interface Executor {
  handle: string;
  roleKey?: string;
  roleVersion?: number;
  live: boolean;
  leaseExpiresAt?: string;
  // Перепроверка — вложенный прогон (решение 0017), а не основной.
  review: boolean;
}

export interface Holding {
  closed: boolean;
  executor?: Executor;
  gates: HoldingGate[];
  awaitsApproval: boolean;
  // Роль живой перепроверки, если она идёт сейчас.
  reviewRole?: string;
}

export function holdingGates(transitions: TransitionOption[]): HoldingGate[] {
  const result: HoldingGate[] = [];
  for (const t of transitions) {
    if (t.kind !== ADVANCE) continue;
    for (const g of t.gates) {
      if (!g.blocking || resolved(g)) continue;
      result.push({
        transitionKey: t.key,
        transitionName: t.name,
        gateKey: g.gate_key,
        gateName: g.gate_name,
        type: g.type,
        status: g.status,
      });
    }
  }
  return result;
}

// Незавершённые прогоны текущего статуса: основной и, если есть, вложенные
// перепроверки. Прогоны прежних статусов и завершённые попытки не в счёт.
function openRuns(runs: StageRun[], statusKey: string): {main?: StageRun; reviews: StageRun[]} {
  const open = runs.filter((r) => r.status_key === statusKey && !r.finished_at);
  const main = open
    .filter((r) => !r.parent_run_id)
    .sort((a, b) => b.entered_at.localeCompare(a.entered_at))[0];
  const reviews = open
    .filter((r) => r.parent_run_id && (!main || r.parent_run_id === main.id))
    .sort((a, b) => b.entered_at.localeCompare(a.entered_at));
  return {main, reviews};
}

function executorOf(run: StageRun | undefined, review: boolean): Executor | undefined {
  if (!run?.claimed_by_handle) return undefined;
  return {
    handle: run.claimed_by_handle,
    roleKey: run.role_key,
    roleVersion: typeof run.role_version === 'number' ? run.role_version : undefined,
    live: isLeaseLive(run),
    leaseExpiresAt: run.lease_expires_at,
    review,
  };
}

export function holding(detail: TaskDetail, statuses: Status[] | undefined): Holding {
  const {task} = detail;
  const terminal = statuses?.find((s) => s.key === task.status_key)?.is_terminal ?? false;
  const closed = terminal || Boolean(task.closed_at);
  if (closed) return {closed: true, gates: [], awaitsApproval: false};

  const {main, reviews} = openRuns(detail.stage_runs, task.status_key);
  // Пока идёт перепроверка, основной прогон стоит в gating и работать в нём
  // некому — исполнитель тот, кто перепроверяет. Живая аренда главнее истёкшей.
  const reviewing = reviews.find(isLeaseLive) ?? reviews[0];
  const executor = executorOf(reviewing, true) ?? executorOf(main, false);
  const reviewRole = reviews.find(isLeaseLive)?.role_key;

  return {
    closed: false,
    executor,
    gates: holdingGates(detail.transitions),
    awaitsApproval: awaitsApproval(detail.transitions),
    reviewRole,
  };
}

// Доля закрытых дочерних для полосы прогресса; без детей — ноль.
export function closedChildren(children: {closed_at?: string}[]): {closed: number; total: number; percent: number} {
  const closed = children.filter((c) => c.closed_at).length;
  return {closed, total: children.length, percent: children.length === 0 ? 0 : (closed / children.length) * 100};
}
