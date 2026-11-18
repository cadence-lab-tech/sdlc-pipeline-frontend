import type {ReactNode} from 'react';
import {Link} from 'react-router-dom';
import {AlertTriangle, ArrowRight, CornerDownRight} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';

import type {ProjectDetail, TaskRow as TaskRowData} from '../../api/types';
import {TaskRow} from '../taskrow/TaskRow';
import {MoreButton, Zone} from './Zone';
import type {OverviewData} from './useOverview';
import {
  BACKLOG_SIZES,
  CAPS,
  READY_TEXTS,
  parseBacklogSize,
  freeCount,
  unstartedModel,
  viaBlockedText,
  viaText,
  visibleStages,
  type ReadyCount,
  type StagesModel,
} from './zones';

export type RowProps = {
  projectKey: string;
  project?: ProjectDetail;
  onPickEpic: (key: string) => void;
  hideEpic: boolean;
};

function Sub({children, aside, ...rest}: {children: ReactNode; aside?: ReactNode} & Record<`data-${string}`, string>) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2" {...rest}>
      <p className="text-muted-foreground text-xs">{children}</p>
      {aside}
    </div>
  );
}

// «↳ внутри KEY — она уже в работе» или «↳ внутри заблокированного KEY».
function viaNote(via: string | null, blocked: boolean): ReactNode {
  if (!via) return undefined;
  return (
    <span className="inline-flex items-center gap-1">
      <CornerDownRight aria-hidden className="size-3" />
      {blocked ? viaBlockedText(via) : viaText(via)}
    </span>
  );
}

function Rows({children}: {children: ReactNode}) {
  return <div className="space-y-2">{children}</div>;
}

// Блок «Можно брать сейчас» (design.spec §4.5): этапы, ждущие исполнителя
// (свои роли первыми), неначатые свободные в порядке бэклога по правилу
// clab backlog --next и ждущие блокирующих. Только чтение: порядок и состав
// отдаёт сервер, клиент строки не сортирует. Ждущие блокирующих и
// назначенные другому в счётчик не входят.
export function ReadyZone({
  data,
  stages,
  count,
  rowProps,
  inParent,
}: {
  data: OverviewData;
  stages: StagesModel | null;
  count: ReadyCount | null;
  rowProps: RowProps;
  inParent: boolean;
}) {
  const s = data.stages;
  const u = data.unstarted;
  const error = s.error ?? u.error;
  const pending = (!s.data || !u.data) && !error;
  const model = u.data ? unstartedModel(u.data.top.tasks, u.data.kids, inParent) : {free: [], waiting: [], held: 0};
  const size = inParent ? CAPS.readyInParent : data.backlogSize;
  const free = model.free.slice(0, size);
  const freeTotal = u.data ? freeCount(u.data.freeTotal, model) : null;
  const rejected = u.data !== undefined && freeTotal === null;
  const v = stages ? visibleStages(stages, data.view.stagesMore) : null;
  const waiting = data.view.waitingMore ? model.waiting : model.waiting.slice(0, CAPS.readyWaiting);
  const waitingHidden = model.waiting.length - waiting.length;
  const nothing =
    stages !== null &&
    u.data !== undefined &&
    stages.own.length + stages.other.length + stages.assigned.length === 0 &&
    model.free.length === 0 &&
    model.waiting.length === 0;
  const topPartial = u.data !== undefined && u.data.top.total > u.data.top.tasks.length;

  const stageRows = (rows: TaskRowData[], mark?: 'own_role' | 'assigned_other') => (
    <Rows>
      {rows.map((t) => (
        <TaskRow key={t.key} task={t} zone="queue" density="row" queueMark={mark} {...rowProps} />
      ))}
    </Rows>
  );

  return (
    <Zone
      zone="ready"
      count={error ? null : count ? count.n : null}
      partial={count?.partial}
      aside={
        <Button asChild variant="link" size="sm" className="h-auto px-0" data-backlog-all>
          <Link to={`/p/${rowProps.projectKey}/backlog`}>
            {READY_TEXTS.all}
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      }
      pending={pending}
      skeletons={4}
      density="row"
      error={error}
      retry={() => {
        s.retry();
        u.retry();
      }}
      busy={s.loading || u.loading}
      isEmpty={nothing}
      emptyText={READY_TEXTS.empty}>
      {nothing || !stages || !v ? null : (
        <>
          {stages.claimable > 0 ? (
            <div className="space-y-2" data-ready-group="stages">
              <Sub>
                {READY_TEXTS.stages} · {stages.partial ? `${stages.claimable}+` : stages.claimable}
              </Sub>
              {stages.grouped ? (
                <>
                  {v.own.length > 0 ? stageRows(v.own, 'own_role') : null}
                  {v.other.length > 0 ? stageRows(v.other) : null}
                </>
              ) : (
                stageRows(v.own)
              )}
            </div>
          ) : null}
          {v.assigned.length > 0 ? (
            <div className="space-y-2" data-ready-group="assigned">
              <Sub>{READY_TEXTS.assigned}</Sub>
              {stageRows(v.assigned, 'assigned_other')}
            </div>
          ) : null}
          {v.hidden > 0 ? <MoreButton label={`Ещё ${v.hidden}`} onClick={() => data.setView({stagesMore: true})} /> : null}
          {data.view.stagesMore && visibleStages(stages, false).hidden > 0 ? (
            <MoreButton label="Показать меньше" onClick={() => data.setView({stagesMore: false})} />
          ) : null}

          <div className="space-y-2" data-ready-group="unstarted">
            <Sub
              aside={
                inParent ? null : (
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    spacing={0}
                    value={String(data.backlogSize)}
                    // Повторное нажатие на выбранное значение у Radix даёт
                    // пустую строку — размер остаётся прежним.
                    onValueChange={(val) => val && data.setBacklogSize(parseBacklogSize(val))}
                    aria-label="Сколько строк показывать"
                    data-backlog-size>
                    {BACKLOG_SIZES.map((n) => (
                      <ToggleGroupItem key={n} value={String(n)} aria-label={`Показывать ${n}`} className="min-w-8 px-2 text-xs">
                        {n}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                )
              }>
              {inParent ? READY_TEXTS.unstartedInParent : READY_TEXTS.unstarted} ·{' '}
              <span data-ready-free>
                {freeTotal === null ? `${model.free.length}+` : freeTotal} {READY_TEXTS.free}
              </span>
            </Sub>
            {rejected ? (
              <p className="flex gap-1.5 text-xs text-amber-700 dark:text-amber-300" data-ready-partial>
                <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                {READY_TEXTS.partial}
              </p>
            ) : null}
            {free.length === 0 ? (
              <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-2 text-sm" data-ready-empty>
                {READY_TEXTS.emptyUnstarted}
              </p>
            ) : (
              <Rows>
                {free.map((e, i) => (
                  <TaskRow
                    key={e.task.key}
                    task={e.task}
                    zone="backlog"
                    density="row"
                    index={i + 1}
                    note={viaNote(e.via, e.viaBlocked)}
                    {...rowProps}
                  />
                ))}
              </Rows>
            )}
          </div>

          {model.waiting.length > 0 ? (
            <div className="space-y-2" data-ready-group="waiting">
              <Sub>
                {READY_TEXTS.waiting} · {topPartial ? `${model.waiting.length}+` : model.waiting.length}
              </Sub>
              <Rows>
                {waiting.map((e) => (
                  <TaskRow key={e.task.key} task={e.task} zone="backlog" density="row" note={viaNote(e.via, e.viaBlocked)} {...rowProps} />
                ))}
              </Rows>
              {waitingHidden > 0 ? (
                <MoreButton label={`Ещё ${waitingHidden}`} onClick={() => data.setView({waitingMore: true})} />
              ) : null}
              {data.view.waitingMore && model.waiting.length > CAPS.readyWaiting ? (
                <MoreButton label="Показать меньше" onClick={() => data.setView({waitingMore: false})} />
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </Zone>
  );
}
