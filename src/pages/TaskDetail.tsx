import {useEffect, useState} from 'react';
import {Link, useParams} from 'react-router-dom';

import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Progress} from '@/components/ui/progress';
import {Separator} from '@/components/ui/separator';
import {Tabs, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {
  EmptyState,
  Row,
  RowList,
  Section,
  StatusDot,
  Timestamp,
  Token,
  type DotVariant,
} from '@/components/kit';

import {ApiError, api} from '../api/client';
import type {
  Artifact,
  StageRun,
  Task,
  TaskDetail as TaskDetailData,
  TaskEvent,
  TaskLink,
  TransitionOption,
  UsageSummary,
  Workflow,
} from '../api/types';
import {useResource, type Resource} from '../api/useResource';
import {Failure, Loading} from '../components/Feedback';
import {GateRow} from '../components/Gates';
import {ArtifactView} from '../components/ArtifactView';
import {AssigneePanel} from '../components/AssigneePanel';
import {DriftPanel} from '../components/DriftPanel';
import {EditTaskDialog} from '../components/EditTaskDialog';
import {ScopePanel} from '../components/ScopePanel';
import {SubmitArtifactDialog} from '../components/SubmitArtifactDialog';

// Пока аренда жива, за карточкой стоит агент на другой машине: он сдаёт
// артефакты и продлевает аренду, а страница об этом узнаёт только перезапросом.
const LIVE_POLL_MS = 10_000;

export function TaskDetail() {
  const {taskKey = ''} = useParams();
  const task = useResource(() => api.getTask(taskKey), [taskKey]);
  const events = useResource(() => api.timeline(taskKey), [taskKey]);
  const [tab, setTab] = useState('stages');

  const live = (task.data?.stage_runs ?? []).some(isLeaseLive);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => task.reload(), LIVE_POLL_MS);
    return () => clearInterval(timer);
    // Опрос заводится на время живой аренды, а не на каждый рендер карточки.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, taskKey]);

  if (task.error) return <div className="p-6"><Failure error={task.error} /></div>;
  if (!task.data) return <Loading />;

  const detail = task.data;
  const reload = () => {
    task.reload();
    events.reload();
  };

  return (
    <div className="flex min-h-[calc(100svh-3.5rem)] flex-col">
      <div className="space-y-2 border-b p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground font-mono text-xs">{detail.task.key}</span>
          <Badge variant="secondary">{detail.task.status_name}</Badge>
          <Badge variant="outline">{taskType(detail.task)}</Badge>
          {detail.task.priority !== 'normal' ? (
            <Badge variant="outline" className="border-amber-500/30 text-amber-700 dark:text-amber-300">
              {detail.task.priority}
            </Badge>
          ) : null}
          {detail.task.parent_key ? (
            <Link
              to={`/p/${detail.task.project_key}/tasks/${detail.task.parent_key}`}
              className="text-sm underline underline-offset-4">
              ↑ {detail.task.parent_key}
            </Link>
          ) : null}
          {detail.task.assignee_handle ? (
            <span className="text-muted-foreground text-xs">
              назначена: {detail.task.assignee_handle}
            </span>
          ) : null}
        </div>
        <div className="flex items-start gap-2">
          <h1 className="min-w-0 flex-1 text-2xl font-semibold tracking-tight">
            {detail.task.title}
          </h1>
          <EditTaskDialog task={detail.task} onChanged={reload} />
        </div>
        {detail.task.description ? (
          <p className="text-muted-foreground text-sm whitespace-pre-wrap">
            {detail.task.description}
          </p>
        ) : null}
      </div>

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
          ) : (
            <Timeline events={events} />
          )}
        </div>

        <aside className="w-full shrink-0 space-y-4 border-t p-4 xl:w-100 xl:border-t-0 xl:border-l">
          <Transitions detail={detail} onChanged={reload} />
          <Separator />
          <AssigneePanel task={detail.task} onChanged={reload} />
          <Separator />
          <UsagePanel usage={detail.usage} hasChildren={detail.children.length > 0} />
          {detail.links.length > 0 ? (
            <>
              <Separator />
              <LinksPanel task={detail.task} links={detail.links} />
            </>
          ) : null}
          <DriftPanel taskKey={detail.task.key} />
          <Separator />
          <ScopePanel task={detail.task} onChanged={reload} />
        </aside>
      </div>
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
    <Section title="Стоимость">
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
    </Section>
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
    <Section title="Связи">
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
    </Section>
  );
}

// Этапы идут попытками: повторный заход после отката — новая попытка, а не
// перезапись прежней, поэтому «аналитика делалась дважды» видно целиком.
//
// Перепроверка ролью-ревьюером — не отдельный этап, а вложенный прогон того же
// (решение 0017), поэтому она показана внутри своего родителя: пока она идёт,
// родительский прогон стоит в gating и работать в нём некому.
function Stages({detail, onChanged}: {detail: TaskDetailData; onChanged: () => void}) {
  const nested = new Map<string, StageRun[]>();
  for (const run of detail.stage_runs) {
    if (!run.parent_run_id) continue;
    const list = nested.get(run.parent_run_id);
    if (list) list.push(run);
    else nested.set(run.parent_run_id, [run]);
  }

  const runs = detail.stage_runs
    .filter((r) => !r.parent_run_id)
    .sort((a, b) => b.entered_at.localeCompare(a.entered_at));

  return (
    <div className="space-y-4">
      {runs.map((run) => (
        <StageCard
          key={run.id}
          run={run}
          reviews={(nested.get(run.id) ?? []).sort((a, b) => a.entered_at.localeCompare(b.entered_at))}
          artifacts={detail.artifacts.filter((a) => a.stage_run_id === run.id)}
          allArtifacts={detail.artifacts}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}

const RUN_VARIANT: Record<string, DotVariant> = {
  passed: 'success',
  failed: 'error',
  abandoned: 'neutral',
  pending: 'neutral',
  claimed: 'accent',
  in_progress: 'accent',
  submitted: 'warning',
  gating: 'warning',
};

// Аренда жива, пока не истекла: агент продлевает её heartbeat'ом, и по этому
// же признаку карточка решает, перезапрашивать ли себя.
function isLeaseLive(run: StageRun): boolean {
  return Boolean(run.lease_expires_at && new Date(run.lease_expires_at) > new Date());
}

function StageCard({
  run,
  reviews,
  artifacts,
  allArtifacts,
  onChanged,
}: {
  run: StageRun;
  reviews: StageRun[];
  artifacts: Artifact[];
  allArtifacts: Artifact[];
  onChanged: () => void;
}) {
  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusDot variant={RUN_VARIANT[run.state] ?? 'neutral'} label={run.state} />
          <h3 className="text-base font-semibold">{run.status_key}</h3>
          {run.role_key ? <Token label={run.role_key} /> : null}
          {run.attempt > 1 ? <Badge variant="secondary">попытка {run.attempt}</Badge> : null}
        </div>
        <Timestamp value={run.entered_at} format="relative" />
      </div>
      <Lease run={run} />
      {run.summary ? <p className="text-muted-foreground text-sm">{run.summary}</p> : null}
      {artifacts.length === 0 ? (
        <p className="text-muted-foreground text-sm">Артефактов на этой попытке нет</p>
      ) : (
        <div className="space-y-2">
          {artifacts.map((a) => (
            <ArtifactView key={a.id} artifact={a} onChanged={onChanged} />
          ))}
        </div>
      )}
      {reviews.length > 0 ? (
        <div className="space-y-2 border-l-2 pl-3">
          <p className="text-muted-foreground text-xs">Перепроверка</p>
          {reviews.map((review) => (
            <ReviewRun
              key={review.id}
              run={review}
              artifacts={allArtifacts.filter((a) => a.stage_run_id === review.id)}
              onChanged={onChanged}
            />
          ))}
        </div>
      ) : null}
    </Card>
  );
}

// Вложенный прогон перепроверки: своя роль, своя аренда, свой вердикт.
function ReviewRun({
  run,
  artifacts,
  onChanged,
}: {
  run: StageRun;
  artifacts: Artifact[];
  onChanged: () => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusDot variant={RUN_VARIANT[run.state] ?? 'neutral'} label={run.state} />
          {run.role_key ? <Token label={run.role_key} /> : null}
          {run.outcome ? <Badge variant="secondary">{run.outcome}</Badge> : null}
        </div>
        <Timestamp value={run.entered_at} format="relative" />
      </div>
      <Lease run={run} />
      {run.summary ? <p className="text-muted-foreground text-sm">{run.summary}</p> : null}
      {artifacts.map((a) => (
        <ArtifactView key={a.id} artifact={a} onChanged={onChanged} />
      ))}
    </div>
  );
}

// Аренда: кто забрал прогон, когда подавал признаки жизни и сколько ей
// осталось. Истёкшую аренду подметает воркер, но до тех пор она видна как
// истёкшая, а не как пустая: разница объясняет, почему задачу никто не берёт.
function Lease({run}: {run: StageRun}) {
  if (!run.claimed_by_handle) return null;
  const live = isLeaseLive(run);
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className="inline-flex items-center gap-1.5">
        <StatusDot variant={live ? 'accent' : 'neutral'} />
        {live ? 'в работе у' : 'аренда истекла у'} {run.claimed_by_handle}
      </span>
      {run.lease_expires_at ? (
        <span>
          аренда {live ? 'истекает' : 'истекла'}{' '}
          <Timestamp value={run.lease_expires_at} format="relative" className="text-xs" />
        </span>
      ) : null}
      {run.heartbeat_at ? (
        <span>
          подал признаки жизни <Timestamp value={run.heartbeat_at} format="relative" className="text-xs" />
        </span>
      ) : null}
    </div>
  );
}

function Transitions({detail, onChanged}: {detail: TaskDetailData; onChanged: () => void}) {
  // Определения гейтов берутся из версии цикла самой задачи, а не из активной:
  // задача доходит по той, на которой начата (решение 0016).
  const workflow = useResource(
    () => api.getWorkflowVersion(detail.task.workflow_id),
    [detail.task.workflow_id],
  );

  return (
    <Section title="Переходы">
      {detail.transitions.length === 0 ? (
        <EmptyState title="Дальше некуда" description="Задача в терминальном статусе" />
      ) : (
        detail.transitions.map((t) => (
          <TransitionCard
            key={t.key}
            taskKey={detail.task.key}
            transition={t}
            workflow={workflow.data}
            onChanged={onChanged}
          />
        ))
      )}
    </Section>
  );
}

function TransitionCard({
  taskKey,
  transition,
  workflow,
  onChanged,
}: {
  taskKey: string;
  transition: TransitionOption;
  workflow?: Workflow;
  onChanged: () => void;
}) {
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);

  const definition = workflow?.transitions.find((t) => t.key === transition.key);

  const act = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await run();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="gap-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{transition.name}</p>
          <p className="text-muted-foreground text-xs">→ {transition.to_status}</p>
        </div>
        <Button
          size="sm"
          variant={transition.allowed ? 'default' : 'secondary'}
          disabled={!transition.allowed || busy}
          onClick={() => act(() => api.execute(taskKey, transition.key))}>
          {transition.allowed ? 'Перевести' : 'Держат гейты'}
        </Button>
      </div>
      {error ? <Failure error={error} title="Переход не выполнен" /> : null}
      {transition.gates.length > 0 ? (
        <div className="space-y-3">
          <Separator />
          {transition.gates.map((gate) => (
            <GateRow
              key={gate.gate_key}
              check={gate}
              gate={definition?.gates?.find((g) => g.key === gate.gate_key)}
              onDecide={(status, details) =>
                act(() => api.decideGate(taskKey, transition.key, gate.gate_key, {status, details}))
              }
            />
          ))}
        </div>
      ) : null}
    </Card>
  );
}

// Лента показывает ресурс карточки, а не заводит свой: её перезапрашивает
// каждое действие на странице (правка постановки, сдача артефакта, переход),
// и второй экземпляр того же запроса остался бы на прежних событиях.
function Timeline({events}: {events: Resource<TaskEvent[]>}) {
  if (events.error) return <Failure error={events.error} />;
  if (!events.data) return <Loading />;

  return (
    <RowList>
      {events.data.map((e) => (
        <Row key={e.id} end={<Timestamp value={e.created_at} format="relative" />}>
          <p className="font-medium">{e.type}</p>
          {e.actor_handle ? (
            <p className="text-muted-foreground text-xs">{e.actor_handle}</p>
          ) : null}
        </Row>
      ))}
    </RowList>
  );
}
