import {useId, useRef, useState} from 'react';
import {TriangleAlert} from 'lucide-react';
import {toast} from 'sonner';

import {cn} from '@/lib/utils';
import {Alert, AlertDescription, AlertTitle} from '@/components/ui/alert';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {Skeleton} from '@/components/ui/skeleton';
import {FormLayout, TextArea, TextInput} from '@/components/fields';
import {Spinner, Token} from '@/components/kit';

import {ApiError, api} from '../../api/client';
import type {Task, TaskRights, Workflow} from '../../api/types';
import {Failure} from '../Feedback';
import {OPTIONAL_LABEL} from '../optionalStage';
import {
  MOVE_BUTTON,
  MOVE_DISABLED_NOTE,
  confirmMismatch,
  moveBody,
  moveEffect,
  moveMissing,
  moveMissingLine,
  moveStatuses,
  type MoveStatusRow,
} from './moveRights';

// Перевод в статус вне цикла (CLAB-407, design.spec): отдельная строка блока
// «Действия», не часть строки перехода. Показывается, только когда сервер
// разрешил (`actor_rights.move`, решает родитель по moveAllowed). Гейты при
// переводе не проверяются, текущий исполнитель теряет аренду — об этом
// предупреждает сам диалог; отказ сервера показывается его собственным текстом.
export function MoveEntry({
  task,
  workflow,
  workflowError,
  workflowReload,
  rights,
  onChanged,
}: {
  task: Task;
  workflow?: Workflow;
  // Ошибка загрузки версии цикла задачи и повтор: диалог открывается и без
  // версии, состояние показывает он сам.
  workflowError?: ApiError;
  workflowReload?: () => void;
  rights?: TaskRights;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Отправка идёт: диалог не закрывается ни Esc, ни кликом вне его.
  const [busy, setBusy] = useState(false);
  // Уход по ссылке «Выбор этапов»: фокус после закрытия идёт не на кнопку входа.
  const leaving = useRef(false);
  return (
    <Card className="gap-2 p-3" data-move-entry>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">Вне цикла</p>
          <p className="text-muted-foreground truncate text-xs">Гейты не проверяются</p>
        </div>
        <Dialog open={open} onOpenChange={(next) => (next || !busy) && setOpen(next)}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" aria-haspopup="dialog" data-move-open>
              {MOVE_BUTTON}
            </Button>
          </DialogTrigger>
          {/* Radix монтирует содержимое при открытии: закрытие забывает выбор,
              причину и ключ. */}
          <DialogContent
            className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-[520px]"
            showCloseButton={!busy}
            data-move-dialog
            onEscapeKeyDown={(e) => busy && e.preventDefault()}
            onInteractOutside={(e) => busy && e.preventDefault()}
            onCloseAutoFocus={(e) => {
              if (leaving.current) {
                leaving.current = false;
                e.preventDefault();
              }
            }}>
            <MoveForm
              task={task}
              workflow={workflow}
              workflowError={workflowError}
              workflowReload={workflowReload}
              rights={rights}
              busy={busy}
              setBusy={setBusy}
              leavingRef={leaving}
              onClose={() => setOpen(false)}
              onChanged={onChanged}
            />
          </DialogContent>
        </Dialog>
      </div>
    </Card>
  );
}

function MoveForm({
  task,
  workflow,
  workflowError,
  workflowReload,
  rights,
  busy,
  setBusy,
  leavingRef,
  onClose,
  onChanged,
}: {
  task: Task;
  workflow?: Workflow;
  workflowError?: ApiError;
  workflowReload?: () => void;
  rights?: TaskRights;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  leavingRef: {current: boolean};
  onClose: () => void;
  onChanged: () => void;
}) {
  const [selected, setSelected] = useState<string>();
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<ApiError>();
  const groupId = useId();
  const missingId = useId();

  const statuses = workflow?.statuses;
  const rows = moveStatuses(statuses, task, rights);
  const current = statuses?.find((s) => s.key === task.status_key);
  const missing = moveMissing({selected, reason, confirm, taskKey: task.key});
  const ready = missing.length === 0;
  const effect = moveEffect(task, statuses, selected);

  const submit = async () => {
    if (!ready || busy || !selected) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.move(task.key, moveBody(selected, reason));
      const name = statuses?.find((s) => s.key === result.task.status_key)?.name ?? result.task.status_name;
      toast.success(`Задача переведена в «${name}»`);
      onChanged();
      setBusy(false);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
      setBusy(false);
    }
  };

  const toStages = () => {
    leavingRef.current = true;
    onClose();
    // Диалог уходит из разметки в тот же такт; переключатели «Деталей» — снаружи.
    setTimeout(() => {
      const stages = document.querySelector<HTMLElement>('[data-task-stages]');
      stages?.scrollIntoView({block: 'center'});
      stages?.querySelector<HTMLElement>('button, input, [role="switch"]')?.focus();
    }, 0);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{MOVE_BUTTON}</DialogTitle>
        <DialogDescription className="[overflow-wrap:anywhere]">
          {task.key} · {task.title}. Сейчас: {current?.name ?? task.status_name ?? task.status_key}
        </DialogDescription>
      </DialogHeader>

      {workflowError && !workflow ? (
        <div data-move-load-error>
          <Failure error={workflowError} title="Не получилось загрузить статусы" reload={workflowReload} />
        </div>
      ) : !workflow ? (
        <div role="status" className="space-y-2" data-move-loading>
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <p className="text-muted-foreground text-xs">Загружаем статусы цикла задачи…</p>
        </div>
      ) : (
        <FormLayout>
          <fieldset className="space-y-1.5" disabled={busy} data-move-statuses>
            <legend className="mb-1.5 text-sm leading-none font-medium">
              Новый статус<span className="text-muted-foreground"> *</span>
            </legend>
            <div className="max-h-60 divide-y overflow-y-auto rounded-lg border">
              {rows.map((row) => (
                <StatusRow
                  key={row.key}
                  row={row}
                  group={groupId}
                  checked={selected === row.key}
                  onSelect={() => setSelected(row.key)}
                  onStages={toStages}
                  busy={busy}
                />
              ))}
            </div>
            <p className="text-muted-foreground min-h-4 text-xs" aria-live="polite" data-move-effect>
              {effect}
            </p>
          </fieldset>

          <TextArea
            id="move-reason"
            label="Причина"
            rows={3}
            isRequired
            isDisabled={busy}
            placeholder="Например: требования неверны, см. комментарий"
            description="Попадёт в ленту задачи и в пометку попытки этапа."
            value={reason}
            onChange={setReason}
          />

          <Alert
            role="note"
            className="border-amber-500/40 bg-amber-500/10"
            data-move-warning>
            <TriangleAlert className="text-amber-700 dark:text-amber-300" />
            <AlertTitle className="text-amber-700 dark:text-amber-300">Это не обычный переход</AlertTitle>
            <AlertDescription>
              Гейты не проверяются, текущий исполнитель потеряет аренду. Артефакты и прежние попытки останутся на месте.
            </AlertDescription>
          </Alert>

          <TextInput
            id="move-confirm"
            label={`Введите ${task.key}, чтобы подтвердить`}
            value={confirm}
            onChange={setConfirm}
            onEnter={submit}
            isDisabled={busy}
            description={
              confirmMismatch(task.key, confirm) ? (
                <span data-move-mismatch>Ключ не совпадает с {task.key}</span>
              ) : undefined
            }
          />

          {error ? (
            <div data-move-error>
              <Failure error={error} title="Перевод не выполнен" />
            </div>
          ) : null}
        </FormLayout>
      )}

      <div className="text-muted-foreground min-h-4 text-right text-xs" id={missingId} data-move-missing>
        {workflow && !ready ? moveMissingLine(missing) : null}
      </div>
      <DialogFooter className="[&>button]:h-9">
        <Button variant="ghost" onClick={onClose} disabled={busy} data-move-cancel>
          Отмена
        </Button>
        <Button
          onClick={submit}
          disabled={!workflow || !ready || busy}
          aria-busy={busy}
          aria-describedby={missingId}
          data-move-submit>
          {busy ? (
            <>
              <Spinner /> Переводим…
            </>
          ) : (
            'Перевести'
          )}
        </Button>
      </DialogFooter>
    </>
  );
}

function StatusRow({
  row,
  group,
  checked,
  onSelect,
  onStages,
  busy,
}: {
  row: MoveStatusRow;
  group: string;
  checked: boolean;
  onSelect: () => void;
  onStages: () => void;
  busy: boolean;
}) {
  return (
    <div
      className={cn(checked && 'bg-accent shadow-[inset_3px_0_0_0_var(--color-primary)]')}
      data-move-status={row.key}
      data-disabled={row.disabled ? '' : undefined}>
      <label
        className={cn(
          'flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm',
          row.disabled && 'text-muted-foreground cursor-not-allowed',
        )}>
        <input
          type="radio"
          name={group}
          value={row.key}
          checked={checked}
          disabled={row.disabled || busy}
          onChange={onSelect}
          className="accent-primary size-4 shrink-0"
        />
        <span className="min-w-0 flex-1">
          <span className="font-medium [overflow-wrap:anywhere]">{row.name}</span>{' '}
          <span className="text-muted-foreground font-mono text-xs [overflow-wrap:anywhere]">{row.key}</span>
        </span>
        <span className="flex shrink-0 flex-wrap justify-end gap-1">
          {row.current ? <Token label="сейчас" color="blue" /> : null}
          {row.terminal ? <Token label="завершающий" /> : null}
          {row.optional ? <Token label={OPTIONAL_LABEL} color="orange" /> : null}
        </span>
      </label>
      {row.disabled && row.note ? (
        <p className="text-muted-foreground px-3 pb-2 pl-10 text-xs" data-move-disabled-note={row.note.kind}>
          {MOVE_DISABLED_NOTE} ·{' '}
          {row.note.kind === 'link' ? (
            <button
              type="button"
              className="underline underline-offset-4"
              onClick={onStages}
              disabled={busy}
              data-move-stages-link>
              {row.note.text}
            </button>
          ) : (
            row.note.text
          )}
        </p>
      ) : null}
    </div>
  );
}
