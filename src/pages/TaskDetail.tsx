import {useEffect, useState} from 'react';
import {Link, useParams, useSearchParams} from 'react-router-dom';
import {Check, Copy, ExternalLink} from 'lucide-react';

import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Row, RowList, Token} from '@/components/kit';

import {api} from '../api/client';
import type {ProjectDetail, Task, TaskDetail as TaskDetailData, TaskEvent, TaskLink, Workflow} from '../api/types';
import {useResource} from '../api/useResource';
import {Failure, Loading} from '../components/Feedback';
import {DriftPanel} from '../components/DriftPanel';
import {EditTaskDialog} from '../components/EditTaskDialog';
import {SubmitArtifactDialog} from '../components/SubmitArtifactDialog';
import {TaskLabels} from '../components/TaskLabels';
import {CycleDiagram} from '../components/cycle/CycleDiagram';
import {resolveStage, toggleStage} from '../components/cycle/state';
import {externalLinks} from '../components/externalRef';
import {priorityClass, priorityLabel} from '../components/priorities';
import {Actions} from '../components/task/Actions';
import {CollapsibleSection} from '../components/task/CollapsibleSection';
import {Details} from '../components/task/Details';
import {Overview} from '../components/task/TaskOverview';
import {Stages} from '../components/task/Stages';
import {UsageLines} from '../components/task/Usage';
import {isLeaseLive} from '../components/task/lease';
import {useTaskLevelEditable} from '../hooks/useTaskLevelEditable';

// Пока аренда жива, за карточкой стоит агент на другой машине: он сдаёт
// артефакты и продлевает аренду, а страница об этом узнаёт только перезапросом.
const LIVE_POLL_MS = 10_000;

export function TaskDetail() {
  const {taskKey = ''} = useParams();
  const task = useResource(() => api.getTask(taskKey), [taskKey]);
  const events = useResource(() => api.timeline(taskKey), [taskKey]);
  // Привязки PR лежат за отдельной ручкой, но живут той же жизнью, что и
  // карточка: их кладёт агент по ходу прогона, и узнаётся это перезапросом.
  const refs = useResource(() => api.repoRefs(taskKey), [taskKey]);
  // Версия цикла задачи — одна на схему и «Действия». Она иммутабельна
  // (решение 0016), поэтому опрос живой аренды её не перезапрашивает; новая
  // приходит, только если у задачи сменилась версия (бэклог после активации,
  // решение 0036).
  const workflowId = task.data?.task.workflow_id;
  const workflow = useResource<Workflow | undefined>(
    () => (workflowId ? api.getWorkflowVersion(workflowId) : Promise.resolve(undefined)),
    [workflowId],
  );
  // Проект задачи — один на «Детали» (свойства, область) и право на уровень
  // модели, которое делят ползунки задачи и этапа.
  const projectKey = task.data?.task.project_key ?? '';
  const project = useResource<ProjectDetail | undefined>(
    () => (projectKey ? api.getProject(projectKey) : Promise.resolve(undefined)),
    [projectKey],
  );
  const levelEditable = useTaskLevelEditable(projectKey, project.data?.project.owner_team_key);
  // Выбранный этап живёт в адресе: ссылкой с ?stage= делятся, а «Назад»
  // возвращает прежний выбор — каждый выбор кладёт запись в историю.
  // Незнакомый ключ — как без выбора.
  const [search, setSearch] = useSearchParams();
  const stageParam = search.get('stage');
  const stage = resolveStage(stageParam, workflow.data?.statuses);
  // Лента выбранного этапа (CLAB-283, `timeline?status=`): своя, а не
  // фильтр ленты задачи — у той предел на всю задачу, и ранние этапы из
  // неё вытесняются. Без выбора запроса нет.
  const stageEvents = useResource<TaskEvent[]>(
    () => (stage ? api.timeline(taskKey, stage) : Promise.resolve([])),
    [taskKey, stage],
  );
  const setStage = (key: string | undefined) => {
    const next = new URLSearchParams(search);
    if (key) next.set('stage', key);
    else next.delete('stage');
    setSearch(next);
  };
  const selectStage = (key: string) => setStage(toggleStage(stage, key));
  // Знак перезапроса журнала: сам журнал живёт в раскрытой секции обзора и
  // грузится только при её открытии, а перезапрашивается вместе с карточкой.
  const [auditVersion, setAuditVersion] = useState(0);

  const live = (task.data?.stage_runs ?? []).some(isLeaseLive);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      task.reload();
      events.reload();
      refs.reload();
      // Панель выбранного этапа живёт той же жизнью, что и карточка: агент
      // сдаёт артефакты и проходит гейты, и это должно быть видно без F5.
      stageEvents.reload();
      setAuditVersion((v) => v + 1);
    }, LIVE_POLL_MS);
    return () => clearInterval(timer);
    // Опрос заводится на время живой аренды, а не на каждый рендер карточки.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, taskKey]);

  if (task.error) return <div className="p-6"><Failure error={task.error} reload={task.reload} /></div>;
  if (!task.data) return <Loading />;

  const detail = task.data;
  const reload = () => {
    task.reload();
    events.reload();
    stageEvents.reload();
    refs.reload();
    setAuditVersion((v) => v + 1);
  };

  return (
    <div className="flex min-h-[calc(100svh-3.5rem)] flex-col">
      <Header detail={detail} onChanged={reload} />

      <div className="flex flex-1 flex-col xl:flex-row">
        <div className="min-w-0 flex-1 space-y-4 p-4">
          <CycleDiagram workflow={workflow} detail={detail} selected={stage} onSelect={selectStage} />
          <div className="flex justify-end">
            <SubmitArtifactDialog
              taskKey={detail.task.key}
              transitions={detail.transitions}
              onSubmitted={reload}
            />
          </div>
          {stage ? (
            <Stages
              detail={detail}
              stage={stage}
              workflow={workflow.data}
              stageEvents={stageEvents}
              levelEditable={levelEditable}
              onClearStage={() => setStage(undefined)}
              onChanged={reload}
            />
          ) : (
            <Overview detail={detail} workflow={workflow.data} events={events} auditVersion={auditVersion} />
          )}
        </div>

        {/* Панель как в трекерах: сначала то, что можно сделать, потом то, что
            про задачу известно, и только потом второстепенное. На широком
            экране она липкая и прокручивается сама, на узком уходит вниз, но
            порядок блоков сохраняет — «Действия» первыми. */}
        <aside className="w-full shrink-0 border-t p-4 xl:w-100 xl:border-t-0 xl:border-l">
          <div className="space-y-6 xl:sticky xl:top-18 xl:max-h-[calc(100svh-5.5rem)] xl:overflow-y-auto">
            <Actions detail={detail} workflow={workflow.data} onChanged={reload} />
            <Details
              detail={detail}
              refs={refs.data ?? []}
              project={project.data}
              levelEditable={levelEditable}
              onChanged={reload}
            />
            {detail.links.length > 0 ? (
              <CollapsibleSection name="links" title="Связи" count={detail.links.length}>
                <LinksPanel task={detail.task} links={detail.links} />
              </CollapsibleSection>
            ) : null}
            <DriftPanel taskKey={detail.task.key} />
            <CollapsibleSection name="usage" title="Стоимость">
              <UsageLines usage={detail.usage} hasChildren={detail.children.length > 0} />
            </CollapsibleSection>
          </div>
        </aside>
      </div>
    </div>
  );
}

// Шапка: ключ, заголовок и одна строка метаданных. Исполнитель здесь не
// показывается — он в «Деталях», где его и меняют.
function Header({detail, onChanged}: {detail: TaskDetailData; onChanged: () => void}) {
  const {task} = detail;

  return (
    <div className="space-y-2 border-b p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <CopyKey taskKey={task.key} />
          <h1 className="text-2xl font-semibold tracking-tight">{task.title}</h1>
        </div>
        <EditTaskDialog task={task} onChanged={onChanged} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="secondary">{task.status_name}</Badge>
        <Token label={taskType(task)} />
        <Token label={priorityLabel(task.priority)} className={priorityClass(task.priority)} />
        {task.parent_key ? (
          <Link
            to={`/p/${task.project_key}/tasks/${task.parent_key}`}
            className="underline underline-offset-4">
            ↑ {task.parent_key}
          </Link>
        ) : null}
        <ExternalRefs externalRef={task.external_ref} />
        <TaskLabels labels={task.labels} />
      </div>
    </div>
  );
}

// Ссылки на тикеты основного трекера — рядом с родителем: это тоже «откуда
// пришла работа». Открываются в новой вкладке: трекер — чужое приложение, и
// уводить из карточки в него незачем. Правка ссылок — через CLI и MCP.
function ExternalRefs({externalRef}: {externalRef: unknown}) {
  return externalLinks(externalRef).map((link) => (
    <a
      key={link.system}
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      data-external-ref={link.system}
      className="inline-flex items-center gap-1 underline underline-offset-4">
      <span className="text-muted-foreground">{link.system}</span>
      <span>{link.key}</span>
      <ExternalLink className="size-3" aria-hidden />
    </a>
  ));
}

// Ключ задачи — то, чем на неё ссылаются в ветке, PR и разговоре, поэтому он
// копируется одной кнопкой.
function CopyKey({taskKey}: {taskKey: string}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(taskKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex items-center gap-1">
      <span className="text-muted-foreground font-mono text-xs">{taskKey}</span>
      <Button size="icon-sm" variant="ghost" onClick={copy} aria-label="Скопировать ключ">
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

// Тип задачи — системное свойство: по нему выбран цикл (решение 0024).
function taskType(task: Task): string {
  const value = task.properties.type;
  return typeof value === 'string' && value ? value : 'task';
}

// Связи задачи. blocks читает гейт зависимостей, поэтому направление важно:
// «эта блокирует» и «эту блокируют» — разные новости.
function LinksPanel({task, links}: {task: Task; links: TaskLink[]}) {
  return (
    <RowList>
      {links.map((link) => (
        <Link
          key={`${link.rel}-${link.direction}-${link.task_id}`}
          to={`/p/${task.project_key}/tasks/${link.task_key}`}
          className="block">
          <Row end={<span className="text-muted-foreground text-xs">{link.status_key}</span>}>
            <p className="truncate font-medium">
              {link.task_key} · {link.task_title}
            </p>
            <p className="text-muted-foreground truncate text-xs">
              {link.direction === 'outgoing'
                ? `${task.key} → ${link.rel}`
                : `${link.rel} → ${task.key}`}
            </p>
          </Row>
        </Link>
      ))}
    </RowList>
  );
}
