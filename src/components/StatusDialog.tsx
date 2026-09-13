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
import {
  FormLayout,
  MultiSelector,
  NumberInput,
  Selector,
  Switch,
  TextArea,
  TextInput,
} from '@/components/fields';

import {ApiError, api} from '../api/client';
import type {Role, Status, UUID} from '../api/types';
import {Failure} from './Feedback';

// Категория статуса — фиксированный перечень схемы, а не выдумка проекта:
// по ней движок и доска понимают, чем статус является.
const CATEGORIES = ['backlog', 'active', 'waiting', 'done', 'cancelled'].map((c) => ({
  value: c,
  label: c,
}));

export function StatusDialog({
  workflowID,
  status,
  roles,
  isOpen,
  onClose,
  onSaved,
}: {
  workflowID: UUID;
  status?: Status;
  roles: Role[];
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [key, setKey] = useState(status?.key ?? '');
  const [name, setName] = useState(status?.name ?? '');
  const [description, setDescription] = useState(status?.description ?? '');
  const [category, setCategory] = useState(status?.category ?? 'active');
  const [isInitial, setIsInitial] = useState(status?.is_initial ?? false);
  const [isTerminal, setIsTerminal] = useState(status?.is_terminal ?? false);
  const [wipLimit, setWipLimit] = useState<number | undefined>(status?.wip_limit);
  const [color, setColor] = useState(status?.color ?? '');
  const [primaryRole, setPrimaryRole] = useState(
    status?.roles?.find((r) => r.is_primary)?.role_key ?? '',
  );
  const [checkers, setCheckers] = useState(
    (status?.roles ?? []).filter((r) => !r.is_primary).map((r) => r.role_key),
  );
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const body = {
        key,
        name,
        description: description || undefined,
        category,
        is_initial: isInitial,
        is_terminal: isTerminal,
        wip_limit: wipLimit,
        color: color || undefined,
      };
      const saved = status
        ? await api.updateStatus(workflowID, status.key, body)
        : await api.createStatus(workflowID, body);

      // Роли ставятся отдельным запросом: их набор — не поле статуса, а связь,
      // и на статусе может быть один исполнитель и несколько проверяющих.
      await api.setStatusRoles(workflowID, saved.key, [
        ...(primaryRole ? [{role: primaryRole, is_primary: true, position: 0}] : []),
        ...checkers
          .filter((r) => r !== primaryRole)
          .map((role, i) => ({role, is_primary: false, position: i + 1})),
      ]);

      toast.success(`Статус ${saved.name} (${saved.key}) сохранён`);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    } finally {
      setBusy(false);
    }
  };

  const options = roles.map((r) => ({value: r.key, label: r.name}));

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{status ? `Статус ${status.key}` : 'Новый статус'}</DialogTitle>
        </DialogHeader>
        {error ? <Failure error={error} title="Статус не сохранён" /> : null}
        <FormLayout>
          <TextInput
            label="Ключ"
            description="Постоянный идентификатор статуса внутри цикла"
            value={key}
            onChange={setKey}
            isDisabled={Boolean(status)}
            isRequired
          />
          <TextInput label="Название" value={name} onChange={setName} isRequired />
          <TextArea label="Описание" value={description} onChange={setDescription} rows={2} />
          <Selector label="Категория" options={CATEGORIES} value={category} onChange={setCategory} />
          <Selector
            label="Исполнитель"
            description="Роль, которая работает на этом статусе"
            options={options}
            value={primaryRole}
            hasClear
            onChange={setPrimaryRole}
          />
          <MultiSelector
            label="Проверяющие"
            value={checkers}
            onChange={setCheckers}
            options={options}
          />
          <NumberInput label="Лимит задач в колонке" value={wipLimit} onChange={setWipLimit} />
          <TextInput
            label="Цвет колонки"
            description="CSS-цвет; пусто — нейтральный из темы"
            value={color}
            onChange={setColor}
          />
          <Switch label="Начальный" value={isInitial} onChange={setIsInitial} />
          <Switch label="Терминальный" value={isTerminal} onChange={setIsTerminal} />
        </FormLayout>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={!key || !name || busy} onClick={submit}>
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
