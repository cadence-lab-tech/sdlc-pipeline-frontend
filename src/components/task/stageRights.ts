// Право этапа на карточке задачи (решение 0072, п. 9, CLAB-383): какие кнопки
// показать и какой текст поставить на место отсутствующих. Право считает
// сервер и присылает его полями actor_may, actor_may_decide, actor_decisions
// и actor_deny; здесь они только читаются — роль участника, ключ статуса и
// уровень доступа не сравниваются ни с чем. Поля, которых нет в ответе
// (сервер прежней версии, ответ без актора), читаются как до изменения.
//
// Модуль без разметки и без путей '@/': e2e/stage-rights-rules.mjs проверяет
// его node без сборщика.
import type {GateCheck, TransitionOption} from '../../api/types';

export interface TransitionControl {
  // Показывать ли кнопку «Перевести» (активна она или нет — решает allowed).
  button: boolean;
  // Текст сервера на месте кнопки; дословно, клиент его не собирает.
  deny?: string;
}

// actor_may: false — кнопки нет, на её месте actor_deny.message. Иначе кнопка
// остаётся, как была: её доступность — allowed (гейты) и unavailable.
export function transitionControl(t: Pick<TransitionOption, 'actor_may' | 'actor_deny'>): TransitionControl {
  if (t.actor_may === false) return {button: false, deny: t.actor_deny?.message};
  return {button: true};
}

export interface GateControl {
  approve: boolean;
  reject: boolean;
  // Сохранить отметки чек-листа (вердикт passed).
  save: boolean;
  // Текст сервера, когда решить нельзя; только у гейтов, где решение
  // принимают руками, и пока гейт не пройден.
  deny?: string;
}

type GateRights = Pick<GateCheck, 'type' | 'status' | 'actor_may_decide' | 'actor_decisions' | 'actor_deny'>;

// Вердикты, которые актор вправе вынести по гейту: список сервера; нет списка
// (сервер прежней версии) — null, и кнопки по прежним правилам.
function allowed(check: GateRights): string[] | null {
  if (check.actor_may_decide === false) return [];
  return Array.isArray(check.actor_decisions) ? check.actor_decisions : null;
}

export function gateControl(check: GateRights, canAct: boolean): GateControl {
  const none: GateControl = {approve: false, reject: false, save: false};
  const manual = check.type === 'human_approval' || check.type === 'checklist';
  if (!manual || !canAct) return none;
  const verdicts = allowed(check);
  const may = (v: string) => (verdicts === null ? true : verdicts.includes(v));
  const open = check.status !== 'passed';
  if (check.type === 'human_approval') {
    const approve = open && may('passed');
    const reject = open && may('failed');
    return {approve, reject, save: false, deny: open && !approve && !reject ? check.actor_deny?.message : undefined};
  }
  // Чек-лист: «Сохранить отметки» — это passed, как и до изменения доступен
  // и на пройденном гейте.
  const save = may('passed');
  return {approve: false, reject: false, save, deny: !save ? check.actor_deny?.message : undefined};
}
