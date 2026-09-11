import {useState} from 'react';
import {useParams} from 'react-router-dom';

import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Separator} from '@/components/ui/separator';
import {FormLayout, MultiSelector, Selector, TextArea, TextInput} from '@/components/fields';
import {DataTable} from '@/components/DataTable';
import {CodeBlock, EmptyState, Note, Page, PageHeader, Section, Token} from '@/components/kit';

import {ApiError, api} from '../api/client';
import {startInstall, startReauth} from '../api/github';
import {InstallationsList} from '../components/Installations';
import type {
  AccessToken,
  GitHubStatus,
  ImportEntry,
  ImportReport,
  Me,
  ProjectMember,
  ProjectTeam,
  RepoAccess,
  Role,
} from '../api/types';
import {useResource} from '../api/useResource';
import {Failure, Loaded} from '../components/Feedback';

const LEVELS = [
  {value: 'viewer', label: 'viewer — только чтение'},
  {value: 'agent', label: 'agent — работа над задачами'},
  {value: 'maintainer', label: 'maintainer — роли, цикл, апрувы, импорт'},
  {value: 'admin', label: 'admin — участники и токены'},
];

// Настройки проекта: участники и уровни прав, токены, перенос связки.
// Уровни участия — фиксированный перечень схемы (project_members.role), в
// отличие от ролей специалистов, которые придумывает проект.
export function Settings() {
  const {projectKey = ''} = useParams();
  const me = useResource(() => api.me(), []);

  return (
    <Page>
      <PageHeader title={`Настройки проекта ${projectKey}`} />
      <Loaded resource={me}>
        {(who) => (
          <div className="space-y-6">
            {who.mode === 'header' ? (
              <Note
                title="Режим отладки: права не проверяются"
                description="Бэкенд запущен с SDLC_AUTH_MODE=header — актор берётся из заголовка. Участники и токены заводятся, но действуют только в режиме токенов."
              />
            ) : null}
            <Members projectKey={projectKey} />
            <Separator />
            <Teams projectKey={projectKey} />
            <Separator />
            <GitHubAccess projectKey={projectKey} />
            <Separator />
            <Tokens projectKey={projectKey} me={who} />
            <Separator />
            <Transfer projectKey={projectKey} />
          </div>
        )}
      </Loaded>
    </Page>
  );
}

// ── роли специалистов ───────────────────────────────────────────────────────

// Роли, которые участник может забирать, задаются на участии, а токен их
// только сужает (решение 0030). Пустой выбор — любые роли проекта: та же
// договорённость, что у токена.
function roleOptions(roles: Role[]) {
  return roles.filter((r) => !r.archived_at).map((r) => ({value: r.key, label: `${r.name} (${r.key})`}));
}

function RoleKeys({keys}: {keys: string[] | null}) {
  if (keys === null) return <span className="text-muted-foreground text-xs">любые</span>;
  if (keys.length === 0) return <span className="text-muted-foreground text-xs">ни одной</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {keys.map((k) => (
        <Token key={k} label={k} />
      ))}
    </span>
  );
}

// ── участники ───────────────────────────────────────────────────────────────

function Members({projectKey}: {projectKey: string}) {
  const members = useResource(() => api.listMembers(projectKey), [projectKey]);
  const roles = useResource(() => api.listRoles(projectKey), [projectKey]);
  const [principal, setPrincipal] = useState('');
  const [level, setLevel] = useState('viewer');
  const [roleKeys, setRoleKeys] = useState<string[]>([]);
  const [error, setError] = useState<ApiError>();

  const act = async (fn: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await fn();
      members.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    }
  };

  return (
    <Section
      title="Участники"
      description="Уровень — про права, роли специалистов — про то, какие этапы участник может забирать. Без ролей забирает любые; токен агента может только сузить этот набор.">
      {error ? <Failure error={error} /> : null}
      <Loaded resource={members}>
        {(list) => (
          <DataTable<ProjectMember>
            data={list}
            idKey="principal_id"
            empty={
              <EmptyState
                title="Участников нет"
                description="В режиме токенов проект без участников виден только администратору системы."
              />
            }
            columns={[
              {key: 'handle', header: 'Кто', renderCell: (m) => `${m.kind}:${m.handle}`},
              {key: 'display_name', header: 'Имя'},
              {
                key: 'role',
                header: 'Уровень',
                width: 130,
                renderCell: (m) => <Token label={m.role} />,
              },
              {
                key: 'role_keys',
                header: 'Роли',
                renderCell: (m) => <RoleKeys keys={m.role_keys} />,
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
                    onClick={() => act(() => api.removeMember(projectKey, `${m.kind}:${m.handle}`))}>
                    Убрать
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Loaded>
      <Card className="gap-3 p-4">
        <h3 className="text-base font-semibold">Добавить или изменить уровень</h3>
        <FormLayout>
          <TextInput
            label="Принципал"
            description="user:alice — коллега, который уже входил; agent:reviewer-bot заводится на месте"
            value={principal}
            onChange={setPrincipal}
          />
          <Selector label="Уровень" options={LEVELS} value={level} onChange={setLevel} />
          <MultiSelector
            label="Роли специалиста"
            description="какие этапы участник может забирать; пусто — любые"
            options={roleOptions(roles.data ?? [])}
            value={roleKeys}
            onChange={setRoleKeys}
            placeholder="Любые роли"
          />
        </FormLayout>
        <div>
          <Button
            disabled={principal.trim() === ''}
            onClick={() =>
              act(async () => {
                await api.setMember(projectKey, principal.trim(), level, roleKeys);
                setPrincipal('');
                setRoleKeys([]);
              })
            }>
            Сохранить
          </Button>
        </div>
      </Card>
    </Section>
  );
}

// ── команды в проекте ───────────────────────────────────────────────────────

// Уровень команды складывается с поимённым участием: действующий уровень
// человека — максимум из путей (решение 0027). Команда-владелец отдельно: её
// лид — администратор проекта по умолчанию, и убрать его отсюда нельзя.
function Teams({projectKey}: {projectKey: string}) {
  const teams = useResource(() => api.listProjectTeams(projectKey), [projectKey]);
  const project = useResource(() => api.getProject(projectKey), [projectKey]);
  const roles = useResource(() => api.listRoles(projectKey), [projectKey]);
  const [team, setTeam] = useState('');
  const [level, setLevel] = useState('viewer');
  const [roleKeys, setRoleKeys] = useState<string[]>([]);
  const [error, setError] = useState<ApiError>();

  const act = async (fn: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await fn();
      teams.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    }
  };

  const ownerTeam = project.data?.project.owner_team_key;

  return (
    <Section
      title="Команды"
      description={`Команда получает уровень в проекте так же, как человек. Её участники приходят с этим уровнем, даже если поимённо в проекте не состоят.${
        ownerTeam ? ` Проект завела команда ${ownerTeam}: её лид — администратор проекта.` : ''
      }`}>
      {error ? <Failure error={error} /> : null}
      <Loaded resource={teams}>
        {(list) => (
          <DataTable<ProjectTeam>
            data={list}
            idKey="team_id"
            empty={
              <EmptyState
                title="Команд в проекте нет"
                description="Права раздаются поимённо; команду можно пустить сюда целиком"
              />
            }
            columns={[
              {key: 'team_name', header: 'Команда'},
              {key: 'team_key', header: 'Ключ'},
              {
                key: 'level',
                header: 'Уровень',
                width: 130,
                renderCell: (t) => <Token label={t.level} />,
              },
              {
                key: 'role_keys',
                header: 'Роли',
                renderCell: (t) => <RoleKeys keys={t.role_keys} />,
              },
              {
                key: 'actions',
                header: '',
                width: 110,
                align: 'end',
                renderCell: (t) => (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => act(() => api.removeProjectTeam(projectKey, t.team_key))}>
                    Убрать
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Loaded>
      <Card className="gap-3 p-4">
        <h3 className="text-base font-semibold">Пустить команду или изменить уровень</h3>
        <FormLayout>
          <TextInput
            label="Ключ команды"
            description="как в разделе «Команды»: platform"
            value={team}
            onChange={setTeam}
          />
          <Selector label="Уровень" options={LEVELS} value={level} onChange={setLevel} />
          <MultiSelector
            label="Роли специалиста"
            description="для всех участников команды; пусто — любые"
            options={roleOptions(roles.data ?? [])}
            value={roleKeys}
            onChange={setRoleKeys}
            placeholder="Любые роли"
          />
        </FormLayout>
        <div>
          <Button
            disabled={team.trim() === ''}
            onClick={() =>
              act(async () => {
                await api.setProjectTeam(projectKey, team.trim(), level, roleKeys);
                setTeam('');
                setRoleKeys([]);
              })
            }>
            Сохранить
          </Button>
        </div>
      </Card>
    </Section>
  );
}

// ── доступ к GitHub ─────────────────────────────────────────────────────────

// Установка приложения принадлежит команде-владельцу проекта (решение 0034):
// её подключают кнопкой, а репозитории выбирают из списка после возврата от
// GitHub. В базе лежат ссылки, а не секреты: имя секрета для запасного пути
// приезжает из окружения (SDLC_GITHUB_TOKEN_<ИМЯ>). Проверка доступа ходит в
// провайдера, поэтому делается по кнопке, а не при открытии страницы.
function GitHubAccess({projectKey}: {projectKey: string}) {
  const github = useResource(() => api.getProjectGitHub(projectKey), [projectKey]);
  const settings = useResource(() => api.githubSettings(), []);
  const [credential, setCredential] = useState<string>();
  const [status, setStatus] = useState<GitHubStatus>();
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    } finally {
      setBusy(false);
    }
  };
  const back = `/p/${projectKey}/settings`;

  return (
    <Section
      title="Доступ к GitHub"
      description="Репозитории читает установка приложения на аккаунте или организации GitHub. Установка записана на команду-владельца проекта; подключается кнопкой, репозитории выбираются из списка. Учётные данные берутся от частного к общему: секрет репозитория, установка репозитория, установка проекта, секрет проекта, общий токен инстанса.">
      {error ? <Failure error={error} /> : null}
      <Loaded resource={github}>
        {(gh) => {
          const installURL = settings.data?.install_url;
          const canPick = (settings.data?.enabled ?? false) && gh.installations.some((i) => !i.removed_at && !i.suspended_at);
          return (
            <Card className="gap-4 p-4">
              <div className="space-y-2">
                <p className="text-muted-foreground text-xs">
                  Установки команды {gh.owner_team_key || '—'}
                </p>
                <InstallationsList installations={gh.installations} />
                {gh.installation_id ? (
                  <p className="text-muted-foreground text-xs">
                    Установка по умолчанию у проекта: {gh.installation_id} — задана до перехода на установки команды и
                    действует для репозиториев без своей.
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy || !installURL}
                  onClick={() => startInstall(installURL ?? '', {team: gh.owner_team_key, project: projectKey, back})}>
                  Подключить GitHub
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy || !canPick || !settings.data}
                  onClick={() => settings.data && startReauth(settings.data, {team: gh.owner_team_key, project: projectKey, back})}>
                  Выбрать репозитории
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => run(async () => setStatus(await api.checkProjectGitHub(projectKey)))}>
                  Проверить доступ
                </Button>
              </div>
              {settings.data && !installURL ? (
                <Note
                  title="Кнопка подключения выключена"
                  description="Без SDLC_GITHUB_APP_SLUG сервис не знает адреса установки приложения; вход через GitHub при этом может работать."
                />
              ) : null}
              <FormLayout>
                <TextInput
                  label="Секрет доступа"
                  description="запасной путь без приложения: имя секрета, значение которого приезжает из SDLC_GITHUB_TOKEN_<ИМЯ>"
                  value={credential ?? (gh.credential_ref ?? '')}
                  onChange={setCredential}
                />
              </FormLayout>
              <div>
                <Button
                  variant="secondary"
                  disabled={busy || credential === undefined}
                  onClick={() =>
                    run(async () => {
                      const ref = (credential ?? '').trim();
                      await api.setProjectGitHub(projectKey, {credential_ref: ref === '' ? null : ref});
                      setCredential(undefined);
                      setStatus(undefined);
                      github.reload();
                    })
                  }>
                  Сохранить секрет
                </Button>
              </div>
              {status ? <AccessReport status={status} /> : null}
            </Card>
          );
        }}
      </Loaded>
    </Section>
  );
}

function AccessReport({status}: {status: GitHubStatus}) {
  return (
    <div className="space-y-2">
      {status.app_configured ? null : (
        <Note
          title="Приложение у инстанса не настроено"
          description="Без SDLC_GITHUB_APP_ID и ключа установку прописывать некуда: доступ пойдёт именованным секретом или общим токеном."
        />
      )}
      <DataTable
        data={status.repositories.map((r) => ({...r, id: r.repository}))}
        idKey="id"
        empty={
          <EmptyState
            title="Проверять нечего"
            description="У проекта нет репозиториев GitHub в области"
          />
        }
        columns={[
          {key: 'repository', header: 'Репозиторий'},
          {
            key: 'ok',
            header: 'Доступ',
            width: 120,
            renderCell: (r) =>
              r.ok ? <Badge>есть</Badge> : <Badge variant="destructive">нет</Badge>,
          },
          {key: 'source', header: 'Чем проверяли', renderCell: (r) => accessSource(r)},
          {key: 'error', header: 'Что не так'},
        ]}
      />
    </div>
  );
}

// Подпись источника учётных данных. source — значение протокола, а не данные
// проекта, поэтому словарь живёт рядом с таблицей. Старый бэкенд поля не
// присылает — тогда прочерк.
function accessSource(r: RepoAccess): string {
  switch (r.source) {
    case undefined:
      return '—';
    case 'repository_secret':
      return `секрет репозитория ${r.credential_ref ?? ''}`;
    case 'repository_installation':
      return `установка репозитория ${r.installation_id ?? ''}`;
    case 'project_installation':
      return `установка проекта ${r.installation_id ?? ''}`;
    case 'project_secret':
      return `секрет проекта ${r.credential_ref ?? ''}`;
    case 'instance':
      return 'токен инстанса';
    default:
      // Бэкенд новее интерфейса: показать как есть, а не прятать.
      return String(r.source);
  }
}

// ── токены ──────────────────────────────────────────────────────────────────

function Tokens({projectKey, me}: {projectKey: string; me: Me}) {
  const isProjectAdmin =
    me.principal.is_admin || me.memberships.some((m) => m.project_key === projectKey && m.role === 'admin');
  // Администратор проекта видит все его токены; остальные — только свои.
  const tokens = useResource(
    () => api.listTokens(isProjectAdmin ? projectKey : undefined),
    [projectKey, isProjectAdmin],
  );
  const [name, setName] = useState('');
  const [principal, setPrincipal] = useState('');
  const [roles, setRoles] = useState('');
  const [days, setDays] = useState('');
  const [issued, setIssued] = useState<string>();
  const [error, setError] = useState<ApiError>();

  const issue = async () => {
    setError(undefined);
    setIssued(undefined);
    try {
      const res = await api.issueToken({
        name: name.trim(),
        principal: principal.trim() || undefined,
        project: projectKey,
        role_keys: roles
          .split(',')
          .map((r) => r.trim())
          .filter(Boolean),
        expires_in_days: days ? Number(days) : undefined,
      });
      setIssued(res.token);
      setName('');
      setPrincipal('');
      setRoles('');
      tokens.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    }
  };

  const revoke = async (id: string) => {
    setError(undefined);
    try {
      await api.revokeToken(id);
      tokens.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    }
  };

  return (
    <Section
      title="Токены"
      description="Токен показывается один раз при выдаче; в базе лежит только хеш. Токен агента привязан к проекту и может быть ограничен ролями, которые он вправе забирать.">
      {error ? <Failure error={error} /> : null}
      {issued ? (
        <Note tone="success" title="Токен выдан — скопируйте его сейчас">
          <CodeBlock code={issued} />
        </Note>
      ) : null}
      <Loaded resource={tokens}>
        {(list) => (
          <DataTable<AccessToken>
            data={list}
            idKey="id"
            empty={<EmptyState title="Токенов нет" />}
            columns={[
              {key: 'name', header: 'Имя'},
              {key: 'handle', header: 'Кому', renderCell: (t) => `${t.kind}:${t.handle}`},
              {key: 'prefix', header: 'Начало', width: 130},
              {
                key: 'role_keys',
                header: 'Роли',
                renderCell: (t) => (t.role_keys.length ? t.role_keys.join(', ') : 'любые'),
              },
              {
                key: 'revoked_at',
                header: 'Состояние',
                width: 120,
                renderCell: (t) =>
                  t.revoked_at ? (
                    <Badge variant="secondary">отозван</Badge>
                  ) : t.expires_at && new Date(t.expires_at) < new Date() ? (
                    <Badge variant="secondary">истёк</Badge>
                  ) : (
                    <Badge>действует</Badge>
                  ),
              },
              {
                key: 'actions',
                header: '',
                width: 110,
                align: 'end',
                renderCell: (t) =>
                  t.revoked_at ? null : (
                    <Button size="sm" variant="ghost" onClick={() => revoke(t.id)}>
                      Отозвать
                    </Button>
                  ),
              },
            ]}
          />
        )}
      </Loaded>
      <Card className="gap-3 p-4">
        <h3 className="text-base font-semibold">Выдать токен</h3>
        <FormLayout>
          <TextInput
            label="Имя"
            description="по нему токен потом отзывают"
            value={name}
            onChange={setName}
            isRequired
          />
          <TextInput
            label="Кому"
            description="пусто — себе; agent:reviewer-bot — агенту (нужен уровень admin в проекте)"
            value={principal}
            onChange={setPrincipal}
          />
          <TextInput
            label="Роли специалистов"
            description="через запятую; агент с этим токеном сможет забирать только их этапы"
            value={roles}
            onChange={setRoles}
          />
          <TextInput
            label="Срок в днях"
            description="пусто — бессрочно"
            value={days}
            onChange={setDays}
          />
        </FormLayout>
        <div>
          <Button disabled={name.trim() === ''} onClick={issue}>
            Выдать
          </Button>
        </div>
      </Card>
    </Section>
  );
}

// ── перенос связки ──────────────────────────────────────────────────────────

function Transfer({projectKey}: {projectKey: string}) {
  const [exported, setExported] = useState<string>();
  const [text, setText] = useState('');
  const [report, setReport] = useState<ImportReport>();
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    } finally {
      setBusy(false);
    }
  };

  const parse = (): unknown => {
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new ApiError('invalid_input', `связка не разбирается как JSON: ${String(err)}`);
    }
  };

  return (
    <Section
      title="Перенос правил"
      description="Связка — репозитории, роли с инструкциями, документы и цикл одним JSON. Импорт идемпотентен: роль с другой инструкцией получает новую версию, документ с тем же названием обновляется, цикл приходит черновиком. Агенту тот же перенос доступен промптом /mcp__sdlc__import_rules.">
      {error ? <Failure error={error} /> : null}
      <div>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const bundle = await api.exportBundle(projectKey);
              setExported(JSON.stringify(bundle, null, 2));
            })
          }>
          Экспортировать проект
        </Button>
      </div>
      {exported ? (
        <CodeBlock code={exported} language="json" title="bundle.json" maxHeight={360} />
      ) : null}
      <Card className="gap-3 p-4">
        <h3 className="text-base font-semibold">Импортировать связку</h3>
        <TextArea
          label="Связка JSON"
          value={text}
          onChange={setText}
          rows={10}
          placeholder='{"version": 1, "roles": [...], "documents": [...]}'
        />
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={busy || text.trim() === ''}
            onClick={() => run(async () => setReport(await api.importBundle(projectKey, parse(), true)))}>
            Проверить (без изменений)
          </Button>
          <Button
            disabled={busy || text.trim() === ''}
            onClick={() => run(async () => setReport(await api.importBundle(projectKey, parse(), false)))}>
            Применить
          </Button>
        </div>
        {report ? <Report report={report} /> : null}
      </Card>
    </Section>
  );
}

function Report({report}: {report: ImportReport}) {
  const rows: (ImportEntry & {section: string})[] = [
    ...report.repositories.map((e) => ({...e, section: 'репозиторий'})),
    ...report.roles.map((e) => ({...e, section: 'роль'})),
    ...report.documents.map((e) => ({...e, section: 'документ'})),
    // Циклов в связке столько, сколько типов задач: у проекта с эпиками их
    // как минимум два (решение 0024).
    ...report.workflows.map((e) => ({...e, section: 'цикл'})),
  ];
  return (
    <div className="space-y-2">
      <Note
        tone={report.dry_run ? 'info' : 'success'}
        title={report.dry_run ? 'Сухой прогон: так изменится проект' : 'Связка применена'}
      />
      <DataTable
        data={rows}
        idKey={(r) => `${r.section}/${r.key}`}
        empty={<EmptyState title="В связке ничего нет" />}
        columns={[
          {key: 'section', header: 'Что', width: 120},
          {key: 'key', header: 'Ключ'},
          {
            key: 'outcome',
            header: 'Итог',
            width: 140,
            renderCell: (r) => <Token label={String(r.outcome)} />,
          },
          {key: 'detail', header: 'Подробности'},
        ]}
      />
      {report.workflow_validations.map((validation, i) => (
        <Note
          key={report.workflows[i]?.key ?? i}
          tone={validation.valid ? 'success' : 'warning'}
          title={
            validation.valid
              ? `Цикл «${report.workflows[i]?.key ?? ''}» прошёл проверку графа; активируйте черновик в редакторе цикла`
              : `Черновик цикла «${report.workflows[i]?.key ?? ''}» создан, но проверку не прошёл`
          }
          description={validation.problems.map((p) => p.message).join('; ')}
        />
      ))}
    </div>
  );
}
