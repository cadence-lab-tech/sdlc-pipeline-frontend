// Строка «кто и что делает» у задач блоков «Требуют решения» и
// «Заблокировано» (CLAB-488, design.spec §4.3–4.4). Без разметки: страница
// рисует части, а правила проверяются без браузера (e2e/overview-rules.mjs).
//
// Ветвление — только по коду причины движка, типу гейта (перечень схемы),
// праву смотрящего из ответа сервера и наличию роли у прогона. Имена ролей,
// гейтов и исполнителей — из данных.
import type {TaskRow} from '../../api/types';
import type {ApprovalHint} from '../taskrow/rules';
import {rowCanDecide} from '../taskrow/rules';
import {gateNameAnywhere, type VersionLabels} from '../taskrow/reasons';

// Часть строки: текст (жирный — кто действует) или ключи задач ссылками.
export type ActionPart = {text: string; strong?: boolean} | {keys: string[]};

export interface RowAction {
  // Код причины, по которому построена строка (опора проверки).
  code: string;
  parts: ActionPart[];
}

const t = (text: string, strong = false): ActionPart => (strong ? {text, strong} : {text});

// «Требуют решения». canDecide — право смотрящего из ответа /approvals
// (false — наблюдатель); approvals — записи по этой задаче.
export function decisionAction(approvals: ApprovalHint[], canDecide: boolean): RowAction {
  if (!canDecide) {
    return {code: 'awaits_human', parts: [t('Решает уровень сопровождающего и выше', true), t(' — вы видите, но не решаете')]};
  }
  if (rowCanDecide(approvals) === false) {
    return {
      code: 'awaits_human',
      parts: [
        t('Решение сопровождающего', true),
        t(' — по этой записи вы не решаете: исчерпан предел попыток или идёт перепроверка'),
      ],
    };
  }
  const type = approvals.find((a) => a.can_decide !== false)?.gate_type ?? approvals[0]?.gate_type;
  let rest = ' — откройте задачу и примите решение по гейту';
  if (type === 'human_approval') rest = ' — откройте задачу, чтобы утвердить или вернуть';
  else if (type === 'checklist') rest = ' — отметьте пункты чек-листа в карточке задачи';
  return {code: 'awaits_human', parts: [t('Решаете вы', true), t(rest)]};
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

// «Заблокировано»: по главной причине — первой в attention. version —
// версия цикла задачи для имени гейта предела (нет — ключ).
export function blockedAction(task: Pick<TaskRow, 'attention' | 'blocked_by' | 'current_run'>, version?: VersionLabels | null): RowAction {
  const main = (task.attention ?? []).find((a) => a.code !== 'returned' && a.code !== 'unclaimed') ?? task.attention?.[0];
  const code = main?.code ?? '';
  switch (code) {
    case 'blocked': {
      const keys = task.blocked_by ?? [];
      if (keys.length === 0) return {code, parts: [t('Сначала доведите блокирующие задачи или снимите связь в карточке задачи')]};
      return {code, parts: [t('Сначала доведите '), {keys}, t(' или снимите связь в карточке задачи')]};
    }
    case 'gate_rejected': {
      const role = task.current_run?.role_name || task.current_run?.role_key;
      return role
        ? {code, parts: [t('Переделывает '), t(role, true), t(': исправить по причине отклонения и снова запросить переход')]}
        : {code, parts: [t('Переделывают '), t('люди этапа', true), t(': исправить по причине отклонения и снова запросить переход')]};
    }
    case 'lease_expired': {
      const holder = str(main?.holder);
      return holder
        ? {code, parts: [t('Исполнитель пропал: этап можно забрать заново — или проверьте '), t(holder, true)]}
        : {code, parts: [t('Исполнитель пропал: этап можно забрать заново')]};
    }
    case 'over_stage_limit': {
      const gate = str(main?.gate);
      return gate
        ? {code, parts: [t('Сопровождающий', true), t(` снимает предел (гейт «${gateNameAnywhere(version, gate)}») или вмешивается`)]}
        : {code, parts: [t('Сопровождающий', true), t(' снимает предел в карточке задачи или вмешивается')]};
    }
    default:
      return {code, parts: [t('Откройте задачу — подробности причины в карточке')]};
  }
}

// Строка одним текстом — для подсказок и проверок.
export function actionText(a: RowAction): string {
  return a.parts.map((p) => ('keys' in p ? p.keys.join(', ') : p.text)).join('');
}
