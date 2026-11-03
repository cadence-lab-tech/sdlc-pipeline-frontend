import {useId, type ReactNode} from 'react';
import {CircleCheck, ChevronDown} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {Collapsible, CollapsibleContent} from '@/components/ui/collapsible';
import {Skeleton} from '@/components/ui/skeleton';
import {cn} from '@/lib/utils';

import type {ApiError} from '../../api/client';
import {useCollapsed} from '../../hooks/useCollapsed';
import {Failure} from '../Feedback';
import {COLLAPSE_KEYS, isCollapsed, ZONE_TITLES, type ZoneKey} from './zones';

// Цвет счётчика при N > 0: синий у решений, красный у застрявшего — срочное
// видно и у свёрнутой зоны (Д-5). У остальных зон и при нуле — нейтральный.
export type CounterTone = 'blue' | 'red';

const COUNTER: Record<CounterTone | 'neutral', string> = {
  neutral: 'bg-muted text-foreground',
  blue: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  red: 'bg-red-500/15 text-red-700 dark:text-red-300',
};

export interface ZoneProps {
  zone: ZoneKey;
  // Заголовок вместо ZONE_TITLES[zone] (блок бэклога в нарезке эпика).
  title?: string;
  // Счётчик: число, «N+» при неполном списке, «—» при ошибке.
  count: number | null;
  partial?: boolean;
  tone?: CounterTone;
  // Подпись справа от счётчика («можно забрать»).
  aside?: ReactNode;
  // Строка под заголовком (права наблюдателя).
  note?: ReactNode;
  // Данных ещё нет: скелетоны вместо тела.
  pending?: boolean;
  skeletons?: number;
  density?: 'card' | 'row';
  // Ошибка загрузки зоны: Failure с «Повторить», прежние строки ниже.
  error?: ApiError;
  retry?: () => void;
  // Пусто — одна строка пунктиром с этим текстом.
  isEmpty?: boolean;
  emptyText?: string;
  // Перечитывается (кнопка «Обновить», «Ещё N»): строки на месте, aria-busy.
  busy?: boolean;
  className?: string;
  children?: ReactNode;
}

// Рамка зоны «Обзора» (design.spec §3.2): <section> с <h2>, весь заголовок —
// одна кнопка сворачивания с шевроном, названием и счётчиком. Свёрнутость —
// настройка вида в браузере (useCollapsed, ключ overview.<зона>); данные
// зоны страница запрашивает и у свёрнутой — счётчик верен. Ту же рамку берёт
// блок «Приоритетные из бэклога» (CLAB-366).
export function Zone({
  zone,
  title: titleOverride,
  count,
  partial,
  tone,
  aside,
  note,
  pending,
  skeletons = 3,
  density = 'card',
  error,
  retry,
  isEmpty,
  emptyText,
  busy,
  className,
  children,
}: ZoneProps) {
  const {key} = COLLAPSE_KEYS[zone];
  const [stored, setStored] = useCollapsed(key);
  const collapsed = isCollapsed(zone, stored);
  const setCollapsed = (next: boolean) => setStored(COLLAPSE_KEYS[zone].inverted ? !next : next);
  const headingId = useId();
  const bodyId = useId();
  const title = titleOverride ?? ZONE_TITLES[zone];
  const counter = count === null ? '—' : partial ? `${count}+` : String(count);
  const toneClass = count !== null && count > 0 && tone ? COUNTER[tone] : COUNTER.neutral;

  return (
    <section
      aria-labelledby={headingId}
      data-zone={zone}
      data-collapsed={collapsed ? '' : undefined}
      className={cn('min-w-0 space-y-3', className)}>
      <Collapsible open={!collapsed} onOpenChange={(open) => setCollapsed(!open)}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 id={headingId} className="text-base font-semibold">
            <button
              type="button"
              aria-expanded={!collapsed}
              aria-controls={bodyId}
              onClick={() => setCollapsed(!collapsed)}
              data-zone-toggle
              className="focus-visible:ring-ring/50 -mx-1 inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-left focus-visible:ring-[3px] focus-visible:outline-none">
              <ChevronDown
                aria-hidden
                className={cn('text-muted-foreground size-4 shrink-0 transition-transform', collapsed && '-rotate-90')}
              />
              <span>{title}</span>
              <span
                aria-label={`${title}, ${counter}`}
                data-zone-count
                className={cn('rounded-full px-2 py-0.5 text-xs font-medium tabular-nums', toneClass)}>
                {counter}
              </span>
            </button>
          </h2>
          {aside ? <span className="text-muted-foreground text-xs">{aside}</span> : null}
        </div>
        {note ? <div className="mt-2">{note}</div> : null}
        <CollapsibleContent id={bodyId} className="mt-3 space-y-3" aria-busy={busy || undefined}>
          {error ? <Failure error={error} title={`Не получилось загрузить «${title}»`} reload={retry} /> : null}
          {pending && !error ? (
            <div className="space-y-2" data-zone-skeleton>
              {Array.from({length: skeletons}, (_, i) => (
                <Skeleton key={i} className={density === 'card' ? 'h-24 w-full' : 'h-14 w-full'} />
              ))}
            </div>
          ) : null}
          {!pending && isEmpty && !error ? (
            <p
              data-zone-empty
              className="text-muted-foreground flex items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-sm">
              <CircleCheck aria-hidden className="size-4 shrink-0" />
              {emptyText}
            </p>
          ) : null}
          {!pending ? children : null}
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}

// «Ещё N» / «Показать меньше» под зоной: разворачивает на месте повторным
// запросом. Пока грузится — кнопка занята, строки не мигают.
export function MoreButton({
  label,
  onClick,
  busy,
}: {
  label: string;
  onClick: () => void;
  busy?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="w-full"
      onClick={onClick}
      disabled={busy}
      aria-busy={busy || undefined}
      data-zone-more>
      {label}
    </Button>
  );
}

// Ошибка «Ещё N» или листания: показанные строки остаются.
export function MoreFailed({retry}: {retry: () => void}) {
  return (
    <p data-zone-more-failed className="flex flex-wrap items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
      Не получилось загрузить ещё.
      <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={retry}>
        Повторить
      </Button>
    </p>
  );
}
