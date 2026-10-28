import {useState} from 'react';

import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {Tabs, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {FileInput, FormLayout, Selector, TextArea, TextInput} from '@/components/fields';

import {ApiError, api} from '../api/client';
import type {StageRun, TransitionOption} from '../api/types';
import {useResource} from '../api/useResource';
import {Failure} from './Feedback';
import {activeStageRun, buildForm, fileKinds, fileLimitProblem, formatBytes, roleVersionOf} from './task/attachmentRules';
import {useInstance} from '../hooks/useInstance';

// Виды артефактов, которых ждут гейты на выходе из текущего статуса. Список
// приходит из вердикта гейтов, а не из справочника в коде: чего именно не
// хватает, знает бэкенд.
function expectedKinds(transitions: TransitionOption[]): string[] {
  const kinds = new Set<string>();
  for (const t of transitions) {
    for (const gate of t.gates) {
      for (const kind of (gate.details?.required as string[]) ?? []) kinds.add(kind);
    }
  }
  return [...kinds];
}

type Mode = 'text' | 'file';

export function SubmitArtifactDialog({
  taskKey,
  projectKey,
  statusKey,
  stageRuns,
  transitions,
  onSubmitted,
}: {
  taskKey: string;
  projectKey: string;
  statusKey: string;
  stageRuns: StageRun[];
  transitions: TransitionOption[];
  onSubmitted: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('text');
  const [kind, setKind] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [file, setFile] = useState<File>();
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);
  const [percent, setPercent] = useState<number>();
  const instance = useInstance();

  // Контракт роли прогона — источник видов для файла (без видов со схемой). Он
  // нужен только в режиме «Файл» и только на открытом диалоге; роль читается
  // существующей ручкой, бэкенд для этого не менялся. Не прочиталась — виды
  // гейтов, как в режиме «Текст».
  const run = activeStageRun(statusKey, stageRuns);
  const role = useResource(
    () =>
      isOpen && mode === 'file' && run?.role_key
        ? api.getRole(projectKey, run.role_key).catch(() => undefined)
        : Promise.resolve(undefined),
    [isOpen, mode, projectKey, run?.role_key],
  );

  const gateKinds = expectedKinds(transitions);
  const kinds = mode === 'file' ? fileKinds(roleVersionOf(run, role.data?.versions), gateKinds) : gateKinds;

  const switchMode = (next: Mode) => {
    setMode(next);
    setKind('');
    setError(undefined);
  };

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (mode === 'file') {
        if (!file) return;
        const problem = fileLimitProblem(file.name, file.size, instance?.maxFileBytes);
        if (problem) {
          setError(new ApiError('invalid_input', problem));
          return;
        }
        setPercent(0);
        const form = buildForm({kind, title: title || kind, stage_run_id: run?.id}, file);
        await api.submitArtifactFile(taskKey, form, (loaded, total) =>
          setPercent(total ? Math.round((loaded / total) * 100) : 0),
        );
      } else {
        await api.submitArtifact(taskKey, {
          kind,
          title: title || kind,
          format: 'markdown',
          content,
        });
      }
      setIsOpen(false);
      setTitle('');
      setContent('');
      setFile(undefined);
      setKind('');
      onSubmitted();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    } finally {
      setBusy(false);
      setPercent(undefined);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">Сдать артефакт</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>Сдать артефакт</DialogTitle>
          <DialogDescription>Артефакт иммутабелен: правка сдаётся новой версией.</DialogDescription>
        </DialogHeader>
        {error ? <Failure error={error} title="Артефакт не принят" /> : null}
        <FormLayout>
          {/* Режим сдачи: текст строкой или файл. Файл уходит multipart-формой
              тем же маршрутом; уровень доступа проверяет сервер. */}
          <Tabs value={mode} onValueChange={(v) => switchMode(v as Mode)}>
            <TabsList>
              <TabsTrigger value="text">Текст</TabsTrigger>
              <TabsTrigger value="file">Файл</TabsTrigger>
            </TabsList>
          </Tabs>
          <Selector
            label="Вид"
            description={
              mode === 'file'
                ? kinds.length
                  ? 'Виды для файла: контракт роли этапа без видов со схемой, без контракта — виды гейтов'
                  : 'Подходящих видов нет'
                : kinds.length
                  ? 'Виды, которых ждут гейты этого статуса'
                  : 'Гейты ничего не требуют'
            }
            options={kinds.map((k) => ({value: k, label: k}))}
            value={kind}
            onChange={setKind}
            hasClear
          />
          <TextInput label="Название" value={title} onChange={setTitle} />
          {mode === 'file' ? (
            <FileInput
              label="Файл"
              description={
                instance?.maxFileBytes ? `До ${formatBytes(instance.maxFileBytes)}` : undefined
              }
              onChange={setFile}
              isRequired
            />
          ) : (
            <TextArea label="Содержимое" value={content} onChange={setContent} rows={12} isRequired />
          )}
          {percent !== undefined ? (
            <p className="text-muted-foreground text-xs" data-submit-progress>
              Отправка файла: {percent}%
            </p>
          ) : null}
        </FormLayout>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setIsOpen(false)}>
            Отмена
          </Button>
          <Button disabled={!kind || (mode === 'file' ? !file : !content) || busy} onClick={submit}>
            Сдать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
