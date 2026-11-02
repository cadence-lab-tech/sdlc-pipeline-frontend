// Словарь причин внимания строки задачи (CLAB-364, design.spec «Обзора»
// §2.3): код причины → значок, тон и текст. Без разметки — страницы и
// карточка задачи (CLAB-359) берут слова отсюда, а не пишут свои; новая
// причина — одна запись здесь.
//
// Коды — словарь движка (решение 0070), а не ключи статусов и ролей проекта.
// Подписи гейтов и переходов приходят из версии цикла задачи; нет в версии —
// ключ, как пришёл. Тип гейта в подпись не превращается.
import type {Attention} from '../../api/types';
import {agoText, exactTime, sinceText} from './format';

export type ReasonTone = 'default' | 'blue' | 'orange' | 'red';

// Имена значков lucide; компонент строки сопоставляет их с самими значками.
export type ReasonIcon =
  | 'UserCheck'
  | 'Unplug'
  | 'TimerOff'
  | 'XCircle'
  | 'Lock'
  | 'RotateCcw'
  | 'CircleDashed'
  | 'HelpCircle'
  | 'MessageCircleQuestion';

export interface Reason {
  code: string;
  icon: ReasonIcon;
  tone: ReasonTone;
  text: string;
  // Полный текст для подсказки: текст длинной причины обрезается в одну строку.
  title: string;
  // Код известен словарю. Незнакомый показывается нейтрально, задача не теряется.
  known: boolean;
}

// Версия цикла задачи в объёме, который нужен подписям.
export interface VersionLabels {
  transitions: {key: string; name: string; gates?: {key: string; name: string}[]}[];
}

export interface ReasonContext {
  now: number;
  // Версия цикла задачи; нет (ещё не прочиталась или не прочиталась совсем) —
  // подписи гейтов и переходов остаются ключами.
  version?: VersionLabels | null;
  // Вправе ли смотрящий решать гейты (maintainer и выше). Наблюдателю вместо
  // гейта — «ждёт решения человека»: обещать ему решение нечем.
  canDecide: boolean;
  // Куда приведёт переход по апруву — только из записи /approvals: клиент
  // пропуски этапов сам не вычисляет, это правило движка (решение 0066).
  landsIn?: (transitionKey: string) => string | undefined;
  blockedBy: string[];
}

// Известные коды движка (решение 0070). `awaits_reply` (CLAB-359) сюда не
// входит: место под него заложено в describeReason, текст — пока по правилу
// незнакомого кода.
export const REASON_CODES = [
  'awaits_human',
  'lease_expired',
  'over_stage_limit',
  'gate_rejected',
  'blocked',
  'returned',
  'unclaimed',
] as const;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

interface GateRef {
  transition: string;
  gate: string;
  reason?: string;
}

function gateRefs(a: Attention): GateRef[] {
  if (!Array.isArray(a.gates)) return [];
  const out: GateRef[] = [];
  for (const g of a.gates) {
    if (typeof g !== 'object' || g === null) continue;
    const {transition, gate, reason} = g as Record<string, unknown>;
    if (typeof transition !== 'string' || typeof gate !== 'string') continue;
    out.push({transition, gate, reason: str(reason)});
  }
  return out;
}

function transitionName(v: VersionLabels | null | undefined, key: string): string {
  return v?.transitions.find((t) => t.key === key)?.name ?? key;
}

function gateName(v: VersionLabels | null | undefined, transition: string, key: string): string {
  const t = v?.transitions.find((x) => x.key === transition);
  return t?.gates?.find((g) => g.key === key)?.name ?? key;
}

function more(n: number): string {
  return n > 0 ? ` и ещё ${n}` : '';
}

// «Ждёт CLAB-357»; ключей больше трёх — «и ещё N».
export function blockedText(keys: string[]): string {
  if (keys.length === 0) return 'Ждёт блокирующих задач';
  return `Ждёт ${keys.slice(0, 3).join(', ')}${more(keys.length - 3)}`;
}

function build(code: string, icon: ReasonIcon, tone: ReasonTone, text: string, known: boolean, title = text): Reason {
  return {code, icon, tone, text, title, known};
}

export function describeReason(a: Attention, ctx: ReasonContext): Reason {
  switch (a.code) {
    case 'awaits_human': {
      if (!ctx.canDecide) return build(a.code, 'UserCheck', 'blue', 'ждёт решения человека', true);
      const gates = gateRefs(a);
      if (gates.length === 0) return build(a.code, 'UserCheck', 'blue', 'ждёт решения человека', true);
      const label = (g: GateRef) =>
        `${gateName(ctx.version, g.transition, g.gate)} · «${transitionName(ctx.version, g.transition)}»`;
      const first = gates[0];
      const lands = ctx.landsIn?.(first.transition);
      const text = `${label(first)}${lands ? ` → ${lands}` : ''}${more(gates.length - 1)}`;
      const title = gates.length > 1 ? `${text}\n${gates.map(label).join('\n')}` : text;
      return build(a.code, 'UserCheck', 'blue', text, true, title);
    }
    case 'lease_expired': {
      const holder = str(a.holder);
      const text = `Аренда истекла${holder ? ` у ${holder}` : ''} ${agoText(a.since, ctx.now)}`.trimEnd();
      return build(a.code, 'Unplug', 'red', text, true, `${text}\n${exactTime(a.since)}`.trimEnd());
    }
    case 'over_stage_limit': {
      const limit = str(a.max_duration);
      return build(a.code, 'TimerOff', 'orange', limit ? `Этап дольше предела ${limit}` : 'Этап дольше предела', true);
    }
    case 'gate_rejected': {
      const gates = gateRefs(a);
      if (gates.length === 0) return build(a.code, 'XCircle', 'red', 'Гейт отклонён', true);
      const first = gates[0];
      const name = gateName(ctx.version, first.transition, first.gate);
      const text = `${name} отклонён${first.reason ? `: ${first.reason}` : ''}${more(gates.length - 1)}`;
      return build(a.code, 'XCircle', 'red', text, true);
    }
    case 'blocked': {
      const text = blockedText(ctx.blockedBy);
      // Больше трёх ключей в тексте обрезаны — полный список в подсказке.
      return build(a.code, 'Lock', 'orange', text, true, ctx.blockedBy.length > 3 ? `Ждёт ${ctx.blockedBy.join(', ')}` : text);
    }
    case 'returned': {
      const attempt = typeof a.attempt === 'number' ? a.attempt : undefined;
      return build(a.code, 'RotateCcw', 'orange', attempt ? `Возврат, попытка ${attempt}` : 'Возврат', true);
    }
    case 'unclaimed': {
      const waited = sinceText(a.since, ctx.now);
      return build(a.code, 'CircleDashed', 'default', waited ? `ждёт ${waited}` : 'ждёт исполнителя', true);
    }
    case 'awaits_reply':
      // Текст даёт CLAB-359; до него — правило незнакомого кода.
      return build(a.code, 'MessageCircleQuestion', 'blue', `Причина: ${a.code}`, false);
    default:
      return build(a.code, 'HelpCircle', 'default', `Причина: ${a.code}`, false);
  }
}

// Причины в порядке сервера (главная — первая), код не повторяется.
export function describeReasons(attention: Attention[], ctx: ReasonContext): Reason[] {
  const seen = new Set<string>();
  const out: Reason[] = [];
  for (const a of attention) {
    if (seen.has(a.code)) continue;
    seen.add(a.code);
    out.push(describeReason(a, ctx));
  }
  return out;
}

// Нужны ли подписи гейтов из версии цикла: только причинам с гейтом, и
// только тому, кто видит их имена.
export function needsVersion(attention: Attention[], canDecide: boolean): boolean {
  return attention.some(
    (a) => a.code === 'gate_rejected' || (a.code === 'awaits_human' && canDecide),
  );
}
