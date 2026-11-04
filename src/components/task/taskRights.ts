// Право актора на карточку задачи (CLAB-409, решение 0072, п. 9): правка
// постановки и уровней, выбор этапов, исполнитель, свойства и область.
// Право считает сервер и присылает его объектом actor_rights; здесь он только
// читается — уровень доступа, роль участника и ключ статуса не сравниваются ни
// с чем. Поля, которого нет в ответе (сервер прежней версии, ответ без
// актора), нет и в правиле: читается запасное значение, то есть поведение до
// изменения.
//
// Модуль без разметки и без путей '@/': e2e/task-rights-rules.mjs проверяет
// его node без сборщика.
import type {TaskRights} from '../../api/types';

// Булево поле объекта права: значение сервера; нет объекта или поля — fallback
// (что показывала карточка до изменения).
export function rightOf(rights: TaskRights | undefined, act: string, fallback: boolean): boolean {
  const value = (rights as Record<string, unknown> | undefined)?.[act];
  return typeof value === 'boolean' ? value : fallback;
}

// Текст отказа сервера по действию, дословно; нет — undefined, клиент своего
// текста не выдумывает.
export function denyOf(rights: TaskRights | undefined, act: string): string | undefined {
  const message = rights?.actor_deny?.[act]?.message;
  return typeof message === 'string' && message ? message : undefined;
}

// Причина «только просмотр»: объект права есть — текст сервера или ничего;
// объекта нет (сервер прежней версии) — прежний текст интерфейса.
export function reasonOf(rights: TaskRights | undefined, act: string, legacy: string): string | undefined {
  return rights ? denyOf(rights, act) : legacy;
}
