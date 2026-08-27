import {useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {CheckboxList, CheckboxListItem} from '@astryxdesign/core/CheckboxList';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Text} from '@astryxdesign/core/Text';
import {Token} from '@astryxdesign/core/Token';

import type {Gate, GateCheck} from '../api/types';

// Вердикт по гейту считает бэкенд — фронтенд его показывает, а не пересчитывает.
const GATE_VARIANT: Record<GateCheck['status'], 'success' | 'warning' | 'error' | 'neutral'> = {
  passed: 'success',
  waived: 'success',
  pending: 'warning',
  failed: 'error',
  skipped: 'neutral',
};

const GATE_STATUS: Record<GateCheck['status'], string> = {
  passed: 'пройден',
  waived: 'отпущен',
  pending: 'ждёт',
  failed: 'не пройден',
  skipped: 'пропущен',
};

export function GateRow({
  check,
  gate,
  onDecide,
}: {
  check: GateCheck;
  // Определение гейта берётся из той версии цикла, по которой идёт задача.
  gate?: Gate;
  onDecide?: (status: string, details?: unknown) => void;
}) {
  return (
    <VStack gap={2}>
      <HStack gap={2} vAlign="center" hAlign="between">
        <HStack gap={2} vAlign="center">
          <StatusDot variant={GATE_VARIANT[check.status]} label={GATE_STATUS[check.status]} />
          <Text weight="medium">{check.gate_name}</Text>
        </HStack>
        <Token size="sm" label={check.type} />
      </HStack>
      {check.reason ? (
        <Text type="supporting" color="secondary">
          {check.reason}
        </Text>
      ) : null}
      <GateDetails check={check} gate={gate} onDecide={onDecide} />
    </VStack>
  );
}

// Детали рисуются по типу гейта, а не по позиции: типов много, конфиг у
// каждого свой, и новый тип не должен ломать разметку остальных.
function GateDetails({
  check,
  gate,
  onDecide,
}: {
  check: GateCheck;
  gate?: Gate;
  onDecide?: (status: string, details?: unknown) => void;
}) {
  const details = check.details ?? {};

  switch (check.type) {
    case 'artifacts_required': {
      const missing = (details.missing as string[]) ?? [];
      return missing.length ? (
        <HStack gap={1} wrap="wrap">
          {missing.map((kind) => (
            <Token key={kind} size="sm" color="orange" label={kind} />
          ))}
        </HStack>
      ) : null;
    }

    case 'human_approval':
      return onDecide && check.status !== 'passed' ? (
        <HStack gap={2}>
          <Button size="sm" variant="primary" label="Апрув" onClick={() => onDecide('passed')} />
          <Button
            size="sm"
            variant="destructive"
            label="Отклонить"
            onClick={() => onDecide('failed')}
          />
        </HStack>
      ) : null;

    case 'checklist':
      return <Checklist gate={gate} check={check} onDecide={onDecide} />;

    case 'drift_clear': {
      const signals = (details.signals as {severity?: string; summary?: string}[]) ?? [];
      return signals.length ? (
        <VStack gap={1}>
          {signals.map((s, i) => (
            <Text key={i} type="supporting">
              {s.severity}: {s.summary}
            </Text>
          ))}
        </VStack>
      ) : null;
    }

    case 'repo_scope': {
      const scope = (details.scope as string[]) ?? [];
      return scope.length ? (
        <HStack gap={1} wrap="wrap">
          {scope.map((repo) => (
            <Token key={repo} size="sm" label={repo} />
          ))}
        </HStack>
      ) : null;
    }

    default:
      return null;
  }
}

function Checklist({
  gate,
  check,
  onDecide,
}: {
  gate?: Gate;
  check: GateCheck;
  onDecide?: (status: string, details?: unknown) => void;
}) {
  const items = (gate?.config.items as {id: string; text: string; required?: boolean}[]) ?? [];
  const unchecked = new Set(
    ((check.details?.unchecked as {id: string}[]) ?? []).map((i) => i.id),
  );
  const [checked, setChecked] = useState<string[]>(() =>
    items.filter((i) => !unchecked.has(i.id)).map((i) => i.id),
  );

  if (items.length === 0) return null;

  return (
    <VStack gap={2}>
      <CheckboxList
        value={checked}
        onChange={setChecked}
        label={gate?.name ?? 'Чек-лист'}
        isLabelHidden>
        {items.map((item) => (
          <CheckboxListItem key={item.id} value={item.id} label={item.text} />
        ))}
      </CheckboxList>
      {onDecide ? (
        <Button
          size="sm"
          variant="secondary"
          label="Сохранить отметки"
          onClick={() => onDecide('passed', {checked})}
        />
      ) : null}
    </VStack>
  );
}
