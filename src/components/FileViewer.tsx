import {useEffect, useRef, useState} from 'react';
import {ChevronRight, Download} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible';
import {CodeBlock, Markdown, Spinner} from '@/components/kit';

import {ApiError, api} from '../api/client';
import type {UUID} from '../api/types';
import {Failure} from './Feedback';
import {
  TEXT_PREVIEW_MAX_BYTES,
  baseMediaType,
  decodeUtf8,
  formatBytes,
  isAttachmentDisposition,
  previewMode,
  type TextFormat,
} from './task/attachmentRules';

// Файл артефакта — вложение, файл по контракту или любой текст: что нужно
// показать и отдать. Достаточно этих полей; и Artifact, и Attachment их дают.
export interface FileRef {
  id: UUID;
  // Имя для сохранения — то, что хранит сервер, как есть.
  name: string;
  mediaType?: string;
  sizeBytes: number;
}

const toError = (err: unknown) => (err instanceof ApiError ? err : new ApiError('internal', String(err)));

type View =
  | {kind: 'image' | 'pdf'; url: string}
  | {kind: 'text'; text: string; format: TextFormat}
  // Превью не строится, остаётся «Скачать»; reason говорит почему.
  | {kind: 'blocked'; reason: string};

// «Скачать» — запрос с токеном, а не прямая ссылка: токен лежит в заголовке.
// Файл уходит как application/octet-stream по ссылке с атрибутом download,
// страница на его содержимое не переходит: HTML и SVG не исполняются в origin
// интерфейса (CLAB-299, AC-28).
export function DownloadButton({file, variant = 'ghost'}: {file: FileRef; variant?: 'ghost' | 'outline'}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError>();

  const download = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const {blob} = await api.artifactFile(file.id);
      const url = URL.createObjectURL(new Blob([blob], {type: 'application/octet-stream'}));
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Браузер читает ссылку асинхронно: отзыв сразу оборвал бы сохранение.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(toError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant={variant} size="sm" onClick={download} disabled={busy} data-download={file.id}>
        {busy ? <Spinner /> : <Download />}
        Скачать
      </Button>
      {error ? (
        <div className="basis-full">
          <Failure error={error} title="Файл не скачался" />
        </div>
      ) : null}
    </>
  );
}

// Просмотр на месте и «Скачать». Содержимое тянется по раскрытию, а не при
// показе списка: файлы бывают по десятку мегабайт. Тип решает previewMode;
// всё, что не картинка, не PDF и не текст из allowlist, — только «Скачать»,
// и blob для просмотра не создаётся вовсе.
export function FileBody({file}: {file: FileRef}) {
  const preview = previewMode(file.mediaType, file.sizeBytes);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>();
  const [error, setError] = useState<ApiError>();
  // Blob-ссылка отзывается, когда вложение уходит с экрана; пока оно на
  // экране, свёрнутый просмотр её держит, чтобы не качать файл заново.
  const urlRef = useRef<string>(undefined);
  const mounted = useRef(true);
  const started = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  const load = async (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen || started.current || preview.mode === 'none') return;
    started.current = true;
    setError(undefined);
    try {
      const {blob, disposition} = await api.artifactFile(file.id);
      if (!mounted.current) return;
      // Сервер ответил attachment: сигнатура не сошлась с заявленным типом.
      if (isAttachmentDisposition(disposition)) {
        setView({kind: 'blocked', reason: 'Сервер не подтвердил тип файла, просмотр недоступен.'});
        return;
      }
      if (preview.mode === 'text') {
        if (blob.size > TEXT_PREVIEW_MAX_BYTES) {
          setView({kind: 'blocked', reason: `Текст крупнее ${formatBytes(TEXT_PREVIEW_MAX_BYTES)}.`});
          return;
        }
        const text = decodeUtf8(await blob.arrayBuffer());
        if (!mounted.current) return;
        setView(
          text === null
            ? {kind: 'blocked', reason: 'Файл не в кодировке UTF-8, просмотр недоступен.'}
            : {kind: 'text', text, format: preview.text},
        );
        return;
      }
      const url = URL.createObjectURL(new Blob([blob], {type: baseMediaType(file.mediaType)}));
      urlRef.current = url;
      setView({kind: preview.mode, url});
    } catch (err) {
      started.current = false;
      if (mounted.current) setError(toError(err));
    }
  };

  return (
    <Collapsible open={open} onOpenChange={load} data-file-body={file.id}>
      <div className="flex flex-wrap items-center gap-1">
        {preview.mode === 'none' ? null : (
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="group -ml-2">
              <ChevronRight className="transition-transform group-data-[state=open]:rotate-90" />
              Просмотр
            </Button>
          </CollapsibleTrigger>
        )}
        <DownloadButton file={file} />
        {preview.mode === 'none' ? (
          <span className="text-muted-foreground text-xs">
            {previewNote(file)}
          </span>
        ) : null}
      </div>
      {preview.mode === 'none' ? null : (
        <CollapsibleContent className="pt-2">
          {error ? <Failure error={error} title="Файл не открылся" /> : null}
          {!error && !view ? (
            <p className="text-muted-foreground text-sm">Загрузка…</p>
          ) : null}
          {view ? <ViewBody view={view} name={file.name} /> : null}
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

function previewNote(file: FileRef): string {
  const base = baseMediaType(file.mediaType);
  const textual = base.startsWith('text/') || base === 'application/json';
  if (textual && file.sizeBytes > TEXT_PREVIEW_MAX_BYTES) {
    return `Крупнее ${formatBytes(TEXT_PREVIEW_MAX_BYTES)} — только «Скачать»`;
  }
  return 'Просмотр для этого типа недоступен';
}

function ViewBody({view, name}: {view: View; name: string}) {
  switch (view.kind) {
    case 'image':
      return (
        <img
          src={view.url}
          alt={name}
          data-file-preview="image"
          className="max-h-96 max-w-full rounded-md border object-contain"
        />
      );
    case 'pdf':
      return (
        <iframe
          src={view.url}
          title={name}
          data-file-preview="pdf"
          className="h-[32rem] w-full rounded-md border"
        />
      );
    case 'text':
      return (
        <div data-file-preview="text" className="max-h-[32rem] overflow-auto">
          {view.format === 'markdown' ? (
            <Markdown>{view.text}</Markdown>
          ) : view.format === 'json' ? (
            <CodeBlock code={view.text} language="json" />
          ) : (
            <p className="text-sm whitespace-pre-wrap">{view.text}</p>
          )}
        </div>
      );
    case 'blocked':
      return (
        <p data-file-preview="blocked" className="text-muted-foreground text-sm">
          {view.reason} Файл можно скачать.
        </p>
      );
  }
}
