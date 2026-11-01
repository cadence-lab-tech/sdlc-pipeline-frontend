// Отбор документов роли на статусе цикла (CLAB-348, решение 0068, п. 3):
// что получит этап, подписи панели статуса и состояние поля «Документы роли
// на этом этапе» в диалоге статуса. Без React и без ключей статусов и ролей —
// проверяется без браузера в e2e/status-docs.mjs.
//
// Правило выбора повторяет серверное (internal/workflow/statusdocs.go): без
// отбора — все документы; с отбором — названные, в порядке версии роли (порядок
// отбора ничего не значит); имя, которого нет в версии, — пропущено и помечено;
// не нашлось ни одного — все документы. Сравнение идёт с последней версией
// роли: так же сверяет проверка черновика (role_document_missing). Захват
// сверяет с версией прогона — экран показывает ожидание, а не историю.
//
// Форму отбора (пусто, повтор, предел) проверяет сервер, его отказ
// показывается дословно; здесь только то, чего сервер не знает: что выбрано
// на экране и что из этого отправить.
import type {RoleDocument, RoleVersion, Status} from '../../api/types';
import {versionDocuments} from './roleDocs';

// ── что получит этап ─────────────────────────────────────────────────────────

export interface StageDocuments {
  // Документы этапа в порядке версии.
  documents: RoleDocument[];
  // Документов в версии роли.
  total: number;
  // Отбор есть (document_names у строки роли статуса).
  selected: boolean;
  // Имена отбора, которых нет в версии, — в порядке отбора.
  missing: string[];
  // Отбор есть, но ни одно имя не нашлось: этап получит все документы.
  fallback: boolean;
}

// Документы этапа по версии роли и отбору строки статуса. Версия без ключа
// documents (прежний backend) — один main.md, как в roleDocs.
export function stageDocuments(
  version: Pick<RoleVersion, 'documents' | 'instructions'>,
  names?: string[] | null,
): StageDocuments {
  const docs = versionDocuments(version);
  if (!names || names.length === 0) {
    return {documents: docs, total: docs.length, selected: false, missing: [], fallback: false};
  }
  const have = new Set(docs.map((d) => d.name));
  const missing = names.filter((n) => !have.has(n));
  if (missing.length === names.length) {
    return {documents: docs, total: docs.length, selected: true, missing, fallback: true};
  }
  const want = new Set(names);
  return {
    documents: docs.filter((d) => want.has(d.name)),
    total: docs.length,
    selected: true,
    missing,
    fallback: false,
  };
}

// «Документов N» без отбора (и при откате на все), «Документов N из M» при
// отборе.
export function documentsCountLabel(s: StageDocuments): string {
  if (!s.selected || s.fallback) return `Документов ${s.documents.length}`;
  return `Документов ${s.documents.length} из ${s.total}`;
}

export const SELECTION_PREFIX = 'Отбор:';
export const MISSING_MARK = 'нет в версии роли';
export const FALLBACK_NOTE = 'ни один документ отбора не найден в версии роли — этап получит все';

export interface SelectionItem {
  name: string;
  missing: boolean;
}

// Строка «Отбор: …» панели статуса: имена отбора в том порядке, в каком их
// получит этап (порядок версии), отсутствующие — в конце, помеченными. Без
// отбора — null: строки нет.
export function selectionItems(names: string[] | null | undefined, s: StageDocuments): SelectionItem[] | null {
  if (!names || names.length === 0) return null;
  const present = s.fallback ? [] : s.documents.map((d) => ({name: d.name, missing: false}));
  return [...present, ...s.missing.map((name) => ({name, missing: true}))];
}

// Та же строка текстом: «Отбор: a.md, b.md, gone.md (нет в версии роли)».
export function selectionLine(names: string[] | null | undefined, s: StageDocuments): string | null {
  const items = selectionItems(names, s);
  if (!items) return null;
  const list = items.map((i) => (i.missing ? `${i.name} (${MISSING_MARK})` : i.name)).join(', ');
  return `${SELECTION_PREFIX} ${list}`;
}

// ── поле в диалоге статуса ──────────────────────────────────────────────────

export type SelectionMode = 'all' | 'picked';
export const MODE_LABEL: Record<SelectionMode, string> = {all: 'Все', picked: 'Выбранные'};
export const FIELD_LABEL = 'Документы роли на этом этапе';
export const EMPTY_PICK_HINT = 'Отметьте хотя бы один документ или оставьте «Все»';

export interface Selection {
  mode: SelectionMode;
  // Отмеченные имена; порядок значения не имеет.
  names: string[];
}

export const ALL: Selection = {mode: 'all', names: []};

// Отбор из сохранённой строки роли статуса.
export const selectionOf = (names?: string[] | null): Selection =>
  names && names.length > 0 ? {mode: 'picked', names: [...names]} : ALL;

// Отборы ролей статуса: исполнитель отдельно, проверяющие по ключу роли.
// Строка исполнителя и строка проверяющего — разные строки status_roles,
// поэтому и отборы у них разные.
export interface StatusSelections {
  primary: Selection;
  checkers: Record<string, Selection>;
}

export function selectionsFromStatus(status?: Pick<Status, 'roles'>): StatusSelections {
  const roles = status?.roles ?? [];
  const primary = roles.find((r) => r.is_primary);
  const checkers: Record<string, Selection> = {};
  for (const r of roles) if (!r.is_primary) checkers[r.role_key] = selectionOf(r.document_names);
  return {primary: selectionOf(primary?.document_names), checkers};
}

export interface PickOption {
  name: string;
  // Документа нет в последней версии роли: его можно только снять.
  missing: boolean;
  checked: boolean;
}

// Список на выбор: документы последней версии по порядку, затем имена из
// отбора, которых в версии нет, — помеченными. Версия не загрузилась — только
// отмеченные имена, без пометок: проверить их не по чему.
export function pickOptions(docs: RoleDocument[] | undefined, sel: Selection): PickOption[] {
  const checked = new Set(sel.names);
  if (!docs) return sel.names.map((name) => ({name, missing: false, checked: true}));
  const have = new Set(docs.map((d) => d.name));
  return [
    ...docs.map((d) => ({name: d.name, missing: false, checked: checked.has(d.name)})),
    ...sel.names.filter((n) => !have.has(n)).map((name) => ({name, missing: true, checked: true})),
  ];
}

// Отметить или снять имя.
export function toggleName(sel: Selection, name: string): Selection {
  const names = sel.names.includes(name) ? sel.names.filter((n) => n !== name) : [...sel.names, name];
  return {...sel, names};
}

// Переключить «Все / Выбранные». Отмеченное помнится, пока диалог открыт:
// случайный клик по «Все» не стирает выбор.
export const withMode = (sel: Selection, mode: SelectionMode): Selection => ({...sel, mode});

// «Выбранные» без отметок сохранить нельзя: пустой отбор сервер не примет, а
// «все» выражается режимом «Все».
export const isEmptyPick = (sel: Selection) => sel.mode === 'picked' && sel.names.length === 0;

// document_names для тела запроса: только у роли в режиме «Выбранные»; имена
// версии — в её порядке, отсутствующие — следом, в порядке отбора. Без
// версии — как отмечены.
export function documentNames(sel: Selection, docs?: RoleDocument[]): string[] | undefined {
  if (sel.mode !== 'picked' || sel.names.length === 0) return undefined;
  if (!docs) return [...sel.names];
  const picked = new Set(sel.names);
  const have = new Set(docs.map((d) => d.name));
  return [...docs.filter((d) => picked.has(d.name)).map((d) => d.name), ...sel.names.filter((n) => !have.has(n))];
}

export interface StatusRoleBody {
  role: string;
  is_primary: boolean;
  position: number;
  document_names?: string[];
}

// Тело PUT …/statuses/:key/roles. Запрос описывает набор целиком: роль без
// document_names теряет отбор, поэтому отбор неизменённых ролей уходит снова.
// Проверяющий, совпавший с исполнителем, отбрасывается, как и раньше.
export function rolesBody(
  primary: string,
  checkers: string[],
  sel: StatusSelections,
  docsOf: (roleKey: string) => RoleDocument[] | undefined = () => undefined,
): StatusRoleBody[] {
  const withNames = (b: Omit<StatusRoleBody, 'document_names'>, s: Selection | undefined): StatusRoleBody => {
    const names = s ? documentNames(s, docsOf(b.role)) : undefined;
    return names ? {...b, document_names: names} : b;
  };
  return [
    ...(primary ? [withNames({role: primary, is_primary: true, position: 0}, sel.primary)] : []),
    ...checkers
      .filter((r) => r !== primary)
      .map((role, i) => withNames({role, is_primary: false, position: i + 1}, sel.checkers[role])),
  ];
}

// Смена исполнителя сбрасывает его отбор: имена прежней роли к новой не
// относятся. Проверяющие, которых убрали, теряют отбор; новые — «Все».
export function changePrimary(sel: StatusSelections, before: string, after: string): StatusSelections {
  return before === after ? sel : {...sel, primary: ALL};
}

export function changeCheckers(sel: StatusSelections, after: string[]): StatusSelections {
  const checkers: Record<string, Selection> = {};
  for (const k of after) checkers[k] = sel.checkers[k] ?? ALL;
  return {...sel, checkers};
}

// Сохранить нельзя, пока у исполнителя или у кого-то из проверяющих
// «Выбранные» без отметок.
export function blocksSave(primary: string, checkers: string[], sel: StatusSelections): boolean {
  if (primary && isEmptyPick(sel.primary)) return true;
  return checkers.filter((r) => r !== primary).some((r) => isEmptyPick(sel.checkers[r] ?? ALL));
}
