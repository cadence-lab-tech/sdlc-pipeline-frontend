import {useEffect, useState} from 'react';
import {Download} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {CodeBlock, Markdown, Spinner} from '@/components/kit';

import {ApiError, api} from '../api/client';
import type {UUID} from '../api/types';
import {Failure} from './Feedback';
import type {ContentCache} from './fileContent';
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

// Просмотр файла в модалке: открыт сразу, свёртки нет. Тип решает previewMode;
// всё, что не картинка, не PDF и не текст из allowlist, — только «Скачать»
// (кнопка в полосе действий модалки), и ни запроса, ни blob для просмотра нет.
export function FilePreview({file, cache}: {file: FileRef; cache: ContentCache}) {
  const preview = previewMode(file.mediaType, file.sizeBytes);
  const [state, setState] = useState<{id: UUID; view?: View; error?: ApiError}>();

  useEffect(() => {
    if (preview.mode === 'none') return;
    let live = true;
    // Blob-ссылка живёт, пока открыт просмотр: уходит модалка — отзывается.
    let url: string | undefined;
    (async () => {
      try {
        const {blob, disposition} = await cache.file(file.id);
        if (!live) return;
        // Сервер ответил attachment: сигнатура не сошлась с заявленным типом.
        if (isAttachmentDisposition(disposition)) {
          setState({id: file.id, view: {kind: 'blocked', reason: 'Сервер не подтвердил тип файла, просмотр недоступен.'}});
          return;
        }
        if (preview.mode === 'text') {
          if (blob.size > TEXT_PREVIEW_MAX_BYTES) {
            setState({id: file.id, view: {kind: 'blocked', reason: `Текст крупнее ${formatBytes(TEXT_PREVIEW_MAX_BYTES)}.`}});
            return;
          }
          const text = decodeUtf8(await blob.arrayBuffer());
          if (!live) return;
          setState({
            id: file.id,
            view:
              text === null
                ? {kind: 'blocked', reason: 'Файл не в кодировке UTF-8, просмотр недоступен.'}
                : {kind: 'text', text, format: preview.text},
          });
          return;
        }
        url = URL.createObjectURL(new Blob([blob], {type: baseMediaType(file.mediaType)}));
        setState({id: file.id, view: {kind: preview.mode, url}});
      } catch (err) {
        if (live) setState({id: file.id, error: toError(err)});
      }
    })();
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
    // preview — функция типа и размера, они и есть зависимости.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache, file.id, file.mediaType, file.sizeBytes]);

  if (preview.mode === 'none') {
    return (
      <p className="text-muted-foreground text-sm" data-file-preview="none">
        {previewNote(file)}
      </p>
    );
  }
  const own = state?.id === file.id ? state : undefined;
  if (own?.error) return <Failure error={own.error} title="Файл не открылся" />;
  if (!own?.view) return <p className="text-muted-foreground text-sm">Загрузка…</p>;
  return <ViewBody view={own.view} name={file.name} />;
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
          className="max-h-[60svh] max-w-full rounded-md border object-contain"
        />
      );
    case 'pdf':
      return (
        <iframe
          src={view.url}
          title={name}
          data-file-preview="pdf"
          className="h-[60svh] min-h-64 w-full rounded-md border"
        />
      );
    case 'text':
      return (
        <div data-file-preview="text" className="min-w-0">
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
