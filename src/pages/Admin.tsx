import {useState} from 'react';
import {Badge} from '@astryxdesign/core/Badge';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Divider} from '@astryxdesign/core/Divider';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {FormLayout} from '@astryxdesign/core/FormLayout';
import {Item} from '@astryxdesign/core/Item';
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutHeader,
  LayoutPanel,
  VStack,
} from '@astryxdesign/core/Layout';
import {List} from '@astryxdesign/core/List';
import {Section} from '@astryxdesign/core/Section';
import {Selector} from '@astryxdesign/core/Selector';
import {Switch} from '@astryxdesign/core/Switch';
import {Table, pixel, proportional} from '@astryxdesign/core/Table';
import {Heading, Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Timestamp} from '@astryxdesign/core/Timestamp';
import {Token} from '@astryxdesign/core/Token';

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
    <Layout
      height="fill"
      start={
        <LayoutPanel width={300} hasDivider padding={0} isScrollable label="Команды">
          <Layout
            height="fill"
            header={
              <LayoutHeader hasDivider padding={3}>
                <VStack gap={2}>
                  <HStack hAlign="between" vAlign="center">
                    <Heading level={2}>Команды</Heading>
                    <Badge variant="neutral" label={String(teams.data.length)} />
                  </HStack>
                  <Button
                    size="sm"
                    label="Завести команду"
                    onClick={() => setCreating(true)}
                  />
                </VStack>
              </LayoutHeader>
            }
            content={
              <LayoutContent padding={0}>
                <List hasDividers>
                  {teams.data.map((team) => (
                    <Item
                      key={team.id}
                      label={team.name}
                      description={team.key}
                      isSelected={team.key === selected}
                      onClick={() => {
                        setCreating(false);
                        setPicked(team.key);
                      }}
                      endContent={
                        team.archived_at ? (
                          <Token size="sm" label="в архиве" />
                        ) : team.can_create_projects ? (
                          <Token size="sm" label="проекты" />
                        ) : null
                      }
                    />
                  ))}
                </List>
              </LayoutContent>
            }
          />
        </LayoutPanel>
      }
      content={
        <LayoutContent padding={4}>
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
        </LayoutContent>
      }
    />
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
    <VStack gap={4}>
      <Heading level={1}>Новая команда</Heading>
      <Text color="secondary">
        Заводит команду администратор системы, и он же становится её первым лидом: команда без лида
        не примет ни человека, ни проект.
      </Text>
      {error ? <Failure error={error} /> : null}
      <Card padding={4}>
        <VStack gap={3}>
          <FormLayout>
            <TextInput label="Ключ" description="короткий, латиницей: platform" value={key} onChange={setKey} isRequired />
            <TextInput label="Название" value={name} onChange={setName} isRequired />
            <TextInput label="Описание" value={description} onChange={setDescription} isOptional />
          </FormLayout>
          <Switch
            label="Может заводить проекты"
            description="право принадлежит команде, а не человеку: лид меняется, команда остаётся"
            value={canCreateProjects}
            onChange={setCanCreateProjects}
          />
          <HStack gap={2}>
            <Button
              variant="primary"
              label="Завести"
              isDisabled={busy || key.trim() === '' || name.trim() === ''}
              onClick={submit}
            />
            <Button variant="ghost" label="Отмена" onClick={onCancel} />
          </HStack>
        </VStack>
      </Card>
    </VStack>
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
        <VStack gap={5}>
          <VStack gap={2}>
            <HStack hAlign="between" vAlign="center">
              <Heading level={1}>{detail.team.name}</Heading>
              <HStack gap={2} vAlign="center">
                {detail.team.can_create_projects ? <Token label="заводит проекты" size="sm" /> : null}
                {detail.team.archived_at ? <Token label="в архиве" size="sm" /> : null}
                <Button size="sm" variant="ghost" label="Архивировать" onClick={archive} />
              </HStack>
            </HStack>
            <Text type="supporting" color="secondary">
              {detail.team.key}
              {detail.team.description ? ` · ${detail.team.description}` : ''}
            </Text>
          </VStack>
          {error ? <Failure error={error} /> : null}

          <Members teamKey={teamKey} members={detail.members} onChanged={reload} />
          <Divider />
          <Projects teamKey={teamKey} projects={detail.projects} onChanged={reload} />
          <Divider />
          <IdPGroups teamKey={teamKey} />
          <Divider />
          <Budgets teamKey={teamKey} />
        </VStack>
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
    <VStack gap={3}>
      <Heading level={2}>Состав</Heading>
      <Text type="supporting" color="secondary">
        Лид правит команду и заводит проекты, если у команды есть на это право. Последнего лида
        убрать нельзя: команда без лида ничего не может.
      </Text>
      {error ? <Failure error={error} /> : null}
      {members.length === 0 ? (
        <EmptyState title="В команде никого нет" />
      ) : (
        <Table<TeamMember & Record<string, unknown>>
          data={members as (TeamMember & Record<string, unknown>)[]}
          idKey="principal_id"
          density="compact"
          columns={[
            {
              key: 'handle',
              header: 'Кто',
              width: proportional(2),
              renderCell: (m) => `${m.kind}:${m.handle}`,
            },
            {key: 'display_name', header: 'Имя', width: proportional(2)},
            {
              key: 'role',
              header: 'Роль',
              width: pixel(120),
              renderCell: (m) => <Token label={m.role === 'lead' ? 'лид' : 'участник'} size="sm" />,
            },
            {
              key: 'actions',
              header: '',
              width: pixel(110),
              align: 'end',
              renderCell: (m) => (
                <Button
                  size="sm"
                  variant="ghost"
                  label="Убрать"
                  onClick={() => act(() => api.removeTeamMember(teamKey, `${m.kind}:${m.handle}`))}
                />
              ),
            },
          ]}
        />
      )}
      <Card padding={4}>
        <VStack gap={3}>
          <Heading level={3}>Добавить или изменить роль</Heading>
          <FormLayout>
            <TextInput
              label="Принципал"
              description="user:alice или agent:reviewer-bot; без префикса — человек"
              value={principal}
              onChange={setPrincipal}
            />
            <Selector label="Роль в команде" options={TEAM_ROLES} value={role} onChange={setRole} />
          </FormLayout>
          <HStack gap={2}>
            <Button
              variant="primary"
              label="Сохранить"
              isDisabled={principal.trim() === ''}
              onClick={() =>
                act(async () => {
                  await api.setTeamMember(teamKey, principal.trim(), role);
                  setPrincipal('');
                })
              }
            />
          </HStack>
        </VStack>
      </Card>
    </VStack>
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
    <VStack gap={3}>
      <Heading level={2}>Доступ в проекты</Heading>
      <Text type="supporting" color="secondary">
        Уровень команды складывается с поимённым участием: действующий уровень человека — максимум
        из путей, а не последний назначенный. Выдаётся уровень в настройках самого проекта.
      </Text>
      {error ? <Failure error={error} /> : null}
      {projects.length === 0 ? (
        <EmptyState
          title="Команда никуда не пущена"
          description="Уровень выдаётся в настройках проекта, на вкладке «Команды»"
        />
      ) : (
        <Table<ProjectTeam & Record<string, unknown>>
          data={projects as (ProjectTeam & Record<string, unknown>)[]}
          idKey="project_id"
          density="compact"
          columns={[
            {key: 'project_key', header: 'Проект', width: proportional(2)},
            {
              key: 'level',
              header: 'Уровень',
              width: pixel(130),
              renderCell: (p) => <Token label={p.level} size="sm" />,
            },
            {
              key: 'created_at',
              header: 'С',
              width: pixel(160),
              renderCell: (p) => <Timestamp value={p.created_at} />,
            },
            {
              key: 'actions',
              header: '',
              width: pixel(110),
              align: 'end',
              renderCell: (p) => (
                <Button size="sm" variant="ghost" label="Убрать" onClick={() => remove(p.project_key)} />
              ),
            },
          ]}
        />
      )}
    </VStack>
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
    <VStack gap={3}>
      <Heading level={2}>Группы провайдера</Heading>
      <Text type="supporting" color="secondary">
        Состав такой команды пересчитывается при каждом входе её участников: кого провайдер в
        группе не вернул, того команда теряет. Лидов синхронизация не трогает — роль в команде
        ставит человек. Команда без групп ведётся руками.
      </Text>
      {error ? <Failure error={error} /> : null}
      <Loaded resource={groups}>
        {(list) => (
          <Card padding={4}>
            <VStack gap={3}>
              <TextInput
                label="Группы"
                description="через запятую, как они приходят в клейме groups"
                value={text ?? list.join(', ')}
                onChange={setText}
                isOptional
              />
              <HStack gap={2}>
                <Button
                  variant="primary"
                  label="Сохранить"
                  isDisabled={text === undefined}
                  onClick={() => save(text ?? '')}
                />
              </HStack>
            </VStack>
          </Card>
        )}
      </Loaded>
    </VStack>
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
    <VStack gap={3}>
      <Heading level={2}>Бюджет</Heading>
      <Text type="supporting" color="secondary">
        Расход — стоимость прогонов в проектах, которыми команда владеет, за календарное окно.
        Исчерпанный предел закрывает новые захваты задач; начатые прогоны доходят до конца. Ноль
        снимает предел: «без ограничения» и «ноль долларов» — разные вещи.
      </Text>
      {error ? <Failure error={error} /> : null}
      <Loaded resource={budgets}>
        {(state) =>
          state.budgets.length === 0 ? (
            <EmptyState title="Пределов нет" description="Команда тратит столько, сколько нужно" />
          ) : (
            <Table
              data={state.budgets.map((b) => ({...b, id: b.period ?? ''}))}
              idKey="id"
              density="compact"
              columns={[
                {
                  key: 'period',
                  header: 'Окно',
                  width: pixel(140),
                  renderCell: (b) => PERIODS.find((p) => p.value === b.period)?.label ?? String(b.period),
                },
                {
                  key: 'limit_usd',
                  header: 'Предел',
                  width: pixel(120),
                  renderCell: (b) => `$${Number(b.limit_usd ?? 0).toFixed(2)}`,
                },
                {
                  key: 'spent_usd',
                  header: 'Потрачено',
                  width: pixel(120),
                  renderCell: (b) => `$${Number(b.spent_usd).toFixed(2)}`,
                },
                {
                  key: 'state',
                  header: 'Состояние',
                  width: pixel(140),
                  renderCell: (b) =>
                    b.spent_usd >= Number(b.limit_usd ?? 0) ? (
                      <Badge variant="warning" label="исчерпан" />
                    ) : (
                      <Badge variant="success" label="в пределах" />
                    ),
                },
              ]}
            />
          )
        }
      </Loaded>
      <Card padding={4}>
        <VStack gap={3}>
          <Heading level={3}>Поставить предел</Heading>
          <FormLayout>
            <Selector label="Окно" options={PERIODS} value={period} onChange={setPeriod} />
            <TextInput
              label="Предел, $"
              description="ноль снимает предел"
              value={limit}
              onChange={setLimit}
            />
          </FormLayout>
          <HStack gap={2}>
            <Button variant="primary" label="Сохранить" isDisabled={limit.trim() === ''} onClick={save} />
          </HStack>
        </VStack>
      </Card>
    </VStack>
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
    <Section padding={6}>
      <VStack gap={4}>
        <Heading level={1}>Принципалы</Heading>
        <Text color="secondary">
          Аудит и права ссылаются на принципалов, а не на строки с именами. Человек заводится сам
          при первом входе через провайдера, агент — при выдаче токена, но и добавить его в команду
          можно заранее: принципал появится по хэндлу.
        </Text>
        <Card padding={4}>
          <HStack gap={2} vAlign="end">
            <TextInput
              label="Поиск"
              description="по хэндлу или имени"
              value={search}
              onChange={setSearch}
              onEnter={() => setApplied(search.trim())}
              isOptional
            />
            <Button label="Найти" onClick={() => setApplied(search.trim())} />
          </HStack>
        </Card>
        <Loaded resource={principals}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState title="Никого не нашлось" />
            ) : (
              <Table<Principal & Record<string, unknown>>
                data={list as (Principal & Record<string, unknown>)[]}
                idKey="id"
                density="compact"
                columns={[
                  {
                    key: 'handle',
                    header: 'Хэндл',
                    width: proportional(2),
                    renderCell: (p) => `${p.kind}:${p.handle}`,
                  },
                  {key: 'display_name', header: 'Имя', width: proportional(2)},
                  {
                    key: 'email',
                    header: 'Почта',
                    width: proportional(2),
                    renderCell: (p) => p.email ?? '—',
                  },
                  {
                    key: 'is_admin',
                    header: 'Права',
                    width: pixel(160),
                    renderCell: (p) =>
                      p.is_admin ? <Token label="администратор системы" size="sm" /> : null,
                  },
                  {
                    key: 'created_at',
                    header: 'Заведён',
                    width: pixel(160),
                    renderCell: (p) => <Timestamp value={p.created_at} />,
                  },
                ]}
              />
            )
          }
        </Loaded>
      </VStack>
    </Section>
  );
}
