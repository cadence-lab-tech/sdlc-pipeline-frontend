import {useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';

import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {FormLayout, MultiSelector, Selector, Switch, TextArea, TextInput} from '@/components/fields';

import {ApiError, api} from '../api/client';
import type {ProjectDetail} from '../api/types';
import {Failure} from './Feedback';
import {PropertyField} from './PropertyFields';
import {OPTIONAL_STAGES_FORM_TITLE, changedStages, stageToggles, type StageToggle} from './optionalStage';
import {PRIORITY_OPTIONS} from './priorities';
import {defaultProperties} from './properties';
import {taskTypes} from './taskTypes';

export function NewTaskDialog({
  project,
  onCreated,
  defaultType,
  parentKey,
}: {
  project: ProjectDetail;
  onCreated: () => void;
  defaultType?: string;
  // Задан — форма заводит дочернюю задачу этого эпика.
  parentKey?: string;
}) {
  const navigate = useNavigate();
  const types = taskTypes(project);
  const [isOpen, setIsOpen] = useState(false);
  const [taskType, setTaskType] = useState(defaultType ?? types[0]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('normal');
  const [repositories, setRepositories] = useState<string[]>([]);
  const [properties, setProperties] = useState(() => defaultProperties(project.task_property_defs));
  const [error, setError] = useState<ApiError>();
  const [saving, setSaving] = useState(false);
  // Необязательные этапы цикла выбранного типа (решение 0066): показанные
  // умолчания и то, что человек успел поменять. Оба набора помнят тип, к
  // которому относятся, — смена типа подставляет набор другого цикла, а
  // правки прежнего не переносит. Цикл не нашёлся или не загрузился — блока
  // нет, и сервер заполнит умолчаниями сам.
  const [loaded, setLoaded] = useState<{type: string; stages: StageToggle[]}>();
  const [edits, setEdits] = useState<{type: string; values: Record<string, boolean>}>();
  const stages = loaded?.type === taskType ? loaded.stages : [];
  const edited = edits?.type === taskType ? edits.values : {};

  useEffect(() => {
    if (!isOpen) return;
    let stale = false;
    api
      .getWorkflow(project.project.key, taskType)
      .then((w) => {
        if (!stale) setLoaded({type: taskType, stages: stageToggles(w.statuses)});
      })
      .catch(() => {
        if (!stale) setLoaded({type: taskType, stages: []});
      });
    return () => {
      stale = true;
    };
  }, [isOpen, project.project.key, taskType]);

  const submit = async () => {
    setSaving(true);
    setError(undefined);
    try {
      const task = await api.createTask(project.project.key, {
        title,
        description: description || undefined,
        type: taskType,
        parent_key: parentKey,
        priority,
        properties,
        repositories,
        optional_stages: changedStages(stages, edited),
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
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant={parentKey ? 'secondary' : 'default'}>
          {parentKey ? 'Дочерняя задача' : 'Новая задача'}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{parentKey ? `Дочерняя задача ${parentKey}` : 'Новая задача'}</DialogTitle>
          {parentKey ? null : (
            <DialogDescription>
              Тип задачи выбирает цикл: эпик идёт планированием, задача — разработкой
            </DialogDescription>
          )}
        </DialogHeader>
        {error ? <Failure error={error} title="Задача не создана" /> : null}
        <FormLayout>
          <TextInput label="Название" value={title} onChange={setTitle} isRequired />
          {types.length > 1 ? (
            <Selector
              label="Тип"
              description="По типу выбирается цикл, по которому пойдёт задача"
              options={types.map((t) => ({value: t, label: t}))}
              value={taskType}
              onChange={setTaskType}
            />
          ) : null}
          <TextArea label="Описание" value={description} onChange={setDescription} rows={4} />
          <Selector
            label="Приоритет"
            options={PRIORITY_OPTIONS}
            value={priority}
            onChange={setPriority}
          />
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
          {stages.length > 0 ? (
            <fieldset className="space-y-2" data-optional-stages>
              <legend className="text-sm font-medium">{OPTIONAL_STAGES_FORM_TITLE}</legend>
              <p className="text-muted-foreground text-xs">
                Выключенный этап задача пройдёт мимо; положение можно сменить и в карточке задачи
              </p>
              {stages.map((s) => (
                <Switch
                  key={s.key}
                  label={s.name}
                  value={edited[s.key] ?? s.value}
                  onChange={(value) => setEdits({type: taskType, values: {...edited, [s.key]: value}})}
                  data-optional-stage={s.key}
                />
              ))}
            </fieldset>
          ) : null}
          {project.task_property_defs
            .filter((def) => def.key !== 'type')
            .map((def) => (
              <PropertyField
                key={def.id}
                def={def}
                value={properties[def.key]}
                onChange={(value) => setProperties((prev) => ({...prev, [def.key]: value}))}
              />
            ))}
        </FormLayout>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setIsOpen(false)}>
            Отмена
          </Button>
          <Button disabled={!title || saving} onClick={submit}>
            Создать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
