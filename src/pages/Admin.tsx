import {useState} from 'react';
import {useNavigate, useSearchParams} from 'react-router-dom';
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
import {AppStateNote, InstallationsList} from '../components/Installations';
import {InviteDialog, InvitesTable} from '../components/Invites';
import {BUDGET_INFO_NOTE, SUBSCRIPTION_LABEL, money, moneyOrUnknown} from '../components/cost';
import {counted} from '../components/removals';
import type {Me, Plan, Principal, ProjectTeam, Team, TeamDetail as TeamDetailData, TeamMember} from '../api/types';
import {useResource} from '../api/useResource';
import {Failure, Loaded, Loading} from '../components/Feedback';
import {NO_ACCESS_HINT, isSingle, useInstance} from '../hooks/useInstance';

// Команды и принципалы (решения 0027, 0033). Команда живёт над проектами: она
// даёт уровень доступа сразу в несколько, владеет проектами, несёт бюджет и
// тариф. Личный аккаунт — команда одного человека, заводится при входе;
// организацию заводит любой вошедший. Права на каждое действие проверяет
// бэкенд — страница их не угадывает и кнопки не прячет; исключение одно,
// список принципалов, он общесистемный и лиду команды не отдаётся вовсе.
//
// На выделенном инстансе компании (SDLC_TENANCY=single, CLAB-88) этого
// самообслуживания нет: команды заводит администратор, личных аккаунтов,
// организаций по кнопке и тарифов нет. Страница ветвится по профилю
// инстанса (useInstance), а не по виду команд и не по уровню доступа: там,
// где профиль действие предусматривает, кнопки по-прежнему не прячутся.

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
  const instance = useInstance();
  const [picked, setPicked] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [search] = useSearchParams();
  const navigate = useNavigate();

  if (teams.error) return <Failure error={teams.error} reload={teams.reload} />;
  // Профиль ждём вместе со списком: иначе страница мигнула бы разделами
  // общего инстанса до ответа /v1/instance.
  if (!teams.data || !instance) return <Loading />;

  const single = isSingle(instance);
  const isAdmin = me.data?.principal.is_admin ?? false;
  // На выделенном инстансе команду заводит только администратор — остальным
  // кнопка заведомо отбитого действия не предлагается.
  const canStart = single ? isAdmin : true;

  // Выбранная команда вычисляется, а не досылается эффектом: пока никого не
  // выбрали, открыта команда из адреса (?team=, туда ведёт принятое
  // приглашение), иначе личный аккаунт, а без него — первая в списке.
  const personal = teams.data.filter((t) => t.kind === 'personal');
  const organizations = teams.data.filter((t) => t.kind !== 'personal');
  const fromAddress = teams.data.find((t) => t.key === search.get('team'))?.key;
  const selected = picked ?? fromAddress ?? (single ? undefined : personal[0]?.key) ?? teams.data[0]?.key;

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
            end={team.can_create_projects ? <Token label="проекты" /> : null}>
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
          {canStart ? (
            <Button size="sm" className="w-full" onClick={() => setCreating(true)}>
              {single ? 'Завести команду' : 'Завести организацию'}
            </Button>
          ) : null}
        </div>
        {single ? (
          // Плоский список: групп «Личный аккаунт / Организации» в профиле нет,
          // заголовок «Команды» стоит выше.
          list(teams.data)
        ) : personal.length > 0 ? (
          <>
            <p className="text-muted-foreground px-3 pt-3 pb-1 text-xs font-medium uppercase">
              {personal.length === 1 ? 'Личный аккаунт' : 'Личные аккаунты'}
            </p>
            {list(personal)}
          </>
        ) : null}
        {!single && organizations.length > 0 ? (
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
            single={single}
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
            single={single}
            onChanged={teams.reload}
            onConverted={(org) => {
              setPicked(org.key);
              teams.reload();
            }}
            onDeleted={() => {
              // Удалённую команду выбирать нечем: выбор сбрасывается, а адрес
              // теряет ?team= — иначе список открылся бы на том, чего нет.
              setPicked(undefined);
              navigate('/teams');
              teams.reload();
            }}
          />
        ) : single ? (
          <EmptyState
            title="Команд нет"
            description={
              isAdmin
                ? 'Заведите первую команду кнопкой слева и позовите в неё коллег: команда даёт доступ сразу в несколько проектов и владеет теми, что завела сама.'
                : NO_ACCESS_HINT
            }
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
// На выделенном инстансе форма та же, но это просто команда: тарифа и личного
// аккаунта там нет, и заводит её администратор.
function NewTeam({
  me,
  single,
  onDone,
  onCancel,
}: {
  me?: Me;
  single: boolean;
  onDone: (team: Team) => void;
  onCancel: () => void;
}) {
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
      {single ? (
        <PageHeader
          title="Новая команда"
          description="Команда даёт уровень доступа сразу в несколько проектов и владеет теми, что завела. Вы станете её первым лидом: позовёте коллег и передадите лидерство, когда команда соберётся."
        />
      ) : (
        <PageHeader
          title="Новая организация"
          description="Вы станете её первым лидом: позовёте коллег и заведёте проекты. На бесплатном тарифе в организации до трёх участников. Личный аккаунт с уже заведёнными проектами можно превратить в организацию вместо этого."
        />
      )}
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
  single,
  onChanged,
  onConverted,
  onDeleted,
}: {
  teamKey: string;
  me?: Me;
  single: boolean;
  onChanged: () => void;
  onConverted: (org: Team) => void;
  onDeleted: () => void;
}) {
  const team = useResource(() => api.getTeam(teamKey), [teamKey]);

  // Список слева показывает имя и право заводить проекты, поэтому он
  // перезапрашивается вместе с командой, а не только при её создании.
  const reload = () => {
    team.reload();
    onChanged();
  };

  return (
    <Loaded resource={team}>
      {(detail) => (
        <div className="space-y-6">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{detail.team.name}</h1>
              <div className="flex items-center gap-2">
                {single ? null : <Token label={kindLabel(detail.team)} />}
                {detail.team.can_create_projects ? <Token label="заводит проекты" /> : null}
              </div>
            </div>
            <p className="text-muted-foreground text-sm">
              {detail.team.key}
              {detail.team.description ? ` · ${detail.team.description}` : ''}
            </p>
          </div>

          {/* Тариф — только если бэкенд его отдал: на выделенном инстансе
              (SDLC_TENANCY=single) поля plan в ответе нет, и раздел без него
              ронял бы всю страницу. В профиле single раздела нет в любом
              случае: профиль решает tenancy, а не наличие поля. */}
          {detail.plan && !single ? (
            <>
              <PlanSection
                detail={detail}
                plan={detail.plan}
                isAdmin={me?.principal.is_admin ?? false}
                onChanged={reload}
              />
              <Separator />
            </>
          ) : null}
          {/* Превращать личный аккаунт в организацию на выделенном инстансе
              незачем: у оставшейся с общего инстанса личной команды просто
              показывается состав. */}
          {detail.team.kind === 'personal' && !single ? (
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
          <Separator />
          <TeamDanger team={detail.team} single={single} onDeleted={onDeleted} />
        </div>
      )}
    </Loaded>
  );
}

// Тариф — набор пределов (решение 0033). Показывается всем участникам:
// упёршись в предел, надо видеть, во что. Назначает тариф администратор
// инстанса, и только ему предлагается выбор.
function PlanSection({
  detail,
  plan,
  isAdmin,
  onChanged,
}: {
  detail: TeamDetailData;
  plan: Plan;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const plans = useResource(() => (isAdmin ? api.listPlans() : Promise.resolve([] as Plan[])), [isAdmin]);
  const [code, setCode] = useState<string>();
  const [error, setError] = useState<ApiError>();

  const members = detail.members.length;
  const limit = plan.members_max;
  const save = async () => {
    setError(undefined);
    try {
      await api.setTeamPlan(detail.team.key, code ?? plan.code);
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
          <span className="font-medium">{plan.name}</span>
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
                value={code ?? plan.code}
                onChange={setCode}
              />
            </div>
            <Button disabled={code === undefined || code === plan.code} onClick={save}>
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
  // Состояние приложения у провайдера приходит вместе с установками команды
  // (CLAB-79). Не ответило или бэкенд его не отдаёт — раздел как раньше.
  const github = useResource(() => api.teamGitHub(team.key), [team.key]);
  const app = github.data?.app;
  const installURL = settings.data?.install_url;
  return (
    <Section
      title="GitHub"
      description="Установки приложения на аккаунтах и организациях GitHub, чьи репозитории команда подключает к проектам. Одна команда может держать несколько установок.">
      <Card className="gap-3 p-4">
        <AppStateNote app={app} />
        <InstallationsList installations={installations} app={app} />
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
      description="Расход — только деньги: отчёты с оплатой по API и без указанного типа в проектах, которыми команда владеет, за календарное окно. Работа на подписке в предел не входит никогда, её условная стоимость показана рядом для сведения. Исчерпанный предел закрывает новые захваты задач; начатые прогоны доходят до конца. Ноль снимает предел: «без ограничения» и «ноль долларов» — разные вещи.">
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
                renderCell: (b) => money(Number(b.limit_usd ?? 0)),
              },
              {
                key: 'spent_usd',
                header: 'Потрачено (деньги)',
                width: 150,
                renderCell: (b) => money(Number(b.spent_usd)),
              },
              {
                key: 'subscription_usd',
                header: SUBSCRIPTION_LABEL,
                width: 190,
                renderCell: (b) => (
                  <div className="flex flex-col" data-budget-subscription>
                    <span className="tabular-nums">{moneyOrUnknown(b.subscription_usd)}</span>
                    <span className="text-muted-foreground text-xs font-normal whitespace-normal">{BUDGET_INFO_NOTE}</span>
                  </div>
                ),
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

// ── опасная зона ────────────────────────────────────────────────────────────

// Удаление арендатора делается только отсюда: ни в CLI, ни в MCP его нет.
// Уходит всё, чем команда владеет, — её проекты целиком, — поэтому зона стоит
// отдельно от состава и приглашений и просит ввести ключ организации.
//
// У личного аккаунта её нет: он уходит вместе с человеком и отдельно не
// удаляется. Вид команды — данные (team.kind), а не уровень доступа; по
// уровню кнопки по-прежнему не прячутся, 403 показывает бэкенд.
function TeamDanger({team, single, onDeleted}: {team: Team; single: boolean; onDeleted: () => void}) {
  const [error, setError] = useState<ApiError>();

  const remove = async () => {
    setError(undefined);
    try {
      const {team: deleted, removed} = await api.deleteTeam(team.key);
      toast.success(`Организация ${deleted.key} удалена`, {
        description:
          removed.project_keys.length > 0
            ? `вместе с проектами: ${removed.project_keys.join(', ')}`
            : counted([
                ['проектов', removed.projects],
                ['участников', removed.members],
                ['доступов в чужие проекты', removed.project_grants],
                ['приглашений', removed.invites],
                ['установок GitHub', removed.installations],
                ['пределов бюджета', removed.budgets],
                ['групп провайдера', removed.idp_groups],
              ]),
      });
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    }
  };

  if (team.kind === 'personal' && single) {
    // Личная команда, оставшаяся с общего инстанса: удаляется вместе с
    // человеком. Про личный аккаунт и организации здесь не говорится — в
    // профиле их нет.
    return (
      <Section title="Опасная зона">
        <p className="text-muted-foreground text-sm">
          Эта команда принадлежит одному человеку и уходит вместе с ним, отдельно она не удаляется.
        </p>
      </Section>
    );
  }

  if (team.kind === 'personal') {
    return (
      <Section title="Опасная зона">
        <p className="text-muted-foreground text-sm">
          Личный аккаунт уходит вместе с человеком и отдельно не удаляется. Чтобы работать с
          коллегами, превратите его в организацию — её потом можно удалить целиком.
        </p>
      </Section>
    );
  }

  return (
    <Section
      title="Опасная зона"
      description="Действия отсюда необратимы: восстановления и корзины у сервиса нет.">
      {error ? <Failure error={error} /> : null}
      <Card className="border-destructive/40 bg-destructive/5 gap-3 p-4">
        <div className="space-y-1">
          <h3 className="text-destructive text-base font-semibold">
            Удалить организацию {team.key}
          </h3>
          <p className="text-muted-foreground text-sm">
            Вместе с организацией удаляются проекты, которыми она владеет, — целиком, со всеми
            задачами и артефактами. Состав, приглашения, установки GitHub, бюджеты и группы
            провайдера исчезают тоже. Это единственный способ удалить арендатора: в CLI его нет.
          </p>
        </div>
        <div>
          <ConfirmButton
            variant="destructive"
            title={`Удалить организацию ${team.key}?`}
            description={`Организация ${team.name} (${team.key}) исчезнет вместе со своими проектами — каждый целиком, с задачами, прогонами и артефактами, — а также с составом, приглашениями, установками GitHub, бюджетами и группами провайдера. Данные удаляются сразу, восстановления не будет. Введите ключ организации, чтобы подтвердить.`}
            confirmPhrase={team.key}
            phraseLabel={`Ключ организации (${team.key})`}
            onConfirm={remove}>
            Удалить организацию
          </ConfirmButton>
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
