// Библиотека инструкций на «Пайплайне» (CLAB-351, решение 0069): правила
// экранов без React — кого отмечать в «Обновить в ролях», подписи строк,
// «есть новее», форма ключа. Проверяется без браузера в e2e/library-rules.mjs.
// Ключей статусов, ролей и инструкций здесь нет: всё приходит данными.
import type {Instruction, InstructionLag, InstructionUsage, InstructionVersion, RoleDocumentPin} from '../../api/types';

// Форма ключа — та же, что у сервера (CHECK 000040). Дублирует его правило
// для подсказки в форме; решает сервер.
export const INSTRUCTION_KEY = /^[a-z0-9][a-z0-9_-]{0,60}$/;
export const KEY_RULE =
  'Ключ: строчные латинские буквы, цифры, «_» и «-», начинается с буквы или цифры, не длиннее 61 символа';
export const keyIsBad = (key: string) => key !== '' && !INSTRUCTION_KEY.test(key);
export const docName = (key: string) => `${key}.md`;
// Ключ из имени документа роли: «git.md» → «git».
export const keyFromDocName = (name: string) => name.replace(/\.md$/, '');

export const INSTRUCTION_KINDS = ['instructions', 'checklist', 'reference'];

// Типы на выбор: тип последней версии не из стандартных — первым.
export function kindChoices(current?: string): string[] {
  return current && !INSTRUCTION_KINDS.includes(current) ? [current, ...INSTRUCTION_KINDS] : INSTRUCTION_KINDS;
}

// ── раздел и панель ─────────────────────────────────────────────────────────

export const pinnedCaption = (i: Pick<Instruction, 'pinned_roles'>) =>
  i.pinned_roles ? `закреплена: ${i.pinned_roles}` : 'ни одна роль не закрепила';
export const laggingLabel = (n: number) => `отстают: ${n}`;

// «Отстают от vN: M» — закреплённые ниже последней версии.
export const laggingCount = (usage: InstructionUsage[], latest: number) =>
  usage.filter((u) => u.pinned_version !== null && u.pinned_version < latest).length;

export type UsageState = 'current' | 'lag' | 'plain';
export function usageState(u: InstructionUsage, latest: number): UsageState {
  if (u.pinned_version === null) return 'plain';
  return u.pinned_version < latest ? 'lag' : 'current';
}

// Строка «Закреплена в ролях: …» у версии.
export function pinnedOn(usage: InstructionUsage[], version: number): string[] {
  return usage.filter((u) => u.pinned_version === version).map((u) => u.role_key);
}

export const versionOptionLabel = (v: Pick<InstructionVersion, 'version' | 'changelog'>, latest: number) =>
  `v${v.version}${v.version === latest ? ' · последняя' : ''}${v.changelog ? ` · ${v.changelog}` : ''}`;

// Подсказка метки «есть новее» у роли: «git: закреплена v1, в библиотеке v2».
export const lagTitle = (lags: InstructionLag[]) =>
  lags.map((l) => `${l.key}: закреплена v${l.pinned_version}, в библиотеке v${l.latest_version}`).join(', ');
export const lagLine = (l: InstructionLag) => `закреплена v${l.pinned_version}, в библиотеке v${l.latest_version}`;

// Метки закрепления у строки документа: «библиотека: git v1» или коротко
// «git v1»; «есть vN», если в библиотеке новее.
export const pinLabel = (pin: RoleDocumentPin, short = false) =>
  short ? `${pin.key} v${pin.version}` : `библиотека: ${pin.key} v${pin.version}`;
export const newerLabel = (pin: RoleDocumentPin, latest?: number) =>
  latest && latest > pin.version ? `есть v${latest}` : undefined;

// ── «Обновить в ролях» ──────────────────────────────────────────────────────

export type CandidateState = 'current' | 'lag' | 'ahead' | 'plain';
export function candidateState(c: InstructionUsage, target: number): CandidateState {
  if (c.pinned_version === null) return 'plain';
  if (c.pinned_version === target) return 'current';
  return c.pinned_version < target ? 'lag' : 'ahead';
}

export const CANDIDATE_TOKEN: Record<CandidateState, {label: string; color: 'green' | 'orange' | 'default'}> = {
  current: {label: 'актуальна', color: 'green'},
  lag: {label: 'отстаёт', color: 'orange'},
  ahead: {label: 'откат', color: 'default'},
  plain: {label: 'не закреплён', color: 'default'},
};

// Отмечены по умолчанию: закреплённые ниже выбранной версии и обычные
// документы с тем же текстом (закрепление ничего в тексте не меняет).
// Обычные с другим текстом, откат и актуальные — нет. preRoles — диалог
// открыт из плашки роли: отмечена только она.
export function defaultPicks(
  candidates: InstructionUsage[],
  target: number,
  targetSha: string | undefined,
  preRoles?: string[],
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const c of candidates) {
    const state = candidateState(c, target);
    if (preRoles) {
      out[c.role_key] = preRoles.includes(c.role_key) && state !== 'current';
      continue;
    }
    out[c.role_key] = state === 'lag' || (state === 'plain' && Boolean(targetSha) && c.sha256 === targetSha);
  }
  return out;
}

// Смена версии: ручные отметки остаются, кроме строк, ставших актуальными.
export function repick(
  candidates: InstructionUsage[],
  picks: Record<string, boolean>,
  touched: boolean,
  target: number,
  targetSha: string | undefined,
  preRoles?: string[],
): Record<string, boolean> {
  if (!touched) return defaultPicks(candidates, target, targetSha, preRoles);
  const out = {...picks};
  for (const c of candidates) if (candidateState(c, target) === 'current') out[c.role_key] = false;
  return out;
}

// Роли, которые уйдут в запрос: отмеченные и не на выбранной версии.
export const chosen = (candidates: InstructionUsage[], picks: Record<string, boolean>, target: number) =>
  candidates.filter((c) => picks[c.role_key] && candidateState(c, target) !== 'current');

export const rolesWord = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'роли' : 'ролях');
export const applyButtonLabel = (n: number) => (n ? `Обновить в ${n} ${rolesWord(n)}` : 'Отметьте роли');

export function candidateLine(c: InstructionUsage, key: string, target: number): string {
  if (candidateState(c, target) === 'current') return `Уже на v${target}: новой версии не будет`;
  const from = c.pinned_version === null ? 'обычный документ' : `${key} v${c.pinned_version}`;
  return `v${c.role_version} → v${c.role_version + 1} · ${from} → v${target}`;
}

// Подпись у обычного документа: закрепление заменит текст или нет.
export const plainNote = (c: InstructionUsage, targetSha?: string) =>
  targetSha && c.sha256 === targetSha ? 'Текст тот же: документ только закрепится' : 'Текст роли заменится текстом инструкции';

export const allCurrent = (candidates: InstructionUsage[], target: number) =>
  candidates.length > 0 && candidates.every((c) => candidateState(c, target) === 'current');

// Роль, названная в отказе 409 (details.role у сервера).
export function conflictRole(details: unknown): string | undefined {
  const role = (details as {role?: unknown} | undefined)?.role;
  return typeof role === 'string' ? role : undefined;
}

// ── форма новой версии ──────────────────────────────────────────────────────

// Текст и тип те же, что у последней версии: сохранять нечего.
export const unchangedVersion = (latest: Pick<InstructionVersion, 'kind' | 'content'> | undefined, kind: string, content: string) =>
  Boolean(latest) && latest!.content === content && latest!.kind === kind;

// Размер текста в байтах UTF-8, как его считает сервер.
export const byteLength = (s: string) => new TextEncoder().encode(s).length;
