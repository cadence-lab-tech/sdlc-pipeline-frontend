import {useState} from 'react';
import {Check, ChevronRight, Copy, File, FileText, Paperclip} from 'lucide-react';

import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible';
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger} from '@/components/ui/dialog';
import {Timestamp, Token} from '@/components/kit';
import {cn} from '@/lib/utils';

import type {ApiError} from '../api/client';
import type {UUID} from '../api/types';
import {Failure} from './Feedback';
import {ContentCache, useCachedText} from './fileContent';
import {ArtifactBody, DownloadButton, FilePreview} from './FileViewer';
import {fileFacts, fileSubtitle, versionLine, type FileItem} from './task/fileItem';

// Плитка файла и модалка (CLAB-308): артефакт этапа и вложение выглядят
// одинаково. На плитке — что это и чьё, действий нет; всё, что с файлом можно
// сделать, — в модалке, которая выросла из прежнего «Открыть целиком».

// Сетка плиток: в одну колонку, пока плитке не хватает 16rem, иначе несколько.
// Ширину задаёт контейнер, а не окно: плитки живут и в узкой правой колонке.
export function TileGrid({children}: {children: React.ReactNode}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-2" data-file-grid>
      {children}
    </div>
  );
}

// Состояние истории прежних версий, когда её приносит отдельный запрос
// (артефакты этапа); у вложений история уже в списке раздела.
export interface HistoryState {
  loading?: boolean;
  error?: ApiError;
}

export interface FileTileProps {
  item: FileItem;
  // Прежние версии от новой к старой.
  history?: FileItem[];
  historyState?: HistoryState;
  // Опоры сквозных сценариев и стили места: data-artifact, data-attachment…
  attrs?: Record<string, string>;
  // Якорь для ссылок вида #artifact-<id>.
  anchorId?: string;
  onOpenChange?: (open: boolean) => void;
  // Действия сверх «Копировать» и «Скачать» — «Принять», «Новая версия».
  // Прежней версии из истории действия отдаются с current=false.
  actions?: (ctx: {item: FileItem; current: boolean}) => React.ReactNode;
  // Прогресс, ошибка действия и прочее, что действие хочет показать в модалке.
  notice?: React.ReactNode;
}

export function FileTile({item, history = [], historyState, attrs, anchorId, onOpenChange, actions, notice}: FileTileProps) {
  // Кэш содержимого живёт, пока жива плитка: повторное открытие не ходит в сеть.
  const [cache] = useState(() => new ContentCache());
  const Icon = item.attachment ? Paperclip : item.isFile ? File : FileText;
  const facts = fileFacts(item);

  return (
    <Dialog onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          id={anchorId}
          data-file-tile
          {...attrs}
          className="bg-card text-card-foreground hover:bg-accent/50 focus-visible:border-ring focus-visible:ring-ring/50 flex w-full min-w-0 scroll-mt-20 flex-col gap-2 rounded-lg border p-3 text-left transition-colors outline-none focus-visible:ring-3">
          <span className="flex items-start gap-2">
            <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium break-words" data-file-title>
                {item.title}
              </span>
              <span className="text-muted-foreground block text-xs break-all">{fileSubtitle(item)}</span>
            </span>
            {item.approved ? (
              <Badge variant="secondary" data-file-approved>
                <Check aria-hidden />
                принят
              </Badge>
            ) : null}
          </span>
          <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <Token label={`v${item.version}`} />
            {facts.map((f) => (
              <span key={f} className="break-all">
                {f}
              </span>
            ))}
            <Timestamp value={item.at} format="relative" className="text-xs" />
          </span>
        </button>
      </DialogTrigger>
      <DialogContent
        data-file-dialog={item.id}
        className="flex h-[90svh] max-h-[90svh] min-w-0 flex-col gap-3 sm:max-w-4xl">
        <FileDialogView
          key={item.id}
          item={item}
          history={history}
          historyState={historyState}
          cache={cache}
          actions={actions}
          notice={notice}
        />
      </DialogContent>
    </Dialog>
  );
}

function FileDialogView({
  item,
  history,
  historyState,
  cache,
  actions,
  notice,
}: {
  item: FileItem;
  history: FileItem[];
  historyState?: HistoryState;
  cache: ContentCache;
  actions?: FileTileProps['actions'];
  notice?: React.ReactNode;
}) {
  // Выбранная прежняя версия; пусто — открыта текущая.
  const [pickedId, setPickedId] = useState<UUID>();
  const shown = history.find((h) => h.id === pickedId) ?? item;
  const current = shown.id === item.id;
  const text = useCachedText(cache, shown.id, !shown.isFile);

  return (
    <>
      <DialogHeader className="shrink-0 pr-8">
        <DialogTitle className="text-base break-words" data-file-title>{shown.title}</DialogTitle>
        <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <Token label={`v${shown.version}`} />
          {shown.kind ? <span className="break-all">{shown.kind}</span> : null}
          <span className="break-all">{shown.isFile ? shown.mediaType || 'тип не указан' : shown.format}</span>
          {fileFacts(shown).map((f) => (
            <span key={f} className="break-all">
              {f}
            </span>
          ))}
          <Timestamp value={shown.at} className="text-xs" />
          {shown.isFile || shown.name !== shown.title ? <span className="break-all">{shown.name}</span> : null}
        </DialogDescription>
      </DialogHeader>

      {current ? null : (
        <p className="shrink-0 text-sm" data-file-old>
          Прежняя версия v{shown.version}.{' '}
          <button type="button" className="underline underline-offset-4" onClick={() => setPickedId(undefined)}>
            К текущей v{item.version}
          </button>
        </p>
      )}

      <div className="flex shrink-0 flex-wrap items-center gap-1" data-file-actions>
        {shown.isFile ? null : <CopyButton text={text?.text} />}
        <DownloadButton file={shown} />
        {actions?.({item: shown, current})}
      </div>
      {notice ? <div className="shrink-0 space-y-2">{notice}</div> : null}

      <VersionHistory
        item={item}
        history={history}
        state={historyState}
        shownId={shown.id}
        onPick={(id) => setPickedId(id === item.id ? undefined : id)}
      />

      <div className="min-h-0 min-w-0 flex-1 overflow-auto pr-1" data-file-body={shown.id}>
        {shown.isFile ? (
          <FilePreview key={shown.id} file={shown} cache={cache} />
        ) : text?.error ? (
          <Failure error={text.error} title="Артефакт не открылся" />
        ) : text?.text === undefined ? (
          <p className="text-muted-foreground text-sm">Загрузка…</p>
        ) : (
          <ArtifactBody format={shown.format} content={text.text} />
        )}
      </div>
    </>
  );
}

// История версий: текущая и прежние, любую можно открыть. Прежние версии
// отдельными плитками не показываются (CLAB-308): они часть этой.
function VersionHistory({
  item,
  history,
  state,
  shownId,
  onPick,
}: {
  item: FileItem;
  history: FileItem[];
  state?: HistoryState;
  shownId: UUID;
  onPick: (id: UUID) => void;
}) {
  if (state?.error) {
    return (
      <div className="shrink-0" data-file-history-error>
        <Failure error={state.error} title="История версий не загрузилась" />
      </div>
    );
  }
  if (state?.loading) {
    return <p className="text-muted-foreground shrink-0 text-xs">История версий: загрузка…</p>;
  }
  if (history.length === 0) return null;
  return (
    <Collapsible className="shrink-0" data-file-history={item.id}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="group -ml-2">
          <ChevronRight className="transition-transform group-data-[state=open]:rotate-90" />
          История версий ({history.length})
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="max-h-40 space-y-1 overflow-auto pt-1">
        {[item, ...history].map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={v.id === shownId}
            data-file-version={v.id === item.id ? undefined : v.id}
            data-file-current={v.id === item.id ? '' : undefined}
            onClick={() => onPick(v.id)}
            className={cn(
              'hover:bg-accent/50 flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border px-2 py-1 text-left text-xs',
              v.id === shownId && 'bg-accent',
            )}>
            <span className="break-all">{versionLine(v)}</span>
            {v.id === item.id ? <span className="text-muted-foreground">текущая</span> : null}
            <Timestamp value={v.at} format="relative" className="text-xs" />
          </button>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

// Копируется исходный текст артефакта, а не отрисованная разметка: в буфер
// нужен тот же markdown, который сдал агент.
function CopyButton({text}: {text?: string}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (text === undefined) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Button variant="ghost" size="sm" onClick={copy} disabled={text === undefined} data-file-copy>
      {copied ? <Check /> : <Copy />}
      Копировать
    </Button>
  );
}
