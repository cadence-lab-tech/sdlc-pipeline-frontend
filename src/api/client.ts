// Клиент REST-API. Ошибку бэкенда разбирает в ApiError с кодом домена: коды
// общие для REST и MCP, и UI ветвится по коду, а не по тексту сообщения.

import type {
  ActivationResult,
  Artifact,
  Project,
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

// Аутентификации пока нет (решение 0010): действующее лицо приезжает
// заголовком и заводится в principals при первом обращении.
const ACTOR_KEY = 'sdlc.actor';

export function currentActor(): string {
  return localStorage.getItem(ACTOR_KEY) ?? 'web';
}

export function setCurrentActor(handle: string): void {
  localStorage.setItem(ACTOR_KEY, handle);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-SDLC-Actor': currentActor(),
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
    const err = (body as {error?: {code: ErrorCode; message: string; details?: unknown}})?.error;
    throw new ApiError(
      err?.code ?? 'internal',
      err?.message ?? `запрос завершился со статусом ${res.status}`,
      err?.details,
      res.status,
    );
  }
  return body as T;
}

async function requestText(path: string): Promise<string> {
  const res = await fetch(BASE + path, {headers: {'X-SDLC-Actor': currentActor()}});
  const text = await res.text();
  if (!res.ok) {
    throw new ApiError('internal', `не удалось прочитать содержимое (${res.status})`, undefined, res.status);
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
  // ── проекты ───────────────────────────────────────────────────────────────
  listProjects: () => request<{projects: Project[]}>('/projects').then((r) => r.projects),

  getProject: (key: string) => request<ProjectDetail>(`/projects/${key}`),

  createProject: (body: {key: string; name: string; description?: string}) =>
    request<Project>('/projects', post(body)),

  // ── цикл ──────────────────────────────────────────────────────────────────
  getWorkflow: (projectKey: string) =>
    request<Workflow>(`/projects/${projectKey}/workflow`).then(normalizeWorkflow),

  listWorkflows: (projectKey: string) =>
    request<{workflows: WorkflowHead[]}>(`/projects/${projectKey}/workflows`).then((r) => r.workflows),

  createDraft: (projectKey: string, body: {name?: string; from?: string}) =>
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
  listTasks: (projectKey: string) =>
    request<{tasks: Task[]}>(`/projects/${projectKey}/tasks`).then((r) => r.tasks.map(normalizeTask)),

  createTask: (projectKey: string, body: Record<string, unknown>) =>
    request<Task>(`/projects/${projectKey}/tasks`, post(body)).then(normalizeTask),

  getTask: (taskKey: string) =>
    request<TaskDetail>(`/tasks/${taskKey}`).then((d) => ({
      ...d,
      task: normalizeTask(d.task),
      stage_runs: d.stage_runs ?? [],
      artifacts: d.artifacts ?? [],
      transitions: (d.transitions ?? []).map((t) => ({...t, gates: t.gates ?? []})),
    })),

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
