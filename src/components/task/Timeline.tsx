import {Row, RowList, Timestamp} from '@/components/kit';

import type {TaskEvent} from '../../api/types';
import type {Resource} from '../../api/useResource';
import {Failure, Loading} from '../Feedback';
import {eventLabel} from './events';

// Лента показывает ресурс карточки, а не заводит свой: её перезапрашивает
// каждое действие на странице (правка постановки, сдача артефакта, переход),
// и второй экземпляр того же запроса остался бы на прежних событиях.
export function Timeline({events}: {events: Resource<TaskEvent[]>}) {
  if (events.error) return <Failure error={events.error} />;
  if (!events.data) return <Loading />;

  return (
    <div className="space-y-4">
      {groupByDay(events.data).map(([day, list]) => (
        <div key={day} className="space-y-2">
          <h3 className="text-muted-foreground text-xs font-medium">{dayLabel(day)}</h3>
          <RowList>
            {list.map((e) => (
              <Row key={e.id} end={<Timestamp value={e.created_at} format="time" />}>
                <p className="font-medium">{eventLabel(e.type)}</p>
                {e.actor_handle ? (
                  <p className="text-muted-foreground text-xs">{e.actor_handle}</p>
                ) : null}
              </Row>
            ))}
          </RowList>
        </div>
      ))}
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
