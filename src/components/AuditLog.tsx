import {useEffect, useRef, useState} from 'react';
import {Link} from 'react-router-dom';
import {ChevronDown} from 'lucide-react';

import {cn} from '@/lib/utils';
import {Button} from '@/components/ui/button';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible';
import {CodeBlock, EmptyState, RowList, Spinner, Timestamp, Token} from '@/components/kit';

import {ApiError} from '../api/client';
import type {AuditEntry, AuditPage} from '../api/types';
import {useResource} from '../api/useResource';
import {Failure, Loading} from './Feedback';
import {
  channelLabel,
  outcomeLabel,
  principalLabel,
  tokenKindColor,
  tokenKindLabel,
  tokenLabel,
} from './audit';

// Журнал действий (CLAB-210): кто, каким токеном, через какой канал и каким
// вызовом действовал, с каким исходом. Один компонент на три места —
// секцию обзора карточки, раздел настроек проекта и страницу инстанса; различаются
// они только ручкой (load) и колонкой задачи.
//
// Компонент монтируется тогда, когда журнал показывают: отказ 403 на чтении
// сам пишется в журнал, и карточка, открытая наблюдателем, не должна
// оставлять такую запись при каждом показе.
//
// Пагинация — по курсору next. Первая страница — обычный ресурс: перезапрос
// (version сменился — действие на карточке, опрос живой аренды) оставляет
// прежний ответ на экране до прихода нового и сбрасывает догруженное, потому
// что курсоры прежней первой страницы уже не про неё.
export function AuditLog({
  load,
  deps,
  version = 0,
  showTask = false,
}: {
  load: (cursor?: string) => Promise<AuditPage>;
  deps: unknown[];
  version?: number;
  showTask?: boolean;
}) {
  const first = useResource(() => load(), deps);
  const [more, setMore] = useState<{base: AuditPage; entries: AuditEntry[]; next: string | null}>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<{base: AuditPage; error: ApiError}>();

  // Перезапрос по знаку снаружи: сам журнал не знает, что на карточке
  // что-то сделали. Первый рендер не считается — ресурс только что загружен.
  const seen = useRef(version);
  const {reload} = first;
  useEffect(() => {
    if (version === seen.current) return;
    seen.current = version;
    reload();
  }, [version, reload]);

  if (first.error) return <Failure error={first.error} reload={first.reload} />;
  if (!first.data) return <Loading />;

  const base = first.data;
  // Догруженное принадлежит той первой странице, от которой шли курсоры.
  const extra = more?.base === base ? more : undefined;
  const entries = extra ? [...base.entries, ...extra.entries] : base.entries;
  const next = extra ? extra.next : base.next;
  const failure = moreError?.base === base ? moreError.error : undefined;

  const loadMore = async () => {
    if (!next) return;
    setLoadingMore(true);
    setMoreError(undefined);
    try {
      const page = await load(next);
      setMore({base, entries: [...(extra?.entries ?? []), ...page.entries], next: page.next});
    } catch (err) {
      setMoreError({base, error: err instanceof ApiError ? err : new ApiError('internal', String(err))});
    } finally {
      setLoadingMore(false);
    }
  };

  if (entries.length === 0) {
    return <EmptyState title="Записей нет" description="Здесь появятся вызовы MCP и REST, изменяющие данные, и отказы в доступе." />;
  }

  return (
    <div className="min-w-0 space-y-3" data-audit-log>
      <RowList>
        {entries.map((entry) => (
          <AuditRow key={entry.id} entry={entry} showTask={showTask} />
        ))}
      </RowList>
      {failure ? <Failure error={failure} reload={loadMore} /> : null}
      {next ? (
        <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? <Spinner /> : null}
          Показать ещё
        </Button>
      ) : null}
    </div>
  );
}

function AuditRow({entry, showTask}: {entry: AuditEntry; showTask: boolean}) {
  const {ok} = entry.outcome;
  const token = tokenLabel(entry.token);
  const kind = entry.token?.kind ?? null;

  return (
    <Collapsible
      data-audit-entry={entry.id}
      data-outcome={ok ? 'ok' : 'fail'}
      className={cn(!ok && 'border-l-destructive bg-destructive/5 border-l-2')}>
      <div className="flex items-start">
        <CollapsibleTrigger className="group hover:bg-accent/60 flex min-w-0 flex-1 cursor-pointer items-start gap-3 px-3 py-2 text-left text-sm transition-colors">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-medium break-all">{entry.action}</span>
              <Token label={channelLabel(entry.channel)} />
              <span
                data-audit-outcome
                className={cn('text-xs', ok ? 'text-muted-foreground' : 'text-destructive font-medium')}>
                {outcomeLabel(entry.outcome)}
              </span>
            </div>
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span>{principalLabel(entry.principal)}</span>
              {token ? <span className="font-mono break-all">{token}</span> : null}
              <Token label={tokenKindLabel(kind)} color={tokenKindColor(kind)} className="text-xs" />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Timestamp value={entry.at} className="text-xs" />
            <ChevronDown className="text-muted-foreground size-4 -rotate-90 transition-transform group-data-[state=open]:rotate-0" />
          </div>
        </CollapsibleTrigger>
        {/* Задача — ссылка, а ссылке внутри кнопки раскрытия не место. */}
        {showTask ? (
          <div className="shrink-0 px-3 py-2 text-xs">
            <TaskRef entry={entry} />
          </div>
        ) : null}
      </div>
      <CollapsibleContent className="min-w-0 space-y-2 px-3 pb-3">
        <CodeBlock
          code={JSON.stringify(entry.params ?? null, null, 2)}
          language="json"
          title="параметры"
          maxHeight={320}
        />
        <p className="text-muted-foreground text-xs break-all">
          request_id: <span className="font-mono">{entry.request_id ?? '—'}</span>
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}

// Колонка задачи в журнале проекта: ссылка на карточку, у проектного
// действия — прочерк.
function TaskRef({entry}: {entry: AuditEntry}) {
  if (!entry.task_key || !entry.project_key) {
    return <span data-audit-task className="text-muted-foreground">—</span>;
  }
  return (
    <Link
      data-audit-task
      to={`/p/${entry.project_key}/tasks/${entry.task_key}`}
      className="underline underline-offset-4">
      {entry.task_key}
    </Link>
  );
}
