import {useState} from 'react';
import {Link, useParams, useSearchParams} from 'react-router-dom';
import {ArrowLeft, RefreshCw} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {Skeleton} from '@/components/ui/skeleton';
import {EmptyState, Note, Token} from '@/components/kit';
import {cn} from '@/lib/utils';

import {api, ApiError} from '../api/client';
import type {TaskListPage} from '../api/types';
import {useResource} from '../api/useResource';
import {Failure} from '../components/Feedback';
import {priorityClass, priorityLabel} from '../components/priorities';
import {StatusColorDot} from '../components/overview/SummaryZone';
import {headOf} from '../components/overview/summary';
import {
  TASK_LIST_PAGE,
  executorText,
  overviewHref,
  readSelection,
  selectionQuery,
  selectionTokens,
  type TaskListSelection,
} from '../components/overview/taskList';
import {agoText} from '../components/taskrow/format';
import {describeReasons} from '../components/taskrow/reasons';
import {isOldVersion} from '../components/taskrow/rules';
import {useNow} from '../components/taskrow/useNow';

// «Задачи» — список по счётчику «Сводки» «Обзора» (CLAB-488, design.spec §5).
// Минимальная страница: ровно отбор из адреса, без своих фильтров и без
// живого обновления; «Обновить» перечитывает.
export function TaskList() {
  const {projectKey = ''} = useParams();
  const [sp] = useSearchParams();
  const sel = readSelection(sp);
  const back = overviewHref(projectKey, sel);
  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-5 p-4 sm:p-6" data-task-list>
      <Button asChild variant="link" size="sm" className="h-auto px-0">
        <Link to={back} data-task-list-back>
          <ArrowLeft aria-hidden />
          Обзор
        </Link>
      </Button>
      {sel ? (
        <Selected projectKey={projectKey} sel={sel} back={back} />
      ) : (
        <Note title="Отбор не задан" description="Эта страница открывается по числу в «Сводке» «Обзора».">
          <Button asChild variant="outline" size="sm">
            <Link to={back}>К обзору</Link>
          </Button>
        </Note>
      )}
    </div>
  );
}

function Selected({projectKey, sel, back}: {projectKey: string; sel: TaskListSelection; back: string}) {
  const project = useResource(() => api.getProject(projectKey), [projectKey]);
  const head = project.data ? headOf(project.data, sel.type) : undefined;
  const version = useResource(
    () => (head ? api.getWorkflowVersion(head.id) : Promise.resolve(null)),
    [head?.id ?? ''],
  );
  const status = sel.by === 'status' ? version.data?.statuses.find((s) => s.key === sel.status) : undefined;
  const scope = JSON.stringify(sel);
  const list = useResource(() => api.listTasks(projectKey, selectionQuery(sel)), [projectKey, scope]);
  // «Ещё 50» дочитывает следующую порцию к уже показанным; «Обновить» и
  // смена отбора начинают заново.
  const [more, setMore] = useState<{scope: string; base: TaskListPage | undefined; tasks: TaskListPage['tasks']; total?: number}>({
    scope,
    base: undefined,
    tasks: [],
  });
  const [moreState, setMoreState] = useState<{loading: boolean; error?: ApiError}>({loading: false});
  const extra = more.scope === scope && more.base === list.data ? more : {tasks: [], total: undefined};
  const now = useNow();
  const rows = [...(list.data?.tasks ?? []), ...extra.tasks];
  const total = extra.total ?? list.data?.total ?? 0;
  const loadMore = () => {
    if (moreState.loading || !list.data) return;
    const base = list.data;
    setMoreState({loading: true});
    api.listTasks(projectKey, selectionQuery(sel, rows.length)).then(
      (page) => {
        setMore({scope, base, tasks: [...extra.tasks, ...page.tasks], total: page.total});
        setMoreState({loading: false});
      },
      (err: unknown) => setMoreState({loading: false, error: err instanceof ApiError ? err : new ApiError('internal', String(err))}),
    );
  };
  const showStatus = sel.by !== 'status';

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Задачи</h1>
          <p className="text-muted-foreground text-sm">
            {project.data?.project.name ?? projectKey} · отбор из сводки «Обзора»
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            if (!list.loading) list.reload();
          }}
          aria-busy={list.loading || undefined}
          aria-label="Обновить"
          data-refresh>
          <RefreshCw aria-hidden className={cn(list.loading && 'animate-spin')} />
          <span className="max-sm:sr-only">Обновить</span>
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5" data-task-list-selection>
        {selectionTokens(sel, status?.name).map((t, i) => (
          <Token
            key={t}
            label={
              i === 1 && sel.by === 'status' ? (
                <>
                  <StatusColorDot color={status?.color} category={status?.category} />
                  {t}
                </>
              ) : (
                t
              )
            }
          />
        ))}
      </div>
      {list.error && !list.data ? (
        <Failure error={list.error} title="Не получилось загрузить задачи" reload={list.reload} />
      ) : !list.data ? (
        <div className="space-y-2" data-task-list-skeleton>
          {Array.from({length: 5}, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="По этому отбору задач нет"
          description="Счётчик сводки мог измениться, пока страница открывалась."
          action={
            <Button asChild variant="outline">
              <Link to={back}>К обзору</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          <p className="text-muted-foreground text-sm" data-task-list-total>
            {total} {total === 1 ? 'задача' : 'задач'} · по последнему движению
          </p>
          <div className="rounded-lg border" role="table" aria-label="Задачи по отбору">
            <div
              role="row"
              className={cn(
                'text-muted-foreground hidden gap-3 border-b px-3 py-2 text-xs font-medium md:grid',
                showStatus ? 'md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_8rem]' : 'md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_8rem]',
              )}>
              <span role="columnheader">Задача</span>
              {showStatus ? <span role="columnheader">Статус</span> : null}
              <span role="columnheader">Исполнитель</span>
              <span role="columnheader">Причина</span>
              <span role="columnheader">Движение</span>
            </div>
            {rows.map((t) => {
              const reason = describeReasons(t.attention ?? [], {now, canDecide: false, blockedBy: t.blocked_by ?? []})[0];
              const old = project.data ? isOldVersion(t, project.data.active_workflows) : false;
              return (
                <Link
                  key={t.key}
                  to={`/p/${projectKey}/tasks/${t.key}`}
                  role="row"
                  data-task-key={t.key}
                  className={cn(
                    'hover:bg-muted/40 focus-visible:ring-ring/50 grid gap-1 border-b px-3 py-2 text-sm last:border-b-0 focus-visible:ring-[3px] focus-visible:outline-none md:gap-3',
                    showStatus ? 'md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_8rem]' : 'md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_8rem]',
                  )}>
                  <span role="cell" className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="text-muted-foreground font-mono text-xs">{t.key}</span>
                    <span className="min-w-0 font-medium break-words">{t.title}</span>
                    {t.priority !== 'normal' ? <Token label={priorityLabel(t.priority)} className={priorityClass(t.priority)} /> : null}
                    {t.parent_key ? <Token label={t.parent_key} /> : null}
                    {old ? <Token label="прежняя версия цикла" color="orange" /> : null}
                  </span>
                  {showStatus ? (
                    <span role="cell" className="text-muted-foreground inline-flex min-w-0 items-center gap-1.5 text-xs">
                      {t.status_name}
                    </span>
                  ) : null}
                  <span role="cell" className="text-muted-foreground text-xs">
                    {executorText(t)}
                  </span>
                  <span role="cell" className="text-xs">
                    {reason ? <Token label={reason.text} color={reason.tone} /> : <span className="text-muted-foreground">—</span>}
                  </span>
                  <span role="cell" className="text-muted-foreground text-xs">
                    {t.last_moved_at ? agoText(t.last_moved_at, now) : '—'}
                  </span>
                </Link>
              );
            })}
          </div>
          {rows.length < total ? (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              aria-busy={moreState.loading || undefined}
              onClick={loadMore}
              data-task-list-more>
              Ещё {Math.min(TASK_LIST_PAGE, total - rows.length)}
            </Button>
          ) : null}
          {moreState.error ? <Failure error={moreState.error} title="Не получилось загрузить ещё" reload={loadMore} /> : null}
        </div>
      )}
    </>
  );
}
