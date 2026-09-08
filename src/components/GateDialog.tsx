import {useState} from 'react';

import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {FormLayout, Selector, Switch, TextArea, TextInput} from '@/components/fields';

import {ApiError, api} from '../api/client';
import type {Gate, UUID} from '../api/types';
import {Failure} from './Feedback';

// Типы гейтов и подсказка по конфигурации каждого. Список типов — это то, что
// умеет движок; UI не считает вердикт, он только помогает не ошибиться в
// названиях полей.
const GATE_TYPES: {value: string; label: string; hint: string; example: unknown}[] = [
  {
    value: 'artifacts_required',
    label: 'Артефакты сданы',
    hint: 'Виды артефактов, без которых переход не пройдёт',
    example: {kinds: ['analysis.brief']},
  },
  {
    value: 'checklist',
    label: 'Чек-лист',
    hint: 'Пункты, которые отмечает человек или агент',
    example: {items: [{id: 'tests', text: 'Тесты прогнаны', required: true}]},
  },
  {
    value: 'human_approval',
    label: 'Апрув человеком',
    hint: 'Сколько независимых апрувов нужно',
    example: {min_approvals: 1},
  },
  {
    value: 'agent_review',
    label: 'Перепроверка другой ролью',
    hint: 'Роль-ревьюер и вид артефакта с вердиктом',
    example: {reviewer_role_key: 'reviewer', artifact_kind: 'review.verdict', pass_on: 'pass'},
  },
  {
    value: 'repo_ref_required',
    label: 'Ссылка на изменения',
    hint: 'Ветка, PR или коммит, привязанные к задаче',
    example: {ref_type: 'pull_request', min_count: 1, require_open: true},
  },
  {
    value: 'repo_scope',
    label: 'Область задачи соблюдена',
    hint: 'Артефакты не вышли за репозитории задачи',
    example: {allow_expansion_when_multi_repo: true},
  },
  {
    value: 'drift_clear',
    label: 'Дрейф не мешает',
    hint: 'С какой серьёзности сигнал дрейфа держит переход',
    example: {min_severity: 'high'},
  },
  {
    value: 'schema_validation',
    label: 'Артефакт по схеме',
    hint: 'Проверка структуры артефакта',
    example: {artifact_kind: 'analysis.brief'},
  },
  {
    value: 'external_check',
    label: 'Внешняя проверка',
    hint: 'Результат CI поверх GitHub Checks',
    example: {check_name: 'build'},
  },
];

export function GateDialog({
  workflowID,
  transitionKey,
  gate,
  isOpen,
  onClose,
  onSaved,
}: {
  workflowID: UUID;
  transitionKey: string;
  gate?: Gate;
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [key, setKey] = useState(gate?.key ?? '');
  const [name, setName] = useState(gate?.name ?? '');
  const [type, setType] = useState(gate?.type ?? 'artifacts_required');
  const [blocking, setBlocking] = useState(gate?.blocking ?? true);
  const [config, setConfig] = useState(JSON.stringify(gate?.config ?? {}, null, 2));
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);

  const meta = GATE_TYPES.find((t) => t.value === type);

  const pickType = (next: string) => {
    setType(next);
    // Конфиг у каждого типа свой, поэтому при смене типа подставляется образец
    // нового: пустой объект оставил бы гейт бессмысленным.
    if (!gate) {
      const example = GATE_TYPES.find((t) => t.value === next)?.example ?? {};
      setConfig(JSON.stringify(example, null, 2));
    }
  };

  const submit = async () => {
    let parsed: unknown;
    try {
      parsed = config.trim() ? JSON.parse(config) : {};
    } catch (err) {
      setError(new ApiError('invalid_input', `конфигурация не разбирается как JSON: ${String(err)}`));
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      const body = {key, name, type, blocking, config: parsed};
      if (gate) {
        await api.updateGate(workflowID, transitionKey, gate.key, body);
      } else {
        await api.createGate(workflowID, transitionKey, body);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{gate ? `Гейт ${gate.key}` : 'Новый гейт'}</DialogTitle>
        </DialogHeader>
        {error ? <Failure error={error} title="Гейт не сохранён" /> : null}
        <FormLayout>
          <TextInput
            label="Ключ"
            value={key}
            onChange={setKey}
            isDisabled={Boolean(gate)}
            isRequired
          />
          <TextInput label="Название" value={name} onChange={setName} isRequired />
          <Selector
            label="Тип"
            options={GATE_TYPES.map((t) => ({value: t.value, label: t.label}))}
            value={type}
            onChange={pickType}
          />
          <Switch
            label="Блокирующий"
            description="Неблокирующий гейт не держит переход, но виден в разборе"
            value={blocking}
            onChange={setBlocking}
          />
          <TextArea
            label="Конфигурация"
            description={meta?.hint}
            value={config}
            onChange={setConfig}
            rows={8}
          />
        </FormLayout>
        <p className="text-muted-foreground text-sm">
          Гейты типов, которых движок ещё не умеет, при активации всплывут предупреждением.
        </p>
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
