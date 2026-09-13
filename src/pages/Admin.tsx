import {useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {toast} from 'sonner';

import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Separator} from '@/components/ui/separator';
import {FormLayout, NumberInput, Selector, Switch, TextInput} from '@/components/fields';
import {DataTable} from '@/components/DataTable';
import {ConfirmButton, EmptyState, Note, Page, PageHeader, Row, Section, Timestamp, Token} from '@/components/kit';

import {ApiError, api} from '../api/client';
import {startInstall} from '../api/github';
import {InstallationsList} from '../components/Installations';
import {InviteDialog, InvitesTable} from '../components/Invites';
import type {Me, Plan, Principal, ProjectTeam, Team, TeamDetail as TeamDetailData, TeamMember} from '../api/types';
import {useResource} from '../api/useResource';
import {Failure, Loaded, Loading} from '../components/Feedback';

// Команды и принципалы (решения 0027, 0033). Команда живёт над проектами: она
// даёт уровень доступа сразу в несколько, владеет проектами, несёт бюджет и
// тариф. Личный аккаунт — команда одного человека, заводится при входе;
// организацию заводит любой вошедший. Права на каждое действие проверяет
// бэкенд — страница их не угадывает и кнопки не прячет; исключение одно,
// список принципалов, он общесистемный и лиду команды не отдаётся вовсе.

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

const kindLabel = (team: Team) => (team.kind === 'personal' ? 'личный аккаунт' : 'организация');

// Роль в команде — перечень схемы; незнакомое значение показывается как есть.
const teamRoleLabel = (role?: string) =>
  role === 'lead' ? 'лид' : role === 'member' ? 'участник' : String(role ?? '—');

export function Teams() {
  const teams = useResource(() => api.listTeams(), []);
  const me = useResource(() => api.me(), []);
  const [picked, setPicked] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [search] = useSearchParams();

  if (teams.error) return <Failure error={teams.error} reload={teams.reload} />;
  if (!teams.data) return <Loading />;

  // Выбранная команда вычисляется, а не досылается эффектом: пока никого не
  // выбрали, открыта команда из адреса (?team=, туда ведёт принятое
  // приглашение), иначе личный аккаунт, а без него — первая в списке.
  const personal = teams.data.filter((t) => t.kind === 'personal');
  const organizations = teams.data.filter((t) => t.kind !== 'personal');
  const fromAddress = teams.data.find((t) => t.key === search.get('team'))?.key;
  const selected = picked ?? fromAddress ?? personal[0]?.key ?? teams.data[0]?.key;

  const list = (items: Team[]) => (
    <ul className="divide-border divide-y">
      {items.map((team) => (
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
  );

  return (
    <div className="flex min-h-[calc(100svh-3.5rem)]">
      <aside className="w-75 shrink-0 border-r">
        <div className="space-y-2 border-b p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Команды</h2>
            <Badge variant="secondary">{teams.data.length}</Badge>
          </div>
          <Button size="sm" className="w-full" onClick={() => setCreating(true)}>
            Завести организацию
          </Button>
        </div>
        {personal.length > 0 ? (
          <>
            <p className="text-muted-foreground px-3 pt-3 pb-1 text-xs font-medium uppercase">
              {personal.length === 1 ? 'Личный аккаунт' : 'Личные аккаунты'}
            </p>
            {list(personal)}
          </>
        ) : null}
        {organizations.length > 0 ? (
          <>
            <p className="text-muted-foreground px-3 pt-3 pb-1 text-xs font-medium uppercase">Организации</p>
            {list(organizations)}
          </>
        ) : null}
      </aside>
      <div className="min-w-0 flex-1 p-4">
        {creating ? (
          <NewTeam
            me={me.data}
            onDone={(team) => {
              setCreating(false);
              setPicked(team.key);
              teams.reload();
            }}
            onCancel={() => setCreating(false)}
          />
        ) : selected ? (
          <TeamDetail
            teamKey={selected}
            me={me.data}
            onChanged={teams.reload}
            onConverted={(org) => {
              setPicked(org.key);
              teams.reload();
            }}
          />
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

// Организацию заводит любой вошедший и становится её лидом (решение 0033).
// Право заводить проекты новая команда получает по режиму инстанса; выдать
// его явно может только администратор — остальным переключатель не показывается.
function NewTeam({me, onDone, onCancel}: {me?: Me; onDone: (team: Team) => void; onCancel: () => void}) {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [canCreateProjects, setCanCreateProjects] = useState(false);
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);
  const isAdmin = me?.principal.is_admin ?? false;

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const created = await api.createTeam({
        key: key.trim(),
        name: name.trim(),
        description: description.trim() || undefined,
        can_create_projects: isAdmin ? canCreateProjects : undefined,
      });
      toast.success(`Команда ${created.key} заведена`);
      onDone(created);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Новая организация"
        description="Вы станете её первым лидом: позовёте коллег и заведёте проекты. На бесплатном тарифе в организации до трёх участников. Личный аккаунт с уже заведёнными проектами можно превратить в организацию вместо этого."
      />
      {error ? <Failure error={error} /> : null}
      <Card className="gap-3 p-4">
        <FormLayout>
          <TextInput
            label="Ключ"
            description="короткий, латиницей: acme"
            value={key}
            onChange={setKey}
            isRequired
          />
          <TextInput label="Название" value={name} onChange={setName} isRequired />
          <TextInput label="Описание" value={description} onChange={setDescription} />
        </FormLayout>
        {isAdmin ? (
          <Switch
            label="Может заводить проекты"
            description="право принадлежит команде, а не человеку: лид меняется, команда остаётся"
            value={canCreateProjects}
            onChange={setCanCreateProjects}
          />
        ) : null}
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

function TeamDetail({
  teamKey,
  me,
  onChanged,
  onConverted,
}: {
  teamKey: string;
  me?: Me;
  onChanged: () => void;
  onConverted: (org: Team) => void;
}) {
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
      toast.success(`Команда ${teamKey} в архиве`);
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
                <Token label={kindLabel(detail.team)} />
                {detail.team.can_create_projects ? <Token label="заводит проекты" /> : null}
                {detail.team.archived_at ? <Token label="в архиве" /> : null}
                <ConfirmButton
                  title="Архивировать команду?"
                  description={`Команда ${detail.team.name} (${detail.team.key}) уйдёт в архив`}
                  onConfirm={archive}>
                  Архивировать
                </ConfirmButton>
              </div>
            </div>
            <p className="text-muted-foreground text-sm">
              {detail.team.key}
              {detail.team.description ? ` · ${detail.team.description}` : ''}
            </p>
          </div>
          {error ? <Failure error={error} /> : null}

          <PlanSection detail={detail} isAdmin={me?.principal.is_admin ?? false} onChanged={reload} />
          <Separator />
          {detail.team.kind === 'personal' ? (
            <Convert team={detail.team} onDone={onConverted} />
          ) : (
            <Members teamKey={teamKey} members={detail.members} onChanged={reload} />
          )}
          <Separator />
          <Projects teamKey={teamKey} projects={detail.projects} onChanged={reload} />
          <Separator />
          <Installations team={detail.team} installations={detail.installations} />
          <Separator />
          <IdPGroups teamKey={teamKey} />
          <Separator />
          <Budgets teamKey={teamKey} />
        </div>
      )}
    </Loaded>
  );
}

// Тариф — набор пределов (решение 0033). Показывается всем участникам:
// упёршись в предел, надо видеть, во что. Назначает тариф администратор
// инстанса, и только ему предлагается выбор.
function PlanSection({detail, isAdmin, onChanged}: {detail: TeamDetailData; isAdmin: boolean; onChanged: () => void}) {
  const plans = useResource(() => (isAdmin ? api.listPlans() : Promise.resolve([] as Plan[])), [isAdmin]);
  const [code, setCode] = useState<string>();
  const [error, setError] = useState<ApiError>();

  const members = detail.members.length;
  const limit = detail.plan.members_max;
  const save = async () => {
    setError(undefined);
    try {
      await api.setTeamPlan(detail.team.key, code ?? detail.plan.code);
      toast.success(`Тариф команды ${detail.team.key} сохранён`);
      setCode(undefined);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    }
  };

  return (
    <Section
      title="Тариф"
      description="Тариф ограничивает рост, а не доступ: исчерпанный предел не пускает новых участников, начатое продолжает работать.">
      {error ? <Failure error={error} /> : null}
      <Card className="gap-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3 text-sm">
          <span className="font-medium">{detail.plan.name}</span>
          <span className="text-muted-foreground">
            {limit === undefined || limit === null
              ? `участников ${members}, без предела`
              : `участников ${members} из ${limit}`}
          </span>
        </div>
        {isAdmin && plans.data && plans.data.length > 0 ? (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Selector
                label="Перевести на тариф"
                options={plans.data.map((p) => ({
                  value: p.code,
                  label: `${p.name}${p.members_max ? ` — до ${p.members_max} участников` : ' — без предела'}`,
                }))}
                value={code ?? detail.plan.code}
                onChange={setCode}
              />
            </div>
            <Button disabled={code === undefined || code === detail.plan.code} onClick={save}>
              Сохранить
            </Button>
          </div>
        ) : null}
      </Card>
    </Section>
  );
}

// Личный аккаунт — один человек. Чтобы позвать коллег, он превращается в
// организацию на месте: проекты остаются, вид меняется. Следующий вход
// заведёт человеку новый личный аккаунт.
function Convert({team, onDone}: {team: Team; onDone: (org: Team) => void}) {
  const [key, setKey] = useState(team.key);
  const [name, setName] = useState(team.name);
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const org = await api.convertTeam(team.key, {key: key.trim(), name: name.trim()});
      toast.success(`Команда ${org.key} теперь организация`);
      onDone(org);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Состав"
      description="Личный аккаунт — вы один, участников он не принимает. Чтобы работать с коллегами, превратите его в организацию: проекты останутся здесь, а личный аккаунт заведётся заново при следующем входе.">
      {error ? <Failure error={error} /> : null}
      <Note title="Превратить в организацию">
        <FormLayout>
          <TextInput label="Ключ организации" description="короткий, латиницей: acme" value={key} onChange={setKey} />
          <TextInput label="Название организации" value={name} onChange={setName} />
        </FormLayout>
        <div>
          <Button disabled={busy || key.trim() === '' || name.trim() === ''} onClick={submit}>
            Превратить
          </Button>
        </div>
      </Note>
      <TeamInvites teamKey={team.key} />
    </Section>
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
            renderCell: (m) => {
              const who = `${m.kind}:${m.handle}`;
              return (
                <ConfirmButton
                  title="Убрать из команды?"
                  description={`${who} потеряет доступ в проекты команды ${teamKey}`}
                  onConfirm={() =>
                    act(async () => {
                      await api.removeTeamMember(teamKey, who);
                      toast.success(`${who} убран из команды ${teamKey}`);
                    })
                  }>
                  Убрать
                </ConfirmButton>
              );
            },
          },
        ]}
      />
      <TeamInvites teamKey={teamKey} />
      <Card className="gap-3 p-4">
        <h3 className="text-base font-semibold">Добавить или изменить роль</h3>
        <FormLayout>
          <TextInput
            label="Принципал"
            description="user:alice — коллега, который уже входил; agent:reviewer-bot заводится на месте"
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
                const who = principal.trim();
                await api.setTeamMember(teamKey, who, role);
                toast.success(`Роль ${who} в команде ${teamKey} сохранена`);
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

// Приглашение ссылкой в команду (решение 0035). Рисуется и у организации, и у
// личного аккаунта: у личного бэкенд откажет, и его текст сам подскажет, что
// делать, — кнопка по виду команды не прячется.
function TeamInvites({teamKey}: {teamKey: string}) {
  const invites = useResource(() => api.listTeamInvites(teamKey), [teamKey]);
  const [role, setRole] = useState('member');
  const [days, setDays] = useState<number>();

  return (
    <InvitesTable
      invites={invites}
      target={(i) => <Token label={teamRoleLabel(i.team_role)} />}
      actions={
        <InviteDialog
          title={`Приглашение в команду ${teamKey}`}
          description="Ссылку откроет коллега: войдёт и станет участником команды с этой ролью. Заранее знать его логин не нужно."
          issue={() => api.createTeamInvite(teamKey, {role, days})}
          onIssued={invites.reload}>
          <Selector label="Роль в команде" options={TEAM_ROLES} value={role} onChange={setRole} />
          <NumberInput
            label="Срок в днях"
            description="пусто — срок по умолчанию"
            value={days}
            onChange={setDays}
          />
        </InviteDialog>
      }
    />
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
      toast.success(`Команда ${teamKey} убрана из проекта ${projectKey}`);
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
              <ConfirmButton
                title="Убрать доступ в проект?"
                description={`Команда ${teamKey} потеряет уровень в проекте ${p.project_key}`}
                onConfirm={() => remove(p.project_key)}>
                Убрать
              </ConfirmButton>
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
      toast.success(`Группы провайдера команды ${teamKey} сохранены`);
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

// Установки GitHub App на команде (решение 0034). Подключение уводит на
// GitHub и возвращается на страницу подключения; репозитории из установки
// выбираются уже из настроек проекта.
function Installations({team, installations}: {team: Team; installations: TeamDetailData['installations']}) {
  const settings = useResource(() => api.githubSettings(), []);
  const installURL = settings.data?.install_url;
  return (
    <Section
      title="GitHub"
      description="Установки приложения на аккаунтах и организациях GitHub, чьи репозитории команда подключает к проектам. Одна команда может держать несколько установок.">
      <Card className="gap-3 p-4">
        <InstallationsList installations={installations} />
        <div>
          <Button
            size="sm"
            disabled={!installURL}
            onClick={() => startInstall(installURL ?? '', {team: team.key, back: '/teams'})}>
            Подключить GitHub
          </Button>
        </div>
        {settings.data && !installURL ? (
          <p className="text-muted-foreground text-xs">
            Кнопка выключена: у инстанса не задан SDLC_GITHUB_APP_SLUG.
          </p>
        ) : null}
      </Card>
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
      toast.success(`Предел команды ${teamKey} сохранён`);
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
// чтобы найти человека, которого добавляют в команду: заранее, по хэндлу, он
// не заводится (решение 0033).
export function Principals() {
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const principals = useResource(() => api.listPrincipals(applied || undefined), [applied]);

  return (
    <Page>
      <PageHeader
        title="Принципалы"
        description="Аудит и права ссылаются на принципалов, а не на строки с именами. Человек заводится сам при первом входе через провайдера — заранее, по хэндлу, его не завести: иначе чужой логин можно было бы занять до входа. Агент заводится при выдаче токена или добавлении в состав."
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
