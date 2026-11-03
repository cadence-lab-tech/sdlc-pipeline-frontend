// Правила предложений версий роли (CLAB-384, решение 0072): кто что видит в
// панели роли, словарь состояний, номера #k, порядок и фильтр очереди,
// отличия предложения от последней версии. Без React, ключей статусов и
// ролей — проверяется без браузера в e2e/proposal-rules.mjs.
//
// Права здесь — подсказка интерфейса, а не проверка: решает сервер, его отказ
// показывается как есть. Поэтому «не знаю» (кто я не загрузился, режим
// header, не пришёл состав команд проекта) — это «можно»: образец —
// components/modelLevel.ts (canEditTaskLevel).
import type {
  MemberRole,
  Me,
  ModelLevel,
  OutputContractItem,
  ProjectTeam,
  RoleProposal,
  RoleVersion,
} from '../../api/types';
import type {TokenColor} from '../kit';
import {modelLevelLabel} from '../modelLevel';

// ── ответ сервера ────────────────────────────────────────────────────────────

// Пустые массивы бэкенд отдаёт нулём или опускает, а Go отдаёт nil как null:
// ответ приводится к одному виду здесь, один раз.
export function normalizeProposal(p: RoleProposal): RoleProposal {
  const orNull = <T>(v: T | null | undefined) => (v === null ? undefined : v);
  return {
    ...p,
    input_kinds: p.input_kinds ?? [],
    output_contract: p.output_contract ?? [],
    tool_policy: p.tool_policy ?? {},
    repo_scope: p.repo_scope ?? [],
    context_budget: p.context_budget ?? {},
    documents: p.documents ?? [],
    model_hint: orNull(p.model_hint),
    model_level: orNull(p.model_level),
    decided_by: orNull(p.decided_by),
    decided_by_handle: orNull(p.decided_by_handle),
    decided_at: orNull(p.decided_at),
    decision_note: orNull(p.decision_note),
    result_version: orNull(p.result_version),
  };
}

// ── права ────────────────────────────────────────────────────────────────────

const RANK: Record<string, number> = {viewer: 1, agent: 2, maintainer: 3, admin: 4};
const rank = (level: string | undefined) => RANK[level ?? ''] ?? 0;

export type RightsLevel = MemberRole | 'none';

export interface RoleRights {
  // Наибольший уровень по всем путям: участие, команды проекта, администратор.
  level: RightsLevel;
  principalId: string;
  // Утверждает и отклоняет человек: принципал-агент уровня maintainer не может.
  isHuman: boolean;
  // Роли, которые участник уровня agent предлагает: null — любые.
  roles: string[] | null;
}

// Состав команд проекта нужен, только если по прямому участию ответ не ясен:
// у человека есть команды, а прямого права maintainer нет.
export function rightsNeedTeams(me: Me | undefined, projectKey: string, ownerTeamKey?: string): boolean {
  if (!me || me.mode === 'header' || me.principal?.is_admin) return false;
  const direct = (me.memberships ?? []).some((m) => m.project_key === projectKey && rank(m.role) >= RANK.maintainer);
  if (direct) return false;
  const teams = me.teams ?? [];
  if (ownerTeamKey && teams.some((t) => t.team_key === ownerTeamKey && t.role === 'lead')) return false;
  return teams.length > 0;
}

// Права человека на роли проекта. undefined — не известны: me не загрузился,
// режим header или нужный состав команд проекта ещё не пришёл.
export function computeRights({
  me,
  projectKey,
  ownerTeamKey,
  projectTeams,
}: {
  me: Me | undefined;
  projectKey: string;
  ownerTeamKey?: string;
  // undefined — состав команд проекта неизвестен (не загружен).
  projectTeams: ProjectTeam[] | undefined;
}): RoleRights | undefined {
  if (!me || me.mode === 'header') return undefined;
  const principalId = me.principal?.id ?? '';
  const isHuman = me.principal?.kind === 'user';
  if (me.principal?.is_admin) return {level: 'admin', principalId, isHuman, roles: null};
  if (rightsNeedTeams(me, projectKey, ownerTeamKey) && !projectTeams) return undefined;

  const teams = me.teams ?? [];
  const mine = new Set(teams.map((t) => t.team_key));
  const paths: {level: string; role_keys?: string[] | null}[] = [
    ...(me.memberships ?? [])
      .filter((m) => m.project_key === projectKey)
      .map((m) => ({level: m.role as string, role_keys: m.role_keys})),
    ...(projectTeams ?? [])
      .filter((pt) => mine.has(pt.team_key))
      .map((pt) => ({level: pt.level as string, role_keys: pt.role_keys})),
  ];
  if (ownerTeamKey && teams.some((t) => t.team_key === ownerTeamKey && t.role === 'lead')) {
    paths.push({level: 'maintainer', role_keys: null});
  }

  let best = 0;
  let level: RightsLevel = 'none';
  let any = false;
  const union = new Set<string>();
  for (const path of paths) {
    const r = rank(path.level);
    if (r > best) {
      best = r;
      level = path.level as RightsLevel;
    }
    if (r >= RANK.agent) {
      if (path.role_keys == null) any = true;
      else path.role_keys.forEach((k) => union.add(k));
    }
  }
  let roles: string[] | null = any ? null : [...union];
  // Токен только сужает; пустой список — без сужения (как у сервера).
  const narrow = me.token?.role_keys ?? [];
  if (narrow.length > 0) roles = roles === null ? [...narrow] : roles.filter((k) => narrow.includes(k));
  return {level, principalId, isHuman, roles};
}

export type VersionAction = 'create' | 'propose' | 'none';

export const NOT_IN_SET_NOTE = 'Версию этой роли вы не предлагаете: она не в вашем наборе ролей';
export const NO_VERSIONS_NOTE = 'У роли нет версий: первую заводит сопровождающий';

// Что стоит в шапке роли вместо «Новая версия». Права не известны — прежняя
// кнопка. Строка note — пояснение под шапкой, когда предложить нельзя, а
// участник — agent.
export function roleVersionAction(
  rights: RoleRights | undefined,
  roleKey: string,
  role: {archived: boolean; hasVersions: boolean},
): {action: VersionAction; note?: string} {
  if (!rights) return {action: 'create'};
  if (rank(rights.level) >= RANK.maintainer) return {action: 'create'};
  if (rights.level !== 'agent') return {action: 'none'};
  if (rights.roles !== null && !rights.roles.includes(roleKey)) return {action: 'none', note: NOT_IN_SET_NOTE};
  if (role.archived) return {action: 'none'};
  if (!role.hasVersions) return {action: 'none', note: NO_VERSIONS_NOTE};
  return {action: 'propose'};
}

// Утвердить и отклонить: человек уровня maintainer и выше.
export function canDecide(rights: RoleRights | undefined): boolean {
  if (!rights) return true;
  return rank(rights.level) >= RANK.maintainer && rights.isHuman;
}

// Отозвать: автор или сопровождающий.
export function canWithdraw(rights: RoleRights | undefined, p: Pick<RoleProposal, 'created_by'>): boolean {
  if (!rights) return true;
  return p.created_by === rights.principalId || rank(rights.level) >= RANK.maintainer;
}

// ── состояния ────────────────────────────────────────────────────────────────

// Предложение устарело: подано от версии, которая уже не последняя. База
// больше последней по серверу невозможна и читается как актуальная.
export function isStale(p: Pick<RoleProposal, 'state' | 'base_version'>, latest?: number): boolean {
  return p.state === 'pending' && latest !== undefined && p.base_version < latest;
}

export interface ProposalLabel {
  label: string;
  color: TokenColor;
}

// Словарь подписей. Подпись всегда текстом, цвет — дополнение; незнакомое
// состояние — ключом как есть.
export function proposalLabel(p: Pick<RoleProposal, 'state' | 'base_version' | 'result_version'>, latest?: number): ProposalLabel {
  switch (p.state) {
    case 'pending':
      return isStale(p, latest) ? {label: 'устарело', color: 'orange'} : {label: 'ожидает', color: 'blue'};
    case 'approved':
      return {label: p.result_version ? `утверждено · v${p.result_version}` : 'утверждено', color: 'green'};
    case 'rejected':
      return {label: 'отклонено', color: 'red'};
    case 'withdrawn':
      return {label: 'отозвано', color: 'default'};
    default:
      return {label: String(p.state), color: 'default'};
  }
}

export const staleTitle = (base: number, latest: number) => `Подано от v${base}, последняя v${latest}; утвердить нельзя`;
export const STALE_HINT = 'Отклоните предложение или попросите автора подать заново от v{N}.';
export const staleHint = (latest: number) => STALE_HINT.replace('{N}', String(latest));
export const APPROVE_BLOCKED = 'Утвердить нельзя: база устарела';

// ── очередь ──────────────────────────────────────────────────────────────────

export type ProposalFilter = 'pending' | 'all';

const byTime = (a: RoleProposal, b: RoleProposal) =>
  a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

// Порядковый номер предложения роли по времени подачи. На сервере поля нет:
// номер считается по полному списку и стабилен, пока предложения не удаляются.
export function proposalNumbers(list: RoleProposal[]): Map<string, number> {
  return new Map([...list].sort(byTime).map((p, i) => [p.id, i + 1]));
}

// Новые сверху.
export const newestFirst = (list: RoleProposal[]): RoleProposal[] => [...list].sort((a, b) => byTime(b, a));

export function filterProposals(list: RoleProposal[], filter: ProposalFilter): RoleProposal[] {
  return newestFirst(filter === 'pending' ? list.filter((p) => p.state === 'pending') : list);
}

export const PAGE_SIZE = 10;

// В режиме «Все» строк первые PAGE_SIZE (плюс подгруженные), остаток — под
// кнопкой «Показать ещё»; «Ожидают» показываются целиком.
export function pageProposals(rows: RoleProposal[], filter: ProposalFilter, extra = 0): {rows: RoleProposal[]; rest: number} {
  if (filter === 'pending') return {rows, rest: 0};
  const shown = PAGE_SIZE + extra;
  return {rows: rows.slice(0, shown), rest: Math.max(0, rows.length - shown)};
}

export const sectionTitle = (count?: number) => (count === undefined ? 'Предложения' : `Предложения (${count})`);

export const authorLabel = (p: Pick<RoleProposal, 'created_by' | 'created_by_handle'>, rights?: RoleRights) =>
  rights && p.created_by === rights.principalId ? 'вы' : p.created_by_handle;

// ── отличия от последней версии ──────────────────────────────────────────────

const contractKey = (items: OutputContractItem[] | undefined) =>
  JSON.stringify(
    (items ?? []).map((i) => [i.kind, i.title ?? '', i.format ?? '', Boolean(i.required), i.schema ?? null]),
  );

// «Прочее» в карточке: только то, что отличается от последней версии и что
// правит форма. tool_policy, repo_scope и context_budget форма не правит —
// не показываются.
export function otherChanges(p: RoleProposal, latest: RoleVersion): string[] {
  const out: string[] = [];
  const a: ModelLevel | undefined = latest.model_level ?? undefined;
  const b: ModelLevel | undefined = p.model_level ?? undefined;
  if (a !== b) out.push(`уровень модели: ${modelLevelLabel(a)} → ${modelLevelLabel(b)}`);
  if (contractKey(latest.output_contract) !== contractKey(p.output_contract)) out.push('контракт вывода изменён');
  if (JSON.stringify(latest.input_kinds ?? []) !== JSON.stringify(p.input_kinds ?? [])) out.push('вход изменён');
  return out;
}
