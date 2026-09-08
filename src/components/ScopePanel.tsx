import {useState} from 'react';

import {Button} from '@/components/ui/button';
import {MultiSelector} from '@/components/fields';
import {Section, Token} from '@/components/kit';

import {ApiError, api} from '../api/client';
import type {Task} from '../api/types';
import {useResource} from '../api/useResource';
import {Failure} from './Feedback';
import {PropertyField} from './PropertyFields';

// Свойства и область задачи. Расширение области — решение человека, а не
// агента (решение 0015): агент работает внутри уже заданной области.
export function ScopePanel({task, onChanged}: {task: Task; onChanged: () => void}) {
  const project = useResource(() => api.getProject(task.project_key), [task.project_key]);
  const [add, setAdd] = useState<string[]>([]);
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);

  const inScope = new Set(task.repositories.map((r) => `${r.owner}/${r.name}`));

  const save = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await api.updateScope(task.key, body);
      setAdd([]);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Область и свойства">
      {error ? <Failure error={error} title="Область не изменена" /> : null}

      <div className="space-y-1">
        <p className="text-muted-foreground text-xs">Репозитории задачи</p>
        <div className="flex flex-wrap gap-1">
          {task.repositories.map((r) => (
            <Token
              key={r.repository_id}
              label={`${r.owner}/${r.name}`}
              color={r.is_primary ? 'blue' : 'default'}
            />
          ))}
        </div>
      </div>

      {project.data ? (
        <div className="space-y-4">
          {project.data.task_property_defs.map((def) => (
            <PropertyField
              key={def.id}
              def={def}
              value={task.properties[def.key]}
              onChange={(value) => save({properties: {[def.key]: value}})}
            />
          ))}

          <MultiSelector
            label="Добавить репозиторий в область"
            value={add}
            onChange={setAdd}
            options={project.data.repositories
              .filter((r) => !inScope.has(`${r.owner}/${r.name}`))
              .map((r) => ({value: `${r.owner}/${r.name}`, label: `${r.owner}/${r.name}`}))}
          />
          {add.length > 0 ? (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => save({add_repositories: add})}>
              Расширить область
            </Button>
          ) : null}
        </div>
      ) : null}
    </Section>
  );
}
