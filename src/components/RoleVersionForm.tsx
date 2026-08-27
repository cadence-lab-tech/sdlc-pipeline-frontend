import {useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {FormLayout} from '@astryxdesign/core/FormLayout';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {Switch} from '@astryxdesign/core/Switch';
import {TextArea} from '@astryxdesign/core/TextArea';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Heading, Text} from '@astryxdesign/core/Text';

import {ApiError, api} from '../api/client';
import type {OutputContractItem, RoleVersion} from '../api/types';
import {Failure} from './Feedback';

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
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.createRoleVersion(projectKey, roleKey, {
        instructions,
        changelog: changelog || undefined,
        input_kinds: splitList(inputKinds),
        output_contract: contract,
        tool_policy: base?.tool_policy ?? {},
        repo_scope: base?.repo_scope ?? [],
        context_budget: base?.context_budget ?? {},
        model_hint: base?.model_hint,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding={4}>
      <VStack gap={4}>
        <Heading level={3}>
          Новая версия {base ? `после v${base.version}` : ''}
        </Heading>
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
          <TextInput
            label="Что изменилось"
            value={changelog}
            onChange={setChangelog}
          />
        </FormLayout>

        <ContractEditor items={contract} onChange={setContract} />

        <HStack gap={2} hAlign="end">
          <Button variant="ghost" label="Отмена" onClick={onCancel} />
          <Button
            variant="primary"
            label="Сохранить версию"
            isDisabled={!instructions || busy}
            onClick={submit}
          />
        </HStack>
      </VStack>
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
    <VStack gap={3}>
      <Text weight="medium">Контракт вывода</Text>
      {items.map((item, i) => (
        <HStack key={i} gap={2} vAlign="end" wrap="wrap">
          <TextInput
            label="Вид"
            value={item.kind}
            onChange={(kind) => patch(i, {kind})}
            width={220}
            isRequired
          />
          <TextInput
            label="Название"
            value={item.title ?? ''}
            onChange={(title) => patch(i, {title})}
            width={220}
          />
          <TextInput
            label="Формат"
            value={item.format ?? ''}
            onChange={(format) => patch(i, {format})}
            width={140}
          />
          <Switch
            label="Обязателен"
            value={item.required ?? false}
            onChange={(required) => patch(i, {required})}
          />
          <Button
            variant="ghost"
            size="sm"
            label="Убрать"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          />
        </HStack>
      ))}
      <HStack>
        <Button
          variant="secondary"
          size="sm"
          label="Добавить артефакт"
          onClick={() => onChange([...items, {kind: '', format: 'markdown', required: true}])}
        />
      </HStack>
    </VStack>
  );
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}
