import {useState} from 'react';
import {Link} from 'react-router-dom';
import {ChevronRight} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {FormLayout, Selector, TextInput} from '@/components/fields';
import {EmptyState, Page, PageHeader, Token} from '@/components/kit';

import {ApiError, api} from '../api/client';
import type {Me, Project} from '../api/types';
import {useResource} from '../api/useResource';
import {Failure, Loaded} from '../components/Feedback';

export function Projects() {
  const projects = useResource(() => api.listProjects(), []);
  const me = useResource(() => api.me(), []);
  const [creating, setCreating] = useState(false);

  // Кнопка показывается тому, у кого она сработает: решает бэкенд
  // (can_create_projects), интерфейс лишь не предлагает заведомо отбитое.
  const canCreate = me.data?.can_create_projects ?? false;

  return (
    <Page>
      <PageHeader
        title="Проекты"
        description="Каждый проект настраивает свой цикл, роли и область по репозиториям."
        actions={
          canCreate && !creating ? (
            <Button onClick={() => setCreating(true)}>Новый проект</Button>
          ) : undefined
        }
      />
      {creating && me.data ? (
        <NewProject
          me={me.data}
          onDone={() => {
            setCreating(false);
            projects.reload();
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}
      <Loaded resource={projects}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState
              title="Проектов пока нет"
              description={
                canCreate
                  ? 'Проект заводит цикл, роли и задачи. Создайте первый.'
                  : 'Доступ к проектам выдают их администраторы.'
              }
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((p) => (
                <ProjectCard key={p.id} projectKey={p.key} name={p.name} description={p.description} />
              ))}
            </div>
          )
        }
      </Loaded>
    </Page>
  );
}

// Создание проекта (решения 0030, 0033): проект всегда принадлежит команде.
// Без выбора он уходит в личный аккаунт создателя; предлагаются команды,
// где человек лид — остальным бэкенд откажет. Создатель — администратор
// проекта и сам добавляет коллег.
function NewProject({me, onDone, onCancel}: {me: Me; onDone: (p: Project) => void; onCancel: () => void}) {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [team, setTeam] = useState('');
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);

  const teams = me.teams
    .filter((t) => t.role === 'lead')
    .map((t) => ({
      value: t.team_key,
      label: t.team_kind === 'personal' ? `Личный аккаунт (${t.team_key})` : t.team_key,
    }));

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      onDone(
        await api.createProject({
          key: key.trim().toUpperCase(),
          name: name.trim(),
          description: description.trim() || undefined,
          team: team || undefined,
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="gap-3 p-4">
      <h3 className="text-base font-semibold">Новый проект</h3>
      {error ? <Failure error={error} /> : null}
      <FormLayout>
        <TextInput
          label="Ключ"
          description="короткий, латиницей: ACME — им начинаются ключи задач (ACME-1)"
          value={key}
          onChange={setKey}
          isRequired
        />
        <TextInput label="Название" value={name} onChange={setName} isRequired />
        <TextInput label="Описание" value={description} onChange={setDescription} />
        {teams.length > 0 ? (
          <Selector
            label="Владелец"
            description="проект принадлежит команде, её лид — администратор проекта; пусто — личный аккаунт"
            options={teams}
            value={team}
            onChange={setTeam}
            placeholder="Личный аккаунт"
            hasClear
          />
        ) : null}
      </FormLayout>
      <div className="flex gap-2">
        <Button disabled={busy || key.trim() === '' || name.trim() === ''} onClick={submit}>
          Создать проект
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </Card>
  );
}

function ProjectCard({
  projectKey,
  name,
  description,
}: {
  projectKey: string;
  name: string;
  description?: string;
}) {
  const detail = useResource(() => api.getProject(projectKey), [projectKey]);

  return (
    <Card className="hover:border-foreground/20 transition-colors">
      <CardHeader>
        <CardTitle>
          <Link to={`/p/${projectKey}/board`} className="flex items-center gap-1 hover:underline">
            {name}
            <ChevronRight className="size-4 opacity-50" />
          </Link>
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        <div className="col-start-2 row-span-2 row-start-1 self-start justify-self-end">
          <Token label={projectKey} />
        </div>
      </CardHeader>
      <CardContent>
        {detail.data ? (
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs">Репозитории в области проекта</p>
            {detail.data.repositories.length === 0 ? (
              <p className="text-muted-foreground text-xs">пока нет — привязываются в настройках</p>
            ) : null}
            {detail.data.repositories.map((r) => (
              <p key={r.id} className="font-mono text-xs">
                {r.owner}/{r.name}
                {r.role_hint ? <span className="text-muted-foreground"> · {r.role_hint}</span> : null}
                {r.unavailable_at ? <span className="text-destructive"> · убран из установки</span> : null}
              </p>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
