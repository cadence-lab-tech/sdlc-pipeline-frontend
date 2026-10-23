import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';

import type {ModelLevel} from '../api/types';
import {AUTO_LABEL, MODEL_LEVELS, modelLevelLabel} from './modelLevel';

const AUTO = 'auto';

// Ползунок уровня модели: «авто», low, medium, high (решение 0060). Один на
// задачу, версию роли и — в CLAB-231 — этап. «Авто» — отсутствие уровня:
// компонент отдаёт null, а "" в запросе ставит вызывающий.
//
// Положений четыре и все видны сразу, поэтому это группа переключателей, а не
// слайдер: выбор одним кликом, клавиатура и роль radio — от Radix.
export function ModelLevelToggle({
  value,
  onChange,
  disabled = false,
  busy = false,
  label,
  labelledBy,
  title,
}: {
  value: ModelLevel | null | undefined;
  onChange: (level: ModelLevel | null) => void;
  disabled?: boolean;
  // Запрос идёт: ползунок занят, но положение видно.
  busy?: boolean;
  // Подпись для программ чтения с экрана, если видимой подписи рядом нет.
  label?: string;
  labelledBy?: string;
  // Всплывающая подсказка ко всему ползунку — например, почему он выключен.
  // Отдельной строки на экране у выключенного ползунка нет.
  title?: string;
}) {
  const current = value ?? AUTO;
  return (
    // data-model-level оформления не несёт — это опора для сквозных
    // сценариев: по нему они видят положение, не разбирая классы.
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      spacing={0}
      value={current}
      disabled={disabled || busy}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-busy={busy || undefined}
      title={title}
      data-model-level={current}
      // Повторный клик по выбранному положению Radix превращает в «ничего не
      // выбрано» — это не смена уровня, а холостой клик.
      onValueChange={(next) => {
        if (!next || next === current) return;
        onChange(next === AUTO ? null : (next as ModelLevel));
      }}>
      <ToggleGroupItem value={AUTO} data-level={AUTO}>
        {AUTO_LABEL}
      </ToggleGroupItem>
      {MODEL_LEVELS.map((level) => (
        <ToggleGroupItem key={level} value={level} data-level={level}>
          {modelLevelLabel(level)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
