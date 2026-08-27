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
  epic_id?: UUID;
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

export interface TaskDetail {
  task: Task;
  stage_runs: StageRun[];
  artifacts: Artifact[];
  transitions: TransitionOption[];
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
  tasks_on_previous_version: OpenTaskOnWorkflow[];
  warnings: WorkflowProblem[];
}
