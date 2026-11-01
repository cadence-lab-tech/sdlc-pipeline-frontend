// Правая панель «Пайплайна» (CLAB-346, design.spec v2 §5): шапка с крошками,
// обзор цикла, статус и переход. Логика правки перенесена из прежнего
// редактора цикла (WorkflowEditor.tsx): те же запросы, те же подтверждения и
// тексты. Панель роли — RolePanel.tsx.
import {useState} from 'react';
import {ArrowDown, ArrowLeft, ArrowUp, ChevronRight, Plus, ScanEye, Undo2, UserRound, X} from 'lucide-react';
import {toast} from 'sonner';

import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Switch} from '@/components/fields';
import {ConfirmButton, EmptyState, Note, Row, RowList, Section, StatusDot, Token} from '@/components/kit';

import {ApiError, api} from '../../api/client';
import type {ActivationResult, Gate, Role, Status, Transition, Validation, Workflow} from '../../api/types';
import {Failure} from '../Feedback';
import {RoleVersionForm} from '../RoleVersionForm';
import {optionalBadges} from '../optionalStage';
import {categoryVariant} from '../status';
import {GateIcon, GateIconRow} from './GateIcons';
import {
  LEGEND_GATE_TYPES,
  NO_GATES_LABEL,
  NO_ROLE_TEXT,
  ROLE_VERSION_HINT,
  gateConfigLine,
  gateLabel,
  versionLabel,
} from './labels';
import {FALLBACK_NOTE, MISSING_MARK, SELECTION_PREFIX, documentsCountLabel, selectionItems, stageDocuments} from './statusDocs';
import {useRoleDocs} from '../../hooks/useRoleDocs';

const toApiError = (err: unknown) => (err instanceof ApiError ? err : new ApiError('internal', String(err)));

export type PipelineDialog =
  | {kind: 'status-new'}
  | {kind: 'status-edit'; status: Status}
  | {kind: 'transition-new'; from?: string}
  | {kind: 'transition-edit'; transition: Transition}
  | {kind: 'gate-new'; transition: Transition}
  | {kind: 'gate-edit'; transition: Transition; gate: Gate}
  | {kind: 'draft-head'};

export function InspectorHeader({
  crumbs,
  onBack,
  onClose,
}: {
  crumbs: string[];
  onBack?: () => void;
  onClose?: () => void;
}) {
  return (
    <div className="bg-background/95 sticky top-0 z-10 flex min-h-11 items-center gap-1 border-b px-3 py-2 backdrop-blur">
      {onBack ? (
        <Button size="icon-sm" variant="ghost" aria-label="Назад" title="Назад" onClick={onBack}>
          <ArrowLeft />
        </Button>
      ) : null}
      <nav aria-label="Где я" className="text-muted-foreground min-w-0 flex-1 truncate text-xs" data-pipeline-crumbs>
        {crumbs.map((c, i) => (
          <span key={i}>
            {i ? ' / ' : ''}
            <span className={i === crumbs.length - 1 ? 'text-foreground font-medium' : ''}>{c}</span>
          </span>
        ))}
      </nav>
      {onClose ? (
        <Button size="icon-sm" variant="ghost" aria-label="Закрыть панель" title="Закрыть панель" onClick={onClose}>
          <X />
        </Button>
      ) : null}
    </div>
  );
}

// ── обзор цикла ─────────────────────────────────────────────────────────────

export interface ValidationState {
  data?: Validation;
  error?: ApiError;
  loading: boolean;
  reload: () => void;
}

export function CycleOverview({
  projectKey,
  workflow,
  roles,
  otherCycles,
  validation,
  showArchived,
  onArchived,
  onRole,
  onStatus,
  onRoleCreated,
}: {
  projectKey: string;
  workflow?: Workflow;
  roles: Role[];
  // Активные версии циклов других типов: подпись «на других циклах: N».
  otherCycles: Workflow[];
  validation?: ValidationState;
  showArchived: boolean;
  onArchived: (v: boolean) => void;
  onRole: (key: string) => void;
  onStatus: (key: string) => void;
  onRoleCreated: (key: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const statuses = workflow?.statuses ?? [];
  const onCycle = roles.filter((r) => statuses.some((s) => s.roles?.some((x) => x.role_key === r.key)));
  const rest = roles.filter((r) => !onCycle.includes(r) && (showArchived || !r.archived_at));
  const gates = (workflow?.transitions ?? []).reduce((n, t) => n + (t.gates?.length ?? 0), 0);
  const elsewhere = (key: string) =>
    otherCycles.filter((w) => w.statuses.some((s) => s.roles?.some((x) => x.role_key === key))).length;

  return (
    <div className="space-y-5 p-4" data-pipeline-overview>
      {workflow ? (
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Цикл {versionLabel(workflow)}</h2>
          <p className="text-muted-foreground text-sm">
            Статусов {workflow.statuses.length} · переходов {workflow.transitions.length} · гейтов {gates}
          </p>
        </div>
      ) : null}
      {workflow && validation ? <ValidationReport validation={validation} onStatus={onStatus} /> : null}

      {roles.length === 0 ? (
        creating ? (
          <RoleVersionForm
            projectKey={projectKey}
            onCancel={() => setCreating(false)}
            onCreated={(key) => {
              setCreating(false);
              onRoleCreated(key);
            }}
          />
        ) : (
          <EmptyState
            title="Заведите роль"
            description="Роль — инструкция агента, который работает на статусе. Поставить её на статус можно в диалоге статуса черновика"
            action={<Button onClick={() => setCreating(true)}>Завести роль</Button>}
          />
        )
      ) : (
        <>
          {workflow ? (
            <Section title="Роли на этом цикле">
              {onCycle.length ? (
                <RowList>
                  {onCycle.map((r) => (
                    <RoleRow
                      key={r.key}
                      role={r}
                      caption={statuses
                        .filter((s) => s.roles?.some((x) => x.role_key === r.key))
                        .map((s) => s.name)
                        .join(', ')}
                      onClick={() => onRole(r.key)}
                    />
                  ))}
                </RowList>
              ) : (
                <p className="text-muted-foreground text-sm">На статусах этого цикла ролей нет</p>
              )}
            </Section>
          ) : null}
          <Section
            title={workflow ? 'Остальные роли проекта' : 'Роли проекта'}
            description={workflow ? 'Не стоят ни на одном статусе этого цикла' : undefined}>
            <Switch label="Показать архивные" value={showArchived} onChange={onArchived} />
            {rest.length ? (
              <RowList>
                {rest.map((r) => {
                  const n = elsewhere(r.key);
                  return (
                    <RoleRow
                      key={r.key}
                      role={r}
                      caption={n ? `на других циклах: ${n}` : 'ни на одном статусе'}
                      onClick={() => onRole(r.key)}
                    />
                  );
                })}
              </RowList>
            ) : (
              <p className="text-muted-foreground text-sm">Других ролей нет</p>
            )}
          </Section>
        </>
      )}
      {workflow ? <Legend /> : null}
    </div>
  );
}

function RoleRow({role, caption, onClick}: {role: Role; caption: string; onClick: () => void}) {
  return (
    <div data-pipeline-role-row={role.key}>
      <Row
        onClick={onClick}
        start={<UserRound className="text-muted-foreground size-4" aria-hidden />}
        end={
          <>
            {role.archived_at ? <Token label="в архиве" /> : null}
            {role.latest_version ? <span className="text-muted-foreground text-xs">v{role.latest_version}</span> : null}
          </>
        }>
        <p className="truncate font-medium">{role.name}</p>
        <p className="text-muted-foreground truncate text-xs">
          {role.key}
          {caption ? ` · ${caption}` : ''}
        </p>
      </Row>
    </div>
  );
}

// Проверка смотрит на цикл как на граф: тупики и недостижимые статусы схема не
// ловит — они про цикл целиком, а не про отдельную строку. Строка с
// проблемой статуса — кнопка: выбирает его узел.
export function ValidationReport({validation, onStatus}: {validation: ValidationState; onStatus: (key: string) => void}) {
  if (validation.error) {
    return <Failure error={validation.error} title="Проверка цикла не выполнена" reload={validation.reload} />;
  }
  const v = validation.data;
  if (!v) return <p className="text-muted-foreground text-sm">Проверяем цикл</p>;
  if (v.valid && v.warnings.length === 0) {
    return <Note tone="success" title="Цикл проходит проверку" />;
  }
  // Текст — как раньше: у ошибки ключ статуса в скобках, у предупреждения
  // только сообщение сервера.
  const line = (withKey: boolean) => (p: Validation['problems'][number], i: number) =>
    p.status ? (
      <button
        key={i}
        type="button"
        className="block text-left underline-offset-2 hover:underline"
        onClick={() => onStatus(p.status!)}>
        {p.message}
        {withKey ? ` (${p.status})` : ''}
      </button>
    ) : (
      <p key={i}>{p.message}</p>
    );
  return (
    <div className="space-y-2" data-pipeline-validation>
      {v.problems.length > 0 ? (
        <Note tone="error" title="Цикл не активируется">
          {v.problems.map(line(true))}
        </Note>
      ) : null}
      {v.warnings.length > 0 ? (
        <Note tone="warning" title="Предупреждения">
          {v.warnings.map(line(false))}
        </Note>
      ) : null}
    </div>
  );
}

// Активация не трогает уже идущие задачи: они доходят по своей версии цикла,
// потому что переклеивание результатов гейтов теряло бы решения людей.
// Задачи из бэклога, которых никто не забирал, переезжают на новую версию
// (решение 0036) — им терять нечего, а правила нужны актуальные.
// Сервер перечисляет первые ключи и отдаёт полное число отдельно: бэклог
// может быть в тысячи задач, и список на весь экран никому не нужен.
export function ActivationReport({result}: {result: ActivationResult}) {
  const moved = result.tasks_moved ?? [];
  const movedTotal = result.tasks_moved_total ?? moved.length;
  // Пустой список сервер отдаёт как null: без запасного значения активация,
  // после которой на прежней версии никого нет, роняла страницу.
  const stayed = result.tasks_on_previous_version ?? [];
  const stayedTotal = result.tasks_on_previous_version_total ?? stayed.length;
  return (
    <Note tone="success" title={`Версия ${result.workflow.version} активирована`}>
      {moved.length ? (
        <div className="space-y-1">
          <p>Задачи из бэклога переехали на новую версию: {movedTotal}</p>
          <div className="flex flex-wrap gap-1">
            {moved.map((t) => (
              <Token
                key={t.task}
                label={t.from_status === t.to_status ? `${t.task} · ${t.to_status}` : `${t.task} · ${t.from_status} → ${t.to_status}`}
              />
            ))}
            {movedTotal > moved.length ? <Token label={`и ещё ${movedTotal - moved.length}`} /> : null}
          </div>
        </div>
      ) : null}
      {stayed.length ? (
        <div className="space-y-1">
          <p>Задачи в работе продолжают идти по прежней версии цикла: {stayedTotal}</p>
          <div className="flex flex-wrap gap-1">
            {stayed.map((t) => (
              <Token key={t.task} label={`${t.task} · ${t.status}`} />
            ))}
            {stayedTotal > stayed.length ? <Token label={`и ещё ${stayedTotal - stayed.length}`} /> : null}
          </div>
        </div>
      ) : null}
    </Note>
  );
}

function Item({children, label}: {children: React.ReactNode; label: string}) {
  return (
    <li className="flex items-center gap-2">
      <span className="flex w-10 justify-center">{children}</span>
      {label}
    </li>
  );
}

function Legend() {
  return (
    <Section title="Обозначения">
      <ul className="text-muted-foreground space-y-1.5 text-xs">
        <Item label="этап; роль и её версия — кнопка">
          <span className="bg-card block h-4 w-8 rounded border" />
        </Item>
        <Item label="необязательный этап">
          <span className="bg-card block h-4 w-8 rounded border border-dashed" />
        </Item>
        <Item label="переход вперёд и его гейты">
          <span className="bg-card rounded-full border px-1 text-[10px]">⋯ 2</span>
        </Item>
        <Item label="возврат (дорожка справа)">
          <svg width="32" height="8" aria-hidden>
            <path d="M0 4 H32" className="stroke-muted-foreground" strokeDasharray="5 4" />
          </svg>
        </Item>
        <Item label="из любого статуса">
          <svg width="32" height="10" aria-hidden>
            <circle cx="5" cy="5" r="4" className="fill-background stroke-muted-foreground" />
            <path d="M9 5 H32" className="stroke-muted-foreground" />
          </svg>
        </Item>
        {LEGEND_GATE_TYPES.map((type) => (
          <Item key={type} label={gateLabel(type)}>
            <GateIcon type={type} />
          </Item>
        ))}
      </ul>
    </Section>
  );
}

// ── статус ──────────────────────────────────────────────────────────────────

export function StatusInspector({
  projectKey,
  workflow,
  status,
  latest,
  editable,
  onChanged,
  onDeleted,
  onDialog,
  onRole,
  onTransition,
}: {
  projectKey: string;
  workflow: Workflow;
  status: Status;
  latest: Map<string, number | undefined>;
  editable: boolean;
  onChanged: () => void;
  onDeleted: () => void;
  onDialog: (d: PipelineDialog) => void;
  onRole: (key: string) => void;
  onTransition: (key: string) => void;
}) {
  // Отказ бэкенда показывается здесь же и подписан тем действием, которое не
  // прошло: удаление и перестановка отказывают по разным причинам.
  const [failure, setFailure] = useState<{title: string; error: ApiError}>();
  // Перестановка в пути: заняты обе кнопки — следующий порядок считается от
  // того, что на экране, а до ответа он ещё прежний.
  const [isMoving, setIsMoving] = useState(false);
  // Что получит этап (CLAB-348): документы последней версии каждой роли
  // статуса и отбор строки. Пока версия грузится или не загрузилась —
  // счётчика нет, а не «0».
  const roleDocs = useRoleDocs(projectKey, (status.roles ?? []).map((r) => r.role_key));
  const byId = new Map(workflow.statuses.map((s) => [s.id, s]));
  const index = workflow.statuses.findIndex((s) => s.id === status.id);
  const outs = workflow.transitions.filter((t) => t.from_status_id === status.id && t.kind !== 'reject');
  const ins = workflow.transitions.filter((t) => t.to_status_id === status.id && t.kind !== 'reject');
  const rets = workflow.transitions.filter(
    (t) => t.kind === 'reject' && (t.from_status_id === status.id || t.to_status_id === status.id),
  );

  // Порядок колонок доски меняется одним запросом на весь набор: уникальность
  // позиции не переживает перестановку по одному статусу.
  const move = async (delta: number) => {
    const keys = workflow.statuses.map((s) => s.key);
    const target = index + delta;
    if (target < 0 || target >= keys.length) return;
    [keys[index], keys[target]] = [keys[target], keys[index]];
    setFailure(undefined);
    setIsMoving(true);
    try {
      await api.reorderStatuses(workflow.id, keys);
      onChanged();
    } catch (err) {
      setFailure({title: 'Порядок статусов не изменён', error: toApiError(err)});
    } finally {
      setIsMoving(false);
    }
  };

  const remove = async () => {
    setFailure(undefined);
    try {
      await api.deleteStatus(workflow.id, status.key);
      toast.success(`Статус ${status.name} (${status.key}) удалён`);
      onDeleted();
    } catch (err) {
      setFailure({title: 'Статус не удалён', error: toApiError(err)});
    }
  };

  // Статус уносит с собой не только свои роли: переходы ссылаются на статус
  // с ON DELETE CASCADE, и вместе с ними пропадают гейты, которые на этих
  // переходах стоят. Диалог называет это до подтверждения, а не после.
  const removalDescription = () => {
    const linked = workflow.transitions.filter((t) => t.from_status_id === status.id || t.to_status_id === status.id);
    const gates = linked.reduce((n, t) => n + (t.gates?.length ?? 0), 0);
    const head = `Статус ${status.name} (${status.key}) пропадёт из черновика вместе со своими ролями.`;
    if (linked.length === 0) return `${head} Переходов, которые его касаются, в цикле нет.`;
    const list = linked.map((t) => `${t.name} (${t.key})`).join(', ');
    const tail = gates > 0 ? `, а с ними и гейты на этих переходах: ${gates}` : '';
    return `${head} Вместе с ним пропадут переходы, которые из него выходят или в него ведут: ${list}${tail}.`;
  };

  return (
    <div className="space-y-5 p-4" data-pipeline-status-panel={status.key}>
      <div className="space-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <StatusDot variant={categoryVariant(status.category)} />
          <h2 className="min-w-0 text-lg font-semibold break-words">{status.name}</h2>
          {status.color ? (
            <span aria-hidden className="inline-block size-3 shrink-0 rounded-full" style={{background: status.color}} />
          ) : null}
        </div>
        <p className="text-muted-foreground font-mono text-xs">
          {status.key} · {status.category}
        </p>
        <div className="flex flex-wrap gap-1">
          {status.is_initial ? <Token label="начальный" /> : null}
          {status.is_terminal ? <Token label="терминальный" /> : null}
          {optionalBadges(status).map((b) => (
            <Token key={b} label={b} />
          ))}
          {status.wip_limit ? <Token label={`предел ${status.wip_limit}`} /> : null}
        </div>
        {editable ? (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="secondary" onClick={() => onDialog({kind: 'status-edit', status})}>
              Править статус
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onDialog({kind: 'transition-new', from: status.key})}>
              <Plus /> Переход отсюда
            </Button>
            <ConfirmButton title="Удалить статус?" description={removalDescription()} onConfirm={remove}>
              Удалить
            </ConfirmButton>
          </div>
        ) : null}
        {editable ? (
          // Порядок статусов — порядок колонок доски: на схеме его не видно,
          // поэтому он правится здесь, у выбранного статуса.
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground text-xs">
              Колонка доски {index + 1} из {workflow.statuses.length}
            </span>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Поднять статус «${status.name}» выше`}
              disabled={isMoving || index <= 0}
              onClick={() => void move(-1)}>
              <ArrowUp /> Выше
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Опустить статус «${status.name}» ниже`}
              disabled={isMoving || index === workflow.statuses.length - 1}
              onClick={() => void move(1)}>
              <ArrowDown /> Ниже
            </Button>
          </div>
        ) : null}
        {failure ? <Failure error={failure.error} title={failure.title} /> : null}
      </div>

      <Section title="Кто работает">
        {status.roles?.length ? (
          <RowList>
            {[...status.roles]
              .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.position - b.position)
              .map((r) => {
                const v = latest.get(r.role_key);
                const docs = roleDocs[r.role_key];
                const stage = docs?.state === 'ok' ? stageDocuments({documents: docs.documents, instructions: ''}, r.document_names) : undefined;
                const items = stage ? selectionItems(r.document_names, stage) : null;
                return (
                  <Row
                    key={r.role_key}
                    onClick={() => onRole(r.role_key)}
                    start={
                      r.is_primary ? (
                        <UserRound className="size-4" aria-hidden />
                      ) : (
                        <ScanEye className="text-muted-foreground size-4" aria-hidden />
                      )
                    }
                    end={
                      <>
                        {v ? <Badge variant="secondary">v{v}</Badge> : null}
                        <ChevronRight className="text-muted-foreground size-4" aria-hidden />
                      </>
                    }>
                    <p className="truncate font-medium">{r.role_name}</p>
                    {/* Строка переносится, а не обрезается: счётчик документов
                        на узкой панели иначе уходит за многоточие. */}
                    <p className="text-muted-foreground text-xs break-words">
                      {r.is_primary ? 'исполнитель' : 'перепроверка'} · {r.role_key}
                      {stage ? (
                        <span className="whitespace-nowrap" data-status-docs-count={r.role_key}>
                          {' '}
                          · {documentsCountLabel(stage)}
                        </span>
                      ) : null}
                    </p>
                    {items ? (
                      <p className="text-muted-foreground text-xs break-words" data-status-docs-selection={r.role_key}>
                        {SELECTION_PREFIX}{' '}
                        {items.map((it, i) => (
                          <span key={it.name} data-status-doc-missing={it.missing || undefined}>
                            {i > 0 ? ', ' : ''}
                            <span className={it.missing ? 'text-destructive font-mono' : 'font-mono'}>{it.name}</span>
                            {it.missing ? <span className="text-destructive"> ({MISSING_MARK})</span> : null}
                          </span>
                        ))}
                        {stage?.fallback ? <span className="block">{FALLBACK_NOTE}</span> : null}
                      </p>
                    ) : r.document_names?.length && docs?.state === 'error' ? (
                      // Версия не загрузилась: отбор показывается как сохранён,
                      // без сверки с документами роли.
                      <p className="text-muted-foreground text-xs break-words" data-status-docs-selection={r.role_key}>
                        {SELECTION_PREFIX} {r.document_names.join(', ')}
                      </p>
                    ) : null}
                  </Row>
                );
              })}
          </RowList>
        ) : (
          <p className="text-muted-foreground text-sm">{NO_ROLE_TEXT}</p>
        )}
        {status.roles?.length ? <p className="text-muted-foreground text-xs">{ROLE_VERSION_HINT}</p> : null}
      </Section>

      <TransitionList title="Переходы отсюда" items={outs} byId={byId} onClick={onTransition} />
      <TransitionList title="Переходы сюда" items={ins} byId={byId} onClick={onTransition} />
      {rets.length ? <TransitionList title="Возвраты" items={rets} byId={byId} isReturn onClick={onTransition} /> : null}
    </div>
  );
}

function TransitionList({
  title,
  items,
  byId,
  isReturn,
  onClick,
}: {
  title: string;
  items: Transition[];
  byId: Map<string, Status>;
  isReturn?: boolean;
  onClick: (key: string) => void;
}) {
  return (
    <Section title={title}>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">Нет</p>
      ) : (
        <RowList>
          {items.map((t) => (
            <Row
              key={t.id}
              onClick={() => onClick(t.key)}
              start={isReturn ? <Undo2 className="text-muted-foreground size-4" aria-hidden /> : null}
              end={
                t.gates?.length ? (
                  <GateIconRow gates={t.gates} max={4} />
                ) : (
                  <span className="text-muted-foreground text-xs">{NO_GATES_LABEL}</span>
                )
              }>
              <p className="truncate font-medium">{t.name}</p>
              <p className="text-muted-foreground truncate text-xs">
                {t.from_status_id ? byId.get(t.from_status_id)?.name : 'из любого статуса'} → {byId.get(t.to_status_id)?.name}
              </p>
            </Row>
          ))}
        </RowList>
      )}
    </Section>
  );
}

// ── переход ─────────────────────────────────────────────────────────────────

export function TransitionInspector({
  workflow,
  transition,
  editable,
  onChanged,
  onDeleted,
  onDialog,
  onStatus,
}: {
  workflow: Workflow;
  transition: Transition;
  editable: boolean;
  onChanged: () => void;
  onDeleted: () => void;
  onDialog: (d: PipelineDialog) => void;
  onStatus: (key: string) => void;
}) {
  const [failure, setFailure] = useState<{title: string; error: ApiError}>();
  const byId = new Map(workflow.statuses.map((s) => [s.id, s]));
  const from = transition.from_status_id ? byId.get(transition.from_status_id) : undefined;
  const to = byId.get(transition.to_status_id);
  const gates = transition.gates ?? [];

  const remove = async () => {
    setFailure(undefined);
    try {
      await api.deleteTransition(workflow.id, transition.key);
      toast.success(`Переход ${transition.name} (${transition.key}) удалён`);
      onDeleted();
    } catch (err) {
      setFailure({title: 'Переход не удалён', error: toApiError(err)});
    }
  };

  const removeGate = async (gate: Gate) => {
    setFailure(undefined);
    try {
      await api.deleteGate(workflow.id, transition.key, gate.key);
      toast.success(`Гейт ${gate.name} (${gate.key}) удалён`);
      onChanged();
    } catch (err) {
      setFailure({title: 'Гейт не удалён', error: toApiError(err)});
    }
  };

  return (
    <div className="space-y-5 p-4" data-pipeline-transition-panel={transition.key}>
      <div className="space-y-2">
        <h2 className="text-lg font-semibold break-words">{transition.name}</h2>
        <p className="text-muted-foreground font-mono text-xs">
          {transition.key} · {transition.kind}
          {transition.auto ? ' · автоматический' : ''}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {from ? (
            <Button size="xs" variant="outline" onClick={() => onStatus(from.key)}>
              {from.name}
            </Button>
          ) : (
            <span className="text-muted-foreground">из любого статуса</span>
          )}
          <span aria-hidden>→</span>
          {to ? (
            <Button size="xs" variant="outline" onClick={() => onStatus(to.key)}>
              {to.name}
            </Button>
          ) : null}
        </div>
        {editable ? (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="secondary" onClick={() => onDialog({kind: 'transition-edit', transition})}>
              Править переход
            </Button>
            <ConfirmButton
              title="Удалить переход?"
              description={`Переход ${transition.name} (${transition.key}) пропадёт вместе со своими гейтами`}
              onConfirm={remove}>
              Удалить
            </ConfirmButton>
          </div>
        ) : null}
        {failure ? <Failure error={failure.error} title={failure.title} /> : null}
      </div>
      <Section
        title={`Гейты: ${gates.length}`}
        description="Всё, что держит переход. Вердикт считает сервер при запросе перехода"
        actions={
          editable ? (
            <Button size="sm" variant="ghost" onClick={() => onDialog({kind: 'gate-new', transition})}>
              Добавить гейт
            </Button>
          ) : null
        }>
        {gates.length === 0 ? (
          <p className="text-muted-foreground text-sm">Переход ничем не закрыт</p>
        ) : (
          <RowList>
            {gates.map((g) => (
              <div key={g.id} data-pipeline-gate={g.key}>
                <Row
                  start={<GateIcon type={g.type} className="size-4" />}
                  end={
                    <>
                      {g.blocking ? null : <Token label="не блокирует" />}
                      {editable ? (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onDialog({kind: 'gate-edit', transition, gate: g})}>
                            Править
                          </Button>
                          <ConfirmButton
                            title="Удалить гейт?"
                            description={`Гейт ${g.name} (${g.key}) перестанет держать переход ${transition.key}`}
                            onConfirm={() => removeGate(g)}>
                            Удалить
                          </ConfirmButton>
                        </>
                      ) : null}
                    </>
                  }>
                  <p className="truncate font-medium">{g.name}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {gateLabel(g.type)}
                    {gateConfigLine(g.config)}
                  </p>
                </Row>
              </div>
            ))}
          </RowList>
        )}
      </Section>
    </div>
  );
}
