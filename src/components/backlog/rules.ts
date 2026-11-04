// Правила страницы «Бэклог» (CLAB-402, эпик CLAB-368, design.spec §3–§6, §10):
// запросы списка, края меню порядка и тела запросов перемещения,
// оптимистичный перенос строки, тексты тостов и объявлений, подсказка права,
// ключ раскрытия эпика, отложенное перечитывание. Без React и DOM: страница
// рисует то, что вернули эти функции, а проверяются они без браузера
// (e2e/backlog-rules.mjs).
//
// Статусов, ролей и типов проекта модуль не знает: состав бэклога решает
// сервер (backlog=true), порядок — ранг сервера (order=backlog), эпик — строка
// с детьми, а не тип. Клиент строки не сортирует: единственная перестановка —
// оптимистичный перенос до ответа сервера, и после ответа список
// перечитывается.
import type {ListTasksQuery, Me, ProjectTeam, RankResult, RankTaskBody, TaskListPage} from '../../api/types';

// Строк в одной порции: первая загрузка, «Ещё 50», потолок детей эпика.
export const PAGE = 50;

// Верхний уровень страницы: задачи без родителя в выборке бэклога, в порядке
// ранга. Ребёнок эпика здесь не повторяется — он внутри эпика.
export function topQuery(offset: number, limit: number = PAGE): ListTasksQuery {
  return {backlog: true, top_level: true, order: 'backlog', limit, offset};
}

// Дети раскрытого эпика в бэклоге, в порядке их ранга внутри эпика.
export function childrenQuery(parent: string, offset: number, limit: number = PAGE): ListTasksQuery {
  return {parent, backlog: true, order: 'backlog', limit, offset};
}

// Перечитывание (событие, «Обновить», ответ на своё действие): с начала и
// столько строк, сколько уже показано, но не меньше порции — строки, которые
// человек долистал, не пропадают.
export function reloadLimit(loaded: number): number {
  return Math.max(PAGE, loaded);
}

// «Ещё 50 · показано 50 из 76»: сколько догрузит кнопка и сколько показано.
// null — показано всё.
export function moreLabel(loaded: number, total: number): string | null {
  if (loaded >= total) return null;
  return `Ещё ${Math.min(PAGE, total - loaded)} · показано ${loaded} из ${total}`;
}

// Сводка над списком: число без склонения существительного.
export function summaryText(total: number): string {
  return `${total} на верхнем уровне · задачи эпика — внутри эпика`;
}

// ── сервер без порядка бэклога ──────────────────────────────────────────────

// Сервер старше CLAB-399 не знает выборки бэклога: отказ 400 по параметру
// backlog или order — или (сервер параметр молча пропустил) строки без ранга.
// Страница тогда не рисует список, а говорит, что ждёт обновления сервера:
// без выборки в нём были бы начатые и закрытые задачи.
export function isBacklogRejected(err: unknown): boolean {
  const e = err as {httpStatus?: number; message?: string} | null;
  return e?.httpStatus === 400 && /backlog|order/i.test(e.message ?? '');
}

export function lacksRank(page: Pick<TaskListPage, 'tasks'>): boolean {
  return page.tasks.length > 0 && page.tasks.every((t) => typeof t.rank !== 'string');
}

// ── меню порядка ────────────────────────────────────────────────────────────

export type MoveKind = 'up' | 'down' | 'top' | 'bottom';

export const MOVE_LABELS: Record<MoveKind, string> = {
  up: 'Выше',
  down: 'Ниже',
  top: 'В начало',
  bottom: 'В конец',
};

// Какие пункты меню доступны строке с индексом index в группе, где
// загружено loaded строк из total. Первая строка группы не идёт выше и в
// начало, последняя строка группы (индекс total − 1) — ниже и в конец;
// единственная — никуда. Последняя загруженная при неполной загрузке идёт
// ниже: соседа страница дочитает перед запросом.
export function moveEdges(index: number, loaded: number, total: number): Record<MoveKind, boolean> {
  const count = Math.max(total, loaded);
  const first = index <= 0;
  const last = index >= count - 1;
  return {up: !first, top: !first, down: !last, bottom: !last};
}

// «Ниже» у последней загруженной строки, когда в группе есть ещё: сосед ниже
// не загружен, и его надо прочитать (limit=1, offset=загружено).
export function needsNextNeighbor(kind: MoveKind, index: number, loaded: number, total: number): boolean {
  return kind === 'down' && index === loaded - 1 && total > loaded;
}

// Тело запроса перемещения по видимому порядку группы. keys — ключи
// загруженных строк группы по порядку; next — ключ дочитанного соседа ниже
// (needsNextNeighbor). null — пункт недоступен (край группы).
export function rankBody(kind: MoveKind, keys: string[], index: number, next?: string): RankTaskBody | null {
  switch (kind) {
    case 'up':
      return index > 0 ? {before: keys[index - 1]} : null;
    case 'down': {
      const below = index + 1 < keys.length ? keys[index + 1] : next;
      return below ? {after: below} : null;
    }
    case 'top':
      return {position: 'top'};
    case 'bottom':
      return {position: 'bottom'};
  }
}

// Оптимистичный перенос строки: новое место в загруженных строках группы до
// ответа сервера. «Ниже» с дочитанным соседом — сосед встаёт над строкой и
// становится загруженным. «В конец» при неполной загрузке — строка уходит
// за последнюю загруженную, то есть со страницы. Возвращает новый порядок и
// сколько строк группы теперь загружено.
export function moveRows<T extends {key: string}>(
  rows: T[],
  index: number,
  kind: MoveKind,
  total: number,
  next?: T,
): T[] {
  if (index < 0 || index >= rows.length) return rows;
  const row = rows[index];
  const rest = rows.filter((_, i) => i !== index);
  switch (kind) {
    case 'up':
      return index > 0 ? [...rest.slice(0, index - 1), row, ...rest.slice(index - 1)] : rows;
    case 'down':
      if (index + 1 < rows.length) return [...rest.slice(0, index + 1), row, ...rest.slice(index + 1)];
      return next ? [...rest, next, row] : rows;
    case 'top':
      return [row, ...rest];
    case 'bottom':
      return rows.length >= total ? [...rest, row] : rest;
  }
}

// Заголовок меню называет группу: перемещение всегда внутри неё.
export function groupTitle(parent: string | null): string {
  return parent ? `Порядок в эпике ${parent}` : 'Порядок в бэклоге';
}

// ── тексты ──────────────────────────────────────────────────────────────────

// Тосты ошибок перемещения дословно (design.spec §5.4).
export const MOVE_ERRORS = {
  conflict: 'Порядок не изменился: задача или соседняя уже закрыта. Список обновлён — переставьте ещё раз.',
  neighbor: 'Порядок не изменился: соседняя задача ушла из списка. Список обновлён — переставьте ещё раз.',
  forbidden: 'Порядок не изменился: двигать бэклог могут участники уровня agent и выше.',
  offline: 'Порядок не изменился: нет связи с сервером. Попробуйте ещё раз.',
} as const;

export type FailureKind = keyof typeof MOVE_ERRORS;

// Ответа не было вовсе или сервер упал: сеть, 5xx.
export function isUnreachable(err: unknown): boolean {
  const s = (err as {httpStatus?: number} | null)?.httpStatus;
  return s === undefined || s === 0 || s >= 500;
}

// Вид отказа перемещения по коду ответа: 409 — закрыта задача или сосед,
// 400/404 — сосед ушёл из группы или исчез, 403 — нет права, остальное —
// сеть или сервер.
export function moveFailure(err: unknown): FailureKind {
  const s = (err as {httpStatus?: number} | null)?.httpStatus;
  if (s === 409) return 'conflict';
  if (s === 400 || s === 404) return 'neighbor';
  if (s === 403) return 'forbidden';
  return 'offline';
}

// После отказа список перечитывается — кроме сети и 5xx: перечитывание тоже
// не дошло бы, а строка уже на прежнем месте.
export function reloadAfterFailure(kind: FailureKind): boolean {
  return kind !== 'offline';
}

// Тост ошибки приоритета: сообщение сервера как есть (без своей точки в
// конце — она в шаблоне), при 403 — текст про уровень.
export function priorityError(key: string, err: unknown): string {
  const e = err as {httpStatus?: number; message?: string} | null;
  if (e?.httpStatus === 403) {
    return `Приоритет ${key} не изменился: менять приоритет могут участники уровня agent и выше.`;
  }
  if (isUnreachable(e)) return `Приоритет ${key} не изменился: нет связи с сервером.`;
  const message = (e?.message ?? '').trim().replace(/[.。]+$/, '');
  return `Приоритет ${key} не изменился: ${message || 'сервер отказал'}.`;
}

// Объявление успеха перемещения для программ чтения с экрана — те же фразы,
// что у `clab rank` (design.spec §9.3, §10).
export function movedAnnouncement(key: string, body: RankTaskBody, result: Pick<RankResult, 'changed' | 'parent'>): string {
  if (!result.changed) return `${key} уже на этом месте.`;
  const group = result.parent ? `эпика ${result.parent}` : 'бэклога';
  if ('before' in body) return `${key} поставлена над ${body.before}.`;
  if ('after' in body) return `${key} поставлена под ${body.after}.`;
  return body.position === 'top' ? `${key} — в начале ${group}.` : `${key} — в конце ${group}.`;
}

export const VIEWER_NOTE = 'Порядок и приоритет меняют участники уровня agent и выше. У вас — просмотр.';

export const PAGE_TEXTS = {
  title: 'Бэклог',
  subtitle: 'что начинать следующим — сверху вниз',
  listLabel: 'Бэклог по порядку',
  empty: 'Бэклог пуст',
  emptyHint: 'Неначатых задач нет — всё начатое на «Обзоре». Новая задача встанет в конец бэклога.',
  failed: 'Не получилось загрузить бэклог',
  oldServer: 'Сервер ещё не знает порядка бэклога',
  oldServerHint: 'Страница заработает после обновления сервера.',
  epicEmpty: 'В эпике нет задач в бэклоге',
  epicFailed: 'Не получилось загрузить задачи эпика.',
} as const;

export const epicListLabel = (epic: string) => `Задачи эпика ${epic} в бэклоге`;
export const expandLabel = (epic: string, expanded: boolean) =>
  `${expanded ? 'Скрыть' : 'Показать'} задачи эпика ${epic}`;
export const menuLabel = (key: string) => `Действия с ${key}`;
export const priorityLabelFor = (key: string, current: string) => `Приоритет ${key}: ${current}. Изменить`;

// ── раскрытие эпика ─────────────────────────────────────────────────────────

// Ключ раскрытия эпика для useCollapsed (localStorage, префикс хука
// `sdlc.collapsed.`). Хранится «раскрыт»: по умолчанию эпик свёрнут, а хук
// знает одно умолчание — «нет записи».
export function expandedKey(projectKey: string, epic: string): string {
  return `backlog.${projectKey}.${epic}`;
}

// Шеврон есть у строки, у которой есть дети: решают данные (child_counts),
// а не тип задачи.
export function hasChildren(counts: Record<string, number> | undefined): boolean {
  return Object.values(counts ?? {}).some((n) => typeof n === 'number' && n > 0);
}

// ── право ───────────────────────────────────────────────────────────────────

// Уровни участника, которым сервер даёт двигать порядок и менять приоритет
// (решение 0075: уровень agent и выше).
const EDITOR_LEVELS = new Set(['agent', 'maintainer', 'admin']);

// Подсказка интерфейса, решает сервер (его 403 показывается тостом).
// Правка видна в режиме header, администратору системы, участнику проекта
// уровня agent и выше — поимённо или через команду проекта — и лиду
// команды-владельца. «Не знаю» (кто я или команды не загрузились) — «можно».
export function canEditBacklog({
  me,
  projectKey,
  ownerTeamKey,
  projectTeams,
}: {
  me: Me | undefined;
  projectKey: string;
  ownerTeamKey?: string;
  projectTeams: Pick<ProjectTeam, 'team_key' | 'level'>[] | undefined;
}): boolean {
  if (!me) return true;
  if (me.mode === 'header') return true;
  if (me.principal?.is_admin) return true;
  if ((me.memberships ?? []).some((m) => m.project_key === projectKey && EDITOR_LEVELS.has(m.role))) return true;
  const myTeams = me.teams ?? [];
  if (ownerTeamKey && myTeams.some((t) => t.team_key === ownerTeamKey && t.role === 'lead')) return true;
  if (!projectTeams) return true;
  const mine = new Set(myTeams.map((t) => t.team_key));
  return projectTeams.some((pt) => mine.has(pt.team_key) && EDITOR_LEVELS.has(pt.level));
}

// Нужен ли состав команд проекта, чтобы ответить на вопрос выше.
export function needsTeams(me: Me | undefined, projectKey: string, ownerTeamKey?: string): boolean {
  if (!me || me.mode === 'header' || me.principal?.is_admin) return false;
  return !canEditBacklog({me, projectKey, ownerTeamKey, projectTeams: []});
}

// ── отложенное перечитывание ────────────────────────────────────────────────

// Пока открыто меню строки или выбор приоритета и пока ждёт собственный
// запрос, перечитывание откладывается и выполняется сразу, как только всё
// отпущено: список не прыгает под курсором (design.spec §6). Каждое
// удержание отпускается своей функцией, повторный вызов которой ничего не
// делает.
export interface ReloadGate {
  hold: () => () => void;
  // Событие или ответ хотят перечитать: сейчас или после отпускания.
  wake: () => void;
  held: () => boolean;
}

export function createReloadGate(run: () => void): ReloadGate {
  let holds = 0;
  let pending = false;
  return {
    hold() {
      holds++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds--;
        if (holds === 0 && pending) {
          pending = false;
          run();
        }
      };
    },
    wake() {
      if (holds > 0) {
        pending = true;
        return;
      }
      run();
    },
    held: () => holds > 0,
  };
}
