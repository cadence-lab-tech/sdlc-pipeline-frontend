// Подписи «Пайплайна» по перечням схемы (CLAB-346): типы гейтов, категории
// статусов, состояния версии цикла. Словари с запасным вариантом —
// незнакомый ключ показывается как есть. Ключей статусов и ролей здесь нет:
// их придумывает проект.
import type {WorkflowState} from '../../api/types';

export const GATE_LABEL: Record<string, string> = {
  artifacts_required: 'Артефакты сданы',
  checklist: 'Чек-лист',
  human_approval: 'Апрув человеком',
  agent_review: 'Перепроверка другой ролью',
  repo_ref_required: 'Ссылка на изменения',
  repo_scope: 'Область задачи соблюдена',
  drift_clear: 'Дрейф не мешает',
  schema_validation: 'Артефакт по схеме',
  external_check: 'Внешняя проверка',
  dependencies_closed: 'Зависимости закрыты',
};

export const gateLabel = (type: string) => GATE_LABEL[type] ?? type;

// Апрув человека — первым и выделенным, затем перепроверка, затем прочее.
export const isHumanGate = (type: string) => type === 'human_approval';

export function gateOrder(type: string): number {
  return isHumanGate(type) ? 0 : type === 'agent_review' ? 1 : 2;
}

export const sortedGates = <G extends {type: string; position: number}>(gates: G[] | undefined): G[] =>
  [...(gates ?? [])].sort((a, b) => gateOrder(a.type) - gateOrder(b.type) || a.position - b.position);

// Типы гейтов в «Обозначениях»: самые частые.
export const LEGEND_GATE_TYPES = ['human_approval', 'agent_review', 'artifacts_required', 'repo_ref_required', 'checklist'];

// Настройка гейта одной строкой: виды артефактов, роль-ревьюер.
export function gateConfigLine(config: Record<string, unknown> | undefined): string {
  const c = config ?? {};
  if (Array.isArray(c.kinds) && c.kinds.length) return ` · ${(c.kinds as unknown[]).map(String).join(', ')}`;
  if (typeof c.reviewer_role_key === 'string') return ` · роль ${c.reviewer_role_key}`;
  if (typeof c.artifact_kind === 'string') return ` · ${c.artifact_kind}`;
  return '';
}

export const CATEGORY_LABEL: Record<string, string> = {
  backlog: 'Бэклог',
  active: 'В работе',
  waiting: 'Ожидание',
  done: 'Готово',
  cancelled: 'Отменено',
};

export const ORPHAN_LABEL = 'Не связаны с циклом';

export const categoryLabel = (category: string) => CATEGORY_LABEL[category] ?? category;

export const STATE_LABEL: Record<WorkflowState, string> = {
  draft: 'черновик',
  active: 'работает',
  retired: 'выведена',
};

export const stateLabel = (state: string) => STATE_LABEL[state as WorkflowState] ?? state;

export const versionLabel = (w: {name: string; version: number}) => `${w.name} · v${w.version}`;

// Подтверждение активации (design.spec v2 §8, отступление 2).
export const activateTitle = (w: {name: string; version: number}) => `Активировать ${versionLabel(w)}?`;

export const activateText = (types: string[]) =>
  `Версия станет рабочей для типа ${types.join(', ')}, прежняя активная — выведенной. Задачи из бэклога переедут на новую версию, задачи в работе дойдут по прежней. Вернуть прежнюю версию можно только новым черновиком.`;

export const NO_ROLE_LABEL = 'без исполнителя';
export const NO_ROLE_TEXT = 'Статус без исполнителя: задача ждёт здесь перехода, агент не работает';
export const NO_GATES_LABEL = 'без гейтов';
export const ROLE_VERSION_HINT = 'Версия — последняя версия роли: по ней этап будет работать при следующем захвате';
