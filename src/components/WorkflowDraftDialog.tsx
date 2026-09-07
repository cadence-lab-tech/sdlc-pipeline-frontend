import {useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {FormLayout} from '@astryxdesign/core/FormLayout';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {MultiSelector} from '@astryxdesign/core/MultiSelector';
import {TextInput} from '@astryxdesign/core/TextInput';

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
    <Dialog isOpen={isOpen} onOpenChange={onClose} purpose="form" width={520} padding={5}>
      <VStack gap={4}>
        <DialogHeader
          title="Название и типы задач"
          subtitle="Активация выведет из работы прежние циклы этих типов"
        />
        {error ? <Failure error={error} title="Черновик не изменён" /> : null}
        <FormLayout>
          <TextInput label="Название" value={name} onChange={setName} isRequired />
          <MultiSelector
            label="Типы задач"
            description="Какие задачи пойдут по этому циклу: task — разработка, epic — планирование"
            value={taskTypes}
            onChange={setTaskTypes}
            options={options}
            triggerDisplay="labels"
            placeholder="Выберите тип задач"
          />
        </FormLayout>
        <HStack gap={2} hAlign="end">
          <Button variant="ghost" label="Отмена" onClick={onClose} />
          <Button
            variant="primary"
            label="Сохранить"
            isDisabled={!name || taskTypes.length === 0 || saving}
            onClick={save}
          />
        </HStack>
      </VStack>
    </Dialog>
  );
}
