import {useId, useState} from 'react';

import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import {Label} from '@/components/ui/label';
import {StatusDot, Token, type DotVariant} from '@/components/kit';

import type {Gate, GateCheck} from '../api/types';

// Вердикт по гейту считает бэкенд — фронтенд его показывает, а не пересчитывает.
const GATE_VARIANT: Record<GateCheck['status'], DotVariant> = {
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
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusDot variant={GATE_VARIANT[check.status]} label={GATE_STATUS[check.status]} />
          <span className="text-sm font-medium">{check.gate_name}</span>
        </div>
        <Token label={check.type} />
      </div>
      {check.reason ? <p className="text-muted-foreground text-sm">{check.reason}</p> : null}
      <GateDetails check={check} gate={gate} onDecide={onDecide} />
    </div>
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
        <div className="flex flex-wrap gap-1">
          {missing.map((kind) => (
            <Token key={kind} color="orange" label={kind} />
          ))}
        </div>
      ) : null;
    }

    case 'human_approval':
      return onDecide && check.status !== 'passed' ? (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => onDecide('passed')}>
            Апрув
          </Button>
          <Button size="sm" variant="destructive" onClick={() => onDecide('failed')}>
            Отклонить
          </Button>
        </div>
      ) : null;

    case 'checklist':
      return <Checklist gate={gate} check={check} onDecide={onDecide} />;

    case 'drift_clear': {
      const signals = (details.signals as {severity?: string; summary?: string}[]) ?? [];
      return signals.length ? (
        <div className="space-y-1 text-sm">
          {signals.map((s, i) => (
            <p key={i}>
              {s.severity}: {s.summary}
            </p>
          ))}
        </div>
      ) : null;
    }

    case 'repo_scope': {
      const scope = (details.scope as string[]) ?? [];
      return scope.length ? (
        <div className="flex flex-wrap gap-1">
          {scope.map((repo) => (
            <Token key={repo} label={repo} />
          ))}
        </div>
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
  const prefix = useId();
  const items = (gate?.config.items as {id: string; text: string; required?: boolean}[]) ?? [];
  const unchecked = new Set(
    ((check.details?.unchecked as {id: string}[]) ?? []).map((i) => i.id),
  );
  const [checked, setChecked] = useState<string[]>(() =>
    items.filter((i) => !unchecked.has(i.id)).map((i) => i.id),
  );

  if (items.length === 0) return null;

  const toggle = (id: string) =>
    setChecked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div className="space-y-2">
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-2">
            <Checkbox
              id={`${prefix}-${item.id}`}
              checked={checked.includes(item.id)}
              onCheckedChange={() => toggle(item.id)}
              className="mt-0.5"
            />
            <Label htmlFor={`${prefix}-${item.id}`} className="text-sm font-normal">
              {item.text}
            </Label>
          </li>
        ))}
      </ul>
      {onDecide ? (
        <Button size="sm" variant="secondary" onClick={() => onDecide('passed', {checked})}>
          Сохранить отметки
        </Button>
      ) : null}
    </div>
  );
}
