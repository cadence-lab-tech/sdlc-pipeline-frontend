import {useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {Button} from '@astryxdesign/core/Button';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {FormLayout} from '@astryxdesign/core/FormLayout';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {MultiSelector} from '@astryxdesign/core/MultiSelector';
import {Selector} from '@astryxdesign/core/Selector';
import {TextArea} from '@astryxdesign/core/TextArea';
import {TextInput} from '@astryxdesign/core/TextInput';

import {ApiError, api} from '../api/client';
import type {ProjectDetail} from '../api/types';
import {Failure} from './Feedback';
import {PropertyField} from './PropertyFields';
import {defaultProperties} from './properties';

const PRIORITIES = ['low', 'normal', 'high', 'urgent'].map((p) => ({value: p, label: p}));

export function NewTaskDialog({project, onCreated}: {project: ProjectDetail; onCreated: () => void}) {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('normal');
  const [repositories, setRepositories] = useState<string[]>([]);
  const [properties, setProperties] = useState(() => defaultProperties(project.task_property_defs));
  const [error, setError] = useState<ApiError>();
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    setError(undefined);
    try {
      const task = await api.createTask(project.project.key, {
        title,
        description: description || undefined,
        priority,
        properties,
        repositories,
      });
      setIsOpen(false);
      onCreated();
      navigate(`/p/${project.project.key}/tasks/${task.key}`);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button variant="primary" label="Новая задача" onClick={() => setIsOpen(true)} />
      <Dialog isOpen={isOpen} onOpenChange={setIsOpen} purpose="form" width={560} padding={5}>
        <VStack gap={4}>
          <DialogHeader title="Новая задача" />
          {error ? <Failure error={error} title="Задача не создана" /> : null}
          <FormLayout>
            <TextInput label="Название" value={title} onChange={setTitle} isRequired />
            <TextArea label="Описание" value={description} onChange={setDescription} rows={4} />
            <Selector label="Приоритет" options={PRIORITIES} value={priority} onChange={(v) => setPriority(v as string)} />
            <MultiSelector
              label="Область по репозиториям"
              description="Одна задача — один репозиторий, если не включена мультирепозиторность"
              value={repositories}
              onChange={setRepositories}
              options={project.repositories.map((r) => ({
                value: `${r.owner}/${r.name}`,
                label: `${r.owner}/${r.name}`,
              }))}
            />
            {project.task_property_defs.map((def) => (
              <PropertyField
                key={def.id}
                def={def}
                value={properties[def.key]}
                onChange={(value) => setProperties((prev) => ({...prev, [def.key]: value}))}
              />
            ))}
          </FormLayout>
          <HStack gap={2} hAlign="end">
            <Button variant="ghost" label="Отмена" onClick={() => setIsOpen(false)} />
            <Button
              variant="primary"
              label="Создать"
              isDisabled={!title || saving}
              onClick={submit}
            />
          </HStack>
        </VStack>
      </Dialog>
    </>
  );
}
