import {useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode} from 'react';
import {Link} from 'react-router-dom';
import {AlertTriangle, ChevronRight, History} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';

import {clockLabel} from '../../hooks/liveFeed';
import {
  NARROW_STATUSES,
  SUMMARY_TEXTS,
  TYPES_FOLD_AT,
  TYPES_SHOWN,
  categoryText,
  countText,
  summaryHref,
  tasksWord,
  type Selection,
  type SummaryStatus,
  type SummaryType,
} from './summary';
import {Zone} from './Zone';
import type {OverviewData} from './useOverview';
import type {OverviewFilters} from './zones';

// Цвет категории — перечень схемы, по нему оформление выбирать можно. У
// каждого цвета пара для тёмной темы. Смысл несёт подпись, цвет помогает.
const CATEGORY_DOT: Record<string, string> = {
  backlog: 'bg-zinc-400 dark:bg-zinc-500',
  active: 'bg-sky-500 dark:bg-sky-400',
  waiting: 'bg-amber-500/90 dark:bg-amber-400/90',
  done: 'bg-teal-500 dark:bg-teal-400',
  cancelled: 'bg-zinc-700 dark:bg-zinc-300',
};
const dotClass = (category: string | undefined) => CATEGORY_DOT[category ?? ''] ?? 'bg-muted-foreground';

// Точка статуса: цвет из версии цикла (style — цвет из данных), иначе по
// категории.
export function StatusColorDot({color, category, className}: {color?: string; category?: string; className?: string}) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-2 shrink-0 rounded-full', !color && dotClass(category), className)}
      style={color ? {backgroundColor: color} : undefined}
    />
  );
}

// Ссылки строки типа — один шаг Tab: внутри стрелки ←/→, Home и End
// (design.spec §7). Без этого длинный проект давал бы десятки остановок.
// tabIndex 0 — только у активной ссылки; ставится после каждой отрисовки,
// ссылки строки рисуются разными ветками.
function RovingGroup({
  label,
  children,
  className,
  ...rest
}: {label: string; children: ReactNode; className?: string} & Record<`data-${string}`, string>) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const links = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-roving]') ?? []);
  useLayoutEffect(() => {
    const list = links();
    const current = Math.min(active, list.length - 1);
    list.forEach((a, i) => {
      a.tabIndex = i === current ? 0 : -1;
    });
  });
  const onKeyDown = (e: KeyboardEvent) => {
    const list = links();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    let next: number;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = Math.min(list.length - 1, i + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = Math.max(0, i - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    else return;
    e.preventDefault();
    setActive(next);
    list[next].focus();
  };
  const onFocus = (e: FocusEvent) => {
    const i = links().indexOf(e.target as HTMLElement);
    if (i >= 0) setActive(i);
  };
  return (
    <div ref={ref} role="group" aria-label={label} onKeyDown={onKeyDown} onFocus={onFocus} className={className} {...rest}>
      {children}
    </div>
  );
}

function CountLink({
  to,
  children,
  label,
  title,
  className,
  kind,
  extra,
}: {
  to: string;
  children: ReactNode;
  label?: string;
  title?: string;
  className?: string;
  kind: string;
  extra?: Record<string, string>;
}) {
  return (
    <Link
      to={to}
      aria-label={label}
      title={title}
      data-roving
      data-summary-count={kind}
      {...extra}
      className={cn(
        'focus-visible:ring-ring/50 rounded-sm underline-offset-2 hover:underline focus-visible:ring-[3px] focus-visible:outline-none',
        className,
      )}>
      {children}
    </Link>
  );
}

function StatusChip({s, href}: {s: SummaryStatus; href: string}) {
  const zero = s.count === 0;
  const aria = `${s.name}${s.optional ? `, ${SUMMARY_TEXTS.optional}` : ''}, ${s.count === null ? 'не прочиталось' : `${s.count} ${tasksWord(s.count)}`}`;
  return (
    <CountLink
      to={href}
      kind="status"
      extra={{'data-summary-status': s.key}}
      label={aria}
      title={s.optional ? `${s.name} · ${SUMMARY_TEXTS.optional}` : s.name}
      className={cn(
        'inline-flex max-w-[260px] items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs no-underline hover:bg-muted max-sm:max-w-[180px]',
        s.optional && 'border-dashed',
        zero && 'text-muted-foreground',
      )}>
      <StatusColorDot color={s.color} category={s.category} />
      <span className="truncate">{s.name}</span>
      <span className={cn('font-medium tabular-nums', zero && 'font-normal')}>{countText(s.count)}</span>
    </CountLink>
  );
}

function OldChip({n, href, closed}: {n: number; href: string; closed: boolean}) {
  return (
    <CountLink
      to={href}
      kind={closed ? 'old-closed' : 'old-open'}
      title={closed ? SUMMARY_TEXTS.oldTitleClosed : SUMMARY_TEXTS.oldTitle}
      label={`${SUMMARY_TEXTS.old}: ${n}`}
      className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-amber-500/60 px-2 py-0.5 text-xs no-underline hover:bg-amber-500/10 text-amber-700 dark:text-amber-300">
      <History aria-hidden className="size-3" />
      {SUMMARY_TEXTS.old}
      <span className="font-medium tabular-nums">{countText(n)}</span>
    </CountLink>
  );
}

// Полоса по категориям: сегменты в порядке перечня, прежние версии —
// штрихованный сегмент.
function CategoryBar({t}: {t: SummaryType}) {
  const old = (t.oldOpen ?? 0) + (t.oldClosed ?? 0);
  const total = t.categories.reduce((n, c) => n + c.count, 0) + old;
  const aria = `по категориям: ${[
    ...t.categories.map((c) => `${categoryText(c.category)} ${c.count}`),
    ...(old > 0 ? [`${SUMMARY_TEXTS.old} ${old}`] : []),
  ].join(', ')}`;
  return (
    <div role="img" aria-label={aria} className="bg-muted flex h-2 w-full overflow-hidden rounded-full" data-summary-bar>
      {total > 0
        ? t.categories.map((c) =>
            c.count > 0 ? (
              <span key={c.category} className={cn('h-full', dotClass(c.category))} style={{width: `${(c.count / total) * 100}%`}} />
            ) : null,
          )
        : null}
      {total > 0 && old > 0 ? (
        <span
          className="h-full bg-[repeating-linear-gradient(45deg,var(--color-amber-500)_0_3px,transparent_3px_6px)] opacity-70"
          style={{width: `${(old / total) * 100}%`}}
        />
      ) : null}
    </div>
  );
}

function TypeRow({
  t,
  projectKey,
  filters,
  narrow,
  single,
}: {
  t: SummaryType;
  projectKey: string;
  filters: OverviewFilters;
  narrow: boolean;
  single: boolean;
}) {
  const href = (sel: Omit<Selection, 'type'>) => summaryHref(projectKey, {type: t.type, ...sel} as Selection, filters);
  const foldable = narrow && !single && t.statuses.length > NARROW_STATUSES;
  const [open, setOpen] = useState(false);
  const showChips = !foldable || open;
  const openStatuses = t.statuses.filter((s) => !s.terminal);
  const closedStatuses = t.statuses.filter((s) => s.terminal);
  const label = (text: string) => <span className="text-muted-foreground w-28 shrink-0 text-xs">{text}</span>;

  return (
    <RovingGroup
      label={`${t.type}: числа по статусам`}
      className="grid gap-x-6 gap-y-2 border-b px-3 py-3 last:border-b-0 sm:grid-cols-[190px_minmax(0,1fr)]"
      data-summary-type={t.type}>
      <div className={cn('min-w-0 space-y-0.5 text-sm', narrow && 'flex flex-wrap items-baseline gap-x-2 space-y-0')}>
        <p className="font-semibold break-words">{t.type}</p>
        <p>
          <CountLink to={href({})} kind="type" className="underline">
            {countText(t.total)} {t.total === null ? '' : tasksWord(t.total)}
          </CountLink>
        </p>
        <p className="text-muted-foreground text-xs">
          <CountLink to={href({terminal: false})} kind="open" className="underline">
            {countText(t.open)} незаверш.
          </CountLink>
          {' · '}
          <CountLink to={href({terminal: true})} kind="closed" className="underline">
            {countText(t.closed)} заверш.
          </CountLink>
        </p>
        {t.cycle ? (
          <p className="text-muted-foreground text-xs">
            цикл {t.cycle.name} · v{t.cycle.version}
          </p>
        ) : null}
      </div>
      <div className="min-w-0 space-y-2">
        {!t.cycle ? (
          <p className="text-muted-foreground text-xs" data-summary-no-cycle>
            {SUMMARY_TEXTS.noCycle}
          </p>
        ) : t.versionFailed ? (
          <p className="flex flex-wrap items-center gap-2 text-xs text-amber-700 dark:text-amber-300" data-summary-version-failed>
            {SUMMARY_TEXTS.versionFailed}
          </p>
        ) : (
          <>
            <CategoryBar t={t} />
            {t.showCategories ? (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" data-summary-categories>
                {t.categories.map((c) => (
                  <CountLink
                    key={c.category}
                    to={href({category: c.category})}
                    kind="category"
                    extra={{'data-summary-category': c.category}}
                    title={SUMMARY_TEXTS.categoryTitle}
                    className="inline-flex items-center gap-1">
                    <StatusColorDot category={c.category} />
                    {categoryText(c.category)}
                    <span className="font-medium tabular-nums">{countText(c.count)}</span>
                  </CountLink>
                ))}
              </p>
            ) : null}
            {foldable ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto px-1 py-0.5 text-xs"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
                data-summary-fold>
                <ChevronRight aria-hidden className={cn('transition-transform', open && 'rotate-90')} />
                Статусы ({t.statuses.length})
              </Button>
            ) : null}
            {showChips ? (
              <>
                <div className="flex flex-wrap items-center gap-1.5" data-summary-open>
                  {label(SUMMARY_TEXTS.open)}
                  {openStatuses.map((s) => (
                    <StatusChip key={s.key} s={s} href={href({status: s.key})} />
                  ))}
                  {t.oldOpen ? <OldChip n={t.oldOpen} href={href({terminal: false})} closed={false} /> : null}
                </div>
                <div className="flex flex-wrap items-center gap-1.5" data-summary-closed>
                  {label(SUMMARY_TEXTS.closed)}
                  {closedStatuses.map((s) => (
                    <StatusChip key={s.key} s={s} href={href({status: s.key})} />
                  ))}
                  {t.oldClosed ? <OldChip n={t.oldClosed} href={href({terminal: true})} closed /> : null}
                </div>
              </>
            ) : null}
          </>
        )}
      </div>
    </RovingGroup>
  );
}

// Блок «Сводка» (design.spec §4.2).
export function SummaryZone({
  data,
  projectKey,
  filters,
  narrow,
}: {
  data: OverviewData;
  projectKey: string;
  filters: OverviewFilters;
  narrow: boolean;
}) {
  const z = data.summary;
  const m = z.data;
  const [allTypes, setAllTypes] = useState(false);
  const clock = clockLabel(data.summaryAt);
  const types = m?.types ?? [];
  const folded = !allTypes && types.length >= TYPES_FOLD_AT;
  const shown = folded ? types.slice(0, TYPES_SHOWN) : types;
  return (
    <Zone
      zone="summary"
      count={m ? m.total : null}
      aside={
        <span data-summary-time>
          {SUMMARY_TEXTS.aside}
          {clock ? ` · на ${clock}` : ''}
        </span>
      }
      pending={!m && !z.error}
      skeletons={2}
      density="row"
      error={m ? undefined : z.error}
      retry={z.retry}
      busy={z.loading}>
      {m ? (
        <div className="rounded-lg border" data-summary>
          {shown.map((t) => (
            <TypeRow key={t.type} t={t} projectKey={projectKey} filters={filters} narrow={narrow} single={types.length === 1} />
          ))}
          {folded ? (
            <div className="border-b px-3 py-2">
              <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setAllTypes(true)} data-summary-more-types>
                Ещё {types.length - TYPES_SHOWN} типов
              </Button>
            </div>
          ) : null}
          {m.others ? (
            <div className="text-muted-foreground border-b px-3 py-2 text-xs last:border-b-0" data-summary-others>
              <span className="text-foreground font-medium">Остальные</span> · {countText(m.others)} {tasksWord(m.others)} ·{' '}
              {SUMMARY_TEXTS.others}
            </div>
          ) : null}
          {m.emptyTypes.length > 0 ? (
            <div className="text-muted-foreground border-b px-3 py-2 text-xs last:border-b-0" data-summary-empty-types>
              Нет задач по отбору: {m.emptyTypes.join(', ')}
            </div>
          ) : null}
          {m.failed > 0 ? (
            <p className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs last:border-b-0 text-amber-700 dark:text-amber-300" data-summary-partial>
              <AlertTriangle aria-hidden className="size-3.5" />
              {m.failed} счётчиков не прочитались — на их месте «—», итоги типа неполные.
              <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={z.retry} aria-busy={z.loading || undefined}>
                Повторить
              </Button>
            </p>
          ) : null}
          {!narrow && types.some((t) => t.statuses.length > 0) ? (
            <p className="text-muted-foreground bg-muted/30 px-3 py-1.5 text-xs" data-summary-legend>
              {SUMMARY_TEXTS.legend}
            </p>
          ) : null}
        </div>
      ) : null}
    </Zone>
  );
}
