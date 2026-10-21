import {ChevronDown} from 'lucide-react';

import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible';
import {CodeBlock, RowList, Timestamp} from '@/components/kit';

import type {TaskEvent} from '../../api/types';
import type {Resource} from '../../api/useResource';
import {Failure, Loading} from '../Feedback';
import {priorityLabel} from '../priorities';
import {eventDetails, eventLabel, hasPayload} from './events';

// Лента показывает ресурс карточки, а не заводит свой: её перезапрашивает
// каждое действие на странице (правка постановки, сдача артефакта, переход),
// и второй экземпляр того же запроса остался бы на прежних событиях.
export function Timeline({events}: {events: Resource<TaskEvent[]>}) {
  if (events.error) return <Failure error={events.error} reload={events.reload} />;
  if (!events.data) return <Loading />;

  return (
    <div className="space-y-4">
      {groupByDay(events.data).map(([day, list]) => (
        <div key={day} className="space-y-2">
          <h3 className="text-muted-foreground text-xs font-medium">{dayLabel(day)}</h3>
          <RowList>
            {list.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </RowList>
        </div>
      ))}
    </div>
  );
}

// Строка события: подпись, кто и короткая строка подробностей из payload.
// Длинное (было/стало описания) и сырой payload — по раскрытию: строка ленты
// остаётся строкой, а событие незнакомого типа не теряет того, что в нём есть.
function EventRow({event}: {event: TaskEvent}) {
  const details = eventDetails(event.type, event.payload, priorityLabel);
  const expandable = hasPayload(event.payload);

  const head = (
    <div className="flex w-full items-start gap-3 px-3 py-2 text-left text-sm">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{eventLabel(event.type)}</p>
        {event.actor_handle ? (
          <p className="text-muted-foreground text-xs">{event.actor_handle}</p>
        ) : null}
        {details.summary ? (
          <p className="text-muted-foreground text-xs break-words" data-event-details>
            {details.summary}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Timestamp value={event.created_at} format="time" />
        {expandable ? (
          <ChevronDown className="text-muted-foreground size-4 -rotate-90 transition-transform group-data-[state=open]:rotate-0" />
        ) : null}
      </div>
    </div>
  );

  if (!expandable) return <div data-event={event.type}>{head}</div>;

  return (
    <Collapsible data-event={event.type}>
      <CollapsibleTrigger className="group hover:bg-accent/60 w-full cursor-pointer transition-colors">
        {head}
      </CollapsibleTrigger>
      <CollapsibleContent className="min-w-0 space-y-3 px-3 pb-3">
        {details.long.map((change) => (
          <div key={change.field} className="grid min-w-0 gap-2 md:grid-cols-2">
            <LongValue title={`${change.field}: было`} value={change.from} />
            <LongValue title={`${change.field}: стало`} value={change.to} />
          </div>
        ))}
        <CodeBlock code={JSON.stringify(event.payload, null, 2)} language="json" title="payload" maxHeight={320} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function LongValue({title, value}: {title: string; value: string}) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-muted-foreground text-xs">{title}</p>
      <p className="bg-muted/40 max-h-60 overflow-auto rounded-md border p-2 text-xs break-words whitespace-pre-wrap">
        {value || '—'}
      </p>
    </div>
  );
}

// День берётся по местному времени читателя, а не по UTC: событие в 2 часа
// ночи по Москве не должно уезжать во вчера.
function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function groupByDay(events: TaskEvent[]): [string, TaskEvent[]][] {
  const groups: [string, TaskEvent[]][] = [];
  for (const event of events) {
    const key = dayKey(event.created_at);
    const last = groups[groups.length - 1];
    if (last && last[0] === key) last[1].push(event);
    else groups.push([key, [event]]);
  }
  return groups;
}

const dayFormat = new Intl.DateTimeFormat('ru', {day: 'numeric', month: 'long', year: 'numeric'});

function dayLabel(key: string): string {
  const today = dayKey(new Date().toISOString());
  if (key === today) return 'сегодня';
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === dayKey(yesterday.toISOString())) return 'вчера';
  const [year, month, day] = key.split('-').map(Number);
  return dayFormat.format(new Date(year, month - 1, day));
}
