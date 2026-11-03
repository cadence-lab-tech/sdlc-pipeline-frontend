import type {ReactNode} from 'react';

import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';

import type {ProjectDetail} from '../../api/types';
import {TaskRow} from '../taskrow/TaskRow';
import {Zone} from './Zone';
import type {OverviewData} from './useOverview';
import {BACKLOG_EPIC_TITLE, BACKLOG_SIZES, BACKLOG_TEXTS, parseBacklogSize} from './zones';

type RowProps = {
  projectKey: string;
  project?: ProjectDetail;
  onPickEpic: (key: string) => void;
  hideEpic: boolean;
};

// Блок «Приоритетные из бэклога» (CLAB-366, design.spec варианта B): первые N
// задач бэклога в порядке, который отдал сервер, — клиент строки не
// сортирует и не правит. Только чтение: ни перетаскивания, ни правки
// приоритета (это страница бэклога, CLAB-368). Нарезка эпика (parent) —
// «Неначатые в эпике»: первые N неначатых детей. newTask — кнопка
// «Новая задача» страницы (тип по умолчанию из данных проекта).
export function BacklogZone({
  data,
  rowProps,
  inEpic,
  newTask,
}: {
  data: OverviewData;
  rowProps: RowProps;
  inEpic: boolean;
  newTask: ReactNode;
}) {
  const z = data.backlog;
  const rows = z.data?.tasks ?? [];
  const total = z.data?.total ?? 0;
  const loaded = z.data !== undefined;
  return (
    <Zone
      zone="backlog"
      title={inEpic ? BACKLOG_EPIC_TITLE : undefined}
      count={z.error && !loaded ? null : loaded ? total : null}
      aside={
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          {inEpic ? null : <span data-backlog-total>{BACKLOG_TEXTS.total}</span>}
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={String(data.backlogSize)}
            // Повторное нажатие на выбранное значение у Radix даёт пустую
            // строку — размер остаётся прежним.
            onValueChange={(v) => v && data.setBacklogSize(parseBacklogSize(v))}
            aria-label="Сколько строк показывать"
            data-backlog-size>
            {BACKLOG_SIZES.map((n) => (
              <ToggleGroupItem key={n} value={String(n)} aria-label={`Показывать ${n}`} className="min-w-8 px-2 text-xs">
                {n}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </span>
      }
      pending={!loaded && !z.error}
      skeletons={Math.min(data.backlogSize, 5)}
      density="row"
      error={z.error}
      retry={z.retry}
      busy={z.loading}>
      {loaded && rows.length === 0 ? (
        <div
          data-zone-empty
          data-backlog-empty
          className="text-muted-foreground space-y-2 rounded-lg border border-dashed px-3 py-2.5 text-sm">
          {inEpic ? (
            <p>{BACKLOG_TEXTS.epicEmpty}</p>
          ) : (
            <>
              <p className="text-foreground font-medium">{BACKLOG_TEXTS.empty}</p>
              <p>{BACKLOG_TEXTS.emptyHint}</p>
              {newTask}
            </>
          )}
        </div>
      ) : null}
      {rows.length > 0 ? (
        <div className="space-y-2">
          {rows.map((t) => (
            <TaskRow key={t.key} task={t} zone="backlog" density="row" {...rowProps} />
          ))}
        </div>
      ) : null}
    </Zone>
  );
}
