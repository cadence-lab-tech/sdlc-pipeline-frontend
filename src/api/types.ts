// Типы повторяют JSON бэкенда, который в свою очередь повторяет схему БД
// (../backend/migrations). При расхождении права схема.

export type UUID = string;

export interface Project {
  id: UUID;
  key: string;
  name: string;
  description?: string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  archived_at?: string;
}

export interface Repository {
  id: UUID;
  project_id: UUID;
  provider: string;
  owner: string;
  name: string;
  default_branch: string;
  clone_url: string;
  visibility: string;
  access_mode: string;
  role_hint?: string;
}

// Определения свойств задачи приходят из API: форма свойств рендерится по ним,
// а не по захардкоженному списку полей.
export interface TaskPropertyDef {
  id: UUID;
  key: string;
  name: string;
  description?: string;
  value_type: string;
  default_value?: unknown;
  enum_values?: string[];
  is_system: boolean;
  expose_to_agent: boolean;
  position: number;
}

export interface ProjectDetail {
  project: Project;
  repositories: Repository[];
  task_property_defs: TaskPropertyDef[];
  // Действующие циклы: по ним видно, задачу какого типа вообще можно завести.
  active_workflows: WorkflowHead[];
}

export interface StatusRole {
  role_id: UUID;
  role_key: string;
  role_name: string;
  is_primary: boolean;
  position: number;
}

export interface Status {
  id: UUID;
  workflow_id: UUID;
  key: string;
  name: string;
  description?: string;
  category: string;
  position: number;
  is_initial: boolean;
  is_terminal: boolean;
  wip_limit?: number;
  color?: string;
  roles?: StatusRole[];
}

export interface Gate {
  id: UUID;
  transition_id: UUID;
  key: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  blocking: boolean;
  position: number;
}

export interface Transition {
  id: UUID;
  workflow_id: UUID;
  key: string;
  name: string;
  // null — «из любого статуса»: так устроена отмена
  from_status_id: UUID | null;
  to_status_id: UUID;
  kind: string;
  auto: boolean;
  position: number;
  gates?: Gate[];
}

export type WorkflowState = 'draft' | 'active' | 'retired';

export interface WorkflowHead {
  id: UUID;
  project_id: UUID;
  name: string;
  version: number;
  state: WorkflowState;
  // Типы задач, которые ведёт цикл: активных циклов у проекта столько, сколько
  // типов, но на один тип — ровно один (решение 0024).
  task_types: string[];
}

export interface Workflow extends WorkflowHead {
  statuses: Status[];
  transitions: Transition[];
}

export interface TaskRepository {
  repository_id: UUID;
  owner: string;
  name: string;
  role_hint?: string;
  is_primary: boolean;
}

export interface Task {
  id: UUID;
  project_id: UUID;
  project_key: string;
  // Родительская задача: эпик для своих детей. Иерархия — ссылка, ключи задач
  // остаются плоскими.
  parent_id?: UUID;
  parent_key?: string;
  key: string;
  seq: number;
  title: string;
  description?: string;
  workflow_id: UUID;
  status_id: UUID;
  status_key: string;
  status_name: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  assignee_id?: UUID;
  assignee_handle?: string;
  external_ref: Record<string, unknown>;
  labels: string[];
  properties: Record<string, unknown>;
  repositories: TaskRepository[];
  blocked_reason?: string;
  created_at: string;
  updated_at: string;
  closed_at?: string;
}

export interface StageRun {
  id: UUID;
  task_id: UUID;
  status_id: UUID;
  status_key: string;
  role_id?: UUID;
  role_version_id?: UUID;
  attempt: number;
  state: string;
  claimed_by?: UUID;
  claimed_at?: string;
  lease_expires_at?: string;
  entered_at: string;
  finished_at?: string;
  outcome?: string;
  summary?: string;
}

export interface Artifact {
  id: UUID;
  task_id: UUID;
  project_id: UUID;
  stage_run_id?: UUID;
  kind: string;
  title: string;
  format: string;
  // содержимое лежит в контент-адресуемом blob, здесь только его хеш
  blob_sha: string;
  size_bytes: number;
  version: number;
  supersedes_id?: UUID;
  status: string;
  produced_by?: UUID;
  approved_by?: UUID;
  meta: Record<string, unknown>;
  created_at: string;
}

// Вердикт по одному гейту. Считает бэкенд, фронтенд его только показывает.
export interface GateCheck {
  gate_key: string;
  gate_name: string;
  type: string;
  blocking: boolean;
  status: 'pending' | 'passed' | 'failed' | 'waived' | 'skipped';
  reason?: string;
  details?: Record<string, unknown>;
}

export interface TransitionOption {
  key: string;
  name: string;
  kind: string;
  to_status: string;
  allowed: boolean;
  gates: GateCheck[];
}

// Связь между задачами. blocks задаёт порядок работ и читается гейтом
// dependencies_closed, остальные отношения — контекст.
export interface TaskLink {
  rel: string;
  direction: 'outgoing' | 'incoming';
  task_id: UUID;
  task_key: string;
  task_title: string;
  status_key: string;
  note?: string;
}

// Стоимость задачи (решение 0026). silent_runs — прогоны, о которых никто не
// отчитался: их стоимость неизвестна, а не равна нулю.
export interface UsageSummary {
  cost_usd: number;
  subtree_cost_usd: number;
  tokens: number;
  reported_runs: number;
  silent_runs: number;
}

export interface TaskDetail {
  task: Task;
  stage_runs: StageRun[];
  artifacts: Artifact[];
  transitions: TransitionOption[];
  // Дочерние задачи: у эпика это его нарезка.
  children: Task[];
  links: TaskLink[];
  usage: UsageSummary;
}

export interface TaskEvent {
  id: UUID;
  task_id: UUID;
  stage_run_id?: UUID;
  type: string;
  actor_id?: UUID;
  actor_handle?: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface Role {
  id: UUID;
  project_id: UUID;
  key: string;
  name: string;
  summary?: string;
  archived_at?: string;
  latest_version?: number;
}

// Контракт вывода роли: kind каждого пункта — то, на что ссылается гейт
// artifacts_required. Поэтому пункт без kind бэкенд не принимает.
export interface OutputContractItem {
  kind: string;
  title?: string;
  format?: string;
  required?: boolean;
}

export interface RoleVersion {
  id: UUID;
  role_id: UUID;
  version: number;
  instructions: string;
  input_kinds: string[];
  output_contract: OutputContractItem[];
  tool_policy: Record<string, unknown>;
  model_hint?: string;
  repo_scope: string[];
  context_budget: Record<string, unknown>;
  changelog?: string;
  created_at: string;
}

export interface WorkflowProblem {
  code: string;
  message: string;
  status?: string;
  transition?: string;
  gate?: string;
}

export interface Validation {
  valid: boolean;
  problems: WorkflowProblem[];
  warnings: WorkflowProblem[];
}

export interface OpenTaskOnWorkflow {
  task: string;
  status: string;
}

export interface RoleUsage {
  workflow_id: UUID;
  workflow_state: WorkflowState;
  status_key: string;
  is_primary: boolean;
}

export interface RoleWithVersions {
  role: Role;
  versions?: RoleVersion[];
  latest_version?: RoleVersion;
  used_on: RoleUsage[];
}

export interface ActivationResult {
  workflow: WorkflowHead;
  retired_workflow_id?: UUID;
  retired_workflow_ids?: UUID[];
  tasks_on_previous_version: OpenTaskOnWorkflow[];
  warnings: WorkflowProblem[];
}

// ── фаза 4: аутентификация, участники, перенос правил, метрики ─────────────

export type MemberRole = 'viewer' | 'agent' | 'maintainer' | 'admin';

export interface Principal {
  id: UUID;
  kind: 'user' | 'agent' | 'system';
  handle: string;
  display_name: string;
  email?: string;
  is_admin: boolean;
  created_at: string;
}

export interface ProjectMember {
  project_id: UUID;
  project_key: string;
  principal_id: UUID;
  handle: string;
  kind: 'user' | 'agent' | 'system';
  display_name: string;
  role: MemberRole;
  created_at: string;
}

export interface AccessToken {
  id: UUID;
  principal_id: UUID;
  handle: string;
  kind: 'user' | 'agent' | 'system';
  project_id?: UUID;
  project_key?: string;
  name: string;
  prefix: string;
  role_keys: string[];
  created_at: string;
  expires_at?: string;
  last_used_at?: string;
  revoked_at?: string;
}

// Ответ /auth/me. mode = header означает, что актор назван заголовком и не
// проверен; в этом режиме форма входа не нужна.
export interface Me {
  mode: 'header' | 'token';
  authenticated: boolean;
  principal: Principal;
  token?: AccessToken;
  memberships: ProjectMember[];
}

export interface IssuedToken {
  token: string;
  record: AccessToken;
}

export interface ProjectDocument {
  id: UUID;
  project_id: UUID;
  kind: string;
  title: string;
  source: 'inline' | 'url' | 'repo_path';
  url?: string;
  repository?: string;
  repo_path?: string;
  blob_sha?: string;
  meta: Record<string, unknown>;
}

// Связка переноса правил (решение 0022). Форма открытая: UI показывает и
// передаёт её как JSON, не разбирая по полям.
export type Bundle = Record<string, unknown> & {version: number};

export interface ImportEntry {
  key: string;
  outcome: 'created' | 'updated' | 'unchanged' | 'new_version' | 'draft_created';
  detail?: string;
  id?: string;
}

export interface ImportReport {
  dry_run: boolean;
  repositories: ImportEntry[];
  roles: ImportEntry[];
  documents: ImportEntry[];
  // Циклов в связке столько, сколько типов задач; проверка графа — по каждому
  // в том же порядке.
  workflows: ImportEntry[];
  workflow_validations: Validation[];
}

export interface StatusMetric {
  status: string;
  status_name: string;
  open_tasks: number;
  finished_runs: number;
  avg_hours: number;
  median_hours: number;
  max_hours: number;
  rejections: number;
  repeated_runs: number;
  expired_leases: number;
}

export interface GateMetric {
  transition: string;
  gate: string;
  gate_name: string;
  type: string;
  passed: number;
  failed: number;
  waived: number;
  pending: number;
}

export interface DriftMetric {
  kind: string;
  severity: string;
  open: number;
  resolved: number;
  dismissed: number;
}

// Стоимость в одном разрезе: по статусу, по роли, по модели. Прогоны без
// отчёта считаются отдельно — «неизвестно» не то же самое, что ноль.
export interface CostMetric {
  dimension: 'status' | 'role' | 'model';
  key: string;
  name?: string;
  runs: number;
  reported_runs: number;
  silent_runs: number;
  cost_usd: number;
  avg_cost_usd: number;
  tokens: number;
}

export interface Metrics {
  since: string;
  until: string;
  throughput: {
    created: number;
    closed: number;
    cancelled: number;
    avg_lead_hours: number;
    review_runs: number;
    review_fails: number;
  };
  statuses: StatusMetric[];
  gates: GateMetric[];
  drift: DriftMetric[];
  cost: CostMetric[];
}
