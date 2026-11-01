// Холст «Пайплайна» (CLAB-346, design.spec v2 §4): полосы фаз, рёбра на SVG
// (примитивы components/graph), узлы и контрольные точки гейтов — HTML
// поверх: внутри узла кнопки ролей, а вложить кнопки в SVG-кнопку доступно
// нельзя (отступление 1 дизайна). Раскладку считает cycle/layered.ts.
import {AlertTriangle, Ban, Flag, Map as MapIcon, Maximize2, Minus, Play, Plus, ScanEye, UserRound} from 'lucide-react';

import {cn} from '@/lib/utils';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {StatusDot, Token} from '@/components/kit';

import type {Status, Transition, Validation, Workflow} from '../../api/types';
import type {LayeredLayout, LayeredNode} from '../cycle/layered';
import {GraphEdge} from '../graph/Graph';
import {optionalBadges} from '../optionalStage';
import {categoryVariant} from '../status';
import {GateIconRow} from './GateIcons';
import {NO_GATES_LABEL, NO_ROLE_LABEL, ORPHAN_LABEL, categoryLabel, gateLabel, isHumanGate, sortedGates} from './labels';
import {ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, clampZoom} from './params';

export type PipelineLayout = LayeredLayout<Status, Transition>;

export interface Selection {
  status?: string;
  transition?: string;
  role?: string;
}

export function PipelineCanvas({
  workflow,
  layout,
  latest,
  selection,
  validation,
  editable,
  disabled,
  zoom,
  compact,
  returnLabels,
  onSelectStatus,
  onSelectTransition,
  onSelectRole,
  onAddTransitionFrom,
}: {
  workflow: Workflow;
  layout: PipelineLayout;
  // Последняя версия роли по ключу: её узел показывает как vN.
  latest: Map<string, number | undefined>;
  selection: Selection;
  validation?: Validation;
  editable: boolean;
  disabled: Set<string>;
  zoom: number;
  compact?: boolean;
  returnLabels: boolean;
  onSelectStatus: (key: string) => void;
  onSelectTransition: (key: string) => void;
  onSelectRole: (key: string) => void;
  onAddTransitionFrom: (key: string) => void;
}) {
  const byId = new Map(workflow.statuses.map((s) => [s.id, s]));
  const selId = workflow.statuses.find((s) => s.key === selection.status)?.id;
  const selT = workflow.transitions.find((t) => t.key === selection.transition);
  // Роль подсвечивает свои узлы, только пока выбрана сама, без статуса.
  const roleFocus = selection.role && !selId ? selection.role : undefined;

  const touches = (from?: string, to?: string) => {
    if (selT) return selT.from_status_id === from && selT.to_status_id === to;
    if (selId) return from === selId || to === selId;
    return true;
  };
  const focusNode = (n: LayeredNode<Status>) => {
    if (roleFocus) return Boolean(n.status.roles?.some((r) => r.role_key === roleFocus));
    if (selT) return n.status.id === selT.from_status_id || n.status.id === selT.to_status_id;
    if (!selId) return true;
    if (n.status.id === selId) return true;
    return workflow.transitions.some(
      (t) =>
        (t.from_status_id === selId && t.to_status_id === n.status.id) ||
        (t.to_status_id === selId && t.from_status_id === n.status.id),
    );
  };
  const anyFocus = Boolean(selId || selT || roleFocus);
  const offIds = new Set(workflow.statuses.filter((s) => disabled.has(s.key)).map((s) => s.id));
  const problems = new Map<string, 'error' | 'warning'>();
  for (const p of validation?.problems ?? []) if (p.status) problems.set(p.status, 'error');
  for (const p of validation?.warnings ?? []) if (p.status && !problems.has(p.status)) problems.set(p.status, 'warning');
  const tProblems = new Set(
    [...(validation?.problems ?? []), ...(validation?.warnings ?? [])].map((p) => p.transition).filter(Boolean) as string[],
  );

  return (
    <div
      className="relative"
      style={{width: layout.width * zoom, height: layout.height * zoom}}
      data-pipeline-canvas
      role="group"
      aria-label={`Схема цикла ${workflow.name}, версия ${workflow.version}`}>
      <div
        className="absolute top-0 left-0"
        style={{width: layout.width, height: layout.height, transform: `scale(${zoom})`, transformOrigin: '0 0'}}>
        {layout.bands.map((b, i) => (
          <div
            key={i}
            data-pipeline-band={b.orphan ? 'orphan' : b.category}
            className={cn(
              'absolute right-0 left-0 rounded-md',
              i % 2 ? 'bg-muted/40' : 'bg-muted/20',
              b.orphan && 'border border-dashed border-red-500/40 bg-red-500/5',
            )}
            style={{top: b.y, height: b.h}}>
            <span className="text-muted-foreground absolute top-2 left-3 flex items-center gap-1.5 text-[11px] font-medium tracking-wide uppercase">
              {b.orphan ? (
                <AlertTriangle className="size-3 text-red-600 dark:text-red-400" aria-hidden />
              ) : (
                <StatusDot variant={categoryVariant(b.category)} />
              )}
              {b.orphan ? ORPHAN_LABEL : categoryLabel(b.category)}
            </span>
          </div>
        ))}

        <svg width={layout.width} height={layout.height} className="absolute top-0 left-0 overflow-visible" aria-hidden>
          {layout.edges.map((e) => {
            const off = offIds.has(e.from) || offIds.has(e.to);
            const tone = anyFocus
              ? touches(e.from, e.to)
                ? 'emphasis'
                : 'muted'
              : e.kind === 'return' || (e.kind === 'forward' && off)
                ? 'muted'
                : e.kind === 'skip'
                  ? 'emphasis'
                  : 'default';
            return (
              <GraphEdge
                key={e.id}
                d={e.d}
                arrow={e.arrow}
                dashed={e.kind !== 'forward'}
                tone={tone}
                title={e.transition?.name}
                data-pipeline-edge={e.transition?.key ?? e.id}
                data-pipeline-edge-kind={e.kind}
              />
            );
          })}
          {layout.entries.map((e) => (
            <g key={e.id}>
              <path d={e.d} className="stroke-muted-foreground" strokeWidth={1.25} fill="none" />
              <polygon points={e.arrow} className="fill-muted-foreground" />
              <circle cx={e.origin.x} cy={e.origin.y} r={4.5} className="fill-background stroke-muted-foreground" strokeWidth={1.5} />
            </g>
          ))}
        </svg>

        {layout.entries.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => onSelectTransition(e.transition.key)}
            aria-pressed={selection.transition === e.transition.key}
            className={cn(
              'bg-background text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 absolute max-w-60 -translate-x-full -translate-y-1/2 truncate rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap outline-none focus-visible:ring-[3px]',
              selection.transition === e.transition.key && 'ring-foreground ring-2',
            )}
            style={{left: e.origin.x - 10, top: e.origin.y}}
            title={`из любого статуса · ${e.transition.name}`}
            data-pipeline-entry={e.transition.key}>
            из любого статуса · {e.transition.name}
          </button>
        ))}

        {layout.edges
          .filter((e) => e.kind === 'forward' && e.transition)
          .map((e) => (
            <Checkpoint
              key={e.id}
              t={e.transition!}
              x={e.mid.x}
              y={e.mid.y}
              selected={selection.transition === e.transition!.key}
              dimmed={(anyFocus && !touches(e.from, e.to)) || offIds.has(e.from) || offIds.has(e.to)}
              problem={tProblems.has(e.transition!.key)}
              compact={compact}
              onClick={() => onSelectTransition(e.transition!.key)}
            />
          ))}

        {layout.edges
          .filter((e) => e.kind === 'skip')
          .map((e) => (
            <span
              key={e.id}
              className="bg-background text-muted-foreground absolute -translate-x-1/2 -translate-y-1/2 rounded-md border border-dashed px-1.5 py-0.5 text-[11px] whitespace-nowrap"
              title={`Переход ведёт в «${(e.skipped ?? []).map((id) => byId.get(id)?.name).join(', ')}», задача встанет дальше`}
              style={{left: e.mid.x, top: e.mid.y}}
              data-pipeline-skip>
              пропуск
            </span>
          ))}

        {returnLabels
          ? layout.edges
              .filter((e) => e.kind === 'return' && e.transition && e.labelAt && touches(e.from, e.to))
              .map((e) => (
                <button
                  key={`label-${e.id}`}
                  type="button"
                  onClick={() => onSelectTransition(e.transition!.key)}
                  className="bg-background text-foreground absolute max-w-52 -translate-y-1/2 truncate rounded-md border border-dashed px-1.5 py-0.5 text-[11px] whitespace-nowrap"
                  style={{left: e.labelAt!.x, top: e.labelAt!.y}}
                  data-pipeline-return-label={e.transition!.key}>
                  ↩ {e.transition!.name} → {byId.get(e.to)?.name}
                </button>
              ))
          : null}

        {layout.nodes.map((n) => (
          <StageNode
            key={n.status.id}
            n={n}
            latest={latest}
            selected={n.status.key === selection.status}
            dimmed={anyFocus && !focusNode(n)}
            disabled={disabled.has(n.status.key)}
            problem={problems.get(n.status.key)}
            editable={editable}
            returnsCount={
              compact ? workflow.transitions.filter((t) => t.kind === 'reject' && t.from_status_id === n.status.id).length : 0
            }
            roleFocus={selection.role}
            onSelect={() => onSelectStatus(n.status.key)}
            onRole={onSelectRole}
            onAdd={() => onAddTransitionFrom(n.status.key)}
          />
        ))}
      </div>
    </div>
  );
}

function Checkpoint({
  t,
  x,
  y,
  selected,
  dimmed,
  problem,
  compact,
  onClick,
}: {
  t: Transition;
  x: number;
  y: number;
  selected: boolean;
  dimmed: boolean;
  problem: boolean;
  compact?: boolean;
  onClick: () => void;
}) {
  const gates = sortedGates(t.gates);
  const human = gates.some((g) => isHumanGate(g.type));
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={`Переход «${t.name}», гейтов: ${gates.length}`}
          aria-pressed={selected}
          data-pipeline-checkpoint={t.key}
          className={cn(
            'bg-card hover:bg-accent focus-visible:ring-ring/50 absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full border py-0.5 pr-2 pl-1.5 text-xs whitespace-nowrap shadow-xs outline-none focus-visible:ring-[3px]',
            selected && 'ring-foreground ring-offset-background ring-2 ring-offset-1',
            dimmed && 'opacity-40',
            problem && 'border-amber-500',
          )}
          style={{left: x, top: y}}>
          <span className="max-w-36 truncate font-medium">{t.name}</span>
          {gates.length === 0 ? (
            <span className="text-muted-foreground">{NO_GATES_LABEL}</span>
          ) : (
            <GateIconRow gates={gates} max={compact ? 2 : 3} />
          )}
          {human ? <span className="sr-only">нужен апрув человека</span> : null}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {gates.length
          ? gates.map((g) => (
              <div key={g.id}>
                {g.name} · {gateLabel(g.type)}
              </div>
            ))
          : 'Переход ничем не закрыт'}
      </TooltipContent>
    </Tooltip>
  );
}

function StageNode({
  n,
  latest,
  selected,
  dimmed,
  disabled,
  problem,
  editable,
  returnsCount,
  roleFocus,
  onSelect,
  onRole,
  onAdd,
}: {
  n: LayeredNode<Status>;
  latest: Map<string, number | undefined>;
  selected: boolean;
  dimmed: boolean;
  disabled: boolean;
  problem?: 'error' | 'warning';
  editable: boolean;
  returnsCount: number;
  roleFocus?: string;
  onSelect: () => void;
  onRole: (key: string) => void;
  onAdd: () => void;
}) {
  const s = n.status;
  const primary = s.roles?.find((r) => r.is_primary);
  const reviewers = (s.roles ?? []).filter((r) => !r.is_primary);
  // «выключен по умолчанию» уже значит «необязательный» — второй жетон не нужен.
  const all = optionalBadges(s);
  const badges = all.length > 1 ? all.slice(1) : all;
  const version = (key: string) => {
    const v = latest.get(key);
    return v ? `v${v}` : undefined;
  };
  const primaryVersion = primary ? version(primary.role_key) : undefined;
  return (
    <div
      className={cn('group absolute', dimmed && 'opacity-45')}
      style={{left: n.x, top: n.y, width: n.w, height: n.h}}
      data-pipeline-status={s.key}
      data-pipeline-node-layer={n.layer}>
      {selected ? (
        <div className="border-foreground pointer-events-none absolute -inset-1.5 rounded-xl border-[1.5px] border-dashed" />
      ) : null}
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
        aria-current={selected ? 'true' : undefined}
        aria-label={`Статус ${s.name}${primary ? `, роль ${primary.role_name}${primaryVersion ? ` ${primaryVersion}` : ''}` : `, ${NO_ROLE_LABEL}`}`}
        title={s.name}
        className={cn(
          'bg-card hover:border-foreground/40 focus-visible:ring-ring/50 flex h-full w-full cursor-pointer flex-col justify-between rounded-lg border px-3 py-2 text-left shadow-xs outline-none focus-visible:ring-[3px]',
          s.is_optional && 'border-dashed',
          disabled && 'bg-background border-dotted opacity-70',
          problem === 'error' && 'border-red-500 bg-red-500/5',
          problem === 'warning' && 'border-amber-500',
        )}
        style={s.color ? {borderLeftColor: s.color, borderLeftWidth: 4} : undefined}>
        <div className="flex min-w-0 items-center gap-2">
          <StatusDot variant={categoryVariant(s.category)} />
          <span className={cn('min-w-0 truncate text-sm font-semibold', disabled && 'italic line-through')}>{s.name}</span>
          <span className="text-muted-foreground ml-auto flex shrink-0 items-center gap-1">
            {s.is_initial ? <Play className="size-3.5" aria-label="начальный" /> : null}
            {s.is_terminal ? <Flag className="size-3.5" aria-label="терминальный" /> : null}
            {s.wip_limit ? (
              <span className="text-[11px]" title="предел задач в статусе">
                ≤{s.wip_limit}
              </span>
            ) : null}
            {disabled ? <Ban className="size-3.5" aria-label="выключен для задачи" /> : null}
            {problem ? (
              <AlertTriangle
                data-pipeline-problem={problem}
                className={cn('size-4', problem === 'error' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-300')}
                aria-label={problem === 'error' ? 'ошибка проверки' : 'предупреждение проверки'}
              />
            ) : null}
          </span>
        </div>
        <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
          <span className="min-w-12 truncate font-mono">{s.key}</span>
          {badges.map((b) => (
            <Token key={b} label={b} className="h-4 px-1 text-[10px]" />
          ))}
          {returnsCount ? <Token label={`↩ ${returnsCount}`} className="h-4 px-1 text-[10px]" /> : null}
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          {primary ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRole(primary.role_key);
              }}
              className={cn(
                'hover:bg-accent focus-visible:ring-ring/50 inline-flex min-w-0 shrink items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs outline-none focus-visible:ring-[3px]',
                roleFocus === primary.role_key && 'border-primary bg-accent',
              )}
              data-pipeline-role={primary.role_key}
              data-pipeline-role-primary
              data-pipeline-role-version={latest.get(primary.role_key) ?? ''}
              aria-label={`Открыть роль ${primary.role_name}`}>
              <UserRound className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{primary.role_name}</span>
              {primaryVersion ? (
                <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                  {primaryVersion}
                </Badge>
              ) : null}
            </button>
          ) : (
            <span className="text-muted-foreground text-xs italic" data-pipeline-no-role>
              {NO_ROLE_LABEL}
            </span>
          )}
          {reviewers.map((r) => (
            <button
              key={r.role_key}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRole(r.role_key);
              }}
              className={cn(
                'text-muted-foreground hover:bg-accent focus-visible:ring-ring/50 inline-flex min-w-0 items-center gap-1 rounded-md border border-dashed px-1.5 py-0.5 text-xs outline-none focus-visible:ring-[3px]',
                roleFocus === r.role_key && 'border-primary bg-accent',
              )}
              title="Перепроверяющая роль"
              data-pipeline-role={r.role_key}
              data-pipeline-role-version={latest.get(r.role_key) ?? ''}
              aria-label={`Открыть перепроверяющую роль ${r.role_name}`}>
              <ScanEye className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{r.role_name}</span>
              {version(r.role_key) ? <span className="text-[10px]">{version(r.role_key)}</span> : null}
            </button>
          ))}
        </div>
      </div>
      {editable && !s.is_terminal ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon-xs"
              variant="outline"
              onClick={onAdd}
              aria-label={`Добавить переход из «${s.name}»`}
              className={cn(
                'bg-background absolute -bottom-3 left-[calc(50%+56px)] rounded-full opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                selected && 'opacity-100',
              )}>
              <Plus />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Добавить переход из «{s.name}»</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

export function ZoomControls({
  zoom,
  onZoom,
  onFit,
  minimap,
  onMinimap,
}: {
  zoom: number;
  onZoom: (z: number) => void;
  onFit: () => void;
  minimap: boolean;
  onMinimap: (v: boolean) => void;
}) {
  return (
    <div className="bg-background flex items-center rounded-md border" role="group" aria-label="Масштаб схемы">
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Мельче"
        title="Мельче"
        disabled={zoom <= ZOOM_MIN}
        onClick={() => onZoom(clampZoom(zoom - ZOOM_STEP))}>
        <Minus />
      </Button>
      <span className="w-11 text-center text-xs tabular-nums" data-pipeline-zoom={Math.round(zoom * 100)}>
        {Math.round(zoom * 100)}%
      </span>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Крупнее"
        title="Крупнее"
        disabled={zoom >= ZOOM_MAX}
        onClick={() => onZoom(clampZoom(zoom + ZOOM_STEP))}>
        <Plus />
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label="Вписать в экран" title="Вписать в экран" onClick={onFit}>
        <Maximize2 />
      </Button>
      <Button
        size="icon-sm"
        variant={minimap ? 'secondary' : 'ghost'}
        aria-label="Мини-карта"
        title="Мини-карта"
        aria-pressed={minimap}
        onClick={() => onMinimap(!minimap)}>
        <MapIcon />
      </Button>
    </div>
  );
}

// Мини-карта: узлы прямоугольниками, выбранный — заливкой, видимая часть — рамкой.
export function Minimap({
  layout,
  selected,
  viewport,
}: {
  layout: PipelineLayout;
  selected?: string;
  viewport: {top: number; height: number};
}) {
  const k = 88 / Math.max(1, layout.width);
  return (
    <svg
      width={88}
      height={Math.max(24, layout.height * k)}
      className="bg-background/90 rounded-md border shadow-sm"
      aria-label="Мини-карта схемы"
      role="img"
      data-pipeline-minimap>
      {layout.nodes.map((n) => (
        <rect
          key={n.status.id}
          x={n.x * k}
          y={n.y * k}
          width={n.w * k}
          height={n.h * k}
          rx={2}
          className={n.status.key === selected ? 'fill-primary' : 'fill-muted-foreground/40'}
        />
      ))}
      <rect
        x={1}
        y={viewport.top * k}
        width={86}
        height={Math.max(4, viewport.height * k)}
        className="fill-primary/10 stroke-primary"
        strokeWidth={1}
        rx={2}
      />
    </svg>
  );
}

