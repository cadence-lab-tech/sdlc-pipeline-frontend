import {useState} from 'react';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {FormLayout, Selector, Switch, TextInput} from '@/components/fields';

import {ApiError, api} from '../api/client';
import type {Status, Transition, UUID} from '../api/types';
import {Failure} from './Feedback';

// Виды перехода — перечень схемы: движок различает движение вперёд, откат и
// снятие задачи, но не знает, какие у проекта статусы.
const KINDS = [
  {value: 'advance', label: 'вперёд'},
  {value: 'reject', label: 'откат'},
  {value: 'cancel', label: 'снятие'},
  {value: 'reopen', label: 'возврат в работу'},
];

const ANY_STATUS = '__any__';

export function TransitionDialog({
  workflowID,
  transition,
  statuses,
  isOpen,
  onClose,
  onSaved,
}: {
  workflowID: UUID;
  transition?: Transition;
  statuses: Status[];
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const fromKey = transition
    ? (statuses.find((s) => s.id === transition.from_status_id)?.key ?? ANY_STATUS)
    : ANY_STATUS;

  const [key, setKey] = useState(transition?.key ?? '');
  const [name, setName] = useState(transition?.name ?? '');
  const [from, setFrom] = useState<string>(fromKey);
  const [to, setTo] = useState(
    transition ? (statuses.find((s) => s.id === transition.to_status_id)?.key ?? '') : '',
  );
  const [kind, setKind] = useState(transition?.kind ?? 'advance');
  const [auto, setAuto] = useState(transition?.auto ?? false);
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const body = {
        key,
        name,
        // null здесь осмыслен: переход из любого статуса, как снятие задачи.
        from_status: from === ANY_STATUS ? null : from,
        to_status: to,
        kind,
        auto,
      };
      if (transition) {
        await api.updateTransition(workflowID, transition.key, body);
      } else {
        await api.createTransition(workflowID, body);
      }
      toast.success(`Переход ${name} (${key}) сохранён`);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    } finally {
      setBusy(false);
    }
  };

  const statusOptions = statuses.map((s) => ({value: s.key, label: s.name}));

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{transition ? `Переход ${transition.key}` : 'Новый переход'}</DialogTitle>
        </DialogHeader>
        {error ? <Failure error={error} title="Переход не сохранён" /> : null}
        <FormLayout>
          <TextInput
            label="Ключ"
            value={key}
            onChange={setKey}
            isDisabled={Boolean(transition)}
            isRequired
          />
          <TextInput label="Название" value={name} onChange={setName} isRequired />
          <Selector
            label="Откуда"
            description="«Из любого статуса» — переход, доступный отовсюду"
            options={[{value: ANY_STATUS, label: 'из любого статуса'}, ...statusOptions]}
            value={from}
            onChange={(v) => setFrom(v || ANY_STATUS)}
          />
          <Selector label="Куда" options={statusOptions} value={to} onChange={setTo} hasClear />
          <Selector label="Вид" options={KINDS} value={kind} onChange={setKind} />
          <Switch
            label="Автоматический"
            description="Движок выполнит переход сам, как только гейты пройдут"
            value={auto}
            onChange={setAuto}
          />
        </FormLayout>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={!key || !name || !to || busy} onClick={submit}>
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
