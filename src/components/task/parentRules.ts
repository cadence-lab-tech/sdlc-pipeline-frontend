// Родитель задачи в «Деталях» (CLAB-196): кто может сменить его и на кого.
// Право присылает сервер (actor_rights.reparent), правило одного уровня —
// данные: у задачи с детьми выбора нового родителя нет, а кандидаты — только
// задачи верхнего уровня. Окончательно решает сервер; здесь — подсказка,
// чтобы не предлагать заведомо отклонённое.
//
// Модуль без разметки и без путей '@/': e2e/parent-rules.mjs проверяет его
// node без сборщика.
import type {TaskRights} from '../../api/types';

// Пояснение, почему у задачи с детьми нет выбора нового родителя.
export const HAS_CHILDREN_HINT = 'У задачи есть дочерние задачи — вложенность один уровень: её можно только снять с родителя';

export type ParentEdit =
  // Поля права нет (сервер до CLAB-196): правки нет и пояснения тоже.
  | {mode: 'none'}
  // Право есть и оно «нельзя»: текст сервера дословно, если он прислан.
  | {mode: 'denied'; reason?: string}
  // Можно: выбирать нового родителя (нет детей) и снимать (родитель есть).
  | {mode: 'edit'; canPick: boolean; pickHint?: string; canDetach: boolean};

export function parentEdit(rights: TaskRights | undefined, parentKey: string | null | undefined, childCount: number): ParentEdit {
  const value = rights?.reparent;
  if (typeof value !== 'boolean') return {mode: 'none'};
  if (!value) {
    const message = rights?.actor_deny?.reparent?.message;
    return {mode: 'denied', reason: typeof message === 'string' && message ? message : undefined};
  }
  const canPick = childCount === 0;
  return {mode: 'edit', canPick, pickHint: canPick ? undefined : HAS_CHILDREN_HINT, canDetach: Boolean(parentKey)};
}

// Кандидат в родители — то, что вернул поиск задач верхнего уровня, без самой
// задачи и без её нынешнего родителя (перенос туда ничего не меняет). Строку с
// родителем сервер в такой выборке не отдаёт, но правило не полагается на это.
export function parentCandidates(
  tasks: {key: string; title: string; parent_key?: string | null}[],
  selfKey: string,
  currentParent: string | null | undefined,
): {value: string; label: string}[] {
  return tasks
    .filter((t) => !t.parent_key && t.key !== selfKey && t.key !== currentParent)
    .map((t) => ({value: t.key, label: `${t.key} · ${t.title}`}));
}
