import {useState} from 'react';

import {Button} from '@/components/ui/button';
import {Selector, TextInput} from '@/components/fields';
import {Section} from '@/components/kit';

import {ApiError, api} from '../api/client';
import type {Task} from '../api/types';
import {useResource} from '../api/useResource';
import {Failure} from './Feedback';

// Назначение адресное: назначенную задачу заберёт по MCP только этот принципал,
// остальным она в очереди не покажется (решение 0025). Так оркестратор
// раздаёт нарезку эпика конкретным агентам, а человек — конкретному человеку.
//
// Исполнителем может быть любой принципал, а не только участник проекта:
// агент заводится при первом обращении и участником становится не всегда.
// Поэтому участники — это подсказка, а не ограничение: когда их нет,
// хэндл вводится руками.
export function AssigneePanel({task, onChanged}: {task: Task; onChanged: () => void}) {
  const members = useResource(() => api.listMembers(task.project_key), [task.project_key]);
  const [handle, setHandle] = useState(task.assignee_handle ?? '');
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);

  const assign = async (next: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await api.assignTask(task.key, next);
      setHandle(next);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    } finally {
      setBusy(false);
    }
  };

  const known = members.data ?? [];
  const options = known.map((m) => ({value: m.handle, label: `${m.handle} · ${m.role}`}));
  if (handle && !options.some((o) => o.value === handle)) {
    options.unshift({value: handle, label: handle});
  }

  return (
    <Section title="Исполнитель">
      <p className="text-muted-foreground text-sm">
        {task.assignee_handle
          ? `Задачу заберёт только ${task.assignee_handle}`
          : 'Задачу заберёт любой агент подходящей роли'}
      </p>
      {error ? <Failure error={error} title="Назначение не изменилось" /> : null}
      {options.length > 0 ? (
        <Selector
          label="Кому"
          isLabelHidden
          placeholder="Выберите принципала"
          options={options}
          value={handle}
          onChange={setHandle}
        />
      ) : (
        <TextInput
          label="Кому"
          isLabelHidden
          placeholder="user:alice или agent:developer"
          value={handle}
          onChange={setHandle}
        />
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={!handle || busy || handle === task.assignee_handle}
          onClick={() => assign(handle)}>
          Назначить
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!task.assignee_handle || busy}
          onClick={() => assign('')}>
          Снять назначение
        </Button>
      </div>
    </Section>
  );
}
