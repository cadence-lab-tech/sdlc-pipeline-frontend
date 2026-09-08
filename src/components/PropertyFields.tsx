import {NumberInput, Selector, Switch, TextInput} from '@/components/fields';

import type {TaskPropertyDef} from '../api/types';

// Форма свойств задачи рисуется по определениям из API (task_property_defs),
// а не по захардкоженному списку полей: проект заводит свои свойства сам,
// а multi_repo — просто системное среди них.
export function PropertyField({
  def,
  value,
  onChange,
}: {
  def: TaskPropertyDef;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  switch (def.value_type) {
    case 'boolean':
      return (
        <Switch
          label={def.name}
          description={def.description}
          value={value === true}
          onChange={onChange}
        />
      );
    case 'number':
      return (
        <NumberInput
          label={def.name}
          description={def.description}
          value={typeof value === 'number' ? value : undefined}
          onChange={onChange}
        />
      );
    case 'enum':
      return (
        <Selector
          label={def.name}
          description={def.description}
          hasClear
          options={(def.enum_values ?? []).map((v) => ({value: v, label: v}))}
          value={typeof value === 'string' ? value : ''}
          onChange={(v) => onChange(v === '' ? undefined : v)}
        />
      );
    default:
      return (
        <TextInput
          label={def.name}
          description={def.description}
          value={typeof value === 'string' ? value : ''}
          onChange={onChange}
        />
      );
  }
}
