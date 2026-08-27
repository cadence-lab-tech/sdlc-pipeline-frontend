import type {TaskPropertyDef} from '../api/types';

// Значения по умолчанию берутся из определений проекта, а не из кода: список
// свойств задачи проект заводит сам.
export function defaultProperties(defs: TaskPropertyDef[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const def of defs) {
    if (def.default_value !== undefined) out[def.key] = def.default_value;
  }
  return out;
}
