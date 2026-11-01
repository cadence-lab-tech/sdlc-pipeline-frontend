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
import {optionalFields} from './optionalStage';
import {StatusDocsField} from './pipeline/StatusDocsField';
import {
  ALL,
  blocksSave,
  changeCheckers,
  changePrimary,
  rolesBody,
  selectionsFromStatus,
  type StatusSelections,
} from './pipeline/statusDocs';
import {useRoleDocs} from '../hooks/useRoleDocs';

// Категория статуса — фиксированный перечень схемы, а не выдумка проекта:
// по ней движок и доска понимают, чем статус является.
const CATEGORIES = ['backlog', 'active', 'waiting', 'done', 'cancelled'].map((c) => ({
  value: c,
  label: c,
}));

export function StatusDialog({
  projectKey,
  workflowID,
  status,
  roles,
  isOpen,
  onClose,
  onSaved,
}: {
  projectKey: string;
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
  const [isOptional, setIsOptional] = useState(status?.is_optional ?? false);
  const [enabledByDefault, setEnabledByDefault] = useState(status?.enabled_by_default ?? true);
  const [wipLimit, setWipLimit] = useState<number | undefined>(status?.wip_limit);
  const [color, setColor] = useState(status?.color ?? '');
  const [primaryRole, setPrimaryRole] = useState(
    status?.roles?.find((r) => r.is_primary)?.role_key ?? '',
  );
  const [checkers, setCheckers] = useState(
    (status?.roles ?? []).filter((r) => !r.is_primary).map((r) => r.role_key),
  );
  // Отбор документов у исполнителя и у каждого проверяющего (CLAB-348).
  // Начальное — сохранённое на статусе: отбор неизменённых ролей уходит в
  // запросе снова, иначе правка названия стёрла бы его.
  const [selections, setSelections] = useState<StatusSelections>(() => selectionsFromStatus(status));
  const checkerKeys = checkers.filter((r) => r !== primaryRole);
  const roleDocs = useRoleDocs(projectKey, [primaryRole, ...checkerKeys]);
  const docsOf = (key: string) => {
    const d = roleDocs[key];
    return d?.state === 'ok' ? d.documents : undefined;
  };
  const choosePrimary = (next: string) => {
    setSelections((prev) => changePrimary(prev, primaryRole, next));
    setPrimaryRole(next);
  };
  const chooseCheckers = (next: string[]) => {
    setSelections((prev) => changeCheckers(prev, next));
    setCheckers(next);
  };
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    let saved: Status | undefined;
    try {
      const body = {
        key,
        name,
        description: description || undefined,
        category,
        is_initial: isInitial,
        is_terminal: isTerminal,
        // Пара уходит всегда и явно; умолчание сводит optionalFields.
        ...optionalFields(isOptional, enabledByDefault),
        wip_limit: wipLimit,
        color: color || undefined,
      };
      saved = status
        ? await api.updateStatus(workflowID, status.key, body)
        : await api.createStatus(workflowID, body);

      // Роли ставятся отдельным запросом: их набор — не поле статуса, а связь,
      // и на статусе может быть один исполнитель и несколько проверяющих.
      // Запрос описывает набор целиком, с отбором документов у каждой роли.
      await api.setStatusRoles(workflowID, saved.key, rolesBody(primaryRole, checkers, selections, docsOf));

      toast.success(`Статус ${saved.name} (${saved.key}) сохранён`);
      onSaved();
      onClose();
    } catch (err) {
      // Статус мог сохраниться, а роли — нет: список всё равно перечитывается,
      // иначе сохранённая отметка видна только после перезагрузки. Диалог
      // остаётся открытым с ошибкой. Для нового статуса повторное сохранение
      // дало бы «ключ занят», но это ответ сервера, и он виден в диалоге.
      if (saved) onSaved();
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    } finally {
      setBusy(false);
    }
  };

  const options = roles.map((r) => ({value: r.key, label: r.name}));
  const roleName = (key: string) =>
    roles.find((r) => r.key === key)?.name ?? status?.roles?.find((r) => r.role_key === key)?.role_name ?? key;

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
            onChange={choosePrimary}
          />
          {primaryRole ? (
            <StatusDocsField
              roleKey={primaryRole}
              roleName={roleName(primaryRole)}
              slot="primary"
              selection={selections.primary}
              docs={roleDocs[primaryRole]}
              onChange={(primary) => setSelections((prev) => ({...prev, primary}))}
            />
          ) : null}
          <MultiSelector
            label="Проверяющие"
            value={checkers}
            onChange={chooseCheckers}
            options={options}
          />
          {checkerKeys.map((key) => (
            <StatusDocsField
              key={key}
              roleKey={key}
              roleName={roleName(key)}
              slot="checker"
              selection={selections.checkers[key] ?? ALL}
              docs={roleDocs[key]}
              onChange={(sel) => setSelections((prev) => ({...prev, checkers: {...prev.checkers, [key]: sel}}))}
            />
          ))}
          <NumberInput label="Лимит задач в колонке" value={wipLimit} onChange={setWipLimit} />
          <TextInput
            label="Цвет колонки"
            description="CSS-цвет; пусто — нейтральный из темы"
            value={color}
            onChange={setColor}
          />
          <Switch label="Начальный" value={isInitial} onChange={setIsInitial} />
          <Switch label="Терминальный" value={isTerminal} onChange={setIsTerminal} />
          <Switch
            label="Необязательный"
            description="Задача может не проходить этот этап; правила проверяет сервер при активации"
            value={isOptional}
            onChange={setIsOptional}
          />
          {isOptional ? (
            <Switch
              label="Включён по умолчанию"
              description="Выключенный по умолчанию этап задача проходит, только если его включили"
              value={enabledByDefault}
              onChange={setEnabledByDefault}
            />
          ) : null}
        </FormLayout>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={!key || !name || busy || blocksSave(primaryRole, checkers, selections)} onClick={submit}>
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
