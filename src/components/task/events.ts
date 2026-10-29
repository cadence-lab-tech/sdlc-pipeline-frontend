// Подписи типов событий ленты. Тип события — строка, которую пишет бэкенд
// (константы Event* в internal/domain), а не перечень схемы: словарь живёт
// здесь и обязан терпеть незнакомый ключ — событие, заведённое на бэкенде
// позже, показывается сырым ключом, а не роняет ленту и не пропадает из неё.
const EVENT_LABELS: Record<string, string> = {
  'task.created': 'задача заведена',
  'task.updated': 'постановка поправлена',
  'task.advanced': 'задача ушла дальше',
  'task.rejected': 'задача возвращена назад',
  'task.cancelled': 'задача снята',
  'task.assigned': 'исполнитель назначен',
  'task.linked': 'связь заведена',
  'task.unlinked': 'связь снята',
  'task.scope_updated': 'область задачи изменена',
  'task.workflow_moved': 'переехала на новую версию цикла',
  'stage.entered': 'этап начат',
  'stage.skipped': 'этап пропущен',
  'stage.claimed': 'этап забран',
  'stage.released': 'этап отпущен',
  'lease.extended': 'аренда продлена',
  'lease.expired': 'аренда истекла',
  'artifact.submitted': 'артефакт сдан',
  'gate.decided': 'решение по гейту',
  'gate.failed': 'гейт не пропустил',
  'review.requested': 'перепроверка запрошена',
  'review.completed': 'перепроверка завершена',
  'repo_ref.linked': 'привязан PR, ветка или коммит',
  'drift.detected': 'найдено расхождение',
  'drift.resolved': 'расхождение разобрано',
  'usage.reported': 'отчёт о стоимости',
};

export function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? type;
}

// ── подробности события ─────────────────────────────────────────────────────

// Длинное значение правки (описание задачи) показывается не строкой ленты, а
// по раскрытию: было и стало целиком.
export interface LongChange {
  field: string;
  from: string;
  to: string;
}

export interface EventDetails {
  // Короткая строка под подписью события; пустая — строки нет.
  summary: string;
  long: LongChange[];
}

// Поля правки постановки в порядке показа и их подписи. Незнакомое поле
// (бэкенд научился править что-то ещё) идёт в конце под своим ключом.
const FIELD_LABELS: Record<string, string> = {
  title: 'название',
  priority: 'приоритет',
  labels: 'метки',
  external_ref: 'ссылки на трекер',
  description: 'описание',
  optional_stages: 'этапы',
};

const FIELD_ORDER = Object.keys(FIELD_LABELS);

type Payload = Record<string, unknown>;

function isObject(v: unknown): v is Payload {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Скаляр строкой; пустое, null и составное — undefined: в строке ленты не
// должно появиться «undefined», «null» или «[object Object]».
function text(v: unknown): string | undefined {
  if (typeof v === 'string') return v.trim() ? v : undefined;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

function list(v: unknown): string[] {
  return Array.isArray(v) ? v.map(text).filter((s): s is string => s !== undefined) : [];
}

function quoted(v: unknown): string {
  const s = text(v);
  return s === undefined ? '—' : `«${s}»`;
}

// Ключи статусов и ролей показываются как пришли: их придумывает проект, и
// подписывать их словарём нельзя.
function move(from: unknown, to: unknown): string | undefined {
  const a = text(from);
  const b = text(to);
  if (!a && !b) return undefined;
  return `${a ?? '—'} → ${b ?? '—'}`;
}

function join(parts: (string | undefined | false)[]): string {
  return parts.filter((p): p is string => Boolean(p)).join(' · ');
}

function updated(payload: Payload, priority: (p: string) => string): EventDetails {
  const changed = isObject(payload.changed) ? payload.changed : {};
  const names = [
    ...FIELD_ORDER.filter((f) => f in changed),
    ...Object.keys(changed).filter((f) => !FIELD_ORDER.includes(f)).sort(),
  ];
  const parts: string[] = [];
  const long: LongChange[] = [];
  for (const name of names) {
    const change = isObject(changed[name]) ? changed[name] : {};
    const label = FIELD_LABELS[name] ?? name;
    switch (name) {
      case 'title':
        parts.push(`${label}: ${quoted(change.from)} → ${quoted(change.to)}`);
        break;
      case 'priority': {
        const p = (v: unknown) => {
          const s = text(v);
          return s === undefined ? '—' : priority(s);
        };
        parts.push(`${label}: ${p(change.from)} → ${p(change.to)}`);
        break;
      }
      case 'labels': {
        const before = list(change.from);
        const after = list(change.to);
        const added = after.filter((l) => !before.includes(l));
        const removed = before.filter((l) => !after.includes(l));
        const delta = join([
          added.length > 0 && `+ ${added.join(', ')}`,
          removed.length > 0 && `− ${removed.join(', ')}`,
        ]);
        parts.push(`${label}: ${delta || 'порядок'}`);
        break;
      }
      case 'optional_stages': {
        const delta = stagesDelta(change.from, change.to);
        parts.push(`${label}: ${delta || 'изменены'}`);
        break;
      }
      case 'description':
        parts.push(`${label} изменено`);
        long.push({field: label, from: text(change.from) ?? '', to: text(change.to) ?? ''});
        break;
      default:
        parts.push(`${label} изменено`);
    }
  }
  return {summary: parts.join(' · '), long};
}

// Выбор необязательных этапов (решение 0066): payload несёт полные наборы
// «ключ → bool» до и после; в строку идут только изменившиеся ключи —
// «design выкл → вкл». Значение не bool или неполный набор — «—», без
// «undefined» и «[object Object]».
function stagesDelta(from: unknown, to: unknown): string {
  const a = isObject(from) ? from : {};
  const b = isObject(to) ? to : {};
  const state = (v: unknown) => (v === true ? 'вкл' : v === false ? 'выкл' : '—');
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return keys
    .filter((k) => a[k] !== b[k])
    .map((k) => `${k} ${state(a[k])} → ${state(b[k])}`)
    .join(', ');
}

function scope(payload: Payload): string {
  const added = list(payload.added_repositories);
  const removed = list(payload.removed_repositories);
  const multi = payload.multi_repo;
  return join([
    added.length > 0 && `добавлено: ${added.join(', ')}`,
    removed.length > 0 && `убрано: ${removed.join(', ')}`,
    text(payload.primary_repository) && `основной: ${text(payload.primary_repository)}`,
    typeof multi === 'boolean' && `multi_repo: ${multi ? 'да' : 'нет'}`,
    text(payload.note) && `заметка: ${text(payload.note)}`,
  ]);
}

// Исходы гейта, которые переход не держат (GateOutcome.Passed на бэкенде).
const PASSING = ['passed', 'waived', 'skipped'];

function money(v: unknown): string | undefined {
  return typeof v === 'number' ? `${v.toFixed(2)} $` : undefined;
}

// Подробности события из его payload — короткой строкой, без разметки.
// Незнакомый тип, пустой или неполный payload дают пустую строку, а не
// исключение: сырой payload лента всё равно показывает по раскрытию.
// Подпись приоритета передаётся снаружи (priorityLabel): словарь живёт в
// своём модуле, а этот файл проверяется node без сборщика.
export function eventDetails(
  type: string,
  payload: unknown,
  priority: (p: string) => string = (p) => p,
): EventDetails {
  const p: Payload = isObject(payload) ? payload : {};
  const only = (summary: string | undefined): EventDetails => ({summary: summary ?? '', long: []});
  switch (type) {
    case 'task.updated':
      return updated(p, priority);
    case 'task.scope_updated':
      return only(scope(p));
    case 'stage.released':
      return only(text(p.note) && `заметка: ${text(p.note)}`);
    case 'task.advanced':
    case 'task.rejected':
    case 'task.cancelled':
      return only(join([
        text(p.transition),
        move(p.from, p.to),
        list(p.skips).length > 0 && `пропущено: ${list(p.skips).join(', ')}`,
        text(p.comment) && `«${text(p.comment)}»`,
      ]));
    case 'task.created':
      return only(join([
        text(p.type) && `тип ${text(p.type)}`,
        text(p.parent) && `эпик ${text(p.parent)}`,
        list(p.blocks).length > 0 && `блокирует ${list(p.blocks).join(', ')}`,
        text(p.assignee) && `исполнитель ${text(p.assignee)}`,
      ]));
    case 'task.assigned':
      return only(text(p.assignee) ? `исполнитель ${text(p.assignee)}` : 'назначение снято');
    case 'task.linked':
    case 'task.unlinked':
      return only(join([text(p.rel) && text(p.task) && `${text(p.rel)} → ${text(p.task)}`, text(p.note)]));
    case 'task.workflow_moved': {
      const moved = isObject(p.optional_stages) ? stagesDelta(p.optional_stages.from, p.optional_stages.to) : '';
      return only(join([
        text(p.workflow) && `${text(p.workflow)}${text(p.version) ? ` v${text(p.version)}` : ''}`,
        move(p.from_status, p.to_status),
        moved && `этапы: ${moved}`,
      ]));
    }
    case 'stage.skipped':
      return only(join([
        text(p.status),
        text(p.bypass_transition) && `обход: ${text(p.bypass_transition)}`,
        text(p.transition) && `по переходу ${text(p.transition)}`,
      ]));
    case 'stage.entered':
      return only(join([text(p.status), text(p.attempt) && `попытка ${text(p.attempt)}`]));
    case 'stage.claimed':
      return only(join([text(p.role), text(p.kind), text(p.attempt) && `попытка ${text(p.attempt)}`]));
    case 'lease.expired':
      return only(text(p.holder) && `держал ${text(p.holder)}`);
    case 'artifact.submitted':
      return only(join([text(p.kind), text(p.version) && `v${text(p.version)}`, text(p.title)]));
    case 'gate.decided':
      return only(join([text(p.gate), text(p.transition), text(p.status)]));
    case 'gate.failed': {
      const gates = Array.isArray(p.gates) ? p.gates : [];
      const held = gates
        .filter(isObject)
        .filter((g) => !PASSING.includes(text(g.status) ?? ''))
        .map((g) => text(g.gate_key) ?? text(g.gate))
        .filter((s): s is string => s !== undefined);
      return only(join([text(p.transition), held.length > 0 && `держат: ${held.join(', ')}`]));
    }
    case 'review.requested':
    case 'review.completed':
      return only(join([text(p.gate), text(p.reviewer_role), text(p.verdict)]));
    case 'repo_ref.linked':
      return only(join([
        text(p.repository),
        [text(p.ref_type), text(p.ref)].filter(Boolean).join(' ') || undefined,
        text(p.state),
      ]));
    case 'drift.detected':
    case 'drift.resolved':
      return only(join([text(p.kind), text(p.severity), text(p.repository), text(p.resolution), text(p.note)]));
    case 'usage.reported':
      return only(join([text(p.model), money(p.cost_usd)]));
    default:
      return only(undefined);
  }
}

// Есть ли что показать по раскрытию: любое событие с непустым payload, в том
// числе незнакомого типа.
export function hasPayload(payload: unknown): boolean {
  return isObject(payload) ? Object.keys(payload).length > 0 : payload !== undefined && payload !== null;
}
