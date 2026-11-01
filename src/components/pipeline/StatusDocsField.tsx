// Поле «Документы роли на этом этапе» в диалоге статуса (CLAB-348): «Все» или
// «Выбранные» с отметками по документам последней версии роли. Правила —
// statusDocs.ts; поле только рисует и отдаёт новое состояние.
import {useId} from 'react';

import {Checkbox} from '@/components/ui/checkbox';
import {Label} from '@/components/ui/label';
import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';
import {Badge} from '@/components/ui/badge';
import {Spinner} from '@/components/kit';

import {
  EMPTY_PICK_HINT,
  FIELD_LABEL,
  MISSING_MARK,
  MODE_LABEL,
  type Selection,
  type SelectionMode,
  isEmptyPick,
  pickOptions,
  toggleName,
  withMode,
} from './statusDocs';
import type {RoleDocsState} from '../../hooks/useRoleDocs';

export function StatusDocsField({
  roleKey,
  roleName,
  slot,
  selection,
  docs,
  onChange,
}: {
  roleKey: string;
  roleName: string;
  slot: 'primary' | 'checker';
  selection: Selection;
  docs: RoleDocsState | undefined;
  onChange: (s: Selection) => void;
}) {
  const id = useId();
  const loaded = docs?.state === 'ok' ? docs.documents : undefined;
  const options = pickOptions(loaded, selection);
  const empty = isEmptyPick(selection);
  return (
    <div
      className="space-y-2 rounded-md border p-3"
      role="group"
      aria-labelledby={`${id}-label`}
      data-status-docs={roleKey}
      data-status-docs-slot={slot}
      data-status-docs-mode={selection.mode}>
      <p id={`${id}-label`} className="text-sm font-medium">
        {FIELD_LABEL} · {roleName}
      </p>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={selection.mode}
        aria-label={`${FIELD_LABEL}: ${roleName}`}
        // Повторный клик по выбранному положению Radix превращает в «ничего не
        // выбрано» — это не смена режима.
        onValueChange={(next) => {
          if (!next || next === selection.mode) return;
          onChange(withMode(selection, next as SelectionMode));
        }}>
        {(['all', 'picked'] as const).map((m) => (
          <ToggleGroupItem key={m} value={m} data-status-docs-option={m}>
            {MODE_LABEL[m]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {selection.mode === 'picked' ? (
        <div className="space-y-1.5">
          {docs?.state === 'loading' ? (
            <p className="text-muted-foreground flex items-center gap-2 text-xs" data-status-docs-loading>
              <Spinner className="size-3" /> Документы роли загружаются
            </p>
          ) : null}
          {docs?.state === 'error' ? (
            <p className="text-destructive text-xs" data-status-docs-error>
              Документы роли не загрузились: {docs.message}
            </p>
          ) : null}
          {docs?.state === 'ok' ? (
            <p className="text-muted-foreground text-xs">
              Документы последней версии роли (v{docs.version}) по порядку выдачи
            </p>
          ) : null}
          <ul className="space-y-1">
            {options.map((o, i) => {
              const cid = `${id}-doc-${i}`;
              return (
                <li
                  key={o.name}
                  className="flex min-w-0 items-center gap-2"
                  data-status-doc={o.name}
                  data-status-doc-missing={o.missing || undefined}>
                  <Checkbox
                    id={cid}
                    checked={o.checked}
                    // Отсутствующее имя можно только снять: снятое пропадает
                    // из списка — этап его всё равно не получил бы.
                    onCheckedChange={() => onChange(toggleName(selection, o.name))}
                  />
                  <Label htmlFor={cid} className="min-w-0 font-mono text-xs font-normal break-all">
                    {o.name}
                  </Label>
                  {o.missing ? (
                    <Badge variant="outline" className="text-destructive shrink-0 font-normal">
                      {MISSING_MARK}
                    </Badge>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {empty ? (
            <p className="text-destructive text-xs" data-status-docs-empty>
              {EMPTY_PICK_HINT}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
