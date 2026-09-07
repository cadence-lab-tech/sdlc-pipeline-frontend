import {useState} from 'react';
import {useParams} from 'react-router-dom';
import {Badge} from '@astryxdesign/core/Badge';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Divider} from '@astryxdesign/core/Divider';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutHeader,
  LayoutPanel,
  VStack,
} from '@astryxdesign/core/Layout';
import {Item} from '@astryxdesign/core/Item';
import {List} from '@astryxdesign/core/List';
import {Selector} from '@astryxdesign/core/Selector';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Heading, Text} from '@astryxdesign/core/Text';
import {Token} from '@astryxdesign/core/Token';

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
    <Layout
      height="fill"
      start={
        <LayoutPanel width={280} hasDivider padding={0} isScrollable label="Версии цикла">
          <Layout
            height="fill"
            header={
              <LayoutHeader hasDivider padding={3}>
                <VStack gap={2}>
                  <Heading level={2}>Версии цикла</Heading>
                  {types.length > 1 ? (
                    <Selector
                      label="Тип задач"
                      size="sm"
                      description="Циклов в проекте столько, сколько типов задач"
                      options={types.map((t) => ({value: t, label: t}))}
                      value={draftType}
                      onChange={(v) => setDraftType(v as string)}
                    />
                  ) : null}
                  <Button
                    size="sm"
                    variant="primary"
                    label="Черновик копией активного"
                    onClick={() => createDraft('active')}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    label="Пустой черновик"
                    onClick={() => createDraft('empty')}
                  />
                </VStack>
              </LayoutHeader>
            }
            content={
              <LayoutContent padding={0}>
                {error ? <Banner status="error" title="Черновик не создан" description={error.message} /> : null}
                <List hasDividers>
                  {versions.data.map((w) => (
                    <VersionRow
                      key={w.id}
                      head={w}
                      isSelected={w.id === selected}
                      onSelect={() => setPicked(w.id)}
                    />
                  ))}
                </List>
              </LayoutContent>
            }
          />
        </LayoutPanel>
      }
      content={
        <LayoutContent padding={4}>
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
        </LayoutContent>
      }
    />
  );
}

const STATE_LABEL: Record<string, string> = {
  draft: 'черновик',
  active: 'работает',
  retired: 'выведена',
};

const STATE_VARIANT: Record<string, 'accent' | 'success' | 'neutral'> = {
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
    <Item
      label={`${head.name} · v${head.version}`}
      description={`${STATE_LABEL[head.state]} · ${head.task_types.join(', ')}`}
      isSelected={isSelected}
      onClick={onSelect}
      startContent={<StatusDot variant={STATE_VARIANT[head.state]} label={head.state} />}
    />
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
    <VStack gap={4}>
      <HStack hAlign="between" vAlign="center" gap={3}>
        <HStack gap={2} vAlign="center">
          <Heading level={1}>
            {wf.name} · v{wf.version}
          </Heading>
          <Badge
            variant={wf.state === 'active' ? 'success' : 'neutral'}
            label={STATE_LABEL[wf.state]}
          />
          {wf.task_types.map((type) => (
            <Token key={type} size="sm" label={type} />
          ))}
        </HStack>
        {isDraft ? (
          <HStack gap={2}>
            <Button
              variant="ghost"
              label="Название и типы"
              onClick={() => setIsEditingHead(true)}
            />
            <Button
              variant="secondary"
              label="Удалить черновик"
              onClick={() =>
                act(async () => {
                  await api.deleteWorkflow(workflowID);
                  onDeleted();
                })
              }
            />
            <Button
              variant="primary"
              label="Активировать"
              isDisabled={validation.data ? !validation.data.valid : true}
              onClick={() =>
                act(async () => {
                  setActivation(await api.activateWorkflow(workflowID));
                  refresh();
                })
              }
            />
          </HStack>
        ) : null}
      </HStack>

      {error ? <Failure error={error} title="Не получилось" /> : null}
      {activation ? <ActivationReport result={activation} /> : null}

      {!isDraft ? (
        <Banner
          status="info"
          title="Эта версия не редактируется"
          description="По ней идут задачи. Правка цикла — новый черновик копией этой версии; он активируется целиком."
        />
      ) : null}

      {isDraft && validation.data ? <ValidationReport validation={validation.data} /> : null}

      <Statuses
        workflow={wf}
        roles={roles.data ?? []}
        isEditable={isDraft}
        onChanged={refresh}
      />

      <Divider />

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
    </VStack>
  );
}

// Проверка смотрит на цикл как на граф: тупики и недостижимые статусы схема не
// ловит — они про цикл целиком, а не про отдельную строку.
function ValidationReport({validation}: {validation: Validation}) {
  if (validation.valid && validation.warnings.length === 0) {
    return <Banner status="success" title="Цикл проходит проверку" />;
  }

  return (
    <VStack gap={2}>
      {validation.problems.length > 0 ? (
        <Banner status="error" title="Цикл не активируется" collapsible={false}>
          <VStack gap={1}>
            {validation.problems.map((p, i) => (
              <Text key={i}>
                {p.message}
                {p.status ? ` (${p.status})` : ''}
              </Text>
            ))}
          </VStack>
        </Banner>
      ) : null}
      {validation.warnings.length > 0 ? (
        <Banner status="warning" title="Предупреждения" collapsible={false}>
          <VStack gap={1}>
            {validation.warnings.map((p, i) => (
              <Text key={i}>{p.message}</Text>
            ))}
          </VStack>
        </Banner>
      ) : null}
    </VStack>
  );
}

// Активация не трогает уже идущие задачи: они доходят по своей версии цикла,
// потому что переклеивание результатов гейтов теряло бы решения людей.
function ActivationReport({result}: {result: ActivationResult}) {
  return (
    <Banner
      status="success"
      collapsible={false}
      title={`Версия ${result.workflow.version} активирована`}
      description={
        result.tasks_on_previous_version.length
          ? 'Задачи ниже продолжают идти по прежней версии цикла'
          : undefined
      }>
      {result.tasks_on_previous_version.length ? (
        <HStack gap={1} wrap="wrap">
          {result.tasks_on_previous_version.map((t) => (
            <Token key={t.task} size="sm" label={`${t.task} · ${t.status}`} />
          ))}
        </HStack>
      ) : null}
    </Banner>
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
    <VStack gap={3}>
      <HStack hAlign="between" vAlign="center">
        <Heading level={2}>Статусы</Heading>
        {isEditable ? (
          <Button size="sm" variant="secondary" label="Добавить статус" onClick={() => open()} />
        ) : null}
      </HStack>

      <List hasDividers>
        {workflow.statuses.map((status, index) => {
          const role = primaryRole(status);
          return (
            <Item
              key={status.id}
              startContent={
                <StatusDot variant={categoryVariant(status.category)} label={status.category} />
              }
              label={status.name}
              description={`${status.key} · ${status.category}`}
              endContent={
                <HStack gap={2} vAlign="center">
                  {status.is_initial ? <Token size="sm" label="начальный" /> : null}
                  {status.is_terminal ? <Token size="sm" label="терминальный" /> : null}
                  {role ? <Token size="sm" color="blue" label={role.role_name} /> : null}
                  {status.color ? (
                    <span
                      aria-hidden
                      style={{
                        width: 'var(--spacing-3)',
                        height: 'var(--spacing-3)',
                        borderRadius: 'var(--radius-full, 50%)',
                        background: statusColor(status),
                        display: 'inline-block',
                      }}
                    />
                  ) : null}
                  {isEditable ? (
                    <HStack gap={1}>
                      <Button size="sm" variant="ghost" label="↑" onClick={() => move(index, -1)} />
                      <Button size="sm" variant="ghost" label="↓" onClick={() => move(index, 1)} />
                      <Button
                        size="sm"
                        variant="ghost"
                        label="Править"
                        onClick={() => open(status)}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        label="Удалить"
                        onClick={() =>
                          void api.deleteStatus(workflow.id, status.key).then(onChanged)
                        }
                      />
                    </HStack>
                  ) : null}
                </HStack>
              }
            />
          );
        })}
      </List>

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
    </VStack>
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
    <VStack gap={3}>
      <HStack hAlign="between" vAlign="center">
        <Heading level={2}>Переходы</Heading>
        {isEditable ? (
          <Button
            size="sm"
            variant="secondary"
            label="Добавить переход"
            onClick={() => {
              setEditing(undefined);
              setIsOpen(true);
            }}
          />
        ) : null}
      </HStack>

      {workflow.transitions.map((t) => (
        <Card key={t.id} padding={3}>
          <VStack gap={3}>
            <HStack hAlign="between" vAlign="center" gap={2}>
              <VStack gap={1}>
                <Text weight="medium">{t.name}</Text>
                <Text type="supporting" color="secondary">
                  {t.from_status_id ? byID.get(t.from_status_id)?.key : 'из любого статуса'} →{' '}
                  {byID.get(t.to_status_id)?.key} · {t.kind}
                  {t.auto ? ' · автоматический' : ''}
                </Text>
              </VStack>
              {isEditable ? (
                <HStack gap={1}>
                  <Button
                    size="sm"
                    variant="ghost"
                    label="Править"
                    onClick={() => {
                      setEditing(t);
                      setIsOpen(true);
                    }}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    label="Удалить"
                    onClick={() => void api.deleteTransition(workflow.id, t.key).then(onChanged)}
                  />
                </HStack>
              ) : null}
            </HStack>
            <Gates
              workflowID={workflow.id}
              transitionKey={t.key}
              gates={t.gates ?? []}
              isEditable={isEditable}
              onChanged={onChanged}
            />
          </VStack>
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
    </VStack>
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
    <VStack gap={2}>
      <HStack hAlign="between" vAlign="center">
        <Text type="supporting" color="secondary">
          Гейты
        </Text>
        {isEditable ? (
          <Button
            size="sm"
            variant="ghost"
            label="Добавить гейт"
            onClick={() => {
              setEditing(undefined);
              setIsOpen(true);
            }}
          />
        ) : null}
      </HStack>

      {gates.length === 0 ? (
        <Text type="supporting" color="secondary">
          Переход ничем не закрыт
        </Text>
      ) : (
        <List hasDividers density="compact">
          {gates.map((gate) => (
            <Item
              key={gate.id}
              label={gate.name}
              description={gate.type}
              endContent={
                <HStack gap={2} vAlign="center">
                  {gate.blocking ? null : <Token size="sm" label="не блокирует" />}
                  {isEditable ? (
                    <HStack gap={1}>
                      <Button
                        size="sm"
                        variant="ghost"
                        label="Править"
                        onClick={() => {
                          setEditing(gate);
                          setIsOpen(true);
                        }}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        label="Удалить"
                        onClick={() =>
                          void api
                            .deleteGate(workflowID, transitionKey, gate.key)
                            .then(onChanged)
                        }
                      />
                    </HStack>
                  ) : null}
                </HStack>
              }
            />
          ))}
        </List>
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
    </VStack>
  );
}
