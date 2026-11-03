import {useState} from 'react';
import {CirclePause, Radio, Timer, WifiOff} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';

import {announcement, indicator, type Connection, type StopReason} from '../../hooks/liveFeed';

const ICON = {live: Radio, fallback: Timer, offline: WifiOff, stopped: CirclePause, connecting: Radio} as const;

const TONE = {
  ok: 'text-muted-foreground',
  muted: 'text-muted-foreground',
  warn: 'text-amber-700 dark:text-amber-300',
} as const;

// Индикатор связи в шапке «Обзора» (CLAB-367, design §2.7): «Обновляется
// само», «Обновление раз в 30 с», «Нет связи · данные на HH:MM» с «Повторить».
// Значок и текст несут смысл без цвета. Вспомогательным технологиям
// объявляется только смена связи на «Нет связи» и обратно — отдельным
// скрытым сообщением, а не каждым перечитыванием.
export function LiveIndicator({
  connection,
  updatedAt,
  stopReason,
  onRetry,
}: {
  connection: Connection;
  updatedAt: number | null;
  stopReason?: StopReason;
  onRetry: () => void;
}) {
  const [seen, setSeen] = useState<{connection: Connection; message: string}>({connection, message: ''});
  if (seen.connection !== connection) {
    setSeen({connection, message: announcement(seen.connection, connection)});
  }

  const view = indicator(connection, updatedAt, stopReason);
  const Icon = ICON[connection];
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm" data-live data-live-mode={connection}>
      <span aria-live="polite" className="sr-only" data-live-announce>
        {seen.message}
      </span>
      {view.label ? (
        <span
          title={view.title}
          className={cn('inline-flex min-w-0 items-center gap-1.5', TONE[view.tone])}
          data-live-label>
          <Icon aria-hidden className="size-4 shrink-0" />
          <span className="min-w-0">{view.label}</span>
        </span>
      ) : null}
      {view.retry ? (
        <Button variant="outline" size="sm" onClick={onRetry} data-live-retry>
          Повторить
        </Button>
      ) : null}
    </div>
  );
}
