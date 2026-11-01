// Документы версии роли (CLAB-347, решение 0068): нормализация ответа,
// дифф двух версий по документам, черновик формы «Новая версия» и разбор
// отказа сервера. Без React и без ключей статусов и ролей — проверяется без
// браузера в e2e/role-docs.mjs. На этом модуле стоит и отбор документов на
// статусе (CLAB-348): публичные имена ниже — контракт, их не переименовывать.
//
// Серверные правила (форма имени, пределы, список типов) здесь не
// повторяются: решает сервер, его сообщение показывается дословно. Модуль
// делает только то, чего сервер знать не может, — сравнивает версии, считает
// правки формы и находит документ, названный в отказе.
import type {ModelLevel, OutputContractItem, RoleDocument, RoleDocumentPin, RoleVersion} from '../../api/types';

// ── нормализация ─────────────────────────────────────────────────────────────

// Имя и тип единственного документа версии, заведённой строкой instructions
// (и ответа прежнего backend без documents).
export const MAIN_DOCUMENT = 'main.md';
export const DEFAULT_DOCUMENT_KIND = 'instructions';
// Типы на выбор в форме. Список не закрыт: тип существующего документа не из
// них показывается и сохраняется как есть.
export const STANDARD_DOCUMENT_KINDS = ['instructions', 'checklist', 'reference'] as const;

// Документы версии по position. Ответ без ключа documents (прежний backend)
// — ровно один main.md с instructions и без sha256; documents: [] — пустой
// список. content не придумывается: в списке версий его нет.
export function versionDocuments(v: {documents?: RoleDocument[] | null; instructions?: string}): RoleDocument[] {
  if (v.documents === undefined || v.documents === null) {
    return [{name: MAIN_DOCUMENT, kind: DEFAULT_DOCUMENT_KIND, position: 0, content: v.instructions ?? ''}];
  }
  return [...v.documents].map((d, i) => ({...d, position: d.position ?? i})).sort((a, b) => a.position - b.position);
}

// Версия с documents, заполненными всегда (так её отдаёт api/client.ts).
export function normalizeRoleVersion<T extends RoleVersion>(v: T): T {
  return {...v, documents: versionDocuments(v)};
}

// У всех документов есть текст: версию можно показывать и сравнивать без
// подгрузки GET …/versions/:n.
export function hasContent(docs: RoleDocument[]): boolean {
  return docs.every((d) => d.content !== undefined);
}

export const shortSha = (sha?: string) => (sha ? sha.slice(0, 7) : '');

// ── построчный дифф ──────────────────────────────────────────────────────────

export type DiffOp = ' ' | '+' | '-';
export interface DiffLine {
  op: DiffOp;
  text: string;
}

// Предел ячеек таблицы построчного сравнения после среза общих начала и
// конца: больше — только счётчики и признак «слишком велик».
export const LINE_DIFF_CELL_LIMIT = 4_000_000;

export interface LineDiff {
  // Нет у слишком большого документа.
  lines?: DiffLine[];
  plus: number;
  minus: number;
  tooBig: boolean;
}

// Строки текста: перевод строки в конце строкой не считается.
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function lineDiff(before: string, after: string, limit = LINE_DIFF_CELL_LIMIT): LineDiff {
  const x = splitLines(before);
  const y = splitLines(after);
  let head = 0;
  while (head < x.length && head < y.length && x[head] === y[head]) head++;
  let tail = 0;
  while (tail < x.length - head && tail < y.length - head && x[x.length - 1 - tail] === y[y.length - 1 - tail]) tail++;
  const mx = x.slice(head, x.length - tail);
  const my = y.slice(head, y.length - tail);
  if (mx.length * my.length > limit) return {plus: my.length, minus: mx.length, tooBig: true};

  const m = mx.length;
  const n = my.length;
  // Наибольшая общая подпоследовательность строк середины.
  const w = n + 1;
  const dp = new Uint32Array((m + 1) * w);
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i * w + j] = mx[i] === my[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const lines: DiffLine[] = x.slice(0, head).map((text) => ({op: ' ', text}));
  let i = 0;
  let j = 0;
  let plus = 0;
  let minus = 0;
  while (i < m && j < n) {
    if (mx[i] === my[j]) {
      lines.push({op: ' ', text: mx[i]});
      i++;
      j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
      lines.push({op: '-', text: mx[i++]});
      minus++;
    } else {
      lines.push({op: '+', text: my[j++]});
      plus++;
    }
  }
  while (i < m) {
    lines.push({op: '-', text: mx[i++]});
    minus++;
  }
  while (j < n) {
    lines.push({op: '+', text: my[j++]});
    plus++;
  }
  for (const text of x.slice(x.length - tail)) lines.push({op: ' ', text});
  return {lines, plus, minus, tooBig: false};
}

// ── дифф версий по документам ────────────────────────────────────────────────

export type DocChange = 'changed' | 'added' | 'removed' | 'same';
export const DOC_CHANGES: readonly DocChange[] = ['changed', 'added', 'removed', 'same'];

export const DOC_CHANGE_LABEL: Record<DocChange, string> = {
  changed: 'изменён',
  added: 'добавлен',
  removed: 'убран',
  same: 'без изменений',
};

export interface DocDiff {
  name: string;
  change: DocChange;
  // Тип в новой версии (у убранного — в прежней).
  kind: string;
  plus: number;
  minus: number;
  // Построчно; нет у same и у слишком большого документа.
  lines?: DiffLine[];
  tooBig: boolean;
  // Отметки same: тип сменился; документ сдвинулся относительно остальных.
  kindChange?: {from: string; to: string};
  moved: boolean;
  // Привязка к библиотеке изменилась (CLAB-351): документ закреплён,
  // перезакреплён или отвязан. Привязка — не текст: сводку не меняет.
  pinChange?: {from?: RoleDocumentPin; to?: RoleDocumentPin};
}

export const samePin = (a?: RoleDocumentPin, b?: RoleDocumentPin) =>
  (a?.key ?? '') === (b?.key ?? '') && (a?.version ?? 0) === (b?.version ?? 0);

// Подпись смены привязки в диффе версий роли.
export function pinChangeLabel(c: {from?: RoleDocumentPin; to?: RoleDocumentPin}): string {
  if (c.from && c.to && c.from.key === c.to.key) return `библиотека: ${c.to.key} v${c.from.version} → v${c.to.version}`;
  if (c.to) return `закреплён: ${c.to.key} v${c.to.version}`;
  return `отвязан от ${c.from?.key} v${c.from?.version}`;
}

export interface VersionDiff {
  docs: DocDiff[];
  counts: Record<DocChange, number>;
  // Ни один документ не изменён, не добавлен, не убран и не помечен.
  unchanged: boolean;
}

export interface DiffOptions {
  // Смена типа — правка (так считает форма, AC-347.5); по умолчанию — только
  // отметка у same (дифф версий, AC-347.3).
  kindIsChange?: boolean;
  limit?: number;
}

function sameBytes(a: RoleDocument, b: RoleDocument): boolean {
  if (a.sha256 && b.sha256) return a.sha256 === b.sha256;
  return (a.content ?? '') === (b.content ?? '');
}

// Документы, оставшиеся на месте: наибольшая возрастающая подпоследовательность
// прежних позиций общих документов в новом порядке. Остальные — «переставлен».
function staying(common: string[], prevOrder: Map<string, number>): Set<string> {
  const seq = common.map((name) => prevOrder.get(name) ?? 0);
  const best = seq.map(() => 1);
  const from = seq.map(() => -1);
  for (let i = 0; i < seq.length; i++) {
    for (let j = 0; j < i; j++) {
      if (seq[j] < seq[i] && best[j] + 1 > best[i]) {
        best[i] = best[j] + 1;
        from[i] = j;
      }
    }
  }
  const stay = new Set<string>();
  let end = -1;
  // При равной длине — подпоследовательность, кончающаяся позже: обмен
  // соседей помечает поднятый документ, а не опущенный.
  for (let i = 0; i < best.length; i++) if (end < 0 || best[i] >= best[end]) end = i;
  while (end >= 0) {
    stay.add(common[end]);
    end = from[end];
  }
  return stay;
}

// Сравнение по именам: только в новой — added, только в прежней — removed, в
// обеих с теми же байтами — same, иначе changed. Переименование — removed +
// added. Порядок: changed, added, removed, same; внутри — порядок документов
// (у убранных — прежней версии).
export function diffVersions(prev: RoleDocument[], next: RoleDocument[], options: DiffOptions = {}): VersionDiff {
  const before = new Map<string, RoleDocument>();
  const prevOrder = new Map<string, number>();
  prev.forEach((d, i) => {
    if (before.has(d.name)) return;
    before.set(d.name, d);
    prevOrder.set(d.name, i);
  });
  const nextNames = new Set(next.map((d) => d.name));
  const common = next.filter((d) => before.has(d.name)).map((d) => d.name);
  const stay = staying(common, prevOrder);

  const docs: DocDiff[] = [];
  for (const d of next) {
    const p = before.get(d.name);
    if (!p) {
      const n = splitLines(d.content ?? '');
      docs.push({
        name: d.name,
        change: 'added',
        kind: d.kind,
        plus: n.length,
        minus: 0,
        lines: n.map((text) => ({op: '+', text})),
        tooBig: false,
        moved: false,
      });
      continue;
    }
    const kindChange = p.kind !== d.kind ? {from: p.kind, to: d.kind} : undefined;
    const pinChange = samePin(p.instruction, d.instruction) ? undefined : {from: p.instruction, to: d.instruction};
    if (sameBytes(p, d) && !(options.kindIsChange && kindChange)) {
      docs.push({name: d.name, change: 'same', kind: d.kind, plus: 0, minus: 0, tooBig: false, kindChange, moved: !stay.has(d.name), pinChange});
      continue;
    }
    const r = lineDiff(p.content ?? '', d.content ?? '', options.limit);
    docs.push({name: d.name, change: 'changed', kind: d.kind, ...r, kindChange, moved: false, pinChange});
  }
  for (const p of prev) {
    if (nextNames.has(p.name)) continue;
    const n = splitLines(p.content ?? '');
    docs.push({
      name: p.name,
      change: 'removed',
      kind: p.kind,
      plus: 0,
      minus: n.length,
      lines: n.map((text) => ({op: '-', text})),
      tooBig: false,
      moved: false,
    });
  }
  const rank = (c: DocChange) => DOC_CHANGES.indexOf(c);
  const sorted = docs.map((d, i) => ({d, i})).sort((a, b) => rank(a.d.change) - rank(b.d.change) || a.i - b.i).map((x) => x.d);
  const counts = {changed: 0, added: 0, removed: 0, same: 0};
  for (const d of sorted) counts[d.change]++;
  const unchanged =
    counts.changed + counts.added + counts.removed === 0 && sorted.every((d) => !d.kindChange && !d.moved && !d.pinChange);
  return {docs: sorted, counts, unchanged};
}

// «изменён N · добавлен N · убран N · без изменений N» — нули не скрываются.
export function diffSummary(counts: Record<DocChange, number>): string {
  return DOC_CHANGES.map((c) => `${DOC_CHANGE_LABEL[c]} ${counts[c]}`).join(' · ');
}

export const kindChangeLabel = (k: {from: string; to: string}) => `тип: ${k.from} → ${k.to}`;
export const MOVED_LABEL = 'переставлен';

// ── свёртка неизменённых кусков ──────────────────────────────────────────────

// Неизменённый кусок длиннее этого сворачивается — и между правками, и на
// краю документа.
export const FOLD_KEEP = 4;
// Свёрнутое раскрывается порциями: одно нажатие не должно вешать вкладку.
export const FOLD_CHUNK = 200;

export type DiffRow = {type: 'line'; line: DiffLine} | {type: 'fold'; lines: DiffLine[]};

export function foldLines(lines: DiffLine[], keep = FOLD_KEEP): DiffRow[] {
  const out: DiffRow[] = [];
  let run: DiffLine[] = [];
  const flush = () => {
    if (run.length > keep) out.push({type: 'fold', lines: run});
    else for (const line of run) out.push({type: 'line', line});
    run = [];
  };
  for (const line of lines) {
    if (line.op === ' ') run.push(line);
    else {
      flush();
      out.push({type: 'line', line});
    }
  }
  flush();
  return out;
}

const numberFormat = new Intl.NumberFormat('ru-RU');
export const formatCount = (n: number) => numberFormat.format(n);

export function linesWord(n: number): string {
  const d10 = n % 10;
  const d100 = n % 100;
  if (d10 === 1 && d100 !== 11) return 'строка';
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return 'строки';
  return 'строк';
}

// Подпись свёрнутого остатка: больше порции — «показать ещё 200».
export function foldLabel(left: number, chunk = FOLD_CHUNK): string {
  const tail = left > chunk ? `показать ещё ${chunk}` : 'показать';
  return `⋯ ${formatCount(left)} ${linesWord(left)} без изменений — ${tail}`;
}

// ── черновик формы ───────────────────────────────────────────────────────────

// Документ формы. base — тот же документ в версии, на которой построена
// форма; у добавленного его нет. Убранный остаётся строкой до сохранения.
export interface DraftDoc {
  id: number;
  name: string;
  kind: string;
  content: string;
  base?: {name: string; kind: string; content: string; pin?: RoleDocumentPin};
  removed?: boolean;
  // Закреплён за версией инструкции (CLAB-351): только читается и уходит
  // ссылкой. wasPin — снято «Отвязать»: можно вернуть до сохранения.
  pin?: RoleDocumentPin;
  wasPin?: RoleDocumentPin;
  // Текст и тип версии инструкции на момент «Отвязать»: «Вернуть
  // закрепление» возвращает их без похода в сеть.
  wasText?: {content: string; kind: string};
}

export type DraftMark = 'same' | 'changed' | 'added' | 'removed' | 'renamed';

export interface RoleDraft {
  docs: DraftDoc[];
  changelog: string;
  inputKinds: string;
  contract: OutputContractItem[];
  modelLevel: ModelLevel | null;
}

let nextDraftId = 1;
const draftId = () => nextDraftId++;

export function draftFromVersion(v?: RoleVersion): RoleDraft {
  if (!v) return newRoleDraft();
  return {
    docs: versionDocuments(v).map((d) => {
      const content = d.content ?? '';
      return {
        id: draftId(),
        name: d.name,
        kind: d.kind,
        content,
        base: {name: d.name, kind: d.kind, content, pin: d.instruction},
        pin: d.instruction,
      };
    }),
    changelog: '',
    inputKinds: (v.input_kinds ?? []).join(', '),
    contract: v.output_contract ?? [],
    modelLevel: v.model_level ?? null,
  };
}

// Первая версия новой роли: один пустой main.md.
export function newRoleDraft(): RoleDraft {
  return {
    docs: [{id: draftId(), name: MAIN_DOCUMENT, kind: DEFAULT_DOCUMENT_KIND, content: ''}],
    changelog: '',
    inputKinds: '',
    contract: [],
    modelLevel: null,
  };
}

export function draftMark(d: DraftDoc): DraftMark {
  if (d.removed) return 'removed';
  if (!d.base) return 'added';
  if (d.name !== d.base.name) return 'renamed';
  return d.content !== d.base.content || d.kind !== d.base.kind || !samePin(d.pin, d.base.pin) ? 'changed' : 'same';
}

// То, что уйдёт в запрос: строки по порядку без убранных.
export const sentDocs = (docs: DraftDoc[]) => docs.filter((d) => !d.removed);

// Номер строки — номер документа среди отправляемых, как в сообщениях
// сервера; у убранной — «–».
export function rowNumbers(docs: DraftDoc[]): string[] {
  let n = 0;
  return docs.map((d) => (d.removed ? '–' : String(++n)));
}

export interface DraftCounts {
  changed: number;
  added: number;
  removed: number;
}

// Счётчик формы — сводка диффа между документами базы и тем, что будет
// отправлено; смена типа здесь правка. Переименование — убран + добавлен.
export function draftCounts(docs: DraftDoc[]): DraftCounts {
  const base: RoleDocument[] = docs
    .filter((d) => d.base)
    .map((d, i) => ({name: d.base!.name, kind: d.base!.kind, content: d.base!.content, position: i}));
  const next: RoleDocument[] = sentDocs(docs).map((d, i) => ({name: d.name, kind: d.kind, content: d.content, position: i}));
  // Только счёт: построчный дифф здесь не нужен, предел ноль его не строит.
  const {counts} = diffVersions(base, next, {kindIsChange: true, limit: 0});
  // Смена привязки при тех же байтах — тоже правка документа (CLAB-351).
  const pinOnly = sentDocs(docs).filter(
    (d) => d.base && d.name === d.base.name && d.content === d.base.content && d.kind === d.base.kind && !samePin(d.pin, d.base.pin),
  ).length;
  return {changed: counts.changed + pinOnly, added: counts.added, removed: counts.removed};
}

// Закреплённых документов среди отправляемых: «из библиотеки N».
export const pinnedCount = (docs: DraftDoc[]) => sentDocs(docs).filter((d) => d.pin).length;

export const countsLabel = (c: DraftCounts, pinned = 0) =>
  `Изменено ${c.changed} · добавлено ${c.added} · убрано ${c.removed}${pinned ? ` · из библиотеки ${pinned}` : ''}`;

// Документ из библиотеки в форму: имя <ключ>.md, тип и текст версии.
export function addPinnedDoc(docs: DraftDoc[], pin: RoleDocumentPin, kind: string, content: string): {docs: DraftDoc[]; id: number} {
  const id = draftId();
  return {docs: [...docs, {id, name: `${pin.key}.md`, kind, content, pin}], id};
}

// «Отвязать»: документ становится обычным, привязку можно вернуть до
// сохранения.
export function unpinDoc(docs: DraftDoc[], id: number): DraftDoc[] {
  return docs.map((d) =>
    d.id === id && d.pin ? {...d, wasPin: d.pin, wasText: {content: d.content, kind: d.kind}, pin: undefined} : d,
  );
}

// Текст отвязанного документа правили: возврат закрепления их сотрёт.
export const repinNeedsConfirm = (d: DraftDoc) =>
  Boolean(d.wasText) && (d.content !== d.wasText!.content || d.kind !== d.wasText!.kind || d.name !== `${d.wasPin?.key}.md`);

// «Вернуть закрепление»: текст, тип и имя снова — версии инструкции.
export function repinDoc(docs: DraftDoc[], id: number): DraftDoc[] {
  return docs.map((d) =>
    d.id === id && d.wasPin && d.wasText
      ? {...d, pin: d.wasPin, wasPin: undefined, wasText: undefined, content: d.wasText.content, kind: d.wasText.kind, name: `${d.wasPin.key}.md`}
      : d,
  );
}

export function editDoc(docs: DraftDoc[], id: number, patch: Partial<Pick<DraftDoc, 'name' | 'kind' | 'content'>>): DraftDoc[] {
  return docs.map((d) => (d.id === id ? {...d, ...patch} : d));
}

// Имя нового документа по умолчанию: new-N.md, не занятое в форме.
export function defaultDocName(docs: DraftDoc[]): string {
  const names = new Set(docs.map((d) => d.name));
  let n = 1;
  while (names.has(`new-${n}.md`)) n++;
  return `new-${n}.md`;
}

export function addDoc(docs: DraftDoc[]): {docs: DraftDoc[]; id: number} {
  const id = draftId();
  return {docs: [...docs, {id, name: defaultDocName(docs), kind: DEFAULT_DOCUMENT_KIND, content: ''}], id};
}

// Документ из версии — помечается убранным и остаётся строкой; добавленный
// до сохранения — исчезает (возвращаться ему некуда).
export function removeDoc(docs: DraftDoc[], id: number): DraftDoc[] {
  const d = docs.find((x) => x.id === id);
  if (!d) return docs;
  if (!d.base) return docs.filter((x) => x.id !== id);
  return docs.map((x) => (x.id === id ? {...x, removed: true} : x));
}

// Убирание требует подтверждения: новый документ с текстом пропадёт насовсем.
export const removalNeedsConfirm = (d: DraftDoc) => !d.base && d.content.trim() !== '';

export function restoreDoc(docs: DraftDoc[], id: number): DraftDoc[] {
  return docs.map((x) => (x.id === id ? {...x, removed: false} : x));
}

// Поднять (-1) или опустить (+1) среди неубранных; на краю — без эффекта.
export function moveDoc(docs: DraftDoc[], id: number, dir: -1 | 1): DraftDoc[] {
  const i = docs.findIndex((d) => d.id === id);
  if (i < 0 || docs[i].removed) return docs;
  let j = i + dir;
  while (j >= 0 && j < docs.length && docs[j].removed) j += dir;
  if (j < 0 || j >= docs.length) return docs;
  const next = [...docs];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

// Можно ли поднять/опустить строку: есть ли неубранный сосед в эту сторону.
export function canMove(docs: DraftDoc[], id: number, dir: -1 | 1): boolean {
  return moveDoc(docs, id, dir) !== docs;
}

// Соседняя строка после исчезновения добавленного документа.
export function neighbourAfterRemoval(before: DraftDoc[], after: DraftDoc[], id: number): number | undefined {
  const idx = before.findIndex((d) => d.id === id);
  const live = after.filter((d) => !d.removed);
  const pick = after[Math.min(Math.max(0, idx - 1), after.length - 1)];
  return (pick && !pick.removed ? pick : live[0] ?? after[0])?.id;
}

// Типы на выбор: тип базового документа не из стандартных — первым.
export function kindOptions(d: DraftDoc): string[] {
  const std = [...STANDARD_DOCUMENT_KINDS] as string[];
  const extra = [d.base?.kind, d.kind].filter((k): k is string => Boolean(k) && !std.includes(k as string));
  return [...new Set(extra), ...std];
}

// Тип существующего документа не из стандартных: форма его не теряет.
export const customBaseKind = (d: DraftDoc) =>
  d.base && !(STANDARD_DOCUMENT_KINDS as readonly string[]).includes(d.base.kind) ? d.base.kind : undefined;

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

// Тело POST …/versions (и version у POST …/roles): документы в порядке строк
// без убранных, без instructions; прочее базовой версии — как было.
export function versionBody(draft: RoleDraft, base?: RoleVersion): Record<string, unknown> {
  const body: Record<string, unknown> = {
    // Закреплённый уходит ссылкой, без текста (решение 0069); отвязанный —
    // содержимым с unpin: иначе сервер перенёс бы закрепление по тому же
    // тексту.
    documents: sentDocs(draft.docs).map((d) =>
      d.pin
        ? {instruction: {key: d.pin.key, version: d.pin.version}}
        : {name: d.name, kind: d.kind, content: d.content, ...(d.wasPin || d.base?.pin ? {unpin: true} : {})},
    ),
    input_kinds: splitList(draft.inputKinds),
    output_contract: draft.contract,
    tool_policy: base?.tool_policy ?? {},
    repo_scope: base?.repo_scope ?? [],
    context_budget: base?.context_budget ?? {},
  };
  if (draft.changelog.trim()) body.changelog = draft.changelog;
  // model_hint устарел (решение 0060) и на экране не правится: значение базы
  // уходит как было.
  if (base?.model_hint !== undefined) body.model_hint = base.model_hint;
  // «Авто» — версия без уровня: ключа нет.
  if (draft.modelLevel) body.model_level = draft.modelLevel;
  return body;
}

// ── отказ сервера ────────────────────────────────────────────────────────────

// «документ N ("имя"): …» → индекс среди отправленных документов; сообщение
// без такого начала или номер вне диапазона — undefined.
export function failedDocumentIndex(message: string, sentCount: number): number | undefined {
  const m = /^документ (\d+)(?=[\s:(]|$)/.exec(message.trim());
  if (!m) return undefined;
  const i = Number(m[1]) - 1;
  return Number.isInteger(i) && i >= 0 && i < sentCount ? i : undefined;
}

// Документ формы, названный в отказе.
export function failedDocumentId(message: string, docs: DraftDoc[]): number | undefined {
  const sent = sentDocs(docs);
  const i = failedDocumentIndex(message, sent.length);
  return i === undefined ? undefined : sent[i].id;
}
