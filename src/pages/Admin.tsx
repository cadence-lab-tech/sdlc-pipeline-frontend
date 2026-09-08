import {useState} from 'react';

import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Separator} from '@/components/ui/separator';
import {FormLayout, Selector, Switch, TextInput} from '@/components/fields';
import {DataTable} from '@/components/DataTable';
import {EmptyState, Page, PageHeader, Row, Section, Timestamp, Token} from '@/components/kit';

import {ApiError, api} from '../api/client';
import type {Principal, ProjectTeam, Team, TeamMember} from '../api/types';
import {useResource} from '../api/useResource';
import {Failure, Loaded, Loading} from '../components/Feedback';

// Команды и принципалы (решение 0027). Команда живёт над проектами: она даёт
// уровень доступа сразу в несколько, владеет проектами и несёт бюджет. Права
// на каждое действие проверяет бэкенд — страница их не угадывает и кнопки не
// прячет; исключение одно, список принципалов, он общесистемный и лиду команды
// не отдаётся вовсе.

const TEAM_ROLES = [
  {value: 'member', label: 'участник'},
  {value: 'lead', label: 'лид — правит команду и заводит проекты'},
];

// Окна календарные, а не скользящие: предел «в неделю» кончается в
// понедельник, а не через семь дней после первого прогона.
const PERIODS: {value: 'day' | 'week' | 'month'; label: string}[] = [
  {value: 'day', label: 'в день'},
  {value: 'week', label: 'в неделю'},
  {value: 'month', label: 'в месяц'},
];

export function Teams() {
  const teams = useResource(() => api.listTeams(), []);
  const [picked, setPicked] = useState<string>();
  const [creating, setCreating] = useState(false);

  if (teams.error) return <Failure error={teams.error} />;
  if (!teams.data) return <Loading />;

  // Выбранная команда вычисляется, а не досылается эффектом: пока никого не
  // выбрали, открыта первая в списке.
  const selected = picked ?? teams.data[0]?.key;

  return (
    <div className="flex min-h-[calc(100svh-3.5rem)]">
      <aside className="w-75 shrink-0 border-r">
        <div className="space-y-2 border-b p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Команды</h2>
            <Badge variant="secondary">{teams.data.length}</Badge>
          </div>
          <Button size="sm" className="w-full" onClick={() => setCreating(true)}>
            Завести команду
          </Button>
        </div>
        <ul className="divide-border divide-y">
          {teams.data.map((team) => (
            <li key={team.id}>
              <Row
                isSelected={team.key === selected}
                onClick={() => {
                  setCreating(false);
                  setPicked(team.key);
                }}
                end={
                  team.archived_at ? (
                    <Token label="в архиве" />
                  ) : team.can_create_projects ? (
                    <Token label="проекты" />
                  ) : null
                }>
                <p className="truncate font-medium">{team.name}</p>
                <p className="text-muted-foreground truncate text-xs">{team.key}</p>
              </Row>
            </li>
          ))}
        </ul>
      </aside>
      <div className="min-w-0 flex-1 p-4">
        {creating ? (
          <NewTeam
            onDone={(team) => {
              setCreating(false);
              setPicked(team.key);
              teams.reload();
            }}
            onCancel={() => setCreating(false)}
          />
        ) : selected ? (
          <TeamDetail teamKey={selected} onChanged={teams.reload} />
        ) : (
          <EmptyState
            title="Команд нет"
            description="Команда даёт уровень доступа сразу в несколько проектов и владеет теми, что завела сама"
          />
        )}
      </div>
    </div>
  );
}

function NewTeam({onDone, onCancel}: {onDone: (team: Team) => void; onCancel: () => void}) {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [canCreateProjects, setCanCreateProjects] = useState(false);
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      onDone(
        await api.createTeam({
          key: key.trim(),
          name: name.trim(),
          description: description.trim() || undefined,
          can_create_projects: canCreateProjects,
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Новая команда"
        description="Заводит команду администратор системы, и он же становится её первым лидом: команда без лида не примет ни человека, ни проект."
      />
      {error ? <Failure error={error} /> : null}
      <Card className="gap-3 p-4">
        <FormLayout>
          <TextInput
            label="Ключ"
            description="короткий, латиницей: platform"
            value={key}
            onChange={setKey}
            isRequired
          />
          <TextInput label="Название" value={name} onChange={setName} isRequired />
          <TextInput label="Описание" value={description} onChange={setDescription} />
        </FormLayout>
        <Switch
          label="Может заводить проекты"
          description="право принадлежит команде, а не человеку: лид меняется, команда остаётся"
          value={canCreateProjects}
          onChange={setCanCreateProjects}
        />
        <div className="flex gap-2">
          <Button disabled={busy || key.trim() === '' || name.trim() === ''} onClick={submit}>
            Завести
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Отмена
          </Button>
        </div>
      </Card>
    </div>
  );
}

function TeamDetail({teamKey, onChanged}: {teamKey: string; onChanged: () => void}) {
  const team = useResource(() => api.getTeam(teamKey), [teamKey]);
  const [error, setError] = useState<ApiError>();

  // Список слева показывает имя и право заводить проекты, поэтому он
  // перезапрашивается вместе с командой, а не только при её создании.
  const reload = () => {
    team.reload();
    onChanged();
  };

  const archive = async () => {
    setError(undefined);
    try {
      await api.archiveTeam(teamKey);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    }
  };

  return (
    <Loaded resource={team}>
      {(detail) => (
        <div className="space-y-6">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{detail.team.name}</h1>
              <div className="flex items-center gap-2">
                {detail.team.can_create_projects ? <Token label="заводит проекты" /> : null}
                {detail.team.archived_at ? <Token label="в архиве" /> : null}
                <Button size="sm" variant="ghost" onClick={archive}>
                  Архивировать
                </Button>
              </div>
            </div>
            <p className="text-muted-foreground text-sm">
              {detail.team.key}
              {detail.team.description ? ` · ${detail.team.description}` : ''}
            </p>
          </div>
          {error ? <Failure error={error} /> : null}

          <Members teamKey={teamKey} members={detail.members} onChanged={reload} />
          <Separator />
          <Projects teamKey={teamKey} projects={detail.projects} onChanged={reload} />
          <Separator />
          <IdPGroups teamKey={teamKey} />
          <Separator />
          <Budgets teamKey={teamKey} />
        </div>
      )}
    </Loaded>
  );
}

function Members({
  teamKey,
  members,
  onChanged,
}: {
  teamKey: string;
  members: TeamMember[];
  onChanged: () => void;
}) {
  const [principal, setPrincipal] = useState('');
  const [role, setRole] = useState('member');
  const [error, setError] = useState<ApiError>();

  const act = async (fn: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    }
  };

  return (
    <Section
      title="Состав"
      description="Лид правит команду и заводит проекты, если у команды есть на это право. Последнего лида убрать нельзя: команда без лида ничего не может.">
      {error ? <Failure error={error} /> : null}
      <DataTable<TeamMember>
        data={members}
        idKey="principal_id"
        empty={<EmptyState title="В команде никого нет" />}
        columns={[
          {key: 'handle', header: 'Кто', renderCell: (m) => `${m.kind}:${m.handle}`},
          {key: 'display_name', header: 'Имя'},
          {
            key: 'role',
            header: 'Роль',
            width: 120,
            renderCell: (m) => <Token label={m.role === 'lead' ? 'лид' : 'участник'} />,
          },
          {
            key: 'actions',
            header: '',
            width: 110,
            align: 'end',
            renderCell: (m) => (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => act(() => api.removeTeamMember(teamKey, `${m.kind}:${m.handle}`))}>
                Убрать
              </Button>
            ),
          },
        ]}
      />
      <Card className="gap-3 p-4">
        <h3 className="text-base font-semibold">Добавить или изменить роль</h3>
        <FormLayout>
          <TextInput
            label="Принципал"
            description="user:alice или agent:reviewer-bot; без префикса — человек"
            value={principal}
            onChange={setPrincipal}
          />
          <Selector label="Роль в команде" options={TEAM_ROLES} value={role} onChange={setRole} />
        </FormLayout>
        <div>
          <Button
            disabled={principal.trim() === ''}
            onClick={() =>
              act(async () => {
                await api.setTeamMember(teamKey, principal.trim(), role);
                setPrincipal('');
              })
            }>
            Сохранить
          </Button>
        </div>
      </Card>
    </Section>
  );
}

function Projects({
  teamKey,
  projects,
  onChanged,
}: {
  teamKey: string;
  projects: ProjectTeam[];
  onChanged: () => void;
}) {
  const [error, setError] = useState<ApiError>();

  const remove = async (projectKey: string) => {
    setError(undefined);
    try {
      await api.removeProjectTeam(projectKey, teamKey);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    }
  };

  return (
    <Section
      title="Доступ в проекты"
      description="Уровень команды складывается с поимённым участием: действующий уровень человека — максимум из путей, а не последний назначенный. Выдаётся уровень в настройках самого проекта.">
      {error ? <Failure error={error} /> : null}
      <DataTable<ProjectTeam>
        data={projects}
        idKey="project_id"
        empty={
          <EmptyState
            title="Команда никуда не пущена"
            description="Уровень выдаётся в настройках проекта, на вкладке «Команды»"
          />
        }
        columns={[
          {key: 'project_key', header: 'Проект'},
          {key: 'level', header: 'Уровень', width: 130, renderCell: (p) => <Token label={p.level} />},
          {
            key: 'created_at',
            header: 'С',
            width: 160,
            renderCell: (p) => <Timestamp value={p.created_at} />,
          },
          {
            key: 'actions',
            header: '',
            width: 110,
            align: 'end',
            renderCell: (p) => (
              <Button size="sm" variant="ghost" onClick={() => remove(p.project_key)}>
                Убрать
              </Button>
            ),
          },
        ]}
      />
    </Section>
  );
}

function IdPGroups({teamKey}: {teamKey: string}) {
  const groups = useResource(() => api.teamIdPGroups(teamKey), [teamKey]);
  const [text, setText] = useState<string>();
  const [error, setError] = useState<ApiError>();

  const save = async (value: string) => {
    setError(undefined);
    try {
      await api.setTeamIdPGroups(
        teamKey,
        value
          .split(',')
          .map((g) => g.trim())
          .filter(Boolean),
      );
      setText(undefined);
      groups.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    }
  };

  return (
    <Section
      title="Группы провайдера"
      description="Состав такой команды пересчитывается при каждом входе её участников: кого провайдер в группе не вернул, того команда теряет. Лидов синхронизация не трогает — роль в команде ставит человек. Команда без групп ведётся руками.">
      {error ? <Failure error={error} /> : null}
      <Loaded resource={groups}>
        {(list) => (
          <Card className="gap-3 p-4">
            <TextInput
              label="Группы"
              description="через запятую, как они приходят в клейме groups"
              value={text ?? list.join(', ')}
              onChange={setText}
            />
            <div>
              <Button disabled={text === undefined} onClick={() => save(text ?? '')}>
                Сохранить
              </Button>
            </div>
          </Card>
        )}
      </Loaded>
    </Section>
  );
}

function Budgets({teamKey}: {teamKey: string}) {
  const budgets = useResource(() => api.teamBudgets(teamKey), [teamKey]);
  const [period, setPeriod] = useState<string>('month');
  const [limit, setLimit] = useState('');
  const [error, setError] = useState<ApiError>();

  const save = async () => {
    setError(undefined);
    try {
      await api.setTeamBudget(teamKey, period, Number(limit.replace(',', '.')) || 0);
      setLimit('');
      budgets.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    }
  };

  return (
    <Section
      title="Бюджет"
      description="Расход — стоимость прогонов в проектах, которыми команда владеет, за календарное окно. Исчерпанный предел закрывает новые захваты задач; начатые прогоны доходят до конца. Ноль снимает предел: «без ограничения» и «ноль долларов» — разные вещи.">
      {error ? <Failure error={error} /> : null}
      <Loaded resource={budgets}>
        {(state) => (
          <DataTable
            data={state.budgets.map((b) => ({...b, id: b.period ?? ''}))}
            idKey="id"
            empty={
              <EmptyState title="Пределов нет" description="Команда тратит столько, сколько нужно" />
            }
            columns={[
              {
                key: 'period',
                header: 'Окно',
                width: 140,
                renderCell: (b) => PERIODS.find((p) => p.value === b.period)?.label ?? String(b.period),
              },
              {
                key: 'limit_usd',
                header: 'Предел',
                width: 120,
                renderCell: (b) => `$${Number(b.limit_usd ?? 0).toFixed(2)}`,
              },
              {
                key: 'spent_usd',
                header: 'Потрачено',
                width: 120,
                renderCell: (b) => `$${Number(b.spent_usd).toFixed(2)}`,
              },
              {
                key: 'state',
                header: 'Состояние',
                width: 140,
                renderCell: (b) =>
                  b.spent_usd >= Number(b.limit_usd ?? 0) ? (
                    <Badge variant="destructive">исчерпан</Badge>
                  ) : (
                    <Badge>в пределах</Badge>
                  ),
              },
            ]}
          />
        )}
      </Loaded>
      <Card className="gap-3 p-4">
        <h3 className="text-base font-semibold">Поставить предел</h3>
        <FormLayout>
          <Selector label="Окно" options={PERIODS} value={period} onChange={setPeriod} />
          <TextInput
            label="Предел, $"
            description="ноль снимает предел"
            value={limit}
            onChange={setLimit}
          />
        </FormLayout>
        <div>
          <Button disabled={limit.trim() === ''} onClick={save}>
            Сохранить
          </Button>
        </div>
      </Card>
    </Section>
  );
}

// ── принципалы ──────────────────────────────────────────────────────────────

// Кто заведён в системе: люди, агенты и служебные принципалы. Список нужен,
// чтобы добавить человека в команду до того, как он впервые придёт с токеном.
export function Principals() {
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const principals = useResource(() => api.listPrincipals(applied || undefined), [applied]);

  return (
    <Page>
      <PageHeader
        title="Принципалы"
        description="Аудит и права ссылаются на принципалов, а не на строки с именами. Человек заводится сам при первом входе через провайдера, агент — при выдаче токена, но и добавить его в команду можно заранее: принципал появится по хэндлу."
      />
      <div className="space-y-4">
        <Card className="p-4">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <TextInput
                label="Поиск"
                description="по хэндлу или имени"
                value={search}
                onChange={setSearch}
                onEnter={() => setApplied(search.trim())}
              />
            </div>
            <Button onClick={() => setApplied(search.trim())}>Найти</Button>
          </div>
        </Card>
        <Loaded resource={principals}>
          {(list) => (
            <DataTable<Principal>
              data={list}
              idKey="id"
              empty={<EmptyState title="Никого не нашлось" />}
              columns={[
                {key: 'handle', header: 'Хэндл', renderCell: (p) => `${p.kind}:${p.handle}`},
                {key: 'display_name', header: 'Имя'},
                {key: 'email', header: 'Почта', renderCell: (p) => p.email ?? '—'},
                {
                  key: 'is_admin',
                  header: 'Права',
                  width: 160,
                  renderCell: (p) => (p.is_admin ? <Token label="администратор системы" /> : null),
                },
                {
                  key: 'created_at',
                  header: 'Заведён',
                  width: 160,
                  renderCell: (p) => <Timestamp value={p.created_at} />,
                },
              ]}
            />
          )}
        </Loaded>
      </div>
    </Page>
  );
}
