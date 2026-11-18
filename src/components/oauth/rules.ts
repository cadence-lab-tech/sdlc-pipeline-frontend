// Правила страницы согласия и раздела подключённых клиентов (CLAB-482) без
// React и без псевдонима @/: модуль читают сценарии e2e/oauth-rules.mjs прямо
// из исходников. Страницы берут отсюда всё, что решает «какое состояние
// показать», — по коду ответа сервера, а не по тексту сообщения.

// ── что нужно от ответа ─────────────────────────────────────────────────────

// Минимум от ошибки клиента API: ApiError подходит, а правила не тянут клиент.
export interface FailureLike {
  code?: string;
  message: string;
  httpStatus?: number;
  details?: unknown;
}

export interface ConsentLike {
  can_grant: boolean;
  reason?: string;
  reason_message?: string;
}

// ── раздел «Подключённые клиенты» и сведения об инстансе ────────────────────

// Подключение клиентов действует, только если сервер так и сказал. Нет поля
// (сервер старше), enabled: false и сбой запроса — одно и то же: раздела нет.
export function oauthEnabledOf(instance?: { oauth?: { enabled?: boolean } } | null): boolean {
  return instance?.oauth?.enabled === true;
}

export type ClientsAccess = 'pending' | 'enabled' | 'disabled';

// Сведения об инстансе ещё не пришли — ждать, а не показывать «выключено».
export function clientsAccess(view?: { oauthEnabled?: boolean }): ClientsAccess {
  if (!view) return 'pending';
  return view.oauthEnabled === true ? 'enabled' : 'disabled';
}

export const CLIENTS_PATH = '/clients';
export const CONSENT_PATH = '/login/oauth';

// ── состояние страницы согласия ─────────────────────────────────────────────

export type ConsentState =
  // нужен вход: страница уводит на вход и возвращает сюда же
  | { kind: 'login' }
  // живой запрос, «Разрешить» доступна
  | { kind: 'ready' }
  // запрос показан, но выдать доступ с этой учётной записью нельзя
  | { kind: 'blocked'; reason: string; message: string }
  // нет данных для карточки (токен задачи, не человек)
  | { kind: 'forbidden'; message: string }
  | { kind: 'expired' }
  | { kind: 'decided' }
  | { kind: 'notfound' }
  // сеть или сбой сервера: можно повторить
  | { kind: 'failed'; message: string };

export const BLOCKED_FALLBACK = 'Выдать доступ с этой учётной записью нельзя.';

function detailReason(err: FailureLike): string {
  const d = err.details;
  if (d && typeof d === 'object' && 'reason' in d) {
    const r = (d as { reason?: unknown }).reason;
    if (typeof r === 'string') return r;
  }
  return '';
}

function isUnauthenticated(err: FailureLike): boolean {
  return err.httpStatus === 401 || err.code === 'unauthenticated';
}

// Общая часть ответов GET и POST: 401 → вход, 409 → устарел/обработан,
// 404 → не найден. undefined — ответ не из этих и решается вызывающим.
function commonFailure(err: FailureLike): ConsentState | undefined {
  if (isUnauthenticated(err)) return { kind: 'login' };
  if (err.httpStatus === 409) {
    const reason = detailReason(err);
    if (reason === 'expired') return { kind: 'expired' };
    if (reason === 'decided') return { kind: 'decided' };
    return undefined;
  }
  if (err.httpStatus === 404 || err.code === 'not_found') return { kind: 'notfound' };
  return undefined;
}

// Состояние по ответу GET запроса: карточка либо ошибка. Каждый код причины
// из контракта и незнакомый дают одно состояние «выдать нельзя»: текст — тот,
// что прислал сервер.
export function consentLoaded(consent: ConsentLike): ConsentState {
  if (consent.can_grant) return { kind: 'ready' };
  return {
    kind: 'blocked',
    reason: consent.reason ?? '',
    message: blockedMessage(consent.reason_message),
  };
}

export function consentFailed(err: FailureLike): ConsentState {
  const common = commonFailure(err);
  if (common) return common;
  if (err.httpStatus === 403 || err.code === 'forbidden') {
    return { kind: 'forbidden', message: blockedMessage(err.message) };
  }
  return { kind: 'failed', message: err.message };
}

// Состояние по ошибке POST решения. 403 — права изменились после показа:
// то же «выдать нельзя» с текстом и причиной сервера. Прочее — повтор тем же
// нажатием, запрос остаётся нерешённым.
export function decideFailed(err: FailureLike): ConsentState {
  const common = commonFailure(err);
  if (common) return common;
  if (err.httpStatus === 403 || err.code === 'forbidden') {
    return { kind: 'blocked', reason: detailReason(err), message: blockedMessage(err.message) };
  }
  return { kind: 'failed', message: err.message };
}

export function blockedMessage(message?: string): string {
  const t = (message ?? '').trim();
  return t === '' ? BLOCKED_FALLBACK : t;
}

// Что есть у состояния из действий. both — «Разрешить», «Отклонить» и «Войти
// другой учётной записью»; switch — только вход другой записью (карточки для
// решения нет); none — запрос не годится, нечего решать и не на что
// переходить. «Разрешить» при blocked выключена, но на месте.
export type ConsentActions = 'both' | 'switch' | 'none';

export function consentActions(state: string): ConsentActions {
  if (state === 'ready' || state === 'blocked') return 'both';
  if (state === 'forbidden') return 'switch';
  return 'none';
}

// ── вывод недоверенных данных клиента ───────────────────────────────────────

export const NO_CLIENT_NAME = 'клиент без имени';

// Имя клиента заявляет сам клиент. Пустое (и из одних пробелов) — не имя.
export function clientName(name?: string | null): string | undefined {
  const t = (name ?? '').trim();
  return t === '' ? undefined : t;
}

// ── переход на адрес клиента ────────────────────────────────────────────────

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

// Переход только на https либо на http на петле, как и принимает сервер.
// Всё прочее — javascript:, data:, адрес без схемы, //хост, адрес с учётными
// данными — не адрес возврата. Возвращается разобранный href, а не исходная
// строка: что разобрал парсер, на то и уходим.
export function safeRedirect(uri: unknown): string | null {
  if (typeof uri !== 'string' || uri.trim() === '') return null;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return null;
  }
  if (u.username !== '' || u.password !== '') return null;
  if (u.protocol === 'https:') return u.href;
  if (u.protocol === 'http:' && LOOPBACK_HOSTS.has(u.hostname.toLowerCase())) return u.href;
  return null;
}

// ── причины отзыва ──────────────────────────────────────────────────────────

const REVOKE_REASONS: Record<string, string> = {
  user: 'Вы отключили этот клиент.',
  refresh_reuse: 'Отозван автоматически: токен обновления использован повторно.',
  code_reuse: 'Отозван автоматически: код подключения использован повторно.',
  expired: 'Отозван: истёк срок без использования.',
};

// Незнакомая причина выводится как есть; пустая — строки нет.
export function revokeReasonText(reason?: string | null): string | undefined {
  const r = (reason ?? '').trim();
  if (r === '') return undefined;
  return Object.hasOwn(REVOKE_REASONS, r) ? REVOKE_REASONS[r] : r;
}

// ── список клиентов ─────────────────────────────────────────────────────────

// Живые идут первыми; порядок сервера внутри групп сохраняется.
export function partitionGrants<T extends { revoked_at?: string | null }>(
  grants: T[],
): { live: T[]; revoked: T[] } {
  const live: T[] = [];
  const revoked: T[] = [];
  for (const g of grants) (g.revoked_at ? revoked : live).push(g);
  return { live, revoked };
}

// Отозванные свёрнуты, пока есть действующие.
export function revokedOpenByDefault(live: number): boolean {
  return live === 0;
}

export const grantScopeAll = 'все проекты';

// Текст подтверждения «Отключить»: имя и хост — чтобы узнать, что именно гасим.
export function disconnectText(name: string | undefined, host: string): string {
  return `«${name ?? NO_CLIENT_NAME}» (${host}) перестанет работать сразу: его токен и токен обновления погаснут. Чтобы вернуть доступ, подключите клиент заново из самого клиента.`;
}

// ── «Токены» проекта ────────────────────────────────────────────────────────

// Что дописать к строке токена подключённого клиента; у остальных токенов —
// ничего, и строка остаётся прежней.
export function tokenClientMark(token: {
  oauth_grant?: { client_name?: string; redirect_host?: string } | null;
}): { name: string | undefined; host: string } | undefined {
  const g = token.oauth_grant;
  if (!g) return undefined;
  return { name: clientName(g.client_name), host: g.redirect_host ?? '' };
}
