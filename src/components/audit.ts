// Подписи журнала действий (CLAB-210, CLAB-211). Вид токена, канал и исход —
// перечни данных сервера, а не роли и статусы: по ним выбирать подпись и
// оформление можно. Словари терпят незнакомый ключ: новый вид токена
// заводится на бэкенде раньше, чем подпись здесь, и журнал показывает его
// сырым ключом, а не падает. Модуль без разметки — его проверяет
// e2e/labels.mjs прямо в node.
import type {AuditEntry} from '../api/types';

const TOKEN_KINDS: Record<string, string> = {
  api: 'личный',
  session: 'сессия',
  // Токен задачи выдаётся исполнителю этапа по аренде (CLAB-212): по нему
  // видно, что действовал исполнитель, а не человек.
  task: 'токен задачи',
};

// Подпись вида токена; null — вызов без токена (режим header).
export function tokenKindLabel(kind: string | null | undefined): string {
  if (kind === null || kind === undefined || kind === '') return 'без токена';
  return TOKEN_KINDS[kind] ?? kind;
}

// Оформление вида токена — цвет Token из kit. Токен задачи выделен: это
// главный признак «действовал исполнитель», и его видно, не читая подписи.
export function tokenKindColor(kind: string | null | undefined): 'default' | 'orange' {
  return kind === 'task' ? 'orange' : 'default';
}

const CHANNELS: Record<string, string> = {mcp: 'MCP', rest: 'REST'};

export function channelLabel(channel: string): string {
  return CHANNELS[channel] ?? channel;
}

// Исход: «успех» либо код ошибки домена и HTTP-статус (у REST), например
// «forbidden · 403». Код — общий у REST и MCP, текст сообщения в журнал не
// пишется.
export function outcomeLabel(outcome: AuditEntry['outcome'] | null | undefined): string {
  if (!outcome) return 'неизвестно';
  if (outcome.ok) return 'успех';
  const parts = [outcome.code || 'ошибка'];
  if (typeof outcome.status === 'number') parts.push(String(outcome.status));
  return parts.join(' · ');
}

// Кто действовал: handle, а вид принципала — только если это не человек.
// principal null — отказ 401 по токену, которого нет в базе.
export function principalLabel(principal: AuditEntry['principal'] | null | undefined): string {
  if (!principal || !principal.handle) return 'неизвестный';
  return principal.kind && principal.kind !== 'user'
    ? `${principal.handle} (${principal.kind})`
    : principal.handle;
}

// Токен строкой: имя и префикс; у снимка без имени и префикса — только вид.
export function tokenLabel(token: AuditEntry['token'] | null | undefined): string {
  if (!token) return '';
  return [token.name, token.prefix].filter(Boolean).join(' · ');
}
