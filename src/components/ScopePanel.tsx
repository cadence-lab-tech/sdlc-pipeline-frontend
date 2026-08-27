import {useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {MultiSelector} from '@astryxdesign/core/MultiSelector';
import {Heading, Text} from '@astryxdesign/core/Text';
import {Token} from '@astryxdesign/core/Token';

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
    <VStack gap={3}>
      <Heading level={3}>Область и свойства</Heading>
      {error ? <Failure error={error} title="Область не изменена" /> : null}

      <VStack gap={1}>
        <Text type="supporting" color="secondary">
          Репозитории задачи
        </Text>
        <HStack gap={1} wrap="wrap">
          {task.repositories.map((r) => (
            <Token
              key={r.repository_id}
              size="sm"
              label={`${r.owner}/${r.name}`}
              color={r.is_primary ? 'blue' : 'gray'}
            />
          ))}
        </HStack>
      </VStack>

      {project.data ? (
        <>
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
            <Button
              size="sm"
              variant="secondary"
              isDisabled={busy}
              label="Расширить область"
              onClick={() => save({add_repositories: add})}
            />
          ) : null}
        </>
      ) : null}
    </VStack>
  );
}
