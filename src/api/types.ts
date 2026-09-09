// Типы повторяют JSON бэкенда, который в свою очередь повторяет схему БД
// (../backend/migrations). При расхождении права схема.

export type UUID = string;

export interface Project {
  id: UUID;
  key: string;
  name: string;
  description?: string;
  settings: Record<string, unknown>;
  // Команда-владелец: её лид — администратор проекта по умолчанию.
  owner_team_id?: UUID;
  owner_team_key?: string;
  // Ссылка на установку GitHub App и имя секрета для запасного пути; сами
  // секреты в базе не лежат (решение 0028).
  github_installation_id?: number;
  github_credential_ref?: string;
  created_at: string;
  updated_at: string;
  archived_at?: string;
}

// Команды (решение 0027). Уровень в проекте у команды тот же, что у человека,
// и действующий уровень участника — максимум из путей: поимённо, через команду
// и через владение проектом.
// Вид команды (решение 0033): личный аккаунт заводится при первом входе и
// участников не принимает, организацию заводит любой вошедший.
export type TeamKind = "personal" | "organization";

export interface Team {
  id: UUID;
  key: string;
  name: string;
  description?: string;
  kind: TeamKind;
  personal_of?: UUID;
  can_create_projects: boolean;
  created_at: string;
  updated_at: string;
  archived_at?: string;
}

export type TeamRole = "member" | "lead";

export interface TeamMember {
  team_id: UUID;
  team_key: string;
  team_kind: TeamKind;
  principal_id: UUID;
  handle: string;
  kind: "user" | "agent" | "system";
  display_name: string;
  role: TeamRole;
  created_at: string;
}

export interface ProjectTeam {
  project_id: UUID;
  project_key: string;
  team_id: UUID;
  team_key: string;
  team_name: string;
  level: MemberRole;
  // Роли специалистов для участников команды; null — любые.
  role_keys: string[] | null;
  created_at: string;
}

// Тариф — набор пределов (решение 0033); отсутствующий предел значит «без
// предела». Команда без подписки живёт на free.
export interface Plan {
  code: string;
  name: string;
  members_max?: number;
  created_at: string;
}

export interface TeamDetail {
  team: Team;
  members: TeamMember[];
  projects: ProjectTeam[];
  plan: Plan;
}

// Расход считается по проектам, которыми команда владеет, за календарное окно.
// Предела может не быть — тогда есть только расход.
export interface BudgetState {
  team_key?: string;
  period?: "day" | "week" | "month";
  limit_usd?: number;
  spent_usd: number;
}

export interface TeamBudgets {
  team: Team;
  budgets: BudgetState[];
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

// Настройки доступа к GitHub у проекта (решение 0028): в базе ссылки, а не
// секреты — идентификатор установки приложения либо имя секрета в окружении.
export interface GitHubStatus {
  installation_id?: number;
  credential_ref?: string;
  app_configured: boolean;
  repositories: RepoAccess[];
}

export interface RepoAccess {
  repository: string;
  ok: boolean;
  error?: string;
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

export type WorkflowState = "draft" | "active" | "retired";

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
  priority: "low" | "normal" | "high" | "urgent";
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
  // stage — обычный прогон этапа, review — вложенная перепроверка
  // (решение 0017).
  kind: string;
  role_id?: UUID;
  role_key?: string;
  role_version_id?: UUID;
  attempt: number;
  state: string;
  claimed_by?: UUID;
  claimed_by_handle?: string;
  claimed_at?: string;
  lease_expires_at?: string;
  heartbeat_at?: string;
  agent_session_ref?: string;
  // Заполнены только у перепроверки: чей результат она проверяет и по какому
  // гейту запущена.
  parent_run_id?: UUID;
  gate_id?: UUID;
  // Этап, который откатил задачу сюда.
  rejected_from_run_id?: UUID;
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
  status: "pending" | "passed" | "failed" | "waived" | "skipped";
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
  direction: "outgoing" | "incoming";
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

export type MemberRole = "viewer" | "agent" | "maintainer" | "admin";

export interface Principal {
  id: UUID;
  kind: "user" | "agent" | "system";
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
  kind: "user" | "agent" | "system";
  display_name: string;
  role: MemberRole;
  // Роли специалистов, которые участник может забирать (решение 0030).
  // null — любые роли проекта, пустой список — ни одной.
  role_keys: string[] | null;
  created_at: string;
}

export interface AccessToken {
  id: UUID;
  principal_id: UUID;
  handle: string;
  kind: "user" | "agent" | "system";
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
  mode: "header" | "token";
  authenticated: boolean;
  principal: Principal;
  token?: AccessToken;
  memberships: ProjectMember[];
  // Команды показываются отдельно: права из них приходят в проекты, которых
  // в memberships нет.
  teams: TeamMember[];
  // Сработает ли кнопка «Новый проект»: открытое создание, администратор
  // системы или лид команды с правом на это. Бэкенд решает, интерфейс лишь
  // не показывает кнопку тому, у кого она отобьётся.
  can_create_projects: boolean;
}

// Вход через корпоративного провайдера (решение 0027). Адреса приходят из
// discovery-документа: фронтенд их не выдумывает.
export interface OIDCSettings {
  enabled: boolean;
  issuer?: string;
  client_id?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  end_session_endpoint?: string;
  scopes?: string;
}

// Вход через GitHub (решение 0030). Секрета клиента здесь нет: код
// авторизации меняет бэкенд.
export interface GitHubSettings {
  enabled: boolean;
  client_id?: string;
  authorization_endpoint?: string;
  scopes?: string;
}

// Сессия — обычный токен с коротким сроком, а не второй транспорт.
export interface Session {
  token: string;
  expires_at: string;
  principal: Principal;
  record: AccessToken;
}

export interface IssuedToken {
  token: string;
  record: AccessToken;
}

// Запрос входа CLI (решение 0032): clab показал код, человек подтверждает
// его здесь. Секрета в записи нет.
export interface CLILoginRequest {
  id: UUID;
  user_code: string;
  label: string;
  token_days: number;
  created_at: string;
  expires_at: string;
  approved_handle?: string;
  approved_at?: string;
  denied_at?: string;
  consumed_at?: string;
}

export interface CLILoginView {
  request: CLILoginRequest;
  status: "pending" | "approved" | "denied" | "expired" | "consumed";
}

export interface ProjectDocument {
  id: UUID;
  project_id: UUID;
  kind: string;
  title: string;
  source: "inline" | "url" | "repo_path";
  url?: string;
  repository?: string;
  repo_path?: string;
  blob_sha?: string;
  meta: Record<string, unknown>;
}

// Связка переноса правил (решение 0022). Форма открытая: UI показывает и
// передаёт её как JSON, не разбирая по полям.
export type Bundle = Record<string, unknown> & { version: number };

export interface ImportEntry {
  key: string;
  outcome:
    "created" | "updated" | "unchanged" | "new_version" | "draft_created";
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
  dimension: "status" | "role" | "model";
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

// ── дрейф кодовой базы ──────────────────────────────────────────────────────

export interface TaskBaseline {
  repository: string;
  branch: string;
  commit: string;
  set_at: string;
}

export interface DriftSignal {
  id: UUID;
  task_id: UUID;
  kind: string;
  severity: string;
  state: string;
  repository?: string;
  from_commit?: string;
  to_commit?: string;
  related_task?: string;
  overlap?: unknown;
  detected_at: string;
  resolution?: string;
  resolved_at?: string;
}

export interface Drift {
  baselines: TaskBaseline[];
  signals: DriftSignal[];
}

// ── индекс и поиск ──────────────────────────────────────────────────────────

// Строка на репозиторий по последнему прогону индексации. Отношение reused к
// indexed показывает, во что обошлась инкрементальность.
export interface IndexStatusRow {
  repository: string;
  index_enabled: boolean;
  watch_branches: string[];
  last_indexed_at?: string;
  branch?: string;
  commit?: string;
  state?: string;
  kind?: string;
  files_indexed?: number;
  files_reused?: number;
  chunks_indexed?: number;
  chunks_reused?: number;
  chunks_embedded?: number;
  attempt?: number;
  error?: string;
  finished_at?: string;
}

export interface SearchHit {
  scope: string;
  score: number;
  match: string;
  repository?: string;
  path?: string;
  lang?: string;
  commit?: string;
  start_line?: number;
  end_line?: number;
  symbol_fqn?: string;
  artifact_id?: UUID;
  document_id?: UUID;
  task?: string;
  stage?: string;
  kind?: string;
  title?: string;
  text: string;
}

export interface SearchResult {
  query: string;
  // hybrid — вектор плюс полнотекст, text — только полнотекст: провайдер
  // эмбеддингов выключен или недоступен, и находится заметно меньше.
  mode: string;
  scopes: string[];
  results: SearchHit[];
}

// ── очередь работы ──────────────────────────────────────────────────────────

// Незакрытый прогон проекта: и этап, и перепроверка. Отсюда доска узнаёт, кто
// держит задачу прямо сейчас.
export interface QueueEntry {
  task: Task;
  stage_run: StageRun;
  role_key?: string;
  role_name?: string;
  claimable: boolean;
}
