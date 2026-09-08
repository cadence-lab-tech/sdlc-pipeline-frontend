import {useState} from 'react';

import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {FormLayout, MultiSelector, TextInput} from '@/components/fields';

import {ApiError, api} from '../api/client';
import type {Workflow} from '../api/types';
import {Failure} from './Feedback';

// Имя черновика и типы задач, которые он поведёт. Тип решает, по какому циклу
// пойдёт задача, поэтому это свойство самого цикла, а не задачи (решение 0024);
// на один тип в проекте приходится ровно один действующий цикл, и активация
// черновика выводит из работы прежние циклы его типов.
export function WorkflowDraftDialog({
  workflow,
  types,
  isOpen,
  onClose,
  onSaved,
}: {
  workflow: Workflow;
  // Типы, заведённые в проекте: перечисление свойства `type` и типы
  // действующих циклов.
  types: string[];
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(workflow.name);
  const [taskTypes, setTaskTypes] = useState<string[]>(workflow.task_types);
  const [error, setError] = useState<ApiError>();
  const [saving, setSaving] = useState(false);

  const options = [...new Set([...types, ...workflow.task_types])].map((t) => ({
    value: t,
    label: t,
  }));

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      await api.updateWorkflowVersion(workflow.id, {name, task_types: taskTypes});
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Название и типы задач</DialogTitle>
          <DialogDescription>
            Активация выведет из работы прежние циклы этих типов
          </DialogDescription>
        </DialogHeader>
        {error ? <Failure error={error} title="Черновик не изменён" /> : null}
        <FormLayout>
          <TextInput label="Название" value={name} onChange={setName} isRequired />
          <MultiSelector
            label="Типы задач"
            description="Какие задачи пойдут по этому циклу: task — разработка, epic — планирование"
            value={taskTypes}
            onChange={setTaskTypes}
            options={options}
            placeholder="Выберите тип задач"
          />
        </FormLayout>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={!name || taskTypes.length === 0 || saving} onClick={save}>
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
