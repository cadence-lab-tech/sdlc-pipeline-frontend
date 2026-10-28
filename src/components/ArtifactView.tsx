import {useState} from 'react';
import {Check, ChevronRight, Copy, Maximize2} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible';
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger} from '@/components/ui/dialog';
import {CodeBlock, Markdown, Token} from '@/components/kit';

import {ApiError, api} from '../api/client';
import type {Artifact} from '../api/types';
import {Failure} from './Feedback';
import {DownloadButton, FileBody, type FileRef} from './FileViewer';
import {fileNameOf, formatBytes} from './task/attachmentRules';

function fileOf(artifact: Artifact): FileRef {
  return {
    id: artifact.id,
    name: fileNameOf(artifact),
    mediaType: artifact.media_type,
    sizeBytes: artifact.size_bytes,
  };
}

// Артефакт иммутабелен: правка — новая версия через supersedes_id. Поэтому
// здесь нет редактирования, только чтение и апрув.
export function ArtifactView({artifact, onChanged}: {artifact: Artifact; onChanged: () => void}) {
  const [content, setContent] = useState<string>();
  const [error, setError] = useState<ApiError>();
  const [open, setOpen] = useState(false);

  // Содержимое подтягивается на первом раскрытии: крупные артефакты лежат во
  // внешнем хранилище, и тянуть их для всего списка сразу незачем.
  const load = async (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen || content !== undefined) return;
    try {
      setContent(await api.artifactContent(artifact.id));
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    }
  };

  const approve = async () => {
    try {
      await api.approveArtifact(artifact.id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    }
  };

  // Файл (format binary) в текст не читается: до 64 МиБ в строке — это и
  // зависшая вкладка, и мусор в разметке. Вместо этого — имя, тип, размер,
  // «Скачать» и просмотр по типу файла.
  const isFile = artifact.format === 'binary';

  return (
    <div className="space-y-2 rounded-lg border p-3" data-artifact={artifact.id}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Token label={`v${artifact.version}`} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{artifact.title}</p>
            <p className="text-muted-foreground text-xs">{artifact.kind}</p>
            {isFile ? (
              <p className="text-muted-foreground text-xs break-all" data-artifact-file>
                {fileNameOf(artifact)} · {artifact.media_type || 'тип не указан'} · {formatBytes(artifact.size_bytes)}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-muted-foreground text-xs">{artifact.status}</span>
          {/* Вложение в гейтах не участвует (решение 0064): принимать нечего. */}
          {artifact.approved_by || artifact.is_attachment ? null : (
            <Button size="sm" variant="secondary" onClick={approve}>
              Принять
            </Button>
          )}
        </div>
      </div>
      {error ? <Failure error={error} title="Артефакт не открылся" /> : null}
      {isFile ? (
        <FileBody file={fileOf(artifact)} />
      ) : (
        <Collapsible open={open} onOpenChange={load}>
          <div className="flex flex-wrap items-center gap-1">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="group -ml-2">
                <ChevronRight className="transition-transform group-data-[state=open]:rotate-90" />
                Содержимое
              </Button>
            </CollapsibleTrigger>
            {/* Копирование и чтение во весь экран — только на раскрытом
                артефакте: пока содержимое не подтянуто, копировать нечего. */}
            {open && content !== undefined ? (
              <>
                <CopyButton text={content} />
                <FullScreen artifact={artifact} content={content} />
              </>
            ) : null}
            {/* «Скачать» у любого артефакта, в том числе у текста, сданного
                строкой: он и забирается тем же запросом с токеном. */}
            <DownloadButton file={fileOf(artifact)} />
          </div>
          <CollapsibleContent className="pt-2">
            {content === undefined ? (
              <p className="text-muted-foreground text-sm">Загрузка…</p>
            ) : (
              <ArtifactBody format={artifact.format} content={content} />
            )}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

// Формат артефакта задаёт бэкенд (markdown, json, yaml, diff, text, html), и
// показывается артефакт по своему формату: markdown — разметкой, машинные
// форматы — блоком кода, текст и html — текстом. HTML именно текстом: он
// приехал от агента, и исполнять его здесь нечего.
export function ArtifactBody({format, content}: {format: string; content: string}) {
  if (format === 'markdown') return <Markdown>{content}</Markdown>;
  if (format === 'json' || format === 'yaml' || format === 'diff') {
    return <CodeBlock code={content} language={format} />;
  }
  return <p className="text-sm whitespace-pre-wrap">{content}</p>;
}

// Копируется исходный текст артефакта, а не отрисованная разметка: в буфер
// нужен тот же markdown, который сдал агент.
function CopyButton({text}: {text: string}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Button variant="ghost" size="sm" onClick={copy}>
      {copied ? <Check /> : <Copy />}
      Копировать
    </Button>
  );
}

// Артефакты бывают длиннее экрана карточки: чтение во всю высоту — отдельный
// диалог, содержимое в нём прокручивается само.
function FullScreen({artifact, content}: {artifact: Artifact; content: string}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Maximize2 />
          Открыть целиком
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[90svh] max-h-[90svh] flex-col gap-3 sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="pr-8 text-base">{artifact.title}</DialogTitle>
          <p className="text-muted-foreground text-xs">
            {artifact.kind} · v{artifact.version} · {artifact.format}
          </p>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto pr-1">
          <ArtifactBody format={artifact.format} content={content} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
