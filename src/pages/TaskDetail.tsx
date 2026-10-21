import {useEffect, useRef, useState} from 'react';
import {Link, useParams} from 'react-router-dom';
import {Check, Copy, ExternalLink} from 'lucide-react';

import {cn} from '@/lib/utils';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Progress} from '@/components/ui/progress';
import {Tabs, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {Markdown, Row, RowList, Token} from '@/components/kit';

import {api} from '../api/client';
import type {Task, TaskDetail as TaskDetailData, TaskLink, UsageSummary} from '../api/types';
import {useResource} from '../api/useResource';
import {AuditLog} from '../components/AuditLog';
import {Failure, Loading} from '../components/Feedback';
import {DriftPanel} from '../components/DriftPanel';
import {EditTaskDialog} from '../components/EditTaskDialog';
import {SubmitArtifactDialog} from '../components/SubmitArtifactDialog';
import {TaskLabels} from '../components/TaskLabels';
import {externalLinks} from '../components/externalRef';
import {priorityClass, priorityLabel} from '../components/priorities';
import {Actions} from '../components/task/Actions';
import {CollapsibleSection} from '../components/task/CollapsibleSection';
import {Details} from '../components/task/Details';
import {Stages} from '../components/task/Stages';
import {isLeaseLive} from '../components/task/lease';
import {Timeline} from '../components/task/Timeline';

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
  const [tab, setTab] = useState('stages');
  // Знак перезапроса журнала: сам журнал живёт во вкладке и грузится только
  // при её открытии, а перезапрашивается вместе с карточкой.
  const [auditVersion, setAuditVersion] = useState(0);

  const live = (task.data?.stage_runs ?? []).some(isLeaseLive);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      task.reload();
      refs.reload();
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
    refs.reload();
    setAuditVersion((v) => v + 1);
  };

  return (
    <div className="flex min-h-[calc(100svh-3.5rem)] flex-col">
      <Header detail={detail} onChanged={reload} />

      <div className="flex flex-1 flex-col xl:flex-row">
        <div className="min-w-0 flex-1 space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="stages">Этапы и артефакты</TabsTrigger>
                {detail.children.length > 0 ? (
                  <TabsTrigger value="children">Нарезка · {detail.children.length}</TabsTrigger>
                ) : null}
                <TabsTrigger value="timeline">Лента</TabsTrigger>
                <TabsTrigger value="audit">Журнал</TabsTrigger>
              </TabsList>
            </Tabs>
            <SubmitArtifactDialog
              taskKey={detail.task.key}
              transitions={detail.transitions}
              onSubmitted={reload}
            />
          </div>
          {tab === 'stages' ? (
            <Stages detail={detail} onChanged={reload} />
          ) : tab === 'children' ? (
            <Children detail={detail} />
          ) : tab === 'audit' ? (
            <AuditLog
              load={(cursor) => api.taskAudit(detail.task.key, cursor)}
              deps={['task-audit', detail.task.key]}
              version={auditVersion}
            />
          ) : (
            <Timeline events={events} />
          )}
        </div>

        {/* Панель как в трекерах: сначала то, что можно сделать, потом то, что
            про задачу известно, и только потом второстепенное. На широком
            экране она липкая и прокручивается сама, на узком уходит вниз, но
            порядок блоков сохраняет — «Действия» первыми. */}
        <aside className="w-full shrink-0 border-t p-4 xl:w-100 xl:border-t-0 xl:border-l">
          <div className="space-y-6 xl:sticky xl:top-18 xl:max-h-[calc(100svh-5.5rem)] xl:overflow-y-auto">
            <Actions detail={detail} onChanged={reload} />
            <Details detail={detail} refs={refs.data ?? []} onChanged={reload} />
            {detail.links.length > 0 ? (
              <CollapsibleSection name="links" title="Связи" count={detail.links.length}>
                <LinksPanel task={detail.task} links={detail.links} />
              </CollapsibleSection>
            ) : null}
            <DriftPanel taskKey={detail.task.key} />
            <CollapsibleSection name="usage" title="Стоимость">
              <UsagePanel usage={detail.usage} hasChildren={detail.children.length > 0} />
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
      {task.description ? <Description text={task.description} /> : null}
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

// Постановка задачи — разметка, а не подпись под заголовком: её пишет человек
// или аналитик списками и кодом. Длинная сворачивается, чтобы вкладки и правая
// панель не уезжали за экран; раскрытие — разовое действие, а не настройка,
// поэтому нигде не запоминается.
const DESCRIPTION_COLLAPSED_PX = 260;

function Description({text}: {text: string}) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Сворачивать нужно только то, что не поместилось: у короткой постановки
  // кнопки «Показать целиком» быть не должно, а длина в символах этого не
  // показывает — решает высота отрисованной разметки. Меряется на каждой новой
  // постановке: её правят прямо в карточке, и мерка от прежнего текста соврала бы.
  useEffect(() => {
    const node = box.current;
    if (node) setOverflows(node.scrollHeight > DESCRIPTION_COLLAPSED_PX + 8);
  }, [text]);

  return (
    <div className="space-y-1">
      <div
        ref={box}
        className={cn('overflow-hidden', !expanded && overflows && 'mask-b-from-80%')}
        style={expanded || !overflows ? undefined : {maxHeight: DESCRIPTION_COLLAPSED_PX}}>
        <Markdown>{text}</Markdown>
      </div>
      {overflows ? (
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Свернуть' : 'Показать целиком'}
        </Button>
      ) : null}
    </div>
  );
}

// Тип задачи — системное свойство: по нему выбран цикл (решение 0024).
function taskType(task: Task): string {
  const value = task.properties.type;
  return typeof value === 'string' && value ? value : 'task';
}

// Нарезка эпика: дочерние задачи со своими статусами. Порядок между ними
// держат связи blocks и гейт dependencies_closed, а не эта таблица.
function Children({detail}: {detail: TaskDetailData}) {
  const closed = detail.children.filter((c) => c.closed_at).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-base font-semibold">Дочерние задачи</h3>
        <Badge variant="secondary">
          закрыто {closed} из {detail.children.length}
        </Badge>
      </div>
      <Progress value={detail.children.length === 0 ? 0 : (closed / detail.children.length) * 100} />
      <RowList>
        {detail.children.map((child) => (
          <Link key={child.id} to={`/p/${child.project_key}/tasks/${child.key}`} className="block">
            <Row end={<Badge variant="secondary">{child.status_name}</Badge>}>
              <p className="truncate font-medium">
                {child.key} · {child.title}
              </p>
              {child.assignee_handle ? (
                <p className="text-muted-foreground truncate text-xs">
                  исполнитель: {child.assignee_handle}
                </p>
              ) : null}
            </Row>
          </Link>
        ))}
      </RowList>
    </div>
  );
}

// Стоимость задачи (решение 0026). Прогоны без отчёта показаны отдельно:
// «неизвестно» — это не ноль, и подменять одно другим значит врать о счёте.
function UsagePanel({usage, hasChildren}: {usage: UsageSummary; hasChildren: boolean}) {
  const money = (v: number) => `${v.toFixed(2)} $`;

  return (
    <>
      <dl className="space-y-1 text-sm">
        <Line label="Своя" value={money(usage.cost_usd)} />
        {hasChildren ? (
          <Line label="Вместе с дочерними" value={money(usage.subtree_cost_usd)} />
        ) : null}
        <Line label="Токенов" value={usage.tokens.toLocaleString('ru')} />
      </dl>
      {usage.silent_runs > 0 ? (
        <p className="text-muted-foreground text-xs">
          Прогонов без отчёта: {usage.silent_runs} — их стоимость неизвестна
        </p>
      ) : null}
    </>
  );
}

function Line({label, value}: {label: string; value: string}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
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
