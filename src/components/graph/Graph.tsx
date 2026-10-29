// Примитивы графа на SVG: холст, узел, ребро со стрелкой и вход «откуда
// угодно». Своими руками, без библиотеки: раскладку считает чистая функция
// (cycle/layout.ts, позже — граф эпика CLAB-69), а здесь только рисование по
// готовым координатам. Цвета — токены темы через классы Tailwind (светлая и
// тёмная темы сразу), цвет из данных — через style.
//
// Предметной области здесь нет: ни статусов, ни задач. Что значит узел и
// какое у него состояние, решает тот, кто примитивы собирает.
import type {KeyboardEvent, ReactNode, SVGProps} from 'react';

import {cn} from '@/lib/utils';

export function GraphCanvas({
  width,
  height,
  label,
  className,
  children,
  ...rest
}: {
  width: number;
  height: number;
  label: string;
  className?: string;
  children: ReactNode;
} & Omit<SVGProps<SVGSVGElement>, 'width' | 'height' | 'viewBox'>) {
  // Холст ужимается по ширине контейнера, но не растягивается больше своего
  // размера: крупнее мелкий текст узлов не станет читаемее.
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="group"
      aria-label={label}
      className={cn('block h-auto max-w-full select-none', className)}
      style={{maxWidth: width}}
      {...rest}>
      {children}
    </svg>
  );
}

// Вид узла — смысловой, а не цветовой: «текущий», «пройденный», «будущий»
// и обычный. Цвет из данных, если есть, подкрашивает рамку и заливку.
//
// `skipped` (прошли мимо) и `disabled` (выключен) отличаются от прочих не
// цветом: пунктир точками и перечёркнутая подпись у первого, точечная рамка
// и курсив у второго.
export type NodeTone = 'default' | 'active' | 'filled' | 'muted' | 'skipped' | 'disabled';

const NODE_BODY: Record<NodeTone, string> = {
  default: 'fill-card stroke-border',
  active: 'fill-accent stroke-primary',
  filled: 'fill-muted stroke-muted-foreground',
  muted: 'fill-background stroke-border',
  skipped: 'fill-muted stroke-muted-foreground',
  disabled: 'fill-background stroke-muted-foreground opacity-70',
};

const NODE_TEXT: Record<NodeTone, string> = {
  default: 'fill-foreground',
  active: 'fill-foreground font-semibold',
  filled: 'fill-foreground',
  muted: 'fill-muted-foreground',
  skipped: 'fill-muted-foreground line-through',
  disabled: 'fill-muted-foreground italic',
};

// Рисунок рамки: пунктир у «впереди», точки у «пропущен» и «выключен».
const NODE_DASH: Partial<Record<NodeTone, string>> = {
  muted: '4 3',
  skipped: '1 3',
  disabled: '1 3',
};

// Узел — прямоугольник с подписью. С onActivate он становится кнопкой:
// фокус по Tab, выбор кликом, Enter и Space; aria-label и aria-current
// задаёт тот, кто собирает граф. Подпись обрезается по ширине, полный текст —
// во всплывающей подсказке и в aria-label.
export function GraphNode({
  x,
  y,
  width,
  height,
  label,
  title,
  color,
  tone = 'default',
  selected = false,
  ariaLabel,
  onActivate,
  children,
  ...data
}: {
  // Центр узла, как в раскладке.
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  title?: string;
  color?: string;
  tone?: NodeTone;
  selected?: boolean;
  ariaLabel?: string;
  onActivate?: () => void;
  // Значки поверх узла (счётчики, отметки) в координатах узла: (0,0) — его
  // левый верхний угол.
  children?: ReactNode;
} & {[key: `data-${string}`]: string | number | undefined}) {
  const left = x - width / 2;
  const top = y - height / 2;
  const interactive = Boolean(onActivate);

  const onKeyDown = (event: KeyboardEvent<SVGGElement>) => {
    if (!onActivate) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onActivate();
    }
  };

  // Цвет из данных: рамка — им, заливка — им же, но прозрачно, чтобы текст
  // читался в обеих темах. У будущего узла заливки нет — он приглушён.
  const tinted = color
    ? {
        stroke: color,
        fill: tone === 'active' || tone === 'filled' ? color : undefined,
        fillOpacity: tone === 'active' ? 0.28 : tone === 'filled' ? 0.16 : undefined,
      }
    : undefined;

  return (
    <g
      transform={`translate(${left} ${top})`}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={ariaLabel}
      aria-current={interactive && selected ? 'true' : undefined}
      onClick={onActivate}
      onKeyDown={onKeyDown}
      className={cn('group outline-none', interactive && 'cursor-pointer')}
      {...data}>
      <title>{title ?? label}</title>
      {/* Кольцо выбора и кольцо фокуса — разные: выбранный узел может быть
          не в фокусе, а фокус бывает на невыбранном. */}
      {selected ? (
        <rect
          x={-5}
          y={-5}
          width={width + 10}
          height={height + 10}
          rx={12}
          className="fill-none stroke-foreground"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
      ) : null}
      <rect
        x={-3}
        y={-3}
        width={width + 6}
        height={height + 6}
        rx={10}
        className="fill-none stroke-ring opacity-0 group-focus-visible:opacity-100"
        strokeWidth={3}
      />
      <rect
        width={width}
        height={height}
        rx={8}
        className={cn(NODE_BODY[tone], 'transition-[fill-opacity] group-hover:brightness-95')}
        strokeWidth={tone === 'active' ? 2.5 : 1.25}
        strokeDasharray={NODE_DASH[tone]}
        style={tinted}
      />
      <text
        x={width / 2}
        y={height / 2}
        dominantBaseline="central"
        textAnchor="middle"
        className={cn('text-xs', NODE_TEXT[tone])}>
        {truncate(label, Math.floor((width - 20) / 7))}
      </text>
      {children}
    </g>
  );
}

// Значок в углу узла: кружок с числом или иконкой.
export function GraphBadge({
  x,
  y,
  className,
  children,
}: {
  x: number;
  y: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <g transform={`translate(${x} ${y})`} aria-hidden>
      <circle r={9} className={cn('fill-primary stroke-background', className)} strokeWidth={2} />
      {children}
    </g>
  );
}

export type EdgeTone = 'default' | 'emphasis' | 'muted';

const EDGE_STROKE: Record<EdgeTone, string> = {
  default: 'stroke-muted-foreground',
  emphasis: 'stroke-foreground',
  muted: 'stroke-muted-foreground/50',
};

const EDGE_FILL: Record<EdgeTone, string> = {
  default: 'fill-muted-foreground',
  emphasis: 'fill-foreground',
  muted: 'fill-muted-foreground/50',
};

// Ребро: путь и наконечник стрелки из раскладки. Пунктир — другой смысл
// ребра (у цикла — возврат). Рёбра для программ чтения скрыты: всё, что про
// них нужно знать, сказано в подписях узлов.
export function GraphEdge({
  d,
  arrow,
  dashed = false,
  tone = 'default',
  title,
  ...data
}: {
  d: string;
  arrow: string;
  dashed?: boolean;
  tone?: EdgeTone;
  title?: string;
} & {[key: `data-${string}`]: string | number | undefined}) {
  return (
    <g aria-hidden {...data}>
      {title ? <title>{title}</title> : null}
      <path
        d={d}
        fill="none"
        className={EDGE_STROKE[tone]}
        strokeWidth={tone === 'emphasis' ? 1.75 : 1.25}
        strokeDasharray={dashed ? '5 4' : undefined}
      />
      <polygon points={arrow} className={EDGE_FILL[tone]} />
    </g>
  );
}

// Вход «откуда угодно»: полый кружок и короткая стрелка к узлу. Одно
// обозначение на переход вместо ребра из каждого узла.
export function GraphEntry({
  origin,
  d,
  arrow,
  title,
  ...data
}: {
  origin: {x: number; y: number};
  d: string;
  arrow: string;
  title?: string;
} & {[key: `data-${string}`]: string | number | undefined}) {
  return (
    <g aria-hidden {...data}>
      {title ? <title>{title}</title> : null}
      <path d={d} fill="none" className="stroke-muted-foreground" strokeWidth={1.25} />
      <polygon points={arrow} className="fill-muted-foreground" />
      <circle cx={origin.x} cy={origin.y} r={4.5} className="fill-background stroke-muted-foreground" strokeWidth={1.5} />
    </g>
  );
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, Math.max(1, max - 1)) + '…';
}

