import {useId, useMemo, useState} from 'react';
import {ChevronRight, Paperclip, Upload} from 'lucide-react';
import {toast} from 'sonner';

import {cn} from '@/lib/utils';
import {Button, buttonVariants} from '@/components/ui/button';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible';
import {Note, Section, Timestamp, Token} from '@/components/kit';

import {ApiError, api} from '../../api/client';
import type {Attachment} from '../../api/types';
import {useResource} from '../../api/useResource';
import {useInstance} from '../../hooks/useInstance';
import {Failure, Loading} from '../Feedback';
import {FileBody, type FileRef} from '../FileViewer';
import {buildForm, fileLimitProblem, formatBytes, groupVersions} from './attachmentRules';

const toError = (err: unknown) => (err instanceof ApiError ? err : new ApiError('internal', String(err)));

const fileOf = (a: Attachment): FileRef => ({
  id: a.id,
  name: a.file_name,
  mediaType: a.media_type,
  sizeBytes: a.size_bytes,
});

interface Progress {
  name: string;
  loaded: number;
  total: number;
  // Вложение, для которого выпускается новая версия; нет — новое вложение.
  target?: string;
}

// Раздел «Вложения» карточки задачи (CLAB-299): список, прикрепление
// перетаскиванием или выбором файла, новая версия, история версий, просмотр и
// «Скачать». Виден у задачи любого типа и в любом статусе — состояния задачи
// раздел не знает, а права прикреплять проверяет сервер: кнопки по уровню
// участника не прячутся.
export function Attachments({taskKey, refreshToken}: {taskKey: string; refreshToken: number}) {
  // Знак перезапроса приходит от карточки: действие на ней и опрос живой
  // аренды обновляют список вместе с остальным, своего таймера у раздела нет.
  const list = useResource(() => api.listAttachments(taskKey, true), [taskKey, refreshToken]);
  const instance = useInstance();
  const pickId = useId();
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<Progress>();
  const [failure, setFailure] = useState<{error: ApiError; target?: string}>();

  const groups = useMemo(() => groupVersions(list.data ?? []), [list.data]);
  const busy = progress !== undefined;

  // Один файл за раз; несколько файлов уходят по очереди и на первой ошибке
  // останавливаются: остальные не отправлены, и ошибка называет файл.
  const send = async (files: File[], supersedes?: Attachment) => {
    setFailure(undefined);
    for (const file of files) {
      const problem = fileLimitProblem(file.name, file.size, instance?.maxFileBytes);
      if (problem) {
        setFailure({error: new ApiError('invalid_input', problem), target: supersedes?.id});
        return;
      }
      setProgress({name: file.name, loaded: 0, total: file.size, target: supersedes?.id});
      try {
        const form = buildForm({title: file.name, supersedes_id: supersedes?.id}, file);
        await api.attachFile(taskKey, form, (loaded, total) =>
          setProgress({name: file.name, loaded, total, target: supersedes?.id}),
        );
        toast.success(supersedes ? `Новая версия «${file.name}» добавлена` : `Вложение «${file.name}» добавлено`);
        list.reload();
      } catch (err) {
        setFailure({error: toError(err), target: supersedes?.id});
        setProgress(undefined);
        return;
      }
    }
    setProgress(undefined);
  };

  if (list.error?.httpStatus === 404) {
    return (
      <Section title="Вложения">
        <div data-attachments="unavailable">
          <Note tone="warning" title="Вложения недоступны на этом сервере" />
        </div>
      </Section>
    );
  }

  return (
    <Section title="Вложения">
      <div className="space-y-3" data-attachments="ready">
        <div
          data-attachments-drop
          data-dragging={dragging || undefined}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!busy) void send(Array.from(e.dataTransfer.files));
          }}
          className={cn(
            'flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-3 text-sm transition-colors',
            dragging && 'border-ring bg-accent/50',
          )}>
          <Upload className="text-muted-foreground size-4" aria-hidden />
          <span className="text-muted-foreground">Перетащите файл сюда или</span>
          <FilePick
            id={pickId}
            label="Выбрать файл"
            disabled={busy}
            multiple
            onFiles={(files) => void send(files)}
          />
          {instance?.maxFileBytes ? (
            <span className="text-muted-foreground text-xs">до {formatBytes(instance.maxFileBytes)}</span>
          ) : null}
        </div>

        {progress && !progress.target ? <UploadProgress progress={progress} /> : null}
        {failure && !failure.target ? <Failure error={failure.error} title="Файл не отправлен" /> : null}

        {list.error ? <Failure error={list.error} reload={list.reload} title="Вложения не загрузились" /> : null}
        {!list.data && !list.error ? <Loading label="Загрузка вложений" /> : null}
        {list.data && groups.length === 0 ? (
          <p className="text-muted-foreground text-sm" data-attachments-empty>
            Вложений нет
          </p>
        ) : null}

        {groups.map(({current, history}) => (
          <AttachmentCard
            key={current.id}
            current={current}
            history={history}
            busy={busy}
            progress={progress?.target === current.id ? progress : undefined}
            error={failure?.target === current.id ? failure.error : undefined}
            onVersion={(file) => void send([file], current)}
          />
        ))}
      </div>
    </Section>
  );
}

function AttachmentCard({
  current,
  history,
  busy,
  progress,
  error,
  onVersion,
}: {
  current: Attachment;
  history: Attachment[];
  busy: boolean;
  progress?: Progress;
  error?: ApiError;
  onVersion: (file: File) => void;
}) {
  const versionId = useId();
  return (
    <div className="space-y-2 rounded-lg border p-3" data-attachment={current.id} data-attachment-name={current.file_name}>
      <AttachmentHead
        item={current}
        end={
          <FilePick
            id={versionId}
            label="Новая версия"
            disabled={busy}
            variant="ghost"
            onFiles={(files) => files[0] && onVersion(files[0])}
          />
        }
      />
      {progress ? <UploadProgress progress={progress} /> : null}
      {error ? <Failure error={error} title="Новая версия не отправлена" /> : null}
      <FileBody file={fileOf(current)} />
      {history.length > 0 ? (
        <Collapsible data-attachment-history={current.id}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="group -ml-2">
              <ChevronRight className="transition-transform group-data-[state=open]:rotate-90" />
              История версий ({history.length})
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-2">
            {history.map((prev) => (
              <div
                key={prev.id}
                className="space-y-2 border-l-2 pl-3"
                data-attachment-version={prev.id}>
                <AttachmentHead item={prev} />
                <FileBody file={fileOf(prev)} />
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}

function AttachmentHead({item, end}: {item: Attachment; end?: React.ReactNode}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2">
        <Token label={`v${item.version}`} />
        <div className="min-w-0">
          {/* Имя — как хранит сервер, без раскодирования: `a%22b.png` так и
              остаётся `a%22b.png`. */}
          <p className="text-sm font-medium break-all" data-attachment-title>
            <Paperclip className="text-muted-foreground mr-1 inline size-3.5" aria-hidden />
            {item.file_name || item.title}
          </p>
          {item.title && item.title !== item.file_name ? (
            <p className="text-muted-foreground text-xs break-all">{item.title}</p>
          ) : null}
          <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
            <span>{item.media_type || 'тип не указан'}</span>
            <span>{formatBytes(item.size_bytes)}</span>
            <span>{item.added_by}</span>
            <Timestamp value={item.added_at} format="relative" className="text-xs" />
          </p>
        </div>
      </div>
      {end ? <div className="shrink-0">{end}</div> : null}
    </div>
  );
}

function UploadProgress({progress}: {progress: Progress}) {
  const percent = progress.total > 0 ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : 0;
  return (
    <div className="space-y-1" data-attachments-progress>
      <p className="text-muted-foreground text-xs">
        Отправка «{progress.name}»: {percent}% ({formatBytes(progress.loaded)} из {formatBytes(progress.total)})
      </p>
      <div
        role="progressbar"
        aria-label={`Отправка «${progress.name}»`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="bg-muted h-1.5 overflow-hidden rounded-full">
        <div className="bg-primary h-full transition-[width]" style={{width: `${percent}%`}} />
      </div>
    </div>
  );
}

// Выбор файла: настоящий input type=file, скрытый только для глаз, и подпись
// label[for] в виде кнопки. Так выбор работает с клавиатуры (Tab на поле,
// Enter и пробел открывают диалог) и находится программами чтения с экрана и
// сквозными сценариями по подписи, а кольцо фокуса рисует подпись.
function FilePick({
  id,
  label,
  disabled,
  multiple,
  variant = 'secondary',
  onFiles,
}: {
  id: string;
  label: string;
  disabled?: boolean;
  multiple?: boolean;
  variant?: 'secondary' | 'ghost';
  onFiles: (files: File[]) => void;
}) {
  return (
    <>
      <input
        id={id}
        type="file"
        multiple={multiple}
        disabled={disabled}
        className="peer sr-only"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          // Тот же файл можно выбрать снова — после ошибки это и нужно.
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
      <label
        htmlFor={id}
        className={cn(
          buttonVariants({variant, size: 'sm'}),
          'cursor-pointer peer-focus-visible:border-ring peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50',
          disabled && 'pointer-events-none opacity-50',
        )}>
        {label}
      </label>
    </>
  );
}
