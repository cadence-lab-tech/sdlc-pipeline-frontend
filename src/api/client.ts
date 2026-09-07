// Клиент REST-API. Ошибку бэкенда разбирает в ApiError с кодом домена: коды
// общие для REST и MCP, и UI ветвится по коду, а не по тексту сообщения.

import type {
  AccessToken,
  ActivationResult,
  Artifact,
  Bundle,
  ImportReport,
  IssuedToken,
  Me,
  Metrics,
  Project,
  ProjectDocument,
  ProjectMember,
  ProjectDetail,
  Role,
  RoleVersion,
  RoleWithVersions,
  Status,
  Task,
  TaskDetail,
  TaskEvent,
  Transition,
  TransitionOption,
  UUID,
  Validation,
  Workflow,
  WorkflowHead,
} from './types';

const BASE = import.meta.env.VITE_API_URL ?? '/v1';

export type ErrorCode =
  | 'not_found'
  | 'invalid_input'
  | 'conflict'
  | 'gates_not_satisfied'
  | 'task_not_claimable'
  | 'lease_held_by_other'
  | 'lease_expired'
  | 'contract_violation'
  | 'unknown_repository'
  | 'scope_expansion_forbidden'
  | 'drift_unresolved'
  | 'transition_not_allowed'
  | 'out_of_task_scope'
  | 'unauthenticated'
  | 'forbidden'
  | 'internal';

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Кто пришёл, определяет токен (решение 0021). В режиме header бэкенд берёт
// актора из заголовка X-SDLC-Actor — он отправляется всегда и в режиме
// токенов просто игнорируется.
const ACTOR_KEY = 'sdlc.actor';
const TOKEN_KEY = 'sdlc.token';

export function currentActor(): string {
  return localStorage.getItem(ACTOR_KEY) ?? 'web';
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
export const UNAUTHENTICATED_EVENT = 'sdlc:unauthenticated';

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {'X-SDLC-Actor': currentActor()};
  const token = currentToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function raise(res: Response, body: unknown): never {
  const err = (body as {error?: {code: ErrorCode; message: string; details?: unknown}})?.error;
  if (res.status === 401) {
    window.dispatchEvent(new Event(UNAUTHENTICATED_EVENT));
  }
  throw new ApiError(
    err?.code ?? 'internal',
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
        'Content-Type': 'application/json',
        ...authHeaders(),
        ...init?.headers,
      },
    });
  } catch (cause) {
    throw new ApiError('internal', `сервис недоступен: ${String(cause)}`);
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
  const res = await fetch(BASE + path, {headers: authHeaders()});
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
  return {...t, repositories: t.repositories ?? [], labels: t.labels ?? [], properties: t.properties ?? {}};
}

function normalizeWorkflow(w: Workflow): Workflow {
  return {
    ...w,
    task_types: w.task_types ?? ['task'],
    statuses: (w.statuses ?? []).map((s) => ({...s, roles: s.roles ?? []})),
    transitions: (w.transitions ?? []).map((t) => ({...t, gates: t.gates ?? []})),
  };
}

const json = (body: unknown): RequestInit => ({body: JSON.stringify(body)});
const post = (body?: unknown): RequestInit => ({method: 'POST', ...(body ? json(body) : {})});
const patch = (body: unknown): RequestInit => ({method: 'PATCH', ...json(body)});
const put = (body: unknown): RequestInit => ({method: 'PUT', ...json(body)});
const del = (): RequestInit => ({method: 'DELETE'});

export const api = {
  // ── кто я, токены, участники ──────────────────────────────────────────────
  me: () => request<Me>('/auth/me').then((m) => ({...m, memberships: m.memberships ?? []})),

  listTokens: (projectKey?: string) =>
    request<{tokens: AccessToken[]}>(`/auth/tokens${projectKey ? `?project=${projectKey}` : ''}`).then(
      (r) => (r.tokens ?? []).map((t) => ({...t, role_keys: t.role_keys ?? []})),
    ),

  // Сам токен приходит один раз — в ответе на выдачу; дальше только хеш.
  issueToken: (body: {
    name: string;
    principal?: string;
    project?: string;
    role_keys?: string[];
    expires_in_days?: number;
    member_role?: string;
  }) => request<IssuedToken>('/auth/tokens', post(body)),

  revokeToken: (id: UUID) => request<void>(`/auth/tokens/${id}`, del()),

  listMembers: (projectKey: string) =>
    request<{members: ProjectMember[]}>(`/projects/${projectKey}/members`).then((r) => r.members ?? []),

  setMember: (projectKey: string, principal: string, role: string) =>
    request<ProjectMember>(`/projects/${projectKey}/members`, put({principal, role})),

  removeMember: (projectKey: string, handle: string) =>
    request<void>(`/projects/${projectKey}/members/${encodeURIComponent(handle)}`, del()),

  // ── перенос правил ────────────────────────────────────────────────────────
  exportBundle: (projectKey: string) => request<Bundle>(`/projects/${projectKey}/export`),

  importBundle: (projectKey: string, bundle: unknown, dryRun: boolean) =>
    request<ImportReport>(`/projects/${projectKey}/import${dryRun ? '?dry_run=true' : ''}`, post(bundle)).then(
      (r) => ({
        ...r,
        repositories: r.repositories ?? [],
        roles: r.roles ?? [],
        documents: r.documents ?? [],
        workflows: r.workflows ?? [],
        workflow_validations: r.workflow_validations ?? [],
      }),
    ),

  listDocuments: (projectKey: string) =>
    request<{documents: ProjectDocument[]}>(`/projects/${projectKey}/documents`).then((r) => r.documents ?? []),

  // ── метрики ───────────────────────────────────────────────────────────────
  metrics: (projectKey: string, period: string) =>
    request<Metrics>(`/projects/${projectKey}/metrics?period=${period}`).then((m) => ({
      ...m,
      statuses: m.statuses ?? [],
      gates: m.gates ?? [],
      drift: m.drift ?? [],
      cost: m.cost ?? [],
    })),

  // ── проекты ───────────────────────────────────────────────────────────────
  listProjects: () => request<{projects: Project[]}>('/projects').then((r) => r.projects),

  getProject: (key: string) =>
    request<ProjectDetail>(`/projects/${key}`).then((d) => ({
      ...d,
      active_workflows: d.active_workflows ?? [],
    })),

  createProject: (body: {key: string; name: string; description?: string}) =>
    request<Project>('/projects', post(body)),

  // ── цикл ──────────────────────────────────────────────────────────────────
  // Цикл выбирается типом задач: у доски эпиков другие колонки.
  getWorkflow: (projectKey: string, taskType?: string) =>
    request<Workflow>(
      `/projects/${projectKey}/workflow${taskType ? `?type=${encodeURIComponent(taskType)}` : ''}`,
    ).then(normalizeWorkflow),

  listWorkflows: (projectKey: string) =>
    request<{workflows: WorkflowHead[]}>(`/projects/${projectKey}/workflows`).then((r) => r.workflows),

  createDraft: (projectKey: string, body: {name?: string; from?: string; task_types?: string[]}) =>
    request<Workflow>(`/projects/${projectKey}/workflows`, post(body)).then(normalizeWorkflow),

  getWorkflowVersion: (id: UUID) => request<Workflow>(`/workflows/${id}`).then(normalizeWorkflow),

  deleteWorkflow: (id: UUID) => request<void>(`/workflows/${id}`, del()),

  validateWorkflow: (id: UUID) => request<Validation>(`/workflows/${id}/validation`),

  activateWorkflow: (id: UUID) => request<ActivationResult>(`/workflows/${id}/activate`, post()),

  // ── статусы черновика ─────────────────────────────────────────────────────
  createStatus: (id: UUID, body: Partial<Status> & {key: string; name: string}) =>
    request<Status>(`/workflows/${id}/statuses`, post(body)),

  updateStatus: (id: UUID, key: string, body: Partial<Status>) =>
    request<Status>(`/workflows/${id}/statuses/${key}`, patch(body)),

  deleteStatus: (id: UUID, key: string) => request<void>(`/workflows/${id}/statuses/${key}`, del()),

  // Порядок колонок меняется целиком одним запросом: уникальность позиции не
  // переживает перестановку по одному статусу.
  reorderStatuses: (id: UUID, order: string[]) =>
    request<{statuses: Status[]}>(`/workflows/${id}/statuses`, put({order})).then((r) => r.statuses),

  setStatusRoles: (
    id: UUID,
    key: string,
    roles: {role: string; is_primary?: boolean; position?: number}[],
  ) =>
    request<Status>(`/workflows/${id}/statuses/${key}/roles`, put({roles})),

  // ── переходы и гейты черновика ────────────────────────────────────────────
  createTransition: (id: UUID, body: Record<string, unknown>) =>
    request<Transition>(`/workflows/${id}/transitions`, post(body)),

  updateTransition: (id: UUID, key: string, body: Record<string, unknown>) =>
    request<Transition>(`/workflows/${id}/transitions/${key}`, patch(body)),

  deleteTransition: (id: UUID, key: string) =>
    request<void>(`/workflows/${id}/transitions/${key}`, del()),

  createGate: (id: UUID, transitionKey: string, body: Record<string, unknown>) =>
    request<Transition>(`/workflows/${id}/transitions/${transitionKey}/gates`, post(body)),

  updateGate: (id: UUID, transitionKey: string, gateKey: string, body: Record<string, unknown>) =>
    request<Transition>(`/workflows/${id}/transitions/${transitionKey}/gates/${gateKey}`, patch(body)),

  deleteGate: (id: UUID, transitionKey: string, gateKey: string) =>
    request<void>(`/workflows/${id}/transitions/${transitionKey}/gates/${gateKey}`, del()),

  // ── роли ──────────────────────────────────────────────────────────────────
  listRoles: (projectKey: string, includeArchived = false) =>
    request<{roles: Role[]}>(
      `/projects/${projectKey}/roles${includeArchived ? '?include_archived=true' : ''}`,
    ).then((r) => r.roles),

  getRole: (projectKey: string, roleKey: string) =>
    request<RoleWithVersions>(`/projects/${projectKey}/roles/${roleKey}`).then((r) => ({
      ...r,
      versions: r.versions ?? [],
      used_on: r.used_on ?? [],
    })),

  createRole: (projectKey: string, body: Record<string, unknown>) =>
    request<RoleWithVersions>(`/projects/${projectKey}/roles`, post(body)),

  updateRole: (projectKey: string, roleKey: string, body: {name?: string; summary?: string}) =>
    request<Role>(`/projects/${projectKey}/roles/${roleKey}`, patch(body)),

  archiveRole: (projectKey: string, roleKey: string) =>
    request<Role>(`/projects/${projectKey}/roles/${roleKey}`, del()),

  restoreRole: (projectKey: string, roleKey: string) =>
    request<Role>(`/projects/${projectKey}/roles/${roleKey}/restore`, post()),

  listRoleVersions: (projectKey: string, roleKey: string) =>
    request<{versions: RoleVersion[]}>(`/projects/${projectKey}/roles/${roleKey}/versions`).then(
      (r) => r.versions ?? [],
    ),

  // Правка инструкции — новая версия, а не изменение существующей.
  createRoleVersion: (projectKey: string, roleKey: string, body: Record<string, unknown>) =>
    request<RoleVersion>(`/projects/${projectKey}/roles/${roleKey}/versions`, post(body)),

  // ── задачи ────────────────────────────────────────────────────────────────
  listTasks: (projectKey: string, filter: {type?: string; parent?: string} = {}) => {
    const query = new URLSearchParams();
    if (filter.type) query.set('type', filter.type);
    if (filter.parent) query.set('parent', filter.parent);
    const suffix = query.size > 0 ? `?${query}` : '';
    return request<{tasks: Task[]}>(`/projects/${projectKey}/tasks${suffix}`).then((r) =>
      r.tasks.map(normalizeTask),
    );
  },

  createTask: (projectKey: string, body: Record<string, unknown>) =>
    request<Task>(`/projects/${projectKey}/tasks`, post(body)).then(normalizeTask),

  getTask: (taskKey: string) =>
    request<TaskDetail>(`/tasks/${taskKey}`).then((d) => ({
      ...d,
      task: normalizeTask(d.task),
      stage_runs: d.stage_runs ?? [],
      artifacts: d.artifacts ?? [],
      transitions: (d.transitions ?? []).map((t) => ({...t, gates: t.gates ?? []})),
      children: (d.children ?? []).map(normalizeTask),
      links: d.links ?? [],
    })),

  // Назначение адресное: назначенную задачу заберёт только этот принципал
  // (решение 0025). Пустой хэндл снимает назначение.
  assignTask: (taskKey: string, assignee: string) =>
    request<Task>(`/tasks/${taskKey}/assignee`, put({assignee})).then(normalizeTask),

  timeline: (taskKey: string) =>
    request<{events: TaskEvent[]}>(`/tasks/${taskKey}/timeline`).then((r) => r.events),

  updateScope: (taskKey: string, body: Record<string, unknown>) =>
    request<Task>(`/tasks/${taskKey}/scope`, patch(body)).then(normalizeTask),

  listArtifacts: (taskKey: string) =>
    request<{artifacts: Artifact[]}>(`/tasks/${taskKey}/artifacts`).then((r) => r.artifacts ?? []),

  submitArtifact: (taskKey: string, body: Record<string, unknown>) =>
    request<Artifact>(`/tasks/${taskKey}/artifacts`, post(body)),

  // Содержимое приезжает сырым телом со своим media type, а не в конверте:
  // артефакт может быть чем угодно, от markdown до диаграммы.
  artifactContent: (id: UUID) => requestText(`/artifacts/${id}/content`),

  approveArtifact: (id: UUID) => request<Artifact>(`/artifacts/${id}/approve`, post()),

  // ── движение задачи ───────────────────────────────────────────────────────
  taskTransitions: (taskKey: string) =>
    request<{transitions: TransitionOption[]}>(`/tasks/${taskKey}/transitions`).then((r) =>
      (r.transitions ?? []).map((t) => ({...t, gates: t.gates ?? []})),
    ),

  execute: (taskKey: string, transitionKey: string, comment?: string) =>
    request<{task: Task}>(`/tasks/${taskKey}/transitions/${transitionKey}`, post({comment})),

  decideGate: (
    taskKey: string,
    transitionKey: string,
    gateKey: string,
    body: {status: string; details?: unknown},
  ) =>
    request<unknown>(
      `/tasks/${taskKey}/transitions/${transitionKey}/gates/${gateKey}/decision`,
      post(body),
    ),
};
