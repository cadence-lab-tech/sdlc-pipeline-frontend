// Клиент REST-API. Ошибку бэкенда разбирает в ApiError с кодом домена: коды
// общие для REST и MCP, и UI ветвится по коду, а не по тексту сообщения.

import type {
  AccessToken,
  ActivationResult,
  AuditEntry,
  AuditPage,
  Artifact,
  Bundle,
  Drift,
  IndexStatusRow,
  QueueEntry,
  SearchResult,
  GitHubConnection,
  GitHubInstallation,
  GitHubSettings,
  ImportReport,
  IssuedToken,
  GitHubStatus,
  ProjectHealth,
  TeamGitHub,
  ProjectGitHub,
  RepoPick,
  AttachResult,
  Me,
  Metrics,
  OIDCSettings,
  Principal,
  Project,
  ProjectDocument,
  ProjectRemoved,
  RepositoryRemoved,
  ProjectMember,
  ProjectDetail,
  Role,
  RoleVersion,
  RoleWithVersions,
  Plan,
  Session,
  Status,
  Task,
  TaskDetail,
  TaskEvent,
  TaskRepoRef,
  Team,
  TeamBudgets,
  TeamDetail,
  TeamRemoved,
  TeamMember,
  ProjectTeam,
  Transition,
  TransitionOption,
  UUID,
  Validation,
  Workflow,
  WorkflowHead,
  CLILoginView,
  Invite,
  IssuedInvite,
  AcceptedInvite,
  AgentKit,
  Instance,
} from "./types";

const BASE = import.meta.env.VITE_API_URL ?? "/v1";

export type ErrorCode =
  | "not_found"
  | "invalid_input"
  | "conflict"
  | "gates_not_satisfied"
  | "task_not_claimable"
  | "lease_held_by_other"
  | "lease_expired"
  | "contract_violation"
  | "unknown_repository"
  | "scope_expansion_forbidden"
  | "drift_unresolved"
  | "transition_not_allowed"
  | "out_of_task_scope"
  | "unauthenticated"
  | "forbidden"
  | "internal";

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// Кто пришёл, определяет токен (решение 0021). В режиме header бэкенд берёт
// актора из заголовка X-SDLC-Actor — он отправляется всегда и в режиме
// токенов просто игнорируется.
const ACTOR_KEY = "sdlc.actor";
const TOKEN_KEY = "sdlc.token";

export function currentActor(): string {
  return localStorage.getItem(ACTOR_KEY) ?? "web";
}

export function setCurrentActor(handle: string): void {
  localStorage.setItem(ACTOR_KEY, handle);
}

export function currentToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setCurrentToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

// Событие «нужен вход»: клиент один на всё приложение и не знает про роутер,
// а показать форму входа после 401 должен тот, кто рисует страницы.
export const UNAUTHENTICATED_EVENT = "sdlc:unauthenticated";

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "X-SDLC-Actor": currentActor() };
  const token = currentToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function raise(res: Response, body: unknown): never {
  const err = (
    body as { error?: { code: ErrorCode; message: string; details?: unknown } }
  )?.error;
  if (res.status === 401) {
    window.dispatchEvent(new Event(UNAUTHENTICATED_EVENT));
  }
  throw new ApiError(
    err?.code ?? "internal",
    err?.message ?? `запрос завершился со статусом ${res.status}`,
    err?.details,
    res.status,
  );
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
        ...init?.headers,
      },
    });
  } catch (cause) {
    throw new ApiError("internal", `сервис недоступен: ${String(cause)}`);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  const body: unknown = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    raise(res, body);
  }
  return body as T;
}

async function requestText(path: string): Promise<string> {
  const res = await fetch(BASE + path, { headers: authHeaders() });
  const text = await res.text();
  if (!res.ok) {
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    raise(res, body);
  }
  return text;
}

// Бэкенд опускает пустые массивы (`omitempty`), поэтому у задачи без
// репозиториев или у пустого черновика цикла полей просто нет. Нормализация
// одна на весь клиент: иначе каждый компонент обязан помнить про это сам, и
// первая же забытая проверка роняет страницу целиком.
function normalizeTask(t: Task): Task {
  return {
    ...t,
    repositories: t.repositories ?? [],
    labels: t.labels ?? [],
    properties: t.properties ?? {},
    stage_settings: t.stage_settings ?? {},
  };
}

// Журнал: пустой список сервер может опустить или отдать null, а поля
// снимка — без значения; компонент журнала про это не помнит.
function normalizeAuditPage(page: Partial<AuditPage> | undefined): AuditPage {
  return {
    entries: (page?.entries ?? []).map(normalizeAuditEntry),
    next: page?.next || null,
  };
}

function normalizeAuditEntry(e: AuditEntry): AuditEntry {
  return {
    ...e,
    project_key: e.project_key ?? null,
    task_key: e.task_key ?? null,
    principal: e.principal ?? null,
    token: e.token
      ? {
          id: e.token.id ?? null,
          name: e.token.name ?? null,
          prefix: e.token.prefix ?? null,
          kind: e.token.kind ?? null,
        }
      : null,
    params: e.params ?? null,
    outcome: {
      ok: Boolean(e.outcome?.ok),
      code: e.outcome?.code ?? null,
      status: e.outcome?.status ?? null,
    },
    request_id: e.request_id ?? null,
  };
}

function auditQuery(cursor?: string): string {
  return cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
}

function normalizeWorkflow(w: Workflow): Workflow {
  return {
    ...w,
    task_types: w.task_types ?? ["task"],
    statuses: (w.statuses ?? []).map((s) => ({ ...s, roles: s.roles ?? [] })),
    transitions: (w.transitions ?? []).map((t) => ({
      ...t,
      gates: t.gates ?? [],
    })),
  };
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });
const post = (body?: unknown): RequestInit => ({
  method: "POST",
  ...(body ? json(body) : {}),
});
const patch = (body: unknown): RequestInit => ({
  method: "PATCH",
  ...json(body),
});
const put = (body: unknown): RequestInit => ({ method: "PUT", ...json(body) });
const del = (): RequestInit => ({ method: "DELETE" });

export const api = {
  // ── сведения об инстансе ──────────────────────────────────────────────────
  // Ручка открытая (CLAB-87): её читают и страница входа, и оболочка, поэтому
  // запрос идёт без токена и актора, а 401 здесь не повод уводить на вход.
  // Отказ любого рода — ошибка; что показывать вместо ответа, решает
  // hooks/useInstance.
  instance: async (): Promise<Instance> => {
    let res: Response;
    try {
      res = await fetch(BASE + "/instance");
    } catch (cause) {
      throw new ApiError("internal", `сервис недоступен: ${String(cause)}`);
    }
    if (!res.ok) {
      throw new ApiError(
        res.status === 404 ? "not_found" : "internal",
        `сведения об инстансе: статус ${res.status}`,
        undefined,
        res.status,
      );
    }
    return (await res.json()) as Instance;
  },

  // Набор агента (CLAB-232) — открытая ручка, как instance: запрос без токена
  // и актора. 404 — сервер старше набора; что показать вместо, решает
  // страница /docs.
  agentKit: async (): Promise<AgentKit> => {
    let res: Response;
    try {
      res = await fetch(BASE + "/agent-kit");
    } catch (cause) {
      throw new ApiError("internal", `сервис недоступен: ${String(cause)}`);
    }
    if (!res.ok) {
      throw new ApiError(
        res.status === 404 ? "not_found" : "internal",
        `набор агента: статус ${res.status}`,
        undefined,
        res.status,
      );
    }
    const kit = (await res.json()) as AgentKit;
    return { ...kit, skills: kit.skills ?? [], agents: kit.agents ?? [] };
  },

  // ── кто я, токены, участники ──────────────────────────────────────────────
  me: () =>
    request<Me>("/auth/me").then((m) => ({
      ...m,
      memberships: m.memberships ?? [],
      teams: m.teams ?? [],
    })),

  // ── вход через корпоративного провайдера ──────────────────────────────────
  // Обе ручки открытые: у того, кто входит, токена ещё нет.
  oidcSettings: () => request<OIDCSettings>("/auth/oidc"),

  oidcLogin: (idToken: string) =>
    request<Session>("/auth/oidc/login", post({ id_token: idToken })),

  // ── вход через GitHub ─────────────────────────────────────────────────────
  githubSettings: () => request<GitHubSettings>("/auth/github"),

  githubLogin: (code: string, redirectURI: string) =>
    request<Session>(
      "/auth/github/login",
      post({ code, redirect_uri: redirectURI }),
    ),

  // Выход отзывает предъявленную сессию на бэкенде; токен, выданный руками,
  // так не отзывается — он отзывается по имени из списка.
  logout: () => request<void>("/auth/logout", post()),

  // ── вход CLI через браузер ────────────────────────────────────────────────
  // Запрос заводит и опрашивает сам clab; здесь только показать и решить.
  cliLoginRequest: (code: string) =>
    request<CLILoginView>(`/auth/cli/${encodeURIComponent(code)}`),

  decideCLILogin: (code: string, approve: boolean) =>
    request<CLILoginView>(
      `/auth/cli/${encodeURIComponent(code)}`,
      post({ approve }),
    ),

  listTokens: (projectKey?: string) =>
    request<{ tokens: AccessToken[] }>(
      `/auth/tokens${projectKey ? `?project=${projectKey}` : ""}`,
    ).then((r) =>
      (r.tokens ?? []).map((t) => ({ ...t, role_keys: t.role_keys ?? [] })),
    ),

  // Сам токен приходит один раз — в ответе на выдачу; дальше только хеш.
  issueToken: (body: {
    name: string;
    principal?: string;
    project?: string;
    role_keys?: string[];
    expires_in_days?: number;
    member_role?: string;
  }) => request<IssuedToken>("/auth/tokens", post(body)),

  revokeToken: (id: UUID) => request<void>(`/auth/tokens/${id}`, del()),

  listMembers: (projectKey: string) =>
    request<{ members: ProjectMember[] }>(
      `/projects/${projectKey}/members`,
    ).then((r) => r.members ?? []),

  // Пустой список ролей — «любые»: та же договорённость, что у токена.
  setMember: (
    projectKey: string,
    principal: string,
    role: string,
    roleKeys: string[] = [],
  ) =>
    request<ProjectMember>(
      `/projects/${projectKey}/members`,
      put({ principal, role, role_keys: roleKeys }),
    ),

  removeMember: (projectKey: string, handle: string) =>
    request<void>(
      `/projects/${projectKey}/members/${encodeURIComponent(handle)}`,
      del(),
    ),

  // ── приглашения ───────────────────────────────────────────────────────────
  // Токен ссылки ходит только в теле: пути запросов оседают в логах прокси и
  // сервиса, а ссылка — пропуск на предъявителя (решение 0035). role_keys не
  // нормализуется: null — «любые роли», пустой список — «ни одной».
  lookupInvite: (token: string) =>
    request<Invite>("/invites/lookup", post({ token })),

  acceptInvite: (token: string) =>
    request<AcceptedInvite>("/invites/accept", post({ token })),

  // Выдача и список. Токен приходит один раз — в ответе на выдачу; в списках
  // его нет. Срок не задан — поле days не уходит вовсе, и бэкенд ставит
  // неделю; диапазон проверяет он же.
  createProjectInvite: (
    projectKey: string,
    body: { level: string; role_keys: string[]; days?: number },
  ) =>
    request<IssuedInvite>(`/projects/${projectKey}/invites`, post(body)),

  listProjectInvites: (projectKey: string) =>
    request<{ invites: Invite[] }>(`/projects/${projectKey}/invites`).then(
      (r) => r.invites ?? [],
    ),

  createTeamInvite: (teamKey: string, body: { role: string; days?: number }) =>
    request<IssuedInvite>(`/teams/${teamKey}/invites`, post(body)),

  listTeamInvites: (teamKey: string) =>
    request<{ invites: Invite[] }>(`/teams/${teamKey}/invites`).then(
      (r) => r.invites ?? [],
    ),

  // Отзыв отвечает самим приглашением в новом статусе, а не пустым телом.
  revokeInvite: (id: UUID) => request<Invite>(`/invites/${id}`, del()),

  // ── команды ───────────────────────────────────────────────────────────────
  listPrincipals: (search?: string) =>
    request<{ principals: Principal[] }>(
      `/principals${search ? `?q=${encodeURIComponent(search)}` : ""}`,
    ).then((r) => r.principals ?? []),

  listTeams: () =>
    request<{ teams: Team[] }>("/teams").then((r) => r.teams ?? []),

  getTeam: (teamKey: string) =>
    request<TeamDetail>(`/teams/${teamKey}`).then((d) => ({
      ...d,
      members: d.members ?? [],
      projects: d.projects ?? [],
      installations: d.installations ?? [],
    })),

  // ── установки GitHub App на команде (решение 0034) ────────────────────────
  listTeamInstallations: (teamKey: string) =>
    request<{ installations: GitHubInstallation[] }>(
      `/teams/${teamKey}/github/installations`,
    ).then((r) => r.installations ?? []),

  // Те же установки вместе с состоянием приложения у провайдера (из кэша
  // бэкенда): странице команды нужно сказать, что ключ не принят.
  teamGitHub: (teamKey: string) =>
    request<TeamGitHub>(`/teams/${teamKey}/github/installations`).then((r) => ({
      ...r,
      installations: r.installations ?? [],
    })),

  // Возврат от GitHub: код повторной авторизации доказывает право на
  // установку и открывает список репозиториев, которые вошедший видит сам.
  connectGitHub: (
    teamKey: string,
    body: {
      code: string;
      redirect_uri: string;
      installation_id?: number;
      project?: string;
    },
  ) =>
    request<GitHubConnection>(
      `/teams/${teamKey}/github/connect`,
      post(body),
    ).then((c) => ({
      ...c,
      installations: c.installations ?? [],
      repositories: c.repositories ?? [],
    })),

  createTeam: (body: {
    key: string;
    name: string;
    description?: string;
    can_create_projects?: boolean;
  }) => request<Team>("/teams", post(body)),

  // Незаполненное поле не меняется: «снять право» отличается от «не трогать».
  updateTeam: (
    teamKey: string,
    body: {
      name?: string;
      description?: string;
      can_create_projects?: boolean;
    },
  ) => request<Team>(`/teams/${teamKey}`, patch(body)),

  // Удаление арендатора необратимо и делается только отсюда: в CLI и MCP
  // его нет. Ответ называет цену действия — что ушло вместе с командой.
  deleteTeam: (teamKey: string) =>
    request<TeamRemoved>(`/teams/${teamKey}`, del()).then((r) => ({
      ...r,
      removed: {...r.removed, project_keys: r.removed.project_keys ?? []},
    })),

  // Личный аккаунт становится организацией: проекты остаются, участников
  // теперь можно звать (решение 0033). Пустые ключ и название — прежние.
  convertTeam: (teamKey: string, body: {key?: string; name?: string}) =>
    request<Team>(`/teams/${teamKey}/convert`, post(body)),

  listPlans: () => request<{plans: Plan[]}>("/plans").then((r) => r.plans ?? []),

  // Тариф назначает администратор инстанса.
  setTeamPlan: (teamKey: string, plan: string) =>
    request<Plan>(`/teams/${teamKey}/plan`, put({plan})),

  setTeamMember: (teamKey: string, principal: string, role: string) =>
    request<TeamMember>(`/teams/${teamKey}/members`, put({ principal, role })),

  removeTeamMember: (teamKey: string, handle: string) =>
    request<void>(
      `/teams/${teamKey}/members/${encodeURIComponent(handle)}`,
      del(),
    ),

  // Группы провайдера, ведущие в команду: состав такой команды пересчитывается
  // при каждом входе её участников.
  teamIdPGroups: (teamKey: string) =>
    request<{ groups: string[] }>(`/teams/${teamKey}/idp-groups`).then(
      (r) => r.groups ?? [],
    ),

  setTeamIdPGroups: (teamKey: string, groups: string[]) =>
    request<{ groups: string[] }>(
      `/teams/${teamKey}/idp-groups`,
      put({ groups }),
    ).then((r) => r.groups ?? []),

  teamBudgets: (teamKey: string) =>
    request<TeamBudgets>(`/teams/${teamKey}/budgets`).then((b) => ({
      ...b,
      budgets: b.budgets ?? [],
    })),

  // Ноль снимает предел: «без ограничения» и «ноль долларов» — разные вещи.
  setTeamBudget: (teamKey: string, period: string, limitUSD: number) =>
    request<TeamBudgets>(
      `/teams/${teamKey}/budgets`,
      put({ period, limit_usd: limitUSD }),
    ).then((b) => ({
      ...b,
      budgets: b.budgets ?? [],
    })),

  listProjectTeams: (projectKey: string) =>
    request<{ teams: ProjectTeam[] }>(`/projects/${projectKey}/teams`).then(
      (r) => r.teams ?? [],
    ),

  setProjectTeam: (
    projectKey: string,
    team: string,
    level: string,
    roleKeys: string[] = [],
  ) =>
    request<ProjectTeam>(
      `/projects/${projectKey}/teams`,
      put({ team, level, role_keys: roleKeys }),
    ),

  removeProjectTeam: (projectKey: string, teamKey: string) =>
    request<void>(`/projects/${projectKey}/teams/${teamKey}`, del()),

  // ── доступ к GitHub у проекта ─────────────────────────────────────────────
  getProjectGitHub: (projectKey: string) =>
    request<ProjectGitHub>(`/projects/${projectKey}/github`).then((g) => ({
      ...g,
      installations: g.installations ?? [],
    })),

  // Привязка пачкой того, что отмечено в списке после возврата от GitHub.
  attachRepositories: (
    projectKey: string,
    body: { installation_id: number; repositories: RepoPick[] },
  ) =>
    request<AttachResult>(
      `/projects/${projectKey}/github/repositories`,
      post(body),
    ).then((r) => ({ ...r, repositories: r.repositories ?? [] })),

  setProjectGitHub: (
    projectKey: string,
    body: { installation_id?: number | null; credential_ref?: string | null },
  ) => request<Project>(`/projects/${projectKey}/github`, put(body)),

  // Ходит в провайдера по каждому репозиторию проекта — поэтому только по
  // кнопке, а не при открытии страницы.
  checkProjectGitHub: (projectKey: string) =>
    request<GitHubStatus>(`/projects/${projectKey}/github/check`).then((s) => ({
      ...s,
      repositories: s.repositories ?? [],
    })),

  // ── перенос правил ────────────────────────────────────────────────────────
  exportBundle: (projectKey: string) =>
    request<Bundle>(`/projects/${projectKey}/export`),

  importBundle: (projectKey: string, bundle: unknown, dryRun: boolean) =>
    request<ImportReport>(
      `/projects/${projectKey}/import${dryRun ? "?dry_run=true" : ""}`,
      post(bundle),
    ).then((r) => ({
      ...r,
      repositories: r.repositories ?? [],
      roles: r.roles ?? [],
      documents: r.documents ?? [],
      workflows: r.workflows ?? [],
      workflow_validations: r.workflow_validations ?? [],
    })),

  listDocuments: (projectKey: string) =>
    request<{ documents: ProjectDocument[] }>(
      `/projects/${projectKey}/documents`,
    ).then((r) => r.documents ?? []),

  // ── метрики ───────────────────────────────────────────────────────────────
  metrics: (projectKey: string, period: string) =>
    request<Metrics>(`/projects/${projectKey}/metrics?period=${period}`).then(
      (m) => ({
        ...m,
        statuses: m.statuses ?? [],
        gates: m.gates ?? [],
        drift: m.drift ?? [],
        cost: m.cost ?? [],
      }),
    ),

  // ── проекты ───────────────────────────────────────────────────────────────
  listProjects: () =>
    request<{ projects: Project[] }>("/projects").then((r) => r.projects),

  getProject: (key: string) =>
    request<ProjectDetail>(`/projects/${key}`).then((d) => ({
      ...d,
      active_workflows: d.active_workflows ?? [],
    })),

  // Кто может завести проект, решает бэкенд (решение 0030): по умолчанию
  // любой вошедший, и создатель становится администратором. Команда-владелец
  // необязательна и указывается явно.
  createProject: (body: {
    key: string;
    name: string;
    description?: string;
    team?: string;
  }) => request<Project>("/projects", post(body)),

  // Проект уходит целиком вместе с задачами: незакрытые задачи удалению не
  // мешают — они исчезают вместе с ним, рассогласовывать нечего.
  deleteProject: (projectKey: string) =>
    request<ProjectRemoved>(`/projects/${projectKey}`, del()),

  // Координаты репозитория стоят в пути, а не в теле: это удаление, и адрес
  // обязан называть, что удаляется. Точка и дефис в имени — обычное дело,
  // поэтому оба сегмента экранируются.
  removeRepository: (projectKey: string, owner: string, name: string) =>
    request<RepositoryRemoved>(
      `/projects/${projectKey}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
      del(),
    ),

  // ── цикл ──────────────────────────────────────────────────────────────────
  // Цикл выбирается типом задач: у доски эпиков другие колонки.
  getWorkflow: (projectKey: string, taskType?: string) =>
    request<Workflow>(
      `/projects/${projectKey}/workflow${taskType ? `?type=${encodeURIComponent(taskType)}` : ""}`,
    ).then(normalizeWorkflow),

  listWorkflows: (projectKey: string) =>
    request<{ workflows: WorkflowHead[] }>(
      `/projects/${projectKey}/workflows`,
    ).then((r) => r.workflows),

  createDraft: (
    projectKey: string,
    body: { name?: string; from?: string; task_types?: string[] },
  ) =>
    request<Workflow>(`/projects/${projectKey}/workflows`, post(body)).then(
      normalizeWorkflow,
    ),

  getWorkflowVersion: (id: UUID) =>
    request<Workflow>(`/workflows/${id}`).then(normalizeWorkflow),

  // Правится только черновик: у активной версии ни имя, ни типы задач не
  // меняются — по ней идут задачи (решение 0016).
  updateWorkflowVersion: (
    id: UUID,
    body: { name?: string; task_types?: string[] },
  ) =>
    request<Workflow>(`/workflows/${id}`, patch(body)).then(normalizeWorkflow),

  deleteWorkflow: (id: UUID) => request<void>(`/workflows/${id}`, del()),

  validateWorkflow: (id: UUID) =>
    request<Validation>(`/workflows/${id}/validation`),

  activateWorkflow: (id: UUID) =>
    request<ActivationResult>(`/workflows/${id}/activate`, post()),

  // ── статусы черновика ─────────────────────────────────────────────────────
  createStatus: (
    id: UUID,
    body: Partial<Status> & { key: string; name: string },
  ) => request<Status>(`/workflows/${id}/statuses`, post(body)),

  updateStatus: (id: UUID, key: string, body: Partial<Status>) =>
    request<Status>(`/workflows/${id}/statuses/${key}`, patch(body)),

  deleteStatus: (id: UUID, key: string) =>
    request<void>(`/workflows/${id}/statuses/${key}`, del()),

  // Порядок колонок меняется целиком одним запросом: уникальность позиции не
  // переживает перестановку по одному статусу.
  reorderStatuses: (id: UUID, order: string[]) =>
    request<{ statuses: Status[] }>(
      `/workflows/${id}/statuses`,
      put({ order }),
    ).then((r) => r.statuses),

  setStatusRoles: (
    id: UUID,
    key: string,
    roles: { role: string; is_primary?: boolean; position?: number }[],
  ) =>
    request<Status>(`/workflows/${id}/statuses/${key}/roles`, put({ roles })),

  // ── переходы и гейты черновика ────────────────────────────────────────────
  createTransition: (id: UUID, body: Record<string, unknown>) =>
    request<Transition>(`/workflows/${id}/transitions`, post(body)),

  updateTransition: (id: UUID, key: string, body: Record<string, unknown>) =>
    request<Transition>(`/workflows/${id}/transitions/${key}`, patch(body)),

  deleteTransition: (id: UUID, key: string) =>
    request<void>(`/workflows/${id}/transitions/${key}`, del()),

  createGate: (
    id: UUID,
    transitionKey: string,
    body: Record<string, unknown>,
  ) =>
    request<Transition>(
      `/workflows/${id}/transitions/${transitionKey}/gates`,
      post(body),
    ),

  updateGate: (
    id: UUID,
    transitionKey: string,
    gateKey: string,
    body: Record<string, unknown>,
  ) =>
    request<Transition>(
      `/workflows/${id}/transitions/${transitionKey}/gates/${gateKey}`,
      patch(body),
    ),

  deleteGate: (id: UUID, transitionKey: string, gateKey: string) =>
    request<void>(
      `/workflows/${id}/transitions/${transitionKey}/gates/${gateKey}`,
      del(),
    ),

  // ── роли ──────────────────────────────────────────────────────────────────
  listRoles: (projectKey: string, includeArchived = false) =>
    request<{ roles: Role[] }>(
      `/projects/${projectKey}/roles${includeArchived ? "?include_archived=true" : ""}`,
    ).then((r) => r.roles),

  getRole: (projectKey: string, roleKey: string) =>
    request<RoleWithVersions>(`/projects/${projectKey}/roles/${roleKey}`).then(
      (r) => ({
        ...r,
        versions: r.versions ?? [],
        used_on: r.used_on ?? [],
      }),
    ),

  createRole: (projectKey: string, body: Record<string, unknown>) =>
    request<RoleWithVersions>(`/projects/${projectKey}/roles`, post(body)),

  updateRole: (
    projectKey: string,
    roleKey: string,
    body: { name?: string; summary?: string },
  ) => request<Role>(`/projects/${projectKey}/roles/${roleKey}`, patch(body)),

  archiveRole: (projectKey: string, roleKey: string) =>
    request<Role>(`/projects/${projectKey}/roles/${roleKey}`, del()),

  restoreRole: (projectKey: string, roleKey: string) =>
    request<Role>(`/projects/${projectKey}/roles/${roleKey}/restore`, post()),

  listRoleVersions: (projectKey: string, roleKey: string) =>
    request<{ versions: RoleVersion[] }>(
      `/projects/${projectKey}/roles/${roleKey}/versions`,
    ).then((r) => r.versions ?? []),

  // Правка инструкции — новая версия, а не изменение существующей.
  createRoleVersion: (
    projectKey: string,
    roleKey: string,
    body: Record<string, unknown>,
  ) =>
    request<RoleVersion>(
      `/projects/${projectKey}/roles/${roleKey}/versions`,
      post(body),
    ),

  // ── задачи ────────────────────────────────────────────────────────────────
  listTasks: (
    projectKey: string,
    filter: { type?: string; parent?: string } = {},
  ) => {
    const query = new URLSearchParams();
    if (filter.type) query.set("type", filter.type);
    if (filter.parent) query.set("parent", filter.parent);
    const suffix = query.size > 0 ? `?${query}` : "";
    return request<{ tasks: Task[] }>(
      `/projects/${projectKey}/tasks${suffix}`,
    ).then((r) => r.tasks.map(normalizeTask));
  },

  createTask: (projectKey: string, body: Record<string, unknown>) =>
    request<Task>(`/projects/${projectKey}/tasks`, post(body)).then(
      normalizeTask,
    ),

  getTask: (taskKey: string) =>
    request<TaskDetail>(`/tasks/${taskKey}`).then((d) => ({
      ...d,
      task: normalizeTask(d.task),
      // Поля CLAB-283: бэкенд постарше их не отдаёт, а пустой список сервер
      // может опустить — панель этапа про это не помнит.
      stage_runs: (d.stage_runs ?? []).map((r) => ({
        ...r,
        gate_results: r.gate_results ?? [],
        exit: r.exit ?? null,
      })),
      artifacts: d.artifacts ?? [],
      transitions: (d.transitions ?? []).map((t) => ({
        ...t,
        gates: t.gates ?? [],
      })),
      children: (d.children ?? []).map(normalizeTask),
      links: d.links ?? [],
    })),

  // Постановка задачи: заголовок, описание, приоритет, метки. Переданное
  // поле меняется, остальные — нет; пустое описание очищает его. Тип,
  // статус, родитель, область и исполнитель этой ручкой не меняются — у
  // каждого своя.
  updateTask: (taskKey: string, body: Record<string, unknown>) =>
    request<Task>(`/tasks/${taskKey}`, patch(body)).then(normalizeTask),

  // Назначение адресное: назначенную задачу заберёт только этот принципал
  // (решение 0025). Пустой хэндл снимает назначение.
  assignTask: (taskKey: string, assignee: string) =>
    request<Task>(`/tasks/${taskKey}/assignee`, put({ assignee })).then(
      normalizeTask,
    ),

  // Лента задачи; со status — только события прогонов этого статуса вместе
  // с перепроверками (CLAB-283). Ключ — как в версии цикла: сервер сравнивает
  // его с учётом регистра, поэтому он не приводится, а только кодируется.
  timeline: (taskKey: string, status?: string) =>
    request<{ events: TaskEvent[] }>(
      `/tasks/${taskKey}/timeline${status ? `?status=${encodeURIComponent(status)}` : ""}`,
    ).then((r) => r.events ?? []),

  // Журнал действий (CLAB-210): задачи и проекта — maintainer, инстанса —
  // администратор системы. Страница по курсору next прошлой.
  taskAudit: (taskKey: string, cursor?: string) =>
    request<AuditPage>(`/tasks/${taskKey}/audit${auditQuery(cursor)}`).then(
      normalizeAuditPage,
    ),

  projectAudit: (projectKey: string, cursor?: string) =>
    request<AuditPage>(
      `/projects/${projectKey}/audit${auditQuery(cursor)}`,
    ).then(normalizeAuditPage),

  instanceAudit: (cursor?: string) =>
    request<AuditPage>(`/audit${auditQuery(cursor)}`).then(normalizeAuditPage),

  updateScope: (taskKey: string, body: Record<string, unknown>) =>
    request<Task>(`/tasks/${taskKey}/scope`, patch(body)).then(normalizeTask),

  // Привязки задачи к репозиториям: PR, ветки, коммиты. Отдельный запрос —
  // в ответе задачи их нет.
  repoRefs: (taskKey: string) =>
    request<{ repo_refs: TaskRepoRef[] }>(`/tasks/${taskKey}/repo-refs`).then(
      (r) => r.repo_refs ?? [],
    ),

  listArtifacts: (taskKey: string) =>
    request<{ artifacts: Artifact[] }>(`/tasks/${taskKey}/artifacts`).then(
      (r) => r.artifacts ?? [],
    ),

  submitArtifact: (taskKey: string, body: Record<string, unknown>) =>
    request<Artifact>(`/tasks/${taskKey}/artifacts`, post(body)),

  // Содержимое приезжает сырым телом со своим media type, а не в конверте:
  // артефакт может быть чем угодно, от markdown до диаграммы.
  artifactContent: (id: UUID) => requestText(`/artifacts/${id}/content`),

  approveArtifact: (id: UUID) =>
    request<Artifact>(`/artifacts/${id}/approve`, post()),

  // ── движение задачи ───────────────────────────────────────────────────────
  taskTransitions: (taskKey: string) =>
    request<{ transitions: TransitionOption[] }>(
      `/tasks/${taskKey}/transitions`,
    ).then((r) =>
      (r.transitions ?? []).map((t) => ({ ...t, gates: t.gates ?? [] })),
    ),

  execute: (taskKey: string, transitionKey: string, comment?: string) =>
    request<{ task: Task }>(
      `/tasks/${taskKey}/transitions/${transitionKey}`,
      post({ comment }),
    ),

  decideGate: (
    taskKey: string,
    transitionKey: string,
    gateKey: string,
    body: { status: string; details?: unknown },
  ) =>
    request<unknown>(
      `/tasks/${taskKey}/transitions/${transitionKey}/gates/${gateKey}/decision`,
      post(body),
    ),

  // ── дрейф ─────────────────────────────────────────────────────────────────

  // По умолчанию бэкенд отдаёт открытые и принятые к сведению сигналы;
  // разобранные нужны, только когда их спрашивают явно.
  taskDrift: (taskKey: string, states?: string[]) =>
    request<Drift>(
      `/tasks/${taskKey}/drift${states?.length ? `?state=${states.join(",")}` : ""}`,
    ).then((d) => ({ baselines: d.baselines ?? [], signals: d.signals ?? [] })),

  // resolved — расхождение разобрано, dismissed — признано неважным. Разница
  // видна в метриках, поэтому «закрыть и забыть» одной кнопкой быть не должно.
  resolveDrift: (
    signalID: UUID,
    resolution: "resolved" | "dismissed",
    note?: string,
  ) =>
    request<unknown>(
      `/drift-signals/${signalID}/resolve`,
      post({ resolution, note }),
    ),

  // ── индекс, поиск и очередь ───────────────────────────────────────────────

  indexStatus: (projectKey: string) =>
    request<{ repositories: IndexStatusRow[] }>(
      `/projects/${projectKey}/index`,
    ).then((r) => r.repositories ?? []),

  // Сводка состояния проекта для оболочки: отметки в боковом меню. Читает
  // кэш и базу бэкенда, поэтому зовётся на каждом переходе по страницам
  // проекта. Отказ сводки (нет ручки у старого бэкенда, 403, сбой) наружу
  // не поднимается: индикатор вспомогательный, страница от него не зависит.
  // Мимо request намеренно — тот на 401 уводит на вход, а решать это должна
  // страница со своими данными, а не индикатор.
  projectHealth: async (projectKey: string): Promise<ProjectHealth | undefined> => {
    try {
      const res = await fetch(`${BASE}/projects/${projectKey}/health`, {
        headers: authHeaders(),
      });
      if (!res.ok) return undefined;
      return (await res.json()) as ProjectHealth;
    } catch {
      return undefined;
    }
  },

  search: (
    projectKey: string,
    body: { query: string; scope?: string[]; top_k?: number },
  ) =>
    request<SearchResult>(`/projects/${projectKey}/search`, post(body)).then(
      (r) => ({
        ...r,
        scopes: r.scopes ?? [],
        results: r.results ?? [],
      }),
    ),

  queue: (projectKey: string) =>
    request<{ queue: QueueEntry[] }>(`/projects/${projectKey}/queue`).then(
      (r) => r.queue ?? [],
    ),
};
