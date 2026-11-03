import type {ComponentType} from 'react';
import {Link} from 'react-router-dom';
import {
  CircleDashed,
  CircleHelp,
  Layers,
  Lock,
  MessageCircleQuestion,
  RotateCcw,
  Timer,
  TimerOff,
  Unplug,
  UserCheck,
  UserX,
  XCircle,
} from 'lucide-react';

import {Card} from '@/components/ui/card';
import {cn} from '@/lib/utils';
import {StatusDot, Token} from '@/components/kit';

import type {ProjectDetail, TaskRow as TaskRowData} from '../../api/types';
import {taskTypes} from '../taskTypes';
import type {Reason, ReasonIcon, ReasonTone} from './reasons';
import {needsVersion} from './reasons';
import {buildRowModel, type ApprovalHint, type RowModel, type RowZone} from './rules';
import {useNow} from './useNow';
import {useWorkflowVersion} from './versionsContext';

const ICONS: Record<ReasonIcon, ComponentType<{className?: string; 'aria-hidden'?: boolean}>> = {
  UserCheck,
  Unplug,
  TimerOff,
  XCircle,
  Lock,
  RotateCcw,
  CircleDashed,
  HelpCircle: CircleHelp,
  MessageCircleQuestion,
};

// Цвет текста и левой границы по тону причины; у каждого цвета есть пара для
// тёмной темы. Смысл несут значок и текст, цвет только усиливает.
const TONE_TEXT: Record<ReasonTone, string> = {
  default: 'text-muted-foreground',
  blue: 'text-blue-700 dark:text-blue-300',
  orange: 'text-amber-700 dark:text-amber-300',
  red: 'text-red-700 dark:text-red-300',
};

const TONE_EDGE: Record<ReasonTone, string> = {
  default: 'border-l-border',
  blue: 'border-l-blue-500/60',
  orange: 'border-l-amber-500/60',
  red: 'border-l-red-500/60',
};

// Плотность задаёт страница: карточка — зонам фокуса и работы, строка —
// спискам (очередь, приоритетные, завершённые). По данным строка её не выбирает.
export type RowDensity = 'card' | 'row';

export interface TaskRowProps {
  task: TaskRowData;
  projectKey: string;
  zone: RowZone;
  density: RowDensity;
  // Проект: из него берутся типы и действующие версии циклов (прежняя
  // версия, тип). Нет — тип и прежняя версия не показываются.
  project?: ProjectDetail;
  // Записи /approvals по этой задаче — подпись «→ куда» у ожидания решения.
  approvals?: ApprovalHint[];
  // Право решать гейты; наблюдатель видит «ждёт решения человека».
  canDecide?: boolean;
  // Нажатие на токен эпика: страница ставит фильтр по эпику. Нет колбэка —
  // токен просто метка.
  onPickEpic?: (epicKey: string) => void;
  hideEpic?: boolean;
  // «Сейчас» для относительного времени; по умолчанию — часы строки, раз в минуту.
  now?: number;
  // Пометка строки очереди (CLAB-365): этап по роли смотрящего или прогон,
  // назначенный другому (В-2: в очереди, но забрать его нельзя).
  queueMark?: 'own_role' | 'assigned_other';
}

function ReasonToken({reason}: {reason: Reason}) {
  const Icon = ICONS[reason.icon];
  return (
    <Token
      color={reason.tone}
      className="max-w-full min-w-0"
      label={
        <>
          <Icon aria-hidden />
          <span className="truncate" title={reason.title}>
            {reason.text}
          </span>
        </>
      }
    />
  );
}

function ProgressBar({progress}: {progress: NonNullable<RowModel['progress']>}) {
  const pct = (n: number) => `${(n / progress.total) * 100}%`;
  return (
    <div className="space-y-1">
      <div
        role="img"
        aria-label={progress.aria}
        className="bg-muted flex h-1.5 w-full overflow-hidden rounded-full">
        <span className="bg-primary h-full" style={{width: pct(progress.done)}} />
        <span className="bg-primary/50 h-full" style={{width: pct(progress.active)}} />
      </div>
      <p className="text-muted-foreground text-xs">{progress.label}</p>
    </div>
  );
}

// Строка задачи со всеми сигналами «Обзора» (CLAB-364). Что показывать, решает
// buildRowModel по данным списка и зоне, здесь только разметка. Вся строка —
// ссылка на карточку задачи: ссылка лежит под содержимым, а единственный
// другой интерактивный элемент — токен эпика — поднят над ней, поэтому Tab
// идёт ссылка, затем эпик, а нажатие на эпик задачу не открывает.
export function TaskRow({
  task,
  projectKey,
  zone,
  density,
  project,
  approvals,
  canDecide = true,
  onPickEpic,
  hideEpic,
  now: nowProp,
  queueMark,
}: TaskRowProps) {
  const tick = useNow();
  const now = nowProp ?? tick;
  const versionNeeded = needsVersion(task.attention, canDecide);
  const version = useWorkflowVersion(task.workflow_id, versionNeeded);
  const m = buildRowModel(task, {
    zone,
    now,
    version: version?.status === 'ok' ? version.workflow : null,
    versionFailed: versionNeeded && version?.status === 'error',
    projectTypes: project ? taskTypes(project) : undefined,
    activeWorkflows: project?.active_workflows,
    approvals,
    canDecide,
    hideEpic,
  });

  const PrimaryIcon = m.primary ? ICONS[m.primary.icon] : null;
  const isCard = density === 'card';

  // Полный текст всего, что в строке обрезано или сокращено: ссылка лежит
  // поверх содержимого, и подсказки отдельных мест под ней не видны.
  const hint = [
    `${m.key} · ${m.title}`,
    m.primary?.title,
    ...m.reasons.map((r) => r.title),
    m.stage.title,
    m.waiting?.title,
    m.onStage?.title,
    m.movement?.title,
    m.cost?.title,
  ]
    .filter(Boolean)
    .join('\n');

  const tokens = (
    <>
      {queueMark === 'own_role' ? <Token label="ваша роль" color="blue" /> : null}
      {queueMark === 'assigned_other' ? (
        <Token
          className="border-dashed"
          label={
            <>
              <UserX aria-hidden />
              назначена другому
            </>
          }
        />
      ) : null}
      {m.priority ? <Token label={m.priority.label} className={m.priority.className} /> : null}
      {m.type ? <Token label={m.type} className="text-muted-foreground" /> : null}
      {m.epic ? (
        onPickEpic ? (
          <button
            type="button"
            onClick={() => onPickEpic(m.epic!)}
            title={`Только задачи эпика ${m.epic}`}
            className="relative z-10 cursor-pointer rounded-full focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
            <Token
              className="hover:bg-muted"
              label={
                <>
                  <Layers aria-hidden />
                  {m.epic}
                </>
              }
            />
          </button>
        ) : (
          <Token
            label={
              <>
                <Layers aria-hidden />
                {m.epic}
              </>
            }
          />
        )
      ) : null}
      {m.oldVersion ? <Token label="прежняя версия цикла" color="orange" /> : null}
      {m.versionFailed ? <Token label="версия цикла не прочиталась" /> : null}
      {m.review ? <Token label="перепроверка" color="blue" /> : null}
      {m.attempt ? (
        <Token
          color="orange"
          label={
            <>
              <RotateCcw aria-hidden />
              попытка {m.attempt}
            </>
          }
        />
      ) : null}
      {m.reasons.map((r) => (
        <ReasonToken key={r.code} reason={r} />
      ))}
    </>
  );

  const facts = (
    <>
      <span className="text-muted-foreground min-w-0 break-words" title={m.stage.title}>
        {m.stage.text}
      </span>
      {m.holder ? (
        <StatusDot variant={m.holder.live ? 'accent' : 'neutral'} label={<span className="text-xs">{m.holder.handle}</span>} />
      ) : null}
      {m.waiting ? (
        <span className="text-muted-foreground" title={m.waiting.title}>
          {m.waiting.text}
        </span>
      ) : null}
      {m.onStage ? (
        <span className="text-muted-foreground inline-flex items-center gap-1" title={m.onStage.title}>
          <Timer className="size-3" aria-hidden />
          {m.onStage.text}
        </span>
      ) : null}
      {m.movement ? (
        <span className="text-muted-foreground" title={m.movement.title}>
          {m.movement.text}
        </span>
      ) : null}
      {m.cost ? (
        <span
          className={cn(m.cost.hasData ? 'text-foreground tabular-nums' : 'text-muted-foreground')}
          title={m.cost.title}>
          {m.cost.text}
        </span>
      ) : null}
    </>
  );

  const link = (
    <Link
      to={`/p/${projectKey}/tasks/${task.key}`}
      title={hint}
      aria-label={`${m.key} ${m.title}`}
      data-task-link
      className="absolute inset-0 z-0 rounded-[inherit] focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50 focus-visible:outline-none"
    />
  );

  const primaryLine =
    m.primary && PrimaryIcon ? (
      <p
        className={cn('flex min-w-0 items-center gap-1.5 text-sm', isCard && 'font-semibold', TONE_TEXT[m.primary.tone])}
        title={m.primary.title}>
        <PrimaryIcon className={cn('size-4 shrink-0', isCard && 'self-start mt-0.5')} aria-hidden />
        {/* В карточке главная причина несёт гейт, переход и «→ куда» — до
            двух строк, чтобы стрелка не обрезалась (design.spec CLAB-365 §6). */}
        <span className={isCard ? 'line-clamp-2' : 'truncate'}>{m.primary.text}</span>
      </p>
    ) : null;

  if (isCard) {
    return (
      <Card
        size="sm"
        data-density="card"
        data-task-key={task.key}
        className={cn(
          'hover:bg-muted/40 relative gap-2 border-l-[3px] border-l-transparent transition-colors',
          m.primary && TONE_EDGE[m.primary.tone],
        )}>
        {link}
        <div className="pointer-events-none relative flex min-w-0 flex-col gap-2 px-(--card-spacing)">
          {primaryLine}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground font-mono text-xs tabular-nums">{m.key}</span>
            <span className="contents [&_button]:pointer-events-auto">{tokens}</span>
          </div>
          <p className="line-clamp-2 text-sm font-medium">{m.title}</p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">{facts}</div>
          {m.progress ? <ProgressBar progress={m.progress} /> : null}
        </div>
      </Card>
    );
  }

  return (
    <div
      data-density="row"
      data-task-key={task.key}
      data-queue-mark={queueMark}
      className={cn(
        'hover:bg-muted/40 relative rounded-lg border px-2.5 py-2 transition-colors',
        queueMark === 'assigned_other' && 'bg-muted/60 border-dashed',
      )}>
      {link}
      <div className="pointer-events-none relative flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-start gap-2">
          <span className="text-muted-foreground shrink-0 pt-0.5 font-mono text-xs tabular-nums">{m.key}</span>
          <p className="line-clamp-2 min-w-0 flex-1 text-sm font-medium sm:line-clamp-1">{m.title}</p>
        </div>
        {primaryLine}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="contents [&_button]:pointer-events-auto">{tokens}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">{facts}</div>
        {m.progress ? <ProgressBar progress={m.progress} /> : null}
      </div>
    </div>
  );
}
