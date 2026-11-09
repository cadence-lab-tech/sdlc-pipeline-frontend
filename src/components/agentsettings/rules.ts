// Правила раздела «Агенты и модели» (CLAB-429, решение 0077): разбор ответа
// сервера, право на правку, документ и его разница по путям, привязка отказа
// сервера к полю, разбор JSON и тексты. Без разметки и без путей `@/`, чтобы
// проверяться без браузера (`node e2e/agent-settings-rules.mjs`).
//
// Проверяет документ только сервер (ValidateAgentSettings): правил формы
// имён, цен и дат здесь нет намеренно. Локально — только целостность самого
// редактора: дубль id модели прайса и JSON, который не разбирается.
import type {
  AgentSettingsActive,
  AgentSettingsListItem,
  AgentSettingsState,
  AgentSettingsView,
  Me,
  ProjectTeam,
} from '../../api/types';
import {canEditTaskLevel} from '../modelLevel';

export type Doc = Record<string, unknown>;

export const LEVELS = ['low', 'medium', 'high'] as const;
export type Level = (typeof LEVELS)[number];

// Агенты набора инстанса (workflow.KnownAgents). Список для выбора при
// добавлении; имя вне него — «свой агент», сервер лишь предупреждает.
export const KNOWN_AGENTS = ['claude', 'codex', 'generic'] as const;

export const PRICE_FIELDS = ['input', 'output', 'cache_read', 'cache_write'] as const;
export type PriceField = (typeof PRICE_FIELDS)[number];

export const PRICE_LABELS: Record<PriceField, string> = {
  input: 'Вход',
  output: 'Выход',
  cache_read: 'Чтение кэша',
  cache_write: 'Запись кэша',
};

export const PRICE_UNIT = 'USD за 1 000 000 токенов';

export function isObject(v: unknown): v is Doc {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ── разбор ответов ──────────────────────────────────────────────────────────

// Бэкенд опускает пустое (`warnings` бывает null), документ может прийти не
// объектом: экран не должен падать от формы, которую ещё не проверили.
export function normalizeView(raw: AgentSettingsView): AgentSettingsView {
  return {
    ...raw,
    document: (isObject(raw.document) ? raw.document : {}) as AgentSettingsView['document'],
    changelog: raw.changelog ?? null,
    created_by: raw.created_by ?? null,
    activated_by: raw.activated_by ?? null,
    activated_at: raw.activated_at ?? null,
    warnings: raw.warnings ?? [],
  };
}

// {"version": null} — настройки нет; это нормальное состояние, не ошибка.
export function activeOf(raw: AgentSettingsActive): AgentSettingsView | null {
  if (!raw || raw.version === null || raw.version === undefined) return null;
  return normalizeView(raw as AgentSettingsView);
}

export function draftOf(list: AgentSettingsListItem[] | undefined): AgentSettingsListItem | undefined {
  return list?.find((v) => v.state === 'draft');
}

export function sortVersions(list: AgentSettingsListItem[]): AgentSettingsListItem[] {
  return [...list].sort((a, b) => b.version - a.version);
}

// ── подписи состояний ───────────────────────────────────────────────────────

// Не словарь цикла (pipeline/labels.ts: «работает / выведена»): так названо в
// утверждённых требованиях и в тосте. Точное значение API — в data-state.
export const STATE_LABELS: Record<AgentSettingsState, string> = {
  active: 'активна',
  draft: 'черновик',
  retired: 'снята',
};

export function stateLabel(state: string): string {
  return STATE_LABELS[state as AgentSettingsState] ?? state;
}

export function stateVariant(state: string): 'success' | 'accent' | 'neutral' {
  return state === 'active' ? 'success' : state === 'draft' ? 'accent' : 'neutral';
}

export function shortSha(sha: string | undefined): string {
  return (sha ?? '').slice(0, 7);
}

// ── право ───────────────────────────────────────────────────────────────────

// Подсказка интерфейса, решает сервер (0077 п. 4.9): «не знаю» — «можно».
// Не-человек (агент, бот) не правит даже с уровнем maintainer. Лид команды
// владельца к настройке проекта не относится: у проекта владельца нет.
export function canEditAgentSettings({
  me,
  projectKey,
  projectTeams,
}: {
  me: Me | undefined;
  projectKey: string;
  projectTeams: ProjectTeam[] | undefined;
}): boolean {
  if (!me) return true;
  if (me.mode === 'header') return true;
  if (me.principal && me.principal.kind !== 'user') return false;
  return canEditTaskLevel({me, projectKey, projectTeams});
}

export function isHuman(me: Me | undefined): boolean {
  return !me || me.mode === 'header' || !me.principal || me.principal.kind === 'user';
}

// Что агенты берут, пока активной версии нет (design.spec §3.1).
export const DEFAULT_BINDINGS = [
  'claude: low → haiku, medium → sonnet, high → opus (алиасы Claude Code)',
  'codex: таблицы нет, берётся модель Codex по умолчанию',
  'generic: таблицы нет, берётся модель агента по умолчанию',
];

export const READ_ONLY_TITLE = 'Только чтение';

export function readOnlyText(human: boolean): string {
  return human
    ? 'Настройку агентов правит сопровождающий проекта (уровень maintainer или admin). Вы можете смотреть действующую версию, черновик и историю.'
    : 'Вы вошли как агент или бот: настройку агентов правит человек — сопровождающий проекта (уровень maintainer или admin).';
}

// ── отказы сервера ──────────────────────────────────────────────────────────

function detail(details: unknown, key: string): unknown {
  return isObject(details) ? details[key] : undefined;
}

// details.path отказа проверки: строка, у пустого пути — ''. Нет поля —
// undefined (отказ не из проверки документа).
export function errorPath(details: unknown): string | undefined {
  const p = detail(details, 'path');
  return typeof p === 'string' ? p : undefined;
}

export type DenyReason = 'level' | 'human_action';

export function denyReason(details: unknown): DenyReason | undefined {
  const r = detail(details, 'reason');
  return r === 'level' || r === 'human_action' ? r : undefined;
}

export function denyReasonText(reason: DenyReason | undefined): string | undefined {
  if (reason === 'level') return 'Нужен уровень maintainer или admin в проекте.';
  if (reason === 'human_action') {
    return 'Правит человек: агентский принципал не правит настройку даже с уровнем maintainer.';
  }
  return undefined;
}

export function activationConflict(details: unknown): {draft?: number; requested?: number} {
  const draft = detail(details, 'draft_version');
  const requested = detail(details, 'requested');
  return {
    draft: typeof draft === 'number' ? draft : undefined,
    requested: typeof requested === 'number' ? requested : undefined,
  };
}

export function activationConflictText({draft, requested}: {draft?: number; requested?: number}): string {
  if (draft !== undefined && requested !== undefined) {
    return `Пока вы подтверждали версию ${requested}, черновиком стала версия ${draft} (её изменили в другой вкладке или из CLI). Раздел перечитан: проверьте разницу и активируйте снова.`;
  }
  return 'Черновик изменился (изменён в другой вкладке или из CLI). Раздел перечитан: проверьте разницу и активируйте снова.';
}

export function pathLabel(path: string): string {
  return path === '' ? 'весь документ' : path;
}

// ── документ ────────────────────────────────────────────────────────────────

export function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (isObject(v)) {
    const out: Doc = {};
    for (const k of Object.keys(v).sort()) out[k] = sortDeep(v[k]);
    return out;
  }
  return v;
}

// Канонический вид: ключи по алфавиту, отступ 2 пробела. Таким документ
// показывает вкладка JSON, и по нему же считаются «изменено» и равенство.
export function canonicalDocument(doc: unknown): string {
  return JSON.stringify(sortDeep(doc ?? {}), null, 2);
}

export function sameDocument(a: unknown, b: unknown): boolean {
  return canonicalDocument(a) === canonicalDocument(b);
}

// ── путь поля ───────────────────────────────────────────────────────────────

// Серверный путь поля. Разбирать его по точкам нельзя (id модели содержит
// точки: pricing.models.gpt-6.1-sol.input), поэтому ошибка привязывается к
// полю равенством строки, а путь строится здесь одним способом.
export const P = {
  changelog: 'changelog',
  agent: (name: string) => `agents.${name}`,
  model: (name: string, i: number) => `agents.${name}.models[${i}]`,
  levelModel: (name: string, level: string) => `agents.${name}.levels.${level}.model`,
  levelEffort: (name: string, level: string) => `agents.${name}.levels.${level}.effort`,
  asOf: 'pricing.as_of',
  priceModel: (id: string) => `pricing.models.${id}`,
  price: (id: string, field: string) => `pricing.models.${id}.${field}`,
};

export function agentNames(doc: Doc): string[] {
  return isObject(doc.agents) ? Object.keys(doc.agents) : [];
}

export function agentOf(doc: Doc, name: string): Doc {
  const agents = doc.agents;
  const a = isObject(agents) ? agents[name] : undefined;
  return isObject(a) ? a : {};
}

export function modelsOf(agent: Doc): string[] | undefined {
  return Array.isArray(agent.models) ? agent.models.map((m) => (typeof m === 'string' ? m : String(m))) : undefined;
}

export function levelOf(agent: Doc, level: string): Doc {
  const levels = agent.levels;
  const l = isObject(levels) ? levels[level] : undefined;
  return isObject(l) ? l : {};
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
}

// Пути всех полей, которые рисует вкладка «Таблица» для документа: по ним
// решается, есть ли у отказа сервера поле, к которому его положить.
export function fieldPaths(doc: Doc, rows?: PriceRow[]): Set<string> {
  const out = new Set<string>([P.changelog]);
  for (const name of agentNames(doc)) {
    const agent = agentOf(doc, name);
    out.add(P.agent(name));
    (modelsOf(agent) ?? []).forEach((_, i) => out.add(P.model(name, i)));
    for (const level of LEVELS) {
      out.add(P.levelModel(name, level));
      out.add(P.levelEffort(name, level));
    }
  }
  if (isObject(doc.pricing)) {
    out.add(P.asOf);
    for (const row of rows ?? priceRows(doc)) {
      out.add(P.priceModel(row.id));
      for (const f of PRICE_FIELDS) out.add(P.price(row.id, f));
    }
  }
  return out;
}

// ── правки документа (чистые, без изменения аргумента) ─────────────────────

function withAgents(doc: Doc, fn: (agents: Doc) => Doc): Doc {
  const agents = fn(isObject(doc.agents) ? {...doc.agents} : {});
  const next = {...doc};
  if (Object.keys(agents).length === 0) delete next.agents;
  else next.agents = agents;
  return next;
}

export function addAgent(doc: Doc, name: string): Doc {
  return withAgents(doc, (a) => ({...a, [name]: {}}));
}

export function removeAgent(doc: Doc, name: string): Doc {
  return withAgents(doc, (a) => {
    const next = {...a};
    delete next[name];
    return next;
  });
}

function setAgent(doc: Doc, name: string, fn: (agent: Doc) => Doc): Doc {
  return withAgents(doc, (a) => ({...a, [name]: fn({...agentOf(doc, name)})}));
}

// Пустой список — ключа models нет: «не ограничены» и «пусто» — разное, и
// таблица их не смешивает (удаление последней строки убирает ключ).
export function setModels(doc: Doc, name: string, models: string[] | undefined): Doc {
  return setAgent(doc, name, (agent) => {
    if (!models || models.length === 0) delete agent.models;
    else agent.models = models;
    return agent;
  });
}

// Объект уровня существует, если задана модель или усилие (или есть чужие
// поля — они остаются как есть). Пусто — уровня нет; нет уровней — нет levels.
export function setLevelField(
  doc: Doc,
  name: string,
  level: string,
  field: 'model' | 'effort',
  value: string,
): Doc {
  return setAgent(doc, name, (agent) => {
    const levels: Doc = isObject(agent.levels) ? {...agent.levels} : {};
    const entry: Doc = {...levelOf(agent, level)};
    if (value === '') delete entry[field];
    else entry[field] = value;
    if (Object.keys(entry).length === 0) delete levels[level];
    else levels[level] = entry;
    if (Object.keys(levels).length === 0) delete agent.levels;
    else agent.levels = levels;
    return agent;
  });
}

export function todayISO(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function setPricing(doc: Doc, pricing: Doc | undefined): Doc {
  const next = {...doc};
  if (pricing === undefined) delete next.pricing;
  else next.pricing = pricing;
  return next;
}

export function emptyPricing(now?: Date): Doc {
  return {as_of: todayISO(now), models: {}};
}

export function setAsOf(doc: Doc, asOf: string): Doc {
  const pricing: Doc = isObject(doc.pricing) ? {...doc.pricing} : {};
  pricing.as_of = asOf;
  return setPricing(doc, pricing);
}

// ── прайс: ряды редактора ───────────────────────────────────────────────────

// Ряд прайса — своя запись редактора, а не ключ объекта: два ряда с одним id
// в объекте схлопнулись бы, а цену надо уметь набирать текстом ("0." — ещё не
// число). extra — поля цены, которых таблица не показывает: остаются как есть.
export interface PriceRow {
  uid: string;
  id: string;
  input: string;
  output: string;
  cache_read: string;
  cache_write: string;
  extra: Doc;
}

let uidSeq = 0;
export function nextUid(): string {
  uidSeq += 1;
  return `r${uidSeq}`;
}

export function priceRows(doc: Doc): PriceRow[] {
  const pricing = doc.pricing;
  const models = isObject(pricing) && isObject(pricing.models) ? pricing.models : {};
  return Object.keys(models).map((id) => {
    const prices = isObject(models[id]) ? (models[id] as Doc) : {};
    const extra: Doc = {};
    for (const k of Object.keys(prices)) {
      if (!(PRICE_FIELDS as readonly string[]).includes(k)) extra[k] = prices[k];
    }
    return {
      uid: nextUid(),
      id,
      input: str(prices.input),
      output: str(prices.output),
      cache_read: str(prices.cache_read),
      cache_write: str(prices.cache_write),
      extra,
    };
  });
}

export function emptyPriceRow(): PriceRow {
  return {uid: nextUid(), id: '', input: '', output: '', cache_read: '', cache_write: '', extra: {}};
}

// Набранное число уходит числом, неразобранное — строкой как набрано: «цена —
// число…» говорит сервер. Пустое в документ не попадает.
export function priceValue(text: string): number | string | undefined {
  const t = text.trim();
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : text;
}

// Id, который встречается в рядах больше одного раза.
export function duplicateIds(rows: PriceRow[]): Set<string> {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.id)) dup.add(r.id);
    seen.add(r.id);
  }
  return dup;
}

// Прайс документа из рядов. При дубле id в документ идёт первый ряд — но
// «Сохранить» при дубле выключена, документ нужен лишь как буфер.
export function pricingFrom(base: Doc | undefined, rows: PriceRow[]): Doc {
  const pricing: Doc = {...(base ?? {})};
  const models: Doc = {};
  for (const r of rows) {
    if (Object.prototype.hasOwnProperty.call(models, r.id)) continue;
    const prices: Doc = {...r.extra};
    for (const f of PRICE_FIELDS) {
      const v = priceValue(r[f]);
      if (v !== undefined) prices[f] = v;
    }
    models[r.id] = prices;
  }
  pricing.models = models;
  return pricing;
}

// ── разница документов по путям ─────────────────────────────────────────────

export type DiffOp = '+' | '~' | '-';

export interface DiffRow {
  op: DiffOp;
  path: string;
  before?: unknown;
  after?: unknown;
}

export const DIFF_WORDS: Record<DiffOp, string> = {'+': 'добавлено', '~': 'изменено', '-': 'удалено'};

function leaves(v: unknown, path: string, out: Map<string, unknown>): void {
  if (isObject(v) && Object.keys(v).length > 0) {
    for (const k of Object.keys(v)) leaves(v[k], path === '' ? k : `${path}.${k}`, out);
    return;
  }
  if (path !== '') out.set(path, v);
}

export function flatten(doc: unknown): Map<string, unknown> {
  const out = new Map<string, unknown>();
  leaves(doc ?? {}, '', out);
  return out;
}

// Листья — скаляры, массивы и пустые объекты; сравнение по каноническому JSON
// значения. «+» — есть в `to`, нет в `from`; «-» — наоборот. Порядок — по
// пути, алфавит.
export function diffDocuments(from: unknown, to: unknown): DiffRow[] {
  const a = flatten(from);
  const b = flatten(to);
  const rows: DiffRow[] = [];
  for (const [path, after] of b) {
    if (!a.has(path)) rows.push({op: '+', path, after});
    else if (JSON.stringify(sortDeep(a.get(path))) !== JSON.stringify(sortDeep(after))) {
      rows.push({op: '~', path, before: a.get(path), after});
    }
  }
  for (const [path, before] of a) {
    if (!b.has(path)) rows.push({op: '-', path, before});
  }
  return rows.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
}

export function diffSummary(rows: DiffRow[]): {added: number; changed: number; removed: number} {
  return {
    added: rows.filter((r) => r.op === '+').length,
    changed: rows.filter((r) => r.op === '~').length,
    removed: rows.filter((r) => r.op === '-').length,
  };
}

export function summaryText(rows: DiffRow[]): string {
  const s = diffSummary(rows);
  return `Добавлено ${s.added} · Изменено ${s.changed} · Удалено ${s.removed}`;
}

export function formatValue(v: unknown): string {
  if (v === undefined) return '—';
  if (Array.isArray(v)) return v.length === 0 ? '[]' : v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(', ');
  if (isObject(v)) return Object.keys(v).length === 0 ? '{}' : JSON.stringify(v);
  if (typeof v === 'string') return v;
  return String(v);
}

export const DIFF_SIGNS: Record<DiffOp, string> = {'+': '+', '~': '~', '-': '−'};

// Строка предпросмотра в диалоге активации: «~ путь: было → стало».
export function previewLine(row: DiffRow): string {
  const sign = DIFF_SIGNS[row.op];
  if (row.op === '+') return `${sign} ${row.path}: ${formatValue(row.after)}`;
  if (row.op === '-') return `${sign} ${row.path}: ${formatValue(row.before)}`;
  return `${sign} ${row.path}: ${formatValue(row.before)} → ${formatValue(row.after)}`;
}

export const PREVIEW_LIMIT = 6;

export function activationPreview(rows: DiffRow[]): {lines: string[]; more: number} {
  return {lines: rows.slice(0, PREVIEW_LIMIT).map(previewLine), more: Math.max(0, rows.length - PREVIEW_LIMIT)};
}

// ── активация и тосты ───────────────────────────────────────────────────────

export function activationFirstLine(draft: number, active: number | null): string {
  return active === null
    ? `Активной версии сейчас нет: версия ${draft} станет первой активной.`
    : `Версия ${draft} станет активной, версия ${active} — снятой.`;
}

export const ACTIVATION_RUNS_LINE =
  'Идущие прогоны остаются на своей версии настройки, новые захваты этапов берут';

export function activationToast(version: number, retired: number | null | undefined): string {
  return retired === null || retired === undefined
    ? `Версия ${version} активна`
    : `Версия ${version} активна, версия ${retired} снята`;
}

// ── JSON ────────────────────────────────────────────────────────────────────

export type JsonParse =
  | {ok: true; doc: Doc}
  | {ok: false; title: string; detail: string; line?: number; column?: number};

export function locate(text: string, position: number): {line: number; column: number} {
  const head = text.slice(0, Math.max(0, position));
  const lines = head.split('\n');
  return {line: lines.length, column: lines[lines.length - 1].length + 1};
}

// Сообщение разборщика без вырезки из текста: в ней может оказаться то, что
// человек набрал (в том числе значение, похожее на секрет), а выводить его
// нельзя (AC-7). Остаётся «Unexpected token '}'» и позиция.
export function parserMessage(message: string): string {
  return message
    .split(/,\s*(?:\.\.\.)?"/)[0]
    .replace(/\s+is not valid JSON.*$/, '')
    .replace(/\s*\(line \d+ column \d+\)/, '')
    .trim();
}

export function parseJsonDocument(text: string): JsonParse {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    let line: number | undefined;
    let column: number | undefined;
    const lc = /line (\d+) column (\d+)/.exec(message);
    const pos = /position (\d+)/.exec(message);
    if (lc) {
      line = Number(lc[1]);
      column = Number(lc[2]);
    } else if (pos) {
      ({line, column} = locate(text, Number(pos[1])));
    }
    return {
      ok: false,
      title: 'JSON не разбирается',
      detail: parserMessage(message) + (line ? `. Строка ${line}, столбец ${column}` : ''),
      line,
      column,
    };
  }
  if (!isObject(value)) {
    return {ok: false, title: 'JSON не разбирается', detail: 'Документ — это JSON-объект {…}'};
  }
  return {ok: true, doc: value};
}

// ── тела запросов ───────────────────────────────────────────────────────────

export type CreateFrom = 'active' | 'empty';

export function createBody(from: CreateFrom, changelog: string): {from: CreateFrom; changelog?: string} {
  const text = changelog.trim();
  return text === '' ? {from} : {from, changelog};
}

export function putBody(doc: unknown, changelog: string): {document: unknown; changelog: string} {
  return {document: doc, changelog};
}

export function changelogOf(view: {changelog: string | null} | undefined): string {
  return view?.changelog ?? '';
}
