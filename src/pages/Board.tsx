import {useState} from 'react';
import {Link, useParams} from 'react-router-dom';

import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {Selector} from '@/components/fields';
import {StatusDot, Token} from '@/components/kit';

import {api} from '../api/client';
import type {ProjectDetail, Status, Task} from '../api/types';
import {useResource} from '../api/useResource';
import {Failure, Loading} from '../components/Feedback';
import {categoryVariant, primaryRole, statusColor} from '../components/status';
import {NewTaskDialog} from '../components/NewTaskDialog';
import {TaskCard} from '../components/TaskCard';

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
    <ToggleGroup
      type="single"
      size="sm"
      variant="outline"
      value={value}
      onValueChange={(next) => next && onChange(next)}
      aria-label="Тип задач">
      {[...types].map((type) => (
        <ToggleGroupItem key={type} value={type}>
          {type}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
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

  if (workflow.error) return <div className="p-6"><Failure error={workflow.error} /></div>;
  if (tasks.error) return <div className="p-6"><Failure error={tasks.error} /></div>;
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
    <div className="flex h-[calc(100svh-3.5rem)] min-w-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">{project.data?.project.name ?? projectKey}</h1>
          <Badge variant="secondary">{tasks.data.length} задач</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {project.data ? (
            <TypePicker
              project={project.data}
              value={taskType}
              onChange={(next) => {
                setTaskType(next);
                setParent('');
              }}
            />
          ) : null}
          {taskType !== EPIC_TYPE && (epics.data?.length ?? 0) > 0 ? (
            <div className="w-60">
              <Selector
                label="Эпик"
                isLabelHidden
                value={parent}
                onChange={setParent}
                placeholder="Все эпики"
                hasClear
                options={(epics.data ?? []).map((e) => ({
                  value: e.key,
                  label: `${e.key} · ${e.title}`,
                }))}
              />
            </div>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-muted-foreground text-sm">
                {workflow.data.name} · v{workflow.data.version}
              </span>
            </TooltipTrigger>
            <TooltipContent>Задачи доходят по той версии цикла, на которой начаты</TooltipContent>
          </Tooltip>
          <Button variant="secondary" onClick={reload}>
            Обновить
          </Button>
          {project.data ? (
            <NewTaskDialog project={project.data} onCreated={reload} defaultType={taskType} />
          ) : null}
        </div>
      </div>
      <div className="flex flex-1 gap-4 overflow-x-auto overflow-y-hidden p-4">
        {workflow.data.statuses.map((status) => (
          <Column
            key={status.id}
            status={status}
            activeWorkflowID={workflow.data!.id}
            tasks={byStatusKey.get(status.key) ?? []}
            projectKey={projectKey}
          />
        ))}
        {outside.length > 0 ? <OutsideColumn tasks={outside} projectKey={projectKey} /> : null}
      </div>
    </div>
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
    <div
      className="bg-muted/40 flex h-full w-75 shrink-0 flex-col rounded-lg border"
      style={{borderTop: `2px solid ${statusColor(status)}`}}>
      <div className="space-y-2 border-b p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <StatusDot variant={categoryVariant(status.category)} label={status.category} />
            <h2 className="text-sm font-semibold">{status.name}</h2>
          </div>
          <span
            className={
              overLimit ? 'text-sm tabular-nums text-amber-600' : 'text-muted-foreground text-sm tabular-nums'
            }>
            {status.wip_limit != null ? `${tasks.length}/${status.wip_limit}` : tasks.length}
          </span>
        </div>
        {role ? <Token label={role.role_name} /> : null}
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {tasks.length === 0 ? (
          <p className="text-muted-foreground px-2 py-6 text-center text-xs">
            {status.description ?? 'Задач на этом статусе нет'}
          </p>
        ) : (
          tasks.map((task) => (
            <Link key={task.id} to={`/p/${projectKey}/tasks/${task.key}`} className="block">
              <TaskCard task={task} isOnOldWorkflow={task.workflow_id !== activeWorkflowID} />
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

// Колонка для задач, чей статус в действующей версии цикла не существует.
// Такое бывает после активации версии, из которой статус убрали: задача
// доходит по своей версии, и спрятать её было бы враньём.
function OutsideColumn({tasks, projectKey}: {tasks: Task[]; projectKey: string}) {
  return (
    <div className="bg-muted/40 flex h-full w-75 shrink-0 flex-col rounded-lg border">
      <div className="space-y-1 border-b p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Вне текущего цикла</h2>
          <span className="text-muted-foreground text-sm tabular-nums">{tasks.length}</span>
        </div>
        <p className="text-muted-foreground text-xs">
          Статуса нет в действующей версии; задачи доходят по своей
        </p>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {tasks.map((task) => (
          <Link key={task.id} to={`/p/${projectKey}/tasks/${task.key}`} className="block">
            <TaskCard task={task} isOnOldWorkflow />
          </Link>
        ))}
      </div>
    </div>
  );
}
