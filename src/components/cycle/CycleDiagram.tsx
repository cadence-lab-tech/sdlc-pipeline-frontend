import {useMemo} from 'react';
import {ChevronRight, UserCheck} from 'lucide-react';

import {cn} from '@/lib/utils';
import {Skeleton} from '@/components/ui/skeleton';

import type {TaskDetail, Workflow} from '../../api/types';
import type {Resource} from '../../api/useResource';
import {useIsMobile} from '../../hooks/use-mobile';
import {Failure} from '../Feedback';
import {GraphBadge, GraphCanvas, GraphEdge, GraphEntry, GraphNode, type NodeTone} from '../graph/Graph';
import {type CycleLayout, layoutCycle} from './layout';
import {type NodeState, type StatusProgress, cycleProgress, nodeLabel} from './state';

// Схема цикла задачи над обзором карточки: статусы версии, на которой
// задача начата (решение 0016), переходы между ними и где задача сейчас.
// Узел — кнопка выбора этапа: выбор живёт в адресе (`?stage=`) и открывает
// панель этапа, без выбора — обзор. На узком экране вместо круга — линейный
// степпер с теми же узлами, состояниями и выбором.
//
// Опоры сквозных сценариев — data-cycle-*: узел несёт ключ статуса и
// состояние. Атрибутов списка прогонов (data-stage-run) и триггеров
// Collapsible у узлов нет.
export function CycleDiagram({
  workflow,
  detail,
  selected,
  onSelect,
}: {
  workflow: Resource<Workflow | undefined>;
  detail: TaskDetail;
  selected?: string;
  onSelect: (statusKey: string) => void;
}) {
  const mobile = useIsMobile();

  if (workflow.error) {
    return <Failure error={workflow.error} title="Схема цикла не загрузилась" reload={workflow.reload} />;
  }
  if (!workflow.data) return <Skeleton className="h-16 w-full" aria-hidden />;

  const version = workflow.data;
  const progress = cycleProgress(
    version.statuses,
    detail.task.status_key,
    detail.stage_runs,
    detail.transitions,
  );
  const awaiting = [...progress.values()].some((p) => p.awaitingApproval);

  return (
    <section
      aria-label={`Схема цикла ${version.name}, версия ${version.version}`}
      data-cycle-diagram={mobile ? 'stepper' : 'ring'}
      data-cycle-version={version.version}
      className="space-y-2">
      <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
        <span>
          Цикл {version.name} · v{version.version}
        </span>
        <Legend awaiting={awaiting} />
      </div>
      {mobile ? (
        <Stepper version={version} progress={progress} selected={selected} onSelect={onSelect} />
      ) : (
        <Ring version={version} progress={progress} selected={selected} onSelect={onSelect} />
      )}
    </section>
  );
}

const TONE: Record<NodeState, NodeTone> = {
  current: 'active',
  passed: 'filled',
  future: 'muted',
};

interface ViewProps {
  version: Workflow;
  progress: Map<string, StatusProgress>;
  selected?: string;
  onSelect: (statusKey: string) => void;
}

function Ring({version, progress, selected, onSelect}: ViewProps) {
  // Раскладка зависит только от версии цикла, а версия иммутабельна: опрос
  // карточки на живой аренде её не пересчитывает.
  const layout: CycleLayout = useMemo(() => layoutCycle(version), [version]);
  const nodeById = new Map(layout.nodes.map((n) => [n.id, n]));
  const currentId = layout.nodes.find((n) => progress.get(n.key)?.state === 'current')?.id;

  return (
    <GraphCanvas width={layout.width} height={layout.height} label="Статусы и переходы" className="mx-auto">
      {layout.edges.map((e) => (
        <GraphEdge
          key={e.id}
          d={e.d}
          arrow={e.arrow}
          dashed={e.reject}
          tone={e.from === currentId ? 'emphasis' : 'default'}
          title={`${e.name}: ${nodeById.get(e.from)?.name} → ${nodeById.get(e.to)?.name}`}
          data-cycle-transition={e.key}
          data-cycle-kind={e.kind}
        />
      ))}
      {layout.entries.map((e) => (
        <GraphEntry
          key={e.id}
          origin={e.origin}
          d={e.d}
          arrow={e.arrow}
          title={`${e.name}: из любого статуса → ${nodeById.get(e.to)?.name}`}
          data-cycle-entry={e.key}
        />
      ))}
      {layout.nodes.map((n) => {
        const p = progress.get(n.key);
        const state = p?.state ?? 'future';
        const isSelected = n.key === selected;
        return (
          <GraphNode
            key={n.id}
            x={n.x}
            y={n.y}
            width={n.width}
            height={n.height}
            label={n.name}
            title={nodeLabel(n.name, p, isSelected)}
            color={n.color}
            tone={TONE[state]}
            selected={isSelected}
            ariaLabel={nodeLabel(n.name, p, isSelected)}
            onActivate={() => onSelect(n.key)}
            data-cycle-status={n.key}
            data-cycle-state={state}
            data-cycle-attempts={p?.attempts ?? 0}
            data-cycle-approval={p?.awaitingApproval ? 'true' : undefined}>
            {p && p.attempts > 1 ? (
              <GraphBadge x={n.width - 2} y={2}>
                <text dominantBaseline="central" textAnchor="middle" className="fill-primary-foreground text-[10px] font-semibold">
                  {p.attempts}
                </text>
              </GraphBadge>
            ) : null}
            {p?.awaitingApproval ? (
              <GraphBadge x={2} y={2} className="fill-amber-400 dark:fill-amber-300">
                <UserCheck x={-6} y={-6} width={12} height={12} className="text-amber-950" />
              </GraphBadge>
            ) : null}
          </GraphNode>
        );
      })}
    </GraphCanvas>
  );
}

const STEP_STATE: Record<NodeState, string> = {
  current: 'border-primary border-2 font-semibold',
  passed: 'border-muted-foreground bg-muted',
  future: 'text-muted-foreground border-dashed',
};

// Линейный степпер для узкого экрана: узлы в порядке `position` переносятся
// строками, поэтому горизонтальной прокрутки нет. Возвраты и переходы «из
// любого статуса» — строкой под ним: стрелок в линейке не нарисовать.
function Stepper({version, progress, selected, onSelect}: ViewProps) {
  const layout = useMemo(() => layoutCycle(version), [version]);
  const nameById = new Map(layout.nodes.map((n) => [n.id, n.name]));
  const returns = [
    ...new Set(layout.edges.filter((e) => e.reject).map((e) => `${nameById.get(e.from)} → ${nameById.get(e.to)}`)),
  ];
  const entries = [...new Set(layout.entries.map((e) => nameById.get(e.to)))];

  return (
    <div className="space-y-1.5">
      <ol className="flex flex-wrap items-center gap-1" aria-label="Статусы цикла">
        {layout.nodes.map((n, i) => {
          const p = progress.get(n.key);
          const state = p?.state ?? 'future';
          const isSelected = n.key === selected;
          const tint = n.color && state !== 'future';
          return (
            <li key={n.id} className="flex min-w-0 items-center gap-1">
              <button
                type="button"
                onClick={() => onSelect(n.key)}
                aria-label={nodeLabel(n.name, p, isSelected)}
                aria-current={isSelected ? 'true' : undefined}
                data-cycle-status={n.key}
                data-cycle-state={state}
                data-cycle-attempts={p?.attempts ?? 0}
                data-cycle-approval={p?.awaitingApproval ? 'true' : undefined}
                className={cn(
                  'focus-visible:ring-ring/50 inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-xs outline-none focus-visible:ring-[3px]',
                  STEP_STATE[state],
                  isSelected && 'ring-foreground ring-offset-background ring-2 ring-offset-1',
                )}
                style={
                  n.color
                    ? {
                        borderColor: state === 'current' ? undefined : n.color,
                        backgroundColor: tint ? `color-mix(in srgb, ${n.color} 20%, transparent)` : undefined,
                      }
                    : undefined
                }>
                <span className="truncate">{n.name}</span>
                {p && p.attempts > 1 ? (
                  <span className="bg-primary text-primary-foreground rounded-full px-1.5 text-[10px]" aria-hidden>
                    {p.attempts}
                  </span>
                ) : null}
                {p?.awaitingApproval ? (
                  <UserCheck className="size-3.5 text-amber-600 dark:text-amber-300" aria-hidden />
                ) : null}
              </button>
              {i < layout.nodes.length - 1 ? (
                <ChevronRight className="text-muted-foreground size-3 shrink-0" aria-hidden />
              ) : null}
            </li>
          );
        })}
      </ol>
      {returns.length > 0 ? (
        <p className="text-muted-foreground text-xs">Возвраты: {returns.join(' · ')}</p>
      ) : null}
      {entries.length > 0 ? (
        <p className="text-muted-foreground text-xs">Из любого статуса: {entries.join(' · ')}</p>
      ) : null}
    </div>
  );
}

// Легенда — словами и теми же значками, что на схеме: цвет из данных один
// смысла не несёт.
function Legend({awaiting}: {awaiting: boolean}) {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Обозначения">
      <LegendItem label="пройден">
        <rect x={1} y={2} width={14} height={8} rx={2} className="fill-muted stroke-muted-foreground" />
      </LegendItem>
      <LegendItem label="текущий">
        <rect x={1} y={2} width={14} height={8} rx={2} className="fill-accent stroke-primary" strokeWidth={2} />
      </LegendItem>
      <LegendItem label="впереди">
        <rect x={1} y={2} width={14} height={8} rx={2} className="fill-background stroke-muted-foreground" strokeDasharray="3 2" />
      </LegendItem>
      <LegendItem label="возврат">
        <path d="M1 6 H15" className="stroke-muted-foreground" strokeDasharray="3 2" />
      </LegendItem>
      <LegendItem label="из любого статуса">
        <circle cx={4} cy={6} r={3} className="fill-background stroke-muted-foreground" />
        <path d="M7 6 H15" className="stroke-muted-foreground" />
      </LegendItem>
      {awaiting ? (
        <li className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-300">
          <UserCheck className="size-3.5" aria-hidden />
          ждёт апрува
        </li>
      ) : null}
    </ul>
  );
}

function LegendItem({label, children}: {label: string; children: React.ReactNode}) {
  return (
    <li className="inline-flex items-center gap-1">
      <svg width={16} height={12} viewBox="0 0 16 12" aria-hidden>
        {children}
      </svg>
      {label}
    </li>
  );
}
