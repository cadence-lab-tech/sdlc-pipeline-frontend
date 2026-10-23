import {useState} from 'react';
import {Link} from 'react-router-dom';

import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {MultiSelector, Selector, TextInput} from '@/components/fields';
import {Section, Token} from '@/components/kit';

import {ApiError, api} from '../../api/client';
import type {ModelLevel, Project, Task, TaskDetail, TaskPropertyDef, TaskRepoRef} from '../../api/types';
import {useResource} from '../../api/useResource';
import {Failure} from '../Feedback';
import {ModelLevelToggle} from '../ModelLevelToggle';
import {PropertyField} from '../PropertyFields';
import {canEditTaskLevel, needsProjectTeams} from '../modelLevel';
import {priorityClass, priorityLabel} from '../priorities';

// «Детали» — список ключ-значение: всё, что задача про себя знает, одной
// колонкой. Формы (назначение, свойства, расширение области) по умолчанию
// свёрнуты: читают карточку чаще, чем правят.
export function Details({
  detail,
  refs,
  onChanged,
}: {
  detail: TaskDetail;
  // Привязки PR приходят отдельным ресурсом: в ответе задачи их нет. Держит
  // его страница — их перезапрашивает та же кнопка и тот же опрос живой
  // аренды, что и саму карточку, иначе PR, привязанный агентом по ходу
  // прогона, на экране не появится.
  refs: TaskRepoRef[];
  onChanged: () => void;
}) {
  const {task} = detail;
  const project = useResource(() => api.getProject(task.project_key), [task.project_key]);
  const [editing, setEditing] = useState(false);
  const [add, setAdd] = useState<string[]>([]);
  const [scopeError, setScopeError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);

  const defs = project.data?.task_property_defs ?? [];
  const inScope = new Set(task.repositories.map((r) => `${r.owner}/${r.name}`));

  const save = async (body: Record<string, unknown>) => {
    setBusy(true);
    setScopeError(undefined);
    try {
      await api.updateScope(task.key, body);
      setAdd([]);
      onChanged();
    } catch (err) {
      setScopeError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Детали">
      <dl className="divide-border divide-y text-sm">
        <DetailRow label="Статус">
          <Badge variant="secondary">{task.status_name}</Badge>
        </DetailRow>
        <DetailRow label="Тип">
          <Token label={taskType(task)} />
        </DetailRow>
        <DetailRow label="Приоритет">
          <Token label={priorityLabel(task.priority)} className={priorityClass(task.priority)} />
        </DetailRow>
        <DetailRow label="Уровень модели">
          <TaskModelLevel task={task} project={project.data?.project} onChanged={onChanged} />
        </DetailRow>
        <DetailRow label="Исполнитель">
          <Assignee task={task} onChanged={onChanged} />
        </DetailRow>
        {task.parent_key ? (
          <DetailRow label="Родитель">
            <Link
              to={`/p/${task.project_key}/tasks/${task.parent_key}`}
              className="underline underline-offset-4">
              {task.parent_key}
            </Link>
          </DetailRow>
        ) : null}
        <DetailRow label="Область">
          <Repositories task={task} refs={refs} />
        </DetailRow>
        {/* Тип показан отдельной строкой выше — он же системное свойство, и
            дважды выводить его незачем. */}
        {defs
          .filter((def) => def.key !== 'type')
          .map((def) => (
            <DetailRow key={def.id} label={def.name}>
              {propertyValue(def, task.properties[def.key])}
            </DetailRow>
          ))}
      </dl>

      {scopeError ? <Failure error={scopeError} title="Область не изменена" /> : null}

      {project.data ? (
        editing ? (
          <div className="space-y-4 rounded-lg border p-3">
            {defs.map((def) => (
              <PropertyField
                key={def.id}
                def={def}
                value={task.properties[def.key]}
                onChange={(value) => save({properties: {[def.key]: value}})}
              />
            ))}
            {/* Расширение области — решение человека, а не агента
                (решение 0015): агент работает внутри уже заданной. */}
            <MultiSelector
              label="Добавить репозиторий в область"
              value={add}
              onChange={setAdd}
              options={project.data.repositories
                .filter((r) => !inScope.has(`${r.owner}/${r.name}`))
                .map((r) => ({value: `${r.owner}/${r.name}`, label: `${r.owner}/${r.name}`}))}
            />
            <div className="flex gap-2">
              {add.length > 0 ? (
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => save({add_repositories: add})}>
                  Расширить область
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Готово
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="ghost" className="-ml-2" onClick={() => setEditing(true)}>
            Править свойства и область
          </Button>
        )
      ) : null}
    </Section>
  );
}

function DetailRow({label, children}: {label: string; children: React.ReactNode}) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-3 py-2">
      {/* Название свойства придумывает проект, и длинное слово обязано
          переноситься внутри своей колонки, а не наезжать на значение. */}
      <dt className="text-muted-foreground break-words">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

// Тип задачи — системное свойство: по нему выбран цикл (решение 0024).
function taskType(task: Task): string {
  const value = task.properties.type;
  return typeof value === 'string' && value ? value : 'task';
}

function propertyValue(def: TaskPropertyDef, value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (def.value_type === 'boolean') return value ? 'да' : 'нет';
  return String(value);
}

// Вид привязки — перечень схемы (task_repo_refs.ref_type), по нему подпись
// выбирать можно. Состояние PR приходит от GitHub и показывается как есть.
const REF_LABEL: Record<string, string> = {
  pull_request: 'PR',
  branch: 'ветка',
  commit: 'коммит',
};

function Repositories({task, refs}: {task: Task; refs: TaskRepoRef[]}) {
  if (task.repositories.length === 0) return <>—</>;

  return (
    <div className="space-y-1.5">
      {task.repositories.map((repo) => {
        const name = `${repo.owner}/${repo.name}`;
        const linked = refs.filter((r) => r.repository === name);
        return (
          <div key={repo.repository_id} className="space-y-1">
            <p className="font-mono text-xs break-all">
              {name}
              {repo.is_primary ? <span className="text-muted-foreground"> · основной</span> : null}
            </p>
            {linked.length > 0 ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                {linked.map((ref) => (
                  <RefLink key={ref.id} refItem={ref} />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function RefLink({refItem}: {refItem: TaskRepoRef}) {
  const label = `${REF_LABEL[refItem.ref_type] ?? refItem.ref_type} ${
    refItem.ref_type === 'pull_request' ? `#${refItem.ref}` : refItem.ref.slice(0, 12)
  }`;
  return (
    <span className="inline-flex items-center gap-1.5">
      {refItem.url ? (
        <a
          href={refItem.url}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4">
          {label}
        </a>
      ) : (
        <span>{label}</span>
      )}
      {refItem.state ? <span className="text-muted-foreground">{refItem.state}</span> : null}
    </span>
  );
}

// Уровень модели задачи (решение 0060): этап без своего уровня берёт его при
// захвате, идущий прогон не меняется — его снимок уже сделан. Сдвиг
// сохраняется сразу, без кнопки: правка одного поля обратима тем же кликом.
// Уровни этапов (stage_settings) здесь не показываются — это панель этапа
// CLAB-231.
function TaskModelLevel({
  task,
  project,
  onChanged,
}: {
  task: Task;
  project: Project | undefined;
  onChanged: () => void;
}) {
  const me = useResource(() => api.me(), []);
  const ownerTeamKey = project?.owner_team_key;
  // Состав команд проекта нужен, только если прямого права нет: в режиме
  // header и у администратора системы лишнего запроса карточка не делает.
  const needTeams = needsProjectTeams(me.data, task.project_key, ownerTeamKey);
  const teams = useResource(
    () => (needTeams ? api.listProjectTeams(task.project_key) : Promise.resolve(undefined)),
    [task.project_key, needTeams],
  );
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);

  const editable = canEditTaskLevel({
    me: me.data,
    projectKey: task.project_key,
    ownerTeamKey,
    projectTeams: needTeams ? teams.data : undefined,
  });

  const change = async (level: ModelLevel | null) => {
    setBusy(true);
    setError(undefined);
    try {
      await api.updateTask(task.key, {model_level: level ?? ''});
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    } finally {
      setBusy(false);
    }
  };

  // Положение всегда то, что отдал сервер: после отказа ползунок сам
  // возвращается к нему, своего «выбранного» состояния у него нет.
  return (
    <div className="space-y-1.5" data-task-model-level>
      <ModelLevelToggle
        value={task.model_level}
        onChange={change}
        disabled={!editable}
        busy={busy}
        label="Уровень модели задачи"
        title={editable ? undefined : 'Уровень задачи меняет сопровождающий проекта'}
      />
      {error ? <Failure error={error} title="Уровень не изменён" /> : null}
    </div>
  );
}

// Назначение адресное: назначенную задачу заберёт по MCP только этот принципал,
// остальным она в очереди не покажется (решение 0025). Так оркестратор раздаёт
// нарезку эпика конкретным агентам, а человек — конкретному человеку.
//
// Исполнителем может быть любой принципал, а не только участник проекта: агент
// заводится при первом обращении и участником становится не всегда. Поэтому
// участники — подсказка, а не ограничение: когда их нет, хэндл вводится руками.
function Assignee({task, onChanged}: {task: Task; onChanged: () => void}) {
  const members = useResource(() => api.listMembers(task.project_key), [task.project_key]);
  const [editing, setEditing] = useState(false);
  const [handle, setHandle] = useState(task.assignee_handle ?? '');
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);

  const assign = async (next: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await api.assignTask(task.key, next);
      setHandle(next);
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    } finally {
      setBusy(false);
    }
  };

  const options = (members.data ?? []).map((m) => ({value: m.handle, label: `${m.handle} · ${m.role}`}));
  if (handle && !options.some((o) => o.value === handle)) options.unshift({value: handle, label: handle});

  return (
    <div className="space-y-1.5">
      <p className="truncate">{task.assignee_handle ?? 'не назначен'}</p>
      <p className="text-muted-foreground text-xs">
        {task.assignee_handle
          ? `Задачу заберёт только ${task.assignee_handle}`
          : 'Задачу заберёт любой агент подходящей роли'}
      </p>
      {error ? <Failure error={error} title="Назначение не изменилось" /> : null}
      {editing ? (
        <div className="space-y-2">
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
          <div className="flex flex-wrap gap-2">
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
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Отмена
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="ghost" className="-ml-2" onClick={() => setEditing(true)}>
          Изменить
        </Button>
      )}
    </div>
  );
}
