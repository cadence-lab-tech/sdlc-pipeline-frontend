import type {ProjectDetail} from '../api/types';

// Тип задачи выбирает цикл, по которому она пойдёт (решение 0024). Типы — это
// данные проекта: они складываются из действующих циклов и перечисления
// системного свойства `type`, а не берутся списком из кода. Цикл может вести
// несколько типов, а тип может быть объявлен раньше, чем под него заведён
// цикл, — поэтому объединение, а не один источник.
export function taskTypes(project: ProjectDetail): string[] {
  const out = new Set<string>();
  for (const wf of project.active_workflows) {
    for (const type of wf.task_types ?? []) out.add(type);
  }
  const declared = project.task_property_defs?.find((d) => d.key === 'type');
  for (const value of declared?.enum_values ?? []) out.add(value);
  return out.size > 0 ? [...out] : ['task'];
}
