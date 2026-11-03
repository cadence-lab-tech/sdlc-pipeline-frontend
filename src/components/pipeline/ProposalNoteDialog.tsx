// Диалог заметки к решению по предложению версии роли (CLAB-384): «Отклонить…»
// с обязательной заметкой автору и «Отозвать…» с необязательной. Не
// ConfirmButton: у того нет поля ввода, кроме точной фразы, а ошибка сервера
// должна оставить диалог открытым с введённой заметкой.
import {useRef, useState} from 'react';

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
import {Spinner} from '@/components/kit';
import {TextArea} from '@/components/fields';

import {ApiError} from '../../api/client';
import {Failure} from '../Feedback';

export type NoteKind = 'reject' | 'withdraw';

const COPY: Record<
  NoteKind,
  {trigger: string; confirm: string; field: string; hint: string; failure: string}
> = {
  reject: {
    trigger: 'Отклонить…',
    confirm: 'Отклонить',
    field: 'Заметка автору',
    hint: 'Обязательно: автор увидит заметку в предложении',
    failure: 'Предложение не отклонено',
  },
  withdraw: {
    trigger: 'Отозвать…',
    confirm: 'Отозвать',
    field: 'Заметка',
    hint: 'Необязательно',
    failure: 'Предложение не отозвано',
  },
};

const noteTitle = (kind: NoteKind, number: number) =>
  kind === 'reject' ? `Отклонить предложение #${number}?` : `Отозвать предложение #${number}?`;

const noteIntro = (kind: NoteKind, author: string) =>
  kind === 'reject'
    ? `Версия не заведётся. Заметка уйдёт автору — ${author}.`
    : 'Предложение закроется без версии. Заново — только новым предложением.';

export function ProposalNoteDialog({
  kind,
  number,
  author,
  variant = 'secondary',
  onSubmit,
  onClosed,
}: {
  kind: NoteKind;
  number: number;
  author: string;
  variant?: React.ComponentProps<typeof Button>['variant'];
  // Бросает ApiError: диалог остаётся открытым, заметка не теряется.
  onSubmit: (note: string) => Promise<void>;
  // Решение принято и диалог закрыт: кнопки, с которых его открыли, вот-вот
  // исчезнут, фокус переводит вызывающий.
  onClosed?: () => void;
}) {
  const copy = COPY[kind];
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError>();
  // После решения Radix не возвращает фокус на кнопку: её уже нет.
  const decided = useRef(false);

  const required = kind === 'reject';
  const canSubmit = !busy && (!required || note.trim() !== '');

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await onSubmit(note.trim());
      decided.current = true;
      setOpen(false);
      setNote('');
      onClosed?.();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    } finally {
      setBusy(false);
    }
  };

  const changeOpen = (next: boolean) => {
    if (busy) return;
    setOpen(next);
    // Закрыли и открыли снова — начинаем с чистого листа.
    if (!next) {
      setNote('');
      setError(undefined);
    }
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={variant} data-proposal-action={kind}>
          {copy.trigger}
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => busy && e.preventDefault()}
        onInteractOutside={(e) => busy && e.preventDefault()}
        onCloseAutoFocus={(e) => decided.current && e.preventDefault()}
        data-proposal-dialog={kind}>
        <DialogHeader>
          <DialogTitle>{noteTitle(kind, number)}</DialogTitle>
          <DialogDescription>{noteIntro(kind, author)}</DialogDescription>
        </DialogHeader>
        {error ? (
          <div role="alert" data-proposal-dialog-failure>
            <Failure error={error} title={copy.failure} />
          </div>
        ) : null}
        <TextArea label={copy.field} description={copy.hint} value={note} onChange={setNote} rows={3} isRequired={required} />
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => changeOpen(false)}>
            Отмена
          </Button>
          <Button variant="destructive" disabled={!canSubmit} onClick={() => void submit()} data-proposal-dialog-submit>
            {busy ? <Spinner /> : null}
            {copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
