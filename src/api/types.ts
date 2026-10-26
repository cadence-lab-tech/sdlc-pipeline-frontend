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
  // Тариф бывает не везде: при SDLC_TENANCY=single (CLAB-88) тарифов нет, и
  // бэкенд поле не отдаёт вовсе.
  plan?: Plan;
  // Установки GitHub App, записанные на команду (решение 0034).
  installations: GitHubInstallation[];
}

// Расход считается по проектам, которыми команда владеет, за календарное окно.
// Предела может не быть — тогда есть только расход.
export interface BudgetState {
  team_key?: string;
  period?: "day" | "week" | "month";
  limit_usd?: number;
  // Деньги: строки API и без признака оплаты. Только они идут против предела.
  spent_usd: number;
  // Условная стоимость работы на подписке за то же окно (решение 0062):
  // для сведения, в предел не входит никогда.
  subscription_usd: number;
}

export interface TeamBudgets {
  team: Team;
  budgets: BudgetState[];
}

// ── цена удаления ───────────────────────────────────────────────────────────
// Что ушло вместе с объектом. Счётчики бэкенд считает до удаления и отдаёт
// только в ответе: ручки-предпросмотра нет, поэтому диалог называет
// категории, а числа показываются после действия.

export interface TeamRemoval {
  projects: number;
  project_keys: string[];
  members: number;
  // Участие команды в чужих проектах: те проекты остаются, исчезает доступ.
  project_grants: number;
  invites: number;
  installations: number;
  budgets: number;
  idp_groups: number;
}

export interface ProjectRemoval {
  tasks: number;
  stage_runs: number;
  artifacts: number;
  repositories: number;
  index_runs: number;
  code_files: number;
  code_chunks: number;
  documents: number;
  members: number;
  tokens: number;
  roles: number;
  workflows: number;
  invites: number;
  cost_usd: number;
}

export interface RepositoryRemoval {
  index_runs: number;
  code_files: number;
  code_chunks: number;
  documents: number;
  drift_signals_dismissed: number;
}

export interface TeamRemoved {
  team: Team;
  removed: TeamRemoval;
}

export interface ProjectRemoved {
  project: Project;
  removed: ProjectRemoval;
}

export interface RepositoryRemoved {
  repository: Repository;
  removed: RepositoryRemoval;
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
  // Установка приложения, которой репозиторий читается (решение 0034);
  // пусто — учётные данные проекта или инстанса.
  installation_id?: number;
  // Репозиторий убран из установки на стороне GitHub: индексация стоит,
  // собранный индекс живёт.
  unavailable_at?: string;
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
  // Состояние приложения, проверенное этим же вызовом. Бэкенд до CLAB-79
  // поля не отдаёт.
  app?: GitHubAppStatus;
  repositories: RepoAccess[];
}

// Состояние приложения GitHub у провайдера (CLAB-79). app_configured —
// «настроено», а не «работает»: принимает ли провайдер ключ, говорит state.
// unknown — проверить не удалось, это не отказ ключа.
export interface GitHubAppStatus {
  state: "ok" | "rejected" | "unknown" | "not_configured" | (string & {});
  // Ответ провайдера при rejected, причина при unknown.
  error?: string;
  checked_at?: string;
  // Измеренное расхождение часов; плюс — часы машины отстают от провайдера.
  clock_offset_seconds?: number;
}

// Сводка состояния проекта для оболочки: отметки в боковом меню. Текста
// провайдера и расхождения часов в ней нет — подробности в настройках.
export interface ProjectHealth {
  app?: Pick<GitHubAppStatus, "state" | "checked_at">;
  unreadable_repositories?: number;
}

// Установки команды вместе с состоянием приложения.
export interface TeamGitHub {
  installations: GitHubInstallation[];
  app?: GitHubAppStatus;
}

// Установка GitHub App на аккаунт человека или организации (решение 0034).
// Принадлежит команде-арендатору; секретов не несёт.
export interface GitHubInstallation {
  id: UUID;
  installation_id: number;
  account_login: string;
  account_id: number;
  account_type: "User" | "Organization";
  owner_team_id: UUID;
  owner_team_key: string;
  connected_by: UUID;
  created_at: string;
  updated_at: string;
  suspended_at?: string;
  removed_at?: string;
}

// Настройки GitHub проекта при открытии страницы: установки
// команды-владельца, учётные данные самого проекта и состояние приложения
// из кэша бэкенда.
export interface ProjectGitHub {
  owner_team_key: string;
  installations: GitHubInstallation[];
  installation_id?: number;
  credential_ref?: string;
  app_configured: boolean;
  app?: GitHubAppStatus;
}

// Репозиторий на выбор: он в установке команды, и вошедший видит его сам.
export interface GitHubRepoChoice {
  installation_id: number;
  account_login: string;
  owner: string;
  name: string;
  default_branch: string;
  private: boolean;
  clone_url: string;
  description?: string;
}

// Ответ на возврат от GitHub: установки команды, только что подключённая и
// репозитории на выбор.
export interface GitHubConnection {
  team: Team;
  installations: GitHubInstallation[];
  connected?: GitHubInstallation;
  repositories: GitHubRepoChoice[];
}

export interface RepoPick {
  owner: string;
  name: string;
  default_branch: string;
  private: boolean;
  clone_url: string;
  role_hint?: string;
}

export interface AttachResult {
  repositories: Repository[];
  created: number;
}

// Откуда бэкенд взял учётные данные репозитория (решение 0034): от частного
// к общему — секрет репозитория, установка репозитория, установка проекта,
// секрет проекта, токен инстанса.
export type CredentialSource =
  | 'repository_secret'
  | 'repository_installation'
  | 'project_installation'
  | 'project_secret'
  | 'instance';

export interface RepoAccess {
  repository: string;
  ok: boolean;
  error?: string;
  // Чем проверяли. Старый бэкенд этих полей не присылает.
  source?: CredentialSource;
  installation_id?: number;
  // Только имя секрета: значение из бэкенда не уходит.
  credential_ref?: string;
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
  // Рекомендованный уровень модели задачи (решение 0060); null — не задан,
  // этап тогда берёт уровень роли. Бэкенд старше CLAB-259 поля не отдаёт.
  model_level?: ModelLevel | null;
  // Уровни этапов: ключ статуса цикла → настройки этапа. Нормализуется в
  // {} в api/client.ts. Экран CLAB-262 их не показывает — их берёт панель
  // этапа CLAB-231.
  stage_settings: Record<string, StageSettings>;
  created_at: string;
  updated_at: string;
  closed_at?: string;
}

// Уровень модели — перечень сервера (решение 0060), а не данные проекта;
// подписи к нему — components/modelLevel.ts.
export type ModelLevel = "low" | "medium" | "high";

// Откуда у прогона взят рекомендованный уровень при захвате: уровень
// этапа, задачи, роли или ниоткуда.
export type ModelLevelSource = "stage" | "task" | "role" | "none";

export interface StageSettings {
  model_level?: ModelLevel;
}

// Учёт одного прогона в карточке задачи (форма CLAB-264): сумма отчётов о
// стоимости. reported: false — «нет учёта», и тогда суммы null, а не ноль.
// Числа складываются только по отчётам, где они есть.
// Состояние учёта прогона (CLAB-219): reported — отчёт есть, missing — агент
// работал, а отчёта нет («без учёта»), not_applicable — агент не работал.
// Перечень движка; незнакомое значение показывается как есть.
export type UsageState = "reported" | "missing" | "not_applicable";

export interface RunUsage {
  reported: boolean;
  // Нет поля — бэкенд старше CLAB-219: прогон без отчёта считается missing.
  state?: UsageState;
  reports: number;
  // Модели как пришли, без повторов, по времени первого отчёта.
  models: string[];
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  cost_usd: number | null;
  duration_ms: number | null;
  // Раздельно по признаку оплаты (решение 0062); null — строк с такой
  // стоимостью нет, а не ноль. Деньги — api и без признака,
  // unspecified — часть денег без признака, subscription — условная
  // стоимость.
  api_cost_usd: number | null;
  unspecified_cost_usd: number | null;
  subscription_cost_usd: number | null;
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
  // Снимок рекомендованного уровня при захвате (решение 0060). У прогона,
  // заведённого до снимка или ещё не забранного, обоих полей нет — это
  // «снимка не было», а не источник none.
  model_level?: ModelLevel;
  model_level_source?: ModelLevelSource;
  // Учёт прогона — только в карточке задачи (GET /v1/tasks/:key); бэкенд
  // без CLAB-264 его не отдаёт.
  usage?: RunUsage;
  // Поля карточки CLAB-283 — только в GET /v1/tasks/:key. Номер версии роли
  // (role_versions.version); null у прогона без роли, нет поля — бэкенд
  // старше CLAB-283.
  role_version?: number | null;
  // Вердикты гейтов прогона, как их записал движок; у прогона без записей
  // — []. Нормализуется в [] в api/client.ts.
  gate_results: RunGateVerdict[];
  // Чем прогон закончен: null, пока идёт, и у перепроверки (её итог —
  // outcome и summary). Нормализуется в null в api/client.ts.
  exit: RunExit | null;
}

// Вердикт гейта на выходе прогона — запись gate_results вместе с именем
// гейта и ключом перехода. Последнее состояние, а не история решений.
export interface RunGateVerdict {
  gate_key: string;
  gate_name: string;
  gate_type: string;
  transition_key: string;
  status: GateCheck["status"];
  details: Record<string, unknown> | null;
  // null — вердикт вынес движок, а не человек.
  decided_by_handle: string | null;
  decided_at: string | null;
}

// Выход прогона: переход, которым он закончен (событие task.advanced /
// task.rejected / task.cancelled прогона).
export interface RunExit {
  kind: "advanced" | "rejected" | "cancelled";
  transition: string;
  // Ключ статуса, куда ушла задача, — из версии цикла задачи.
  to_status: string;
  comment: string | null;
  by_handle: string | null;
  at: string;
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
  // Раздельно по признаку оплаты (решение 0062): cost_usd = api + subscription,
  // unspecified — часть денег без признака.
  api_cost_usd: number;
  unspecified_cost_usd: number;
  subscription_cost_usd: number;
  subtree_api_cost_usd: number;
  subtree_unspecified_cost_usd: number;
  subtree_subscription_cost_usd: number;
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

// Привязка задачи к репозиторию: PR, ветка или коммит. Вид привязки —
// перечень схемы (`task_repo_refs.ref_type`), состояние приходит от GitHub.
// В ответе задачи привязок нет, они приезжают отдельным запросом.
export interface TaskRepoRef {
  id: UUID;
  task_id: UUID;
  repository_id: UUID;
  // owner/name — бэкенд склеивает его при чтении
  repository: string;
  ref_type: "branch" | "pull_request" | "commit";
  ref: string;
  url?: string;
  state?: string;
  meta: Record<string, unknown>;
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
  // Устарел (решение 0060): строка модели для раннера прежних версий. На
  // экране её нет, новая версия из формы переносит значение базовой.
  model_hint?: string;
  // Уровень модели роли по умолчанию; поля нет — уровень не задан.
  model_level?: ModelLevel;
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

export interface MovedTask {
  task: string;
  from_status: string;
  to_status: string;
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
  // Списки обрезаны сервером до первых ключей; полное число — в *_total.
  tasks_on_previous_version: OpenTaskOnWorkflow[];
  tasks_on_previous_version_total?: number;
  // Задачи из бэклога, переехавшие на активированную версию (решение 0036).
  tasks_moved?: MovedTask[];
  tasks_moved_total?: number;
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

// Запись журнала действий (CLAB-210, MCP_CONTRACT.md «Журнал действий»):
// кто, каким токеном, через какой канал и каким вызовом действовал, с каким
// исходом. Лента задачи — это что случилось с задачей; журнал — кто что
// вызывал, включая отказы.
export interface AuditEntry {
  id: UUID;
  at: string;
  project_key: string | null;
  task_key: string | null;
  // null — отказ 401 по токену, которого нет в базе.
  principal: {handle: string; kind: string} | null;
  // Снимок токена на момент вызова; null — без токена (режим header).
  // kind — вид из agent_tokens.kind: api, session, task или новый вид,
  // который интерфейс показывает как есть.
  token: {id: UUID | null; name: string | null; prefix: string | null; kind: string | null} | null;
  channel: string;
  // Имя тула или «МЕТОД шаблон пути».
  action: string;
  params: unknown;
  outcome: {ok: boolean; code: string | null; status: number | null};
  request_id: string | null;
}

// Страница журнала, новые сверху; next — курсор следующей, null — дальше
// ничего.
export interface AuditPage {
  entries: AuditEntry[];
  next: string | null;
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

// Сведения об инстансе (CLAB-87): открытая ручка GET /v1/instance, тот же
// ответ, что в backend/internal/workflow/instance.go. Профиль — tenancy:
// shared у нашего общего инстанса, single у инстанса компании (CLAB-88).
export type Tenancy = "shared" | "single";

export interface Instance {
  // vX.Y.Z у выпуска, SHA у нашего инстанса, dev у локальной сборки.
  version: string;
  tenancy: Tenancy;
  project_creation: "open" | "teams";
  login: {
    methods: ("token" | "github" | "oidc")[];
    github?: GitHubSettings & { available: boolean };
    oidc?: OIDCSettings & { available: boolean; error?: string };
  };
}

// Набор агента инстанса (GET /v1/agent-kit, CLAB-232): скилы и саб-агент той
// же версии, что сервер. Содержимое файлов странице не нужно — только
// перечень с описаниями; ставит набор clab setup.
export interface AgentKitEntry {
  name: string;
  description: string;
}

export interface AgentKit {
  version: string;
  skills: AgentKitEntry[];
  agents: AgentKitEntry[];
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
  // Куда ведёт «Подключить GitHub»; пусто — слаг приложения не задан.
  install_url?: string;
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

// ── приглашения (решение 0035) ──

export type InviteTargetKind = "team" | "project";

// Статус вычисляется бэкендом на момент чтения; конечные состояния важнее
// срока: принятое после срока приглашение остаётся принятым.
export type InviteStatus = "pending" | "accepted" | "expired" | "revoked";

// Приглашение ссылкой — отложенное участие в организации или проекте. Сам
// токен в нём не лежит: его видно только в ответе на выдачу.
export interface Invite {
  id: UUID;
  target_kind: InviteTargetKind;
  team_key?: string;
  project_key?: string;
  target_name: string;
  // У командного — роль в команде, у проектного — уровень и роли специалистов.
  team_role?: TeamRole;
  level?: MemberRole;
  // null — любые роли проекта, пустой список — ни одной (решение 0030); у
  // командного приглашения всегда null. В [] не нормализуется.
  role_keys: string[] | null;
  status: InviteStatus;
  created_by_handle: string;
  created_at: string;
  expires_at: string;
  accepted_by_handle?: string;
  accepted_at?: string;
  revoked_by_handle?: string;
  revoked_at?: string;
}

// Ответ на выдачу: единственное место, где приходит токен.
export interface IssuedInvite { invite: Invite; token: string; }

// Куда привело приглашение: интерфейсу для перехода после приёма.
export interface InviteTarget {
  kind: InviteTargetKind;
  key: string;
  name: string;
}

export interface AcceptedInvite {
  invite: Invite;
  // Участие уже было и не менялось: смена уровня — прямое действие
  // администратора, а не побочный эффект ссылки.
  already_member: boolean;
  target: InviteTarget;
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
  // Раздельно по признаку оплаты (решение 0062): cost_usd = api + subscription,
  // unspecified — часть денег без признака.
  api_cost_usd: number;
  unspecified_cost_usd: number;
  subscription_cost_usd: number;
}

// Стоимость на закрытую задачу по типу задач (CLAB-220). Закрытые — done за
// период, стоимость — за всю жизнь задачи, у эпика по поддереву. Строки
// «итого» нет: эпик и его задачи считаются каждый в своей строке.
// silent_share — доля 0..1. Среднее и медиана — по всем закрытым задачам типа.
export interface ClosedCostMetric {
  task_type: string;
  closed_tasks: number;
  incomplete_tasks: number;
  runs: number;
  reported_runs: number;
  silent_runs: number;
  silent_share: number;
  api_cost_usd: number;
  avg_api_cost_usd: number;
  median_api_cost_usd: number;
  unspecified_cost_usd: number;
  subscription_cost_usd: number;
  avg_subscription_cost_usd: number;
  median_subscription_cost_usd: number;
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
  // Нет поля — бэкенд старше CLAB-220 («раздел недоступен»); [] — закрытых
  // задач за период нет.
  closed_cost?: ClosedCostMetric[];
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
  // Репозиторий не читается повторно (CLAB-79): прогон в failed, вторая
  // неудачная попытка либо голова ветки, не прочитанная два прохода подряд.
  failure?: IndexFailure;
}

export interface IndexFailure {
  since: string;
  error: string;
  // run — не проходит прогон, head — не читается голова ветки.
  source: "run" | "head" | (string & {});
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
