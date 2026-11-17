import {useState} from 'react';
import {toast} from 'sonner';

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
import {FormLayout, MultiSelector, Selector, TextInput, type Option} from '@/components/fields';

import {ApiError} from '../../api/client';
import {Failure} from '../Feedback';
import {LEVELS} from './options';

// Диалог «принципал или команда + уровень + роли специалистов» (CLAB-39):
// «Добавить участника» и «Пустить команду» отличаются только подписями и
// вызовом. Поля живут в форме внутри содержимого диалога, поэтому закрытие
// забывает введённое. Пока идёт запрос, диалог не закрывается ни Esc, ни
// кликом мимо, ни крестиком. Отказ сервера — Failure над полями, поля на
// месте; кнопки по уровню доступа не отключаются (решение 0021).
export function LevelDialog({
  trigger,
  title,
  description,
  failTitle,
  targetLabel,
  targetHint,
  rolesHint,
  roleOptions,
  save,
  savedText,
  onSaved,
}: {
  trigger: string;
  title: string;
  description: string;
  failTitle: string;
  targetLabel: string;
  targetHint: string;
  rolesHint: string;
  roleOptions: Option[];
  save: (target: string, level: string, roleKeys: string[]) => Promise<unknown>;
  savedText: (target: string) => string;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return;
        setOpen(next);
      }}>
      <DialogTrigger asChild>
        <Button size="sm">{trigger}</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <LevelForm
          busy={busy}
          setBusy={setBusy}
          failTitle={failTitle}
          targetLabel={targetLabel}
          targetHint={targetHint}
          rolesHint={rolesHint}
          roleOptions={roleOptions}
          save={save}
          savedText={savedText}
          onDone={() => {
            setOpen(false);
            onSaved();
          }}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function LevelForm({
  busy,
  setBusy,
  failTitle,
  targetLabel,
  targetHint,
  rolesHint,
  roleOptions,
  save,
  savedText,
  onDone,
  onCancel,
}: {
  busy: boolean;
  setBusy: (busy: boolean) => void;
  failTitle: string;
  targetLabel: string;
  targetHint: string;
  rolesHint: string;
  roleOptions: Option[];
  save: (target: string, level: string, roleKeys: string[]) => Promise<unknown>;
  savedText: (target: string) => string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [target, setTarget] = useState('');
  const [level, setLevel] = useState('viewer');
  const [roleKeys, setRoleKeys] = useState<string[]>([]);
  const [error, setError] = useState<ApiError>();

  const submit = async () => {
    const who = target.trim();
    if (who === '' || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await save(who, level, roleKeys);
      toast.success(savedText(who));
      setBusy(false);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}>
      {error ? <Failure error={error} title={failTitle} /> : null}
      <FormLayout>
        <TextInput label={targetLabel} description={targetHint} value={target} onChange={setTarget} />
        <Selector label="Уровень" options={LEVELS} value={level} onChange={setLevel} />
        <MultiSelector
          label="Роли специалиста"
          description={rolesHint}
          options={roleOptions}
          value={roleKeys}
          onChange={setRoleKeys}
          placeholder="Любые роли"
        />
      </FormLayout>
      <DialogFooter>
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          Отмена
        </Button>
        <Button type="submit" disabled={busy || target.trim() === ''}>
          Сохранить
        </Button>
      </DialogFooter>
    </form>
  );
}
