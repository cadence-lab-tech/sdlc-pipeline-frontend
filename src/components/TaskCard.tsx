import {Card} from '@/components/ui/card';
import {Token, type TokenColor} from '@/components/kit';

import type {Task} from '../api/types';

const PRIORITY_COLOR: Record<string, TokenColor> = {
  urgent: 'red',
  high: 'orange',
  low: 'default',
};

// Карточка задачи на доске. Область задачи — набор репозиториев, а не один:
// у мультирепозиторной задачи их несколько (решение 0015).
export function TaskCard({
  task,
  isOnOldWorkflow = false,
  holder,
}: {
  task: Task;
  isOnOldWorkflow?: boolean;
  // Кто держит задачу прямо сейчас: хэндл и жива ли аренда. Истёкшая аренда
  // показывается тоже — она объясняет, почему задача стоит.
  holder?: {handle: string; live: boolean};
}) {
  const multiRepo = task.properties.multi_repo === true;

  return (
    <Card className="hover:border-foreground/20 gap-2 p-3 transition-colors">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground font-mono text-xs tabular-nums">{task.key}</span>
        {task.priority !== 'normal' ? (
          <Token label={task.priority} color={PRIORITY_COLOR[task.priority] ?? 'default'} />
        ) : null}
      </div>
      <p className="line-clamp-3 text-sm font-medium">{task.title}</p>
      {holder ? (
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <span
            className={holder.live ? 'size-2 shrink-0 rounded-full bg-blue-500' : 'bg-muted-foreground size-2 shrink-0 rounded-full'}
          />
          {holder.live ? 'в работе у' : 'аренда истекла у'} {holder.handle}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1">
        {task.repositories.map((r) => (
          <Token key={r.repository_id} label={r.name} />
        ))}
        {multiRepo ? <Token label="мультирепо" color="blue" /> : null}
        {isOnOldWorkflow ? <Token label="прежняя версия цикла" color="orange" /> : null}
      </div>
      {task.labels.length > 0 ? (
        <div className="text-muted-foreground flex flex-wrap gap-1 text-xs">
          {task.labels.map((l) => (
            <span key={l}>#{l}</span>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
