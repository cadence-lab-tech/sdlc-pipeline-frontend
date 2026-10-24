import {useId, useState} from 'react';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {FormLayout, Switch, TextArea, TextInput} from '@/components/fields';

import {ApiError, api} from '../api/client';
import type {ModelLevel, OutputContractItem, RoleVersion} from '../api/types';
import {Failure} from './Feedback';
import {ModelLevelToggle} from './ModelLevelToggle';

// Новая версия роли заводится копией предыдущей: правка — это почти всегда
// «то же самое, но точнее», а не текст с нуля.
export function RoleVersionForm({
  projectKey,
  roleKey,
  base,
  onCreated,
  onCancel,
}: {
  projectKey: string;
  roleKey: string;
  base?: RoleVersion;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [instructions, setInstructions] = useState(base?.instructions ?? '');
  const [changelog, setChangelog] = useState('');
  const [inputKinds, setInputKinds] = useState((base?.input_kinds ?? []).join(', '));
  const [contract, setContract] = useState<OutputContractItem[]>(base?.output_contract ?? []);
  const [modelLevel, setModelLevel] = useState<ModelLevel | null>(base?.model_level ?? null);
  const levelLabel = useId();
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const created = await api.createRoleVersion(projectKey, roleKey, {
        instructions,
        changelog: changelog || undefined,
        input_kinds: splitList(inputKinds),
        output_contract: contract,
        tool_policy: base?.tool_policy ?? {},
        repo_scope: base?.repo_scope ?? [],
        context_budget: base?.context_budget ?? {},
        // model_hint устарел (решение 0060) и на экране не правится: значение
        // базовой версии уходит как было, иначе новая версия молча потеряла
        // бы его для раннеров прежних версий.
        model_hint: base?.model_hint,
        // «Авто» — версия без уровня: поле не уходит вовсе.
        model_level: modelLevel ?? undefined,
      });
      toast.success(`Версия ${created.version} роли ${roleKey} создана`);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="gap-4 p-4">
      <h3 className="text-base font-semibold">Новая версия {base ? `после v${base.version}` : ''}</h3>
      {error ? <Failure error={error} title="Версия не создана" /> : null}
      <FormLayout>
        <TextArea
          label="Инструкция"
          description="Что делает роль и по каким правилам"
          value={instructions}
          onChange={setInstructions}
          rows={14}
          isRequired
        />
        <TextInput
          label="Что читает на входе"
          description="Виды артефактов через запятую"
          value={inputKinds}
          onChange={setInputKinds}
        />
        <TextInput label="Что изменилось" value={changelog} onChange={setChangelog} />
        <div className="space-y-1.5">
          <p id={levelLabel} className="text-sm font-medium">
            Уровень модели
          </p>
          <ModelLevelToggle value={modelLevel} onChange={setModelLevel} labelledBy={levelLabel} />
          <p className="text-muted-foreground text-xs">
            Уровень роли по умолчанию: его перекрывают уровень задачи и этапа
          </p>
        </div>
      </FormLayout>

      <ContractEditor items={contract} onChange={setContract} />

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Отмена
        </Button>
        <Button disabled={!instructions || busy} onClick={submit}>
          Сохранить версию
        </Button>
      </div>
    </Card>
  );
}

// Вид артефакта (kind) — то, на что ссылается гейт artifacts_required, поэтому
// пункт контракта без него бессмыслен, и бэкенд такой не принимает.
function ContractEditor({
  items,
  onChange,
}: {
  items: OutputContractItem[];
  onChange: (items: OutputContractItem[]) => void;
}) {
  const patch = (index: number, next: Partial<OutputContractItem>) =>
    onChange(items.map((item, i) => (i === index ? {...item, ...next} : item)));

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Контракт вывода</p>
      {items.map((item, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
          <div className="w-55">
            <TextInput label="Вид" value={item.kind} onChange={(kind) => patch(i, {kind})} isRequired />
          </div>
          <div className="w-55">
            <TextInput label="Название" value={item.title ?? ''} onChange={(title) => patch(i, {title})} />
          </div>
          <div className="w-35">
            <TextInput label="Формат" value={item.format ?? ''} onChange={(format) => patch(i, {format})} />
          </div>
          <div className="pb-2">
            <Switch
              label="Обязателен"
              value={item.required ?? false}
              onChange={(required) => patch(i, {required})}
            />
          </div>
          <Button variant="ghost" size="sm" onClick={() => onChange(items.filter((_, j) => j !== i))}>
            Убрать
          </Button>
        </div>
      ))}
      <Button
        variant="secondary"
        size="sm"
        onClick={() => onChange([...items, {kind: '', format: 'markdown', required: true}])}>
        Добавить артефакт
      </Button>
    </div>
  );
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}
