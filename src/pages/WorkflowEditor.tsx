import {useState} from 'react';
import {useParams} from 'react-router-dom';

import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Separator} from '@/components/ui/separator';
import {Selector} from '@/components/fields';
import {EmptyState, Note, Row, Section, StatusDot, Token, type DotVariant} from '@/components/kit';

import {ApiError, api} from '../api/client';
import type {
  ActivationResult,
  Gate,
  Role,
  Status,
  Transition,
  UUID,
  Validation,
  Workflow,
  WorkflowHead,
} from '../api/types';
import {useResource} from '../api/useResource';
import {Failure, Loading} from '../components/Feedback';
import {GateDialog} from '../components/GateDialog';
import {StatusDialog} from '../components/StatusDialog';
import {TransitionDialog} from '../components/TransitionDialog';
import {WorkflowDraftDialog} from '../components/WorkflowDraftDialog';
import {categoryVariant, primaryRole, statusColor} from '../components/status';
import {taskTypes} from '../components/taskTypes';

// Редактор цикла. Активная версия не правится — ни целиком, ни по мелочи:
// по ней прямо сейчас идут задачи (решение 0016). Правка — это черновик,
// копия работающей версии, который активируется целиком.
export function WorkflowEditor() {
  const {projectKey = ''} = useParams();
  const versions = useResource(() => api.listWorkflows(projectKey), [projectKey]);
  const project = useResource(() => api.getProject(projectKey), [projectKey]);
  const [picked, setPicked] = useState<UUID>();
  // Тип задач для нового черновика: копия снимается с действующего цикла
  // этого же типа, иначе черновик цикла эпиков начался бы с разработки.
  const [draftType, setDraftType] = useState('task');
  const [error, setError] = useState<ApiError>();

  if (versions.error) return <Failure error={versions.error} />;
  if (!versions.data) return <Loading />;

  const types = project.data ? taskTypes(project.data) : ['task'];

  // По умолчанию открыт черновик, если он есть: правят обычно его, а не
  // работающую версию, которую всё равно нельзя менять.
  const draft = versions.data.find((w) => w.state === 'draft');
  const active = versions.data.find((w) => w.state === 'active');
  const selected = picked ?? (draft ?? active ?? versions.data[0])?.id;

  const createDraft = async (from: 'active' | 'empty') => {
    setError(undefined);
    try {
      const created = await api.createDraft(projectKey, {from, task_types: [draftType]});
      versions.reload();
      setPicked(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    }
  };

  return (
    <div className="flex min-h-[calc(100svh-3.5rem)]">
      <aside className="w-70 shrink-0 border-r">
        <div className="space-y-2 border-b p-3">
          <h2 className="text-base font-semibold">Версии цикла</h2>
          {types.length > 1 ? (
            <Selector
              label="Тип задач"
              description="Циклов в проекте столько, сколько типов задач"
              options={types.map((t) => ({value: t, label: t}))}
              value={draftType}
              onChange={setDraftType}
            />
          ) : null}
          <Button size="sm" className="w-full" onClick={() => createDraft('active')}>
            Черновик копией активного
          </Button>
          <Button size="sm" variant="ghost" className="w-full" onClick={() => createDraft('empty')}>
            Пустой черновик
          </Button>
        </div>
        {error ? (
          <div className="p-3">
            <Failure error={error} title="Черновик не создан" />
          </div>
        ) : null}
        <ul className="divide-border divide-y">
          {versions.data.map((w) => (
            <VersionRow
              key={w.id}
              head={w}
              isSelected={w.id === selected}
              onSelect={() => setPicked(w.id)}
            />
          ))}
        </ul>
      </aside>
      <div className="min-w-0 flex-1 p-4">
        {selected ? (
          <VersionEditor
            key={selected}
            projectKey={projectKey}
            workflowID={selected}
            types={types}
            onChanged={() => {
              versions.reload();
            }}
            onDeleted={() => {
              setPicked(undefined);
              versions.reload();
            }}
          />
        ) : (
          <EmptyState title="Цикла нет" description="Создайте первый черновик" />
        )}
      </div>
    </div>
  );
}

const STATE_LABEL: Record<string, string> = {
  draft: 'черновик',
  active: 'работает',
  retired: 'выведена',
};

const STATE_VARIANT: Record<string, DotVariant> = {
  draft: 'accent',
  active: 'success',
  retired: 'neutral',
};

function VersionRow({
  head,
  isSelected,
  onSelect,
}: {
  head: WorkflowHead;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <Row
        isSelected={isSelected}
        onClick={onSelect}
        start={<StatusDot variant={STATE_VARIANT[head.state]} />}>
        <p className="truncate font-medium">
          {head.name} · v{head.version}
        </p>
        <p className="text-muted-foreground truncate text-xs">
          {STATE_LABEL[head.state]} · {head.task_types.join(', ')}
        </p>
      </Row>
    </li>
  );
}

function VersionEditor({
  projectKey,
  workflowID,
  types,
  onChanged,
  onDeleted,
}: {
  projectKey: string;
  workflowID: UUID;
  types: string[];
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const workflow = useResource(() => api.getWorkflowVersion(workflowID), [workflowID]);
  const roles = useResource(() => api.listRoles(projectKey), [projectKey]);
  const validation = useResource(() => api.validateWorkflow(workflowID), [workflowID]);
  const [error, setError] = useState<ApiError>();
  const [activation, setActivation] = useState<ActivationResult>();
  const [isEditingHead, setIsEditingHead] = useState(false);

  if (workflow.error) return <Failure error={workflow.error} />;
  if (!workflow.data) return <Loading />;

  const wf = workflow.data;
  const isDraft = wf.state === 'draft';

  const refresh = () => {
    workflow.reload();
    validation.reload();
    onChanged();
  };

  const act = async (run: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await run();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {wf.name} · v{wf.version}
          </h1>
          <Badge variant={wf.state === 'active' ? 'default' : 'secondary'}>
            {STATE_LABEL[wf.state]}
          </Badge>
          {wf.task_types.map((type) => (
            <Token key={type} label={type} />
          ))}
        </div>
        {isDraft ? (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setIsEditingHead(true)}>
              Название и типы
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                act(async () => {
                  await api.deleteWorkflow(workflowID);
                  onDeleted();
                })
              }>
              Удалить черновик
            </Button>
            <Button
              disabled={validation.data ? !validation.data.valid : true}
              onClick={() =>
                act(async () => {
                  setActivation(await api.activateWorkflow(workflowID));
                  refresh();
                })
              }>
              Активировать
            </Button>
          </div>
        ) : null}
      </div>

      {error ? <Failure error={error} title="Не получилось" /> : null}
      {activation ? <ActivationReport result={activation} /> : null}

      {!isDraft ? (
        <Note
          title="Эта версия не редактируется"
          description="По ней идут задачи. Правка цикла — новый черновик копией этой версии; он активируется целиком."
        />
      ) : null}

      {isDraft && validation.data ? <ValidationReport validation={validation.data} /> : null}

      <Statuses workflow={wf} roles={roles.data ?? []} isEditable={isDraft} onChanged={refresh} />

      <Separator />

      <Transitions workflow={wf} isEditable={isDraft} onChanged={refresh} />

      {isEditingHead ? (
        <WorkflowDraftDialog
          workflow={wf}
          types={types}
          isOpen={isEditingHead}
          onClose={() => setIsEditingHead(false)}
          onSaved={refresh}
        />
      ) : null}
    </div>
  );
}

// Проверка смотрит на цикл как на граф: тупики и недостижимые статусы схема не
// ловит — они про цикл целиком, а не про отдельную строку.
function ValidationReport({validation}: {validation: Validation}) {
  if (validation.valid && validation.warnings.length === 0) {
    return <Note tone="success" title="Цикл проходит проверку" />;
  }

  return (
    <div className="space-y-2">
      {validation.problems.length > 0 ? (
        <Note tone="error" title="Цикл не активируется">
          {validation.problems.map((p, i) => (
            <p key={i}>
              {p.message}
              {p.status ? ` (${p.status})` : ''}
            </p>
          ))}
        </Note>
      ) : null}
      {validation.warnings.length > 0 ? (
        <Note tone="warning" title="Предупреждения">
          {validation.warnings.map((p, i) => (
            <p key={i}>{p.message}</p>
          ))}
        </Note>
      ) : null}
    </div>
  );
}

// Активация не трогает уже идущие задачи: они доходят по своей версии цикла,
// потому что переклеивание результатов гейтов теряло бы решения людей.
function ActivationReport({result}: {result: ActivationResult}) {
  return (
    <Note
      tone="success"
      title={`Версия ${result.workflow.version} активирована`}
      description={
        result.tasks_on_previous_version.length
          ? 'Задачи ниже продолжают идти по прежней версии цикла'
          : undefined
      }>
      {result.tasks_on_previous_version.length ? (
        <div className="flex flex-wrap gap-1">
          {result.tasks_on_previous_version.map((t) => (
            <Token key={t.task} label={`${t.task} · ${t.status}`} />
          ))}
        </div>
      ) : null}
    </Note>
  );
}

function Statuses({
  workflow,
  roles,
  isEditable,
  onChanged,
}: {
  workflow: Workflow;
  roles: Role[];
  isEditable: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<Status | undefined>();
  const [isOpen, setIsOpen] = useState(false);

  const open = (status?: Status) => {
    setEditing(status);
    setIsOpen(true);
  };

  // Порядок колонок меняется одним запросом на весь набор: уникальность
  // позиции не переживает перестановку по одному статусу.
  const move = (index: number, delta: number) => {
    const keys = workflow.statuses.map((s) => s.key);
    const target = index + delta;
    if (target < 0 || target >= keys.length) return;
    [keys[index], keys[target]] = [keys[target], keys[index]];
    void api.reorderStatuses(workflow.id, keys).then(onChanged);
  };

  return (
    <Section
      title="Статусы"
      actions={
        isEditable ? (
          <Button size="sm" variant="secondary" onClick={() => open()}>
            Добавить статус
          </Button>
        ) : null
      }>
      <ul className="divide-border overflow-hidden rounded-lg border divide-y">
        {workflow.statuses.map((status, index) => {
          const role = primaryRole(status);
          return (
            <li key={status.id}>
              <Row
                start={<StatusDot variant={categoryVariant(status.category)} />}
                end={
                  <>
                    {status.is_initial ? <Token label="начальный" /> : null}
                    {status.is_terminal ? <Token label="терминальный" /> : null}
                    {role ? <Token color="blue" label={role.role_name} /> : null}
                    {status.color ? (
                      <span
                        aria-hidden
                        className="inline-block size-3 rounded-full"
                        style={{background: statusColor(status)}}
                      />
                    ) : null}
                    {isEditable ? (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => move(index, -1)}>
                          ↑
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => move(index, 1)}>
                          ↓
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => open(status)}>
                          Править
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void api.deleteStatus(workflow.id, status.key).then(onChanged)}>
                          Удалить
                        </Button>
                      </>
                    ) : null}
                  </>
                }>
                <p className="truncate font-medium">{status.name}</p>
                <p className="text-muted-foreground truncate text-xs">
                  {status.key} · {status.category}
                </p>
              </Row>
            </li>
          );
        })}
      </ul>

      {isOpen ? (
        <StatusDialog
          workflowID={workflow.id}
          status={editing}
          roles={roles}
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          onSaved={onChanged}
        />
      ) : null}
    </Section>
  );
}

function Transitions({
  workflow,
  isEditable,
  onChanged,
}: {
  workflow: Workflow;
  isEditable: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<Transition | undefined>();
  const [isOpen, setIsOpen] = useState(false);
  const byID = new Map(workflow.statuses.map((s) => [s.id, s]));

  return (
    <Section
      title="Переходы"
      actions={
        isEditable ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setEditing(undefined);
              setIsOpen(true);
            }}>
            Добавить переход
          </Button>
        ) : null
      }>
      {workflow.transitions.map((t) => (
        <Card key={t.id} className="gap-3 p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">{t.name}</p>
              <p className="text-muted-foreground text-xs">
                {t.from_status_id ? byID.get(t.from_status_id)?.key : 'из любого статуса'} →{' '}
                {byID.get(t.to_status_id)?.key} · {t.kind}
                {t.auto ? ' · автоматический' : ''}
              </p>
            </div>
            {isEditable ? (
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(t);
                    setIsOpen(true);
                  }}>
                  Править
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void api.deleteTransition(workflow.id, t.key).then(onChanged)}>
                  Удалить
                </Button>
              </div>
            ) : null}
          </div>
          <Gates
            workflowID={workflow.id}
            transitionKey={t.key}
            gates={t.gates ?? []}
            isEditable={isEditable}
            onChanged={onChanged}
          />
        </Card>
      ))}

      {isOpen ? (
        <TransitionDialog
          workflowID={workflow.id}
          transition={editing}
          statuses={workflow.statuses}
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          onSaved={onChanged}
        />
      ) : null}
    </Section>
  );
}

function Gates({
  workflowID,
  transitionKey,
  gates,
  isEditable,
  onChanged,
}: {
  workflowID: UUID;
  transitionKey: string;
  gates: Gate[];
  isEditable: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<Gate | undefined>();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-xs">Гейты</p>
        {isEditable ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(undefined);
              setIsOpen(true);
            }}>
            Добавить гейт
          </Button>
        ) : null}
      </div>

      {gates.length === 0 ? (
        <p className="text-muted-foreground text-sm">Переход ничем не закрыт</p>
      ) : (
        <ul className="divide-border overflow-hidden rounded-lg border divide-y">
          {gates.map((gate) => (
            <li key={gate.id}>
              <Row
                end={
                  <>
                    {gate.blocking ? null : <Token label="не блокирует" />}
                    {isEditable ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditing(gate);
                            setIsOpen(true);
                          }}>
                          Править
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            void api.deleteGate(workflowID, transitionKey, gate.key).then(onChanged)
                          }>
                          Удалить
                        </Button>
                      </>
                    ) : null}
                  </>
                }>
                <p className="truncate font-medium">{gate.name}</p>
                <p className="text-muted-foreground truncate text-xs">{gate.type}</p>
              </Row>
            </li>
          ))}
        </ul>
      )}

      {isOpen ? (
        <GateDialog
          workflowID={workflowID}
          transitionKey={transitionKey}
          gate={editing}
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          onSaved={onChanged}
        />
      ) : null}
    </div>
  );
}
