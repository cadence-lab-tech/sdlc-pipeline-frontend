import {useState} from 'react';
import {Link, useParams} from 'react-router-dom';
import {Badge} from '@astryxdesign/core/Badge';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {HStack, Layout, LayoutContent, LayoutHeader, VStack} from '@astryxdesign/core/Layout';
import {Section} from '@astryxdesign/core/Section';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {Selector} from '@astryxdesign/core/Selector';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Heading, Text} from '@astryxdesign/core/Text';
import {Token} from '@astryxdesign/core/Token';
import {Tooltip} from '@astryxdesign/core/Tooltip';

import {api} from '../api/client';
import type {ProjectDetail, Status, Task} from '../api/types';
import {useResource} from '../api/useResource';
import {Failure, Loading} from '../components/Feedback';
import {categoryVariant, primaryRole, statusColor} from '../components/status';
import {NewTaskDialog} from '../components/NewTaskDialog';
import {TaskCard} from '../components/TaskCard';

const COLUMN_WIDTH = 300;
// Тип задачи по умолчанию и тип эпика. Набор типов — данные проекта, но
// доска обязана с чего-то начинаться, а эпик она показывает особым образом.
const DEFAULT_TYPE = 'task';
const EPIC_TYPE = 'epic';

// TypePicker показывает, какого типа задачи сейчас на доске. Если тип в
// проекте один, переключать нечего — и переключателя нет.
function TypePicker({
  project,
  value,
  onChange,
}: {
  project: ProjectDetail;
  value: string;
  onChange: (next: string) => void;
}) {
  const types = new Set<string>();
  for (const wf of project.active_workflows) {
    for (const type of wf.task_types ?? []) types.add(type);
  }
  if (types.size < 2) return null;

  return (
    <SegmentedControl label="Тип задач" value={value} onChange={onChange} size="sm">
      {[...types].map((type) => (
        <SegmentedControlItem key={type} value={type} label={type} />
      ))}
    </SegmentedControl>
  );
}

// Доска. Колонки берутся из активного цикла проекта, а не из константы: у
// каждого проекта свой набор статусов.
//
// Карточки не перетаскиваются намеренно. Колонка — это статус, а между
// статусами задачу двигает именованный переход со своими гейтами; в одну и ту
// же колонку могут вести разные переходы («сдать» и «вернуть»), и у них разный
// смысл. Перетаскивание сделало бы вид, что достаточно выбрать колонку.
export function Board() {
  const {projectKey = ''} = useParams();
  const project = useResource(() => api.getProject(projectKey), [projectKey]);
  // Доска показывает один цикл: у эпиков свои статусы, и смешивать их с
  // задачами в одних колонках нечестно — это разные наборы (решение 0024).
  const [taskType, setTaskType] = useState(DEFAULT_TYPE);
  // Фильтр по эпику: нарезка одного эпика в отрыве от остальной доски.
  const [parent, setParent] = useState('');

  const workflow = useResource(() => api.getWorkflow(projectKey, taskType), [projectKey, taskType]);
  const tasks = useResource(
    () => api.listTasks(projectKey, {type: taskType, parent: parent || undefined}),
    [projectKey, taskType, parent],
  );
  const epics = useResource(() => api.listTasks(projectKey, {type: EPIC_TYPE}), [projectKey]);

  if (workflow.error) return <Section padding={6}><Failure error={workflow.error} /></Section>;
  if (tasks.error) return <Section padding={6}><Failure error={tasks.error} /></Section>;
  if (!workflow.data || !tasks.data) return <Loading />;

  const reload = () => {
    tasks.reload();
    workflow.reload();
    epics.reload();
  };

  // Задачи раскладываются по ключу статуса, а не по его идентификатору:
  // задача, начатая на прежней версии цикла, доходит по ней, и у её статуса
  // другой id, хотя это тот же статус. Ключ статуса уникален внутри цикла и
  // переживает копирование версии.
  const byStatusKey = new Map<string, Task[]>();
  for (const task of tasks.data) {
    const list = byStatusKey.get(task.status_key);
    if (list) list.push(task);
    else byStatusKey.set(task.status_key, [task]);
  }

  // Статус мог исчезнуть в новой версии цикла — задача на нём всё равно живая
  // и должна быть видна, иначе она пропадает с доски молча.
  const columnKeys = new Set(workflow.data.statuses.map((s) => s.key));
  const outside = tasks.data.filter((t) => !columnKeys.has(t.status_key));

  return (
    <Layout
      height="fill"
      header={
        <LayoutHeader hasDivider padding={4}>
          <HStack hAlign="between" vAlign="center" gap={3}>
            <HStack gap={2} vAlign="center">
              <Heading level={1}>{project.data?.project.name ?? projectKey}</Heading>
              <Badge variant="neutral" label={`${tasks.data.length} задач`} />
            </HStack>
            <HStack gap={2} vAlign="center">
              {project.data ? (
                <TypePicker project={project.data} value={taskType} onChange={(next) => {
                  setTaskType(next);
                  setParent('');
                }} />
              ) : null}
              {taskType !== EPIC_TYPE && (epics.data?.length ?? 0) > 0 ? (
                <Selector
                  label="Эпик"
                  isLabelHidden
                  variant="ghost"
                  size="sm"
                  width={240}
                  value={parent}
                  onChange={(v) => setParent(v as string)}
                  options={[
                    {value: '', label: 'Все эпики'},
                    ...(epics.data ?? []).map((e) => ({value: e.key, label: `${e.key} · ${e.title}`})),
                  ]}
                />
              ) : null}
              <Tooltip content="Задачи доходят по той версии цикла, на которой начаты">
                <Text type="supporting" color="secondary">
                  {workflow.data.name} · v{workflow.data.version}
                </Text>
              </Tooltip>
              <Button variant="secondary" label="Обновить" onClick={reload} />
              {project.data ? (
                <NewTaskDialog project={project.data} onCreated={reload} defaultType={taskType} />
              ) : null}
            </HStack>
          </HStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent padding={0}>
          <HStack
            gap={4}
            isScrollable
            height="100%"
            padding={4}
            style={{overflowX: 'auto', overflowY: 'hidden'}}>
            {workflow.data.statuses.map((status) => (
              <Column
                key={status.id}
                status={status}
                activeWorkflowID={workflow.data!.id}
                tasks={byStatusKey.get(status.key) ?? []}
                projectKey={projectKey}
              />
            ))}
            {outside.length > 0 ? (
              <OutsideColumn tasks={outside} projectKey={projectKey} />
            ) : null}
          </HStack>
        </LayoutContent>
      }
    />
  );
}

function Column({
  status,
  tasks,
  projectKey,
  activeWorkflowID,
}: {
  status: Status;
  tasks: Task[];
  projectKey: string;
  activeWorkflowID: string;
}) {
  const role = primaryRole(status);
  // Лимит WIP — предупреждение проекту, а не запрет: переход держат гейты,
  // а не колонка.
  const overLimit = status.wip_limit != null && tasks.length > status.wip_limit;

  return (
    <Card
      variant="muted"
      padding={0}
      style={{
        flexShrink: 0,
        flexBasis: COLUMN_WIDTH,
        height: '100%',
        borderTop: `2px solid ${statusColor(status)}`,
      }}>
      <Layout
        height="fill"
        header={
          <LayoutHeader hasDivider padding={3}>
            <VStack gap={2}>
              <HStack hAlign="between" vAlign="center" gap={2}>
                <HStack gap={2} vAlign="center">
                  <StatusDot variant={categoryVariant(status.category)} label={status.category} />
                  <Heading level={4}>{status.name}</Heading>
                </HStack>
                <Text
                  type="supporting"
                  color={overLimit ? 'accent' : 'secondary'}
                  hasTabularNumbers>
                  {status.wip_limit != null ? `${tasks.length}/${status.wip_limit}` : tasks.length}
                </Text>
              </HStack>
              {role ? <Token size="sm" label={role.role_name} /> : null}
            </VStack>
          </LayoutHeader>
        }
        content={
          <LayoutContent padding={2}>
            {tasks.length === 0 ? (
              <EmptyState
                isCompact
                title="Пусто"
                description={status.description ?? 'Задач на этом статусе нет'}
              />
            ) : (
              <VStack gap={2}>
                {tasks.map((task) => (
                  <Link
                    key={task.id}
                    to={`/p/${projectKey}/tasks/${task.key}`}
                    style={{textDecoration: 'none', color: 'inherit'}}>
                    <TaskCard
                      task={task}
                      isOnOldWorkflow={task.workflow_id !== activeWorkflowID}
                    />
                  </Link>
                ))}
              </VStack>
            )}
          </LayoutContent>
        }
      />
    </Card>
  );
}

// Колонка для задач, чей статус в действующей версии цикла не существует.
// Такое бывает после активации версии, из которой статус убрали: задача
// доходит по своей версии, и спрятать её было бы враньём.
function OutsideColumn({tasks, projectKey}: {tasks: Task[]; projectKey: string}) {
  return (
    <Card
      variant="muted"
      padding={0}
      style={{flexShrink: 0, flexBasis: COLUMN_WIDTH, height: '100%'}}>
      <Layout
        height="fill"
        header={
          <LayoutHeader hasDivider padding={3}>
            <VStack gap={1}>
              <HStack hAlign="between" vAlign="center" gap={2}>
                <Heading level={4}>Вне текущего цикла</Heading>
                <Text type="supporting" color="secondary" hasTabularNumbers>
                  {tasks.length}
                </Text>
              </HStack>
              <Text type="supporting" color="secondary">
                Статуса нет в действующей версии; задачи доходят по своей
              </Text>
            </VStack>
          </LayoutHeader>
        }
        content={
          <LayoutContent padding={2}>
            <VStack gap={2}>
              {tasks.map((task) => (
                <Link
                  key={task.id}
                  to={`/p/${projectKey}/tasks/${task.key}`}
                  style={{textDecoration: 'none', color: 'inherit'}}>
                  <TaskCard task={task} isOnOldWorkflow />
                </Link>
              ))}
            </VStack>
          </LayoutContent>
        }
      />
    </Card>
  );
}
