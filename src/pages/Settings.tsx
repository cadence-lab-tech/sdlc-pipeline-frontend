import {useState} from 'react';
import {useParams} from 'react-router-dom';
import {Badge} from '@astryxdesign/core/Badge';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {CodeBlock} from '@astryxdesign/core/CodeBlock';
import {Divider} from '@astryxdesign/core/Divider';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {FormLayout} from '@astryxdesign/core/FormLayout';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {Section} from '@astryxdesign/core/Section';
import {Selector} from '@astryxdesign/core/Selector';
import {Table, pixel, proportional} from '@astryxdesign/core/Table';
import {Heading, Text} from '@astryxdesign/core/Text';
import {TextArea} from '@astryxdesign/core/TextArea';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Token} from '@astryxdesign/core/Token';

import {ApiError, api} from '../api/client';
import type {
  AccessToken,
  GitHubStatus,
  ImportEntry,
  ImportReport,
  Me,
  ProjectMember,
  ProjectTeam,
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
    <Section padding={6}>
      <VStack gap={6}>
        <Heading level={1}>Настройки проекта {projectKey}</Heading>
        <Loaded resource={me}>
          {(who) => (
            <>
              {who.mode === 'header' ? (
                <Banner
                  status="info"
                  title="Режим отладки: права не проверяются"
                  description="Бэкенд запущен с SDLC_AUTH_MODE=header — актор берётся из заголовка. Участники и токены заводятся, но действуют только в режиме токенов."
                />
              ) : null}
              <Members projectKey={projectKey} />
              <Divider />
              <Teams projectKey={projectKey} />
              <Divider />
              <GitHubAccess projectKey={projectKey} />
              <Divider />
              <Tokens projectKey={projectKey} me={who} />
              <Divider />
              <Transfer projectKey={projectKey} />
            </>
          )}
        </Loaded>
      </VStack>
    </Section>
  );
}

// ── участники ───────────────────────────────────────────────────────────────

function Members({projectKey}: {projectKey: string}) {
  const members = useResource(() => api.listMembers(projectKey), [projectKey]);
  const [principal, setPrincipal] = useState('');
  const [level, setLevel] = useState('viewer');
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
    <VStack gap={3}>
      <Heading level={2}>Участники</Heading>
      <Text type="supporting" color="secondary">
        Уровень — про права, а не про роль специалиста: агент с уровнем agent забирает задачи любой
        роли, если его токен не ограничен.
      </Text>
      {error ? <Failure error={error} /> : null}
      <Loaded resource={members}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState
              title="Участников нет"
              description="В режиме токенов проект без участников виден только администратору системы."
            />
          ) : (
            <Table<ProjectMember & Record<string, unknown>>
              data={list as (ProjectMember & Record<string, unknown>)[]}
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
                  header: 'Уровень',
                  width: pixel(130),
                  renderCell: (m) => <Token label={m.role} size="sm" />,
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
                      onClick={() => act(() => api.removeMember(projectKey, `${m.kind}:${m.handle}`))}
                    />
                  ),
                },
              ]}
            />
          )
        }
      </Loaded>
      <Card padding={4}>
        <VStack gap={3}>
          <Heading level={3}>Добавить или изменить уровень</Heading>
          <FormLayout>
            <TextInput
              label="Принципал"
              description="user:alice или agent:reviewer-bot; без префикса — человек"
              value={principal}
              onChange={setPrincipal}
            />
            <Selector label="Уровень" options={LEVELS} value={level} onChange={setLevel} />
          </FormLayout>
          <HStack gap={2}>
            <Button
              variant="primary"
              label="Сохранить"
              isDisabled={principal.trim() === ''}
              onClick={() =>
                act(async () => {
                  await api.setMember(projectKey, principal.trim(), level);
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

// ── команды в проекте ───────────────────────────────────────────────────────

// Уровень команды складывается с поимённым участием: действующий уровень
// человека — максимум из путей (решение 0027). Команда-владелец отдельно: её
// лид — администратор проекта по умолчанию, и убрать его отсюда нельзя.
function Teams({projectKey}: {projectKey: string}) {
  const teams = useResource(() => api.listProjectTeams(projectKey), [projectKey]);
  const project = useResource(() => api.getProject(projectKey), [projectKey]);
  const [team, setTeam] = useState('');
  const [level, setLevel] = useState('viewer');
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
    <VStack gap={3}>
      <Heading level={2}>Команды</Heading>
      <Text type="supporting" color="secondary">
        Команда получает уровень в проекте так же, как человек. Её участники приходят с этим
        уровнем, даже если поимённо в проекте не состоят.
        {ownerTeam ? ` Проект завела команда ${ownerTeam}: её лид — администратор проекта.` : ''}
      </Text>
      {error ? <Failure error={error} /> : null}
      <Loaded resource={teams}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState
              title="Команд в проекте нет"
              description="Права раздаются поимённо; команду можно пустить сюда целиком"
            />
          ) : (
            <Table<ProjectTeam & Record<string, unknown>>
              data={list as (ProjectTeam & Record<string, unknown>)[]}
              idKey="team_id"
              density="compact"
              columns={[
                {key: 'team_name', header: 'Команда', width: proportional(2)},
                {key: 'team_key', header: 'Ключ', width: proportional(1)},
                {
                  key: 'level',
                  header: 'Уровень',
                  width: pixel(130),
                  renderCell: (t) => <Token label={t.level} size="sm" />,
                },
                {
                  key: 'actions',
                  header: '',
                  width: pixel(110),
                  align: 'end',
                  renderCell: (t) => (
                    <Button
                      size="sm"
                      variant="ghost"
                      label="Убрать"
                      onClick={() => act(() => api.removeProjectTeam(projectKey, t.team_key))}
                    />
                  ),
                },
              ]}
            />
          )
        }
      </Loaded>
      <Card padding={4}>
        <VStack gap={3}>
          <Heading level={3}>Пустить команду или изменить уровень</Heading>
          <FormLayout>
            <TextInput
              label="Ключ команды"
              description="как в разделе «Команды»: platform"
              value={team}
              onChange={setTeam}
            />
            <Selector label="Уровень" options={LEVELS} value={level} onChange={setLevel} />
          </FormLayout>
          <HStack gap={2}>
            <Button
              variant="primary"
              label="Сохранить"
              isDisabled={team.trim() === ''}
              onClick={() =>
                act(async () => {
                  await api.setProjectTeam(projectKey, team.trim(), level);
                  setTeam('');
                })
              }
            />
          </HStack>
        </VStack>
      </Card>
    </VStack>
  );
}

// ── доступ к GitHub ─────────────────────────────────────────────────────────

// В базе лежат ссылки, а не секреты (решение 0028): идентификатор установки
// приложения и имя секрета, значение которого приезжает из окружения
// (SDLC_GITHUB_TOKEN_<ИМЯ>). Проверка доступа ходит в провайдера, поэтому
// делается по кнопке, а не при открытии страницы.
function GitHubAccess({projectKey}: {projectKey: string}) {
  const project = useResource(() => api.getProject(projectKey), [projectKey]);
  const [installation, setInstallation] = useState<string>();
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

  return (
    <VStack gap={3}>
      <Heading level={2}>Доступ к GitHub</Heading>
      <Text type="supporting" color="secondary">
        Учётные данные выбираются от частного к общему: секрет репозитория, установка приложения у
        проекта, секрет проекта, общий токен инстанса. Здесь задаётся уровень проекта — ссылки, а
        не секреты: значение именованного секрета живёт в окружении сервиса.
      </Text>
      {error ? <Failure error={error} /> : null}
      <Loaded resource={project}>
        {(detail) => (
          <Card padding={4}>
            <VStack gap={3}>
              <FormLayout>
                <TextInput
                  label="Установка приложения"
                  description="installation_id из адреса установки GitHub App в организации"
                  value={installation ?? (detail.project.github_installation_id?.toString() ?? '')}
                  onChange={setInstallation}
                  isOptional
                />
                <TextInput
                  label="Секрет доступа"
                  description="запасной путь: имя секрета, значение которого приезжает из SDLC_GITHUB_TOKEN_<ИМЯ>"
                  value={credential ?? (detail.project.github_credential_ref ?? '')}
                  onChange={setCredential}
                  isOptional
                />
              </FormLayout>
              <HStack gap={2}>
                <Button
                  variant="primary"
                  label="Сохранить"
                  isDisabled={busy || (installation === undefined && credential === undefined)}
                  onClick={() =>
                    run(async () => {
                      const id = (installation ?? '').trim();
                      const ref = (credential ?? '').trim();
                      await api.setProjectGitHub(projectKey, {
                        installation_id: id === '' ? null : Number(id),
                        credential_ref: ref === '' ? null : ref,
                      });
                      setInstallation(undefined);
                      setCredential(undefined);
                      setStatus(undefined);
                      project.reload();
                    })
                  }
                />
                <Button
                  label="Проверить доступ"
                  isDisabled={busy}
                  onClick={() => run(async () => setStatus(await api.checkProjectGitHub(projectKey)))}
                />
              </HStack>
              {status ? <AccessReport status={status} /> : null}
            </VStack>
          </Card>
        )}
      </Loaded>
    </VStack>
  );
}

function AccessReport({status}: {status: GitHubStatus}) {
  return (
    <VStack gap={2}>
      {status.app_configured ? null : (
        <Banner
          status="info"
          title="Приложение у инстанса не настроено"
          description="Без SDLC_GITHUB_APP_ID и ключа установку прописывать некуда: доступ пойдёт именованным секретом или общим токеном."
          collapsible={false}
        />
      )}
      {status.repositories.length === 0 ? (
        <EmptyState
          title="Проверять нечего"
          description="У проекта нет репозиториев GitHub в области"
        />
      ) : (
        <Table
          data={status.repositories.map((r) => ({...r, id: r.repository}))}
          idKey="id"
          density="compact"
          columns={[
            {key: 'repository', header: 'Репозиторий', width: proportional(2)},
            {
              key: 'ok',
              header: 'Доступ',
              width: pixel(120),
              renderCell: (r) =>
                r.ok ? (
                  <Badge variant="success" label="есть" />
                ) : (
                  <Badge variant="warning" label="нет" />
                ),
            },
            {key: 'error', header: 'Что не так', width: proportional(3)},
          ]}
        />
      )}
    </VStack>
  );
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
    <VStack gap={3}>
      <Heading level={2}>Токены</Heading>
      <Text type="supporting" color="secondary">
        Токен показывается один раз при выдаче; в базе лежит только хеш. Токен агента привязан к
        проекту и может быть ограничен ролями, которые он вправе забирать.
      </Text>
      {error ? <Failure error={error} /> : null}
      {issued ? (
        <Banner status="success" title="Токен выдан — скопируйте его сейчас" collapsible={false}>
          <CodeBlock code={issued} language="plaintext" width="100%" />
        </Banner>
      ) : null}
      <Loaded resource={tokens}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState title="Токенов нет" />
          ) : (
            <Table<AccessToken & Record<string, unknown>>
              data={list as (AccessToken & Record<string, unknown>)[]}
              idKey="id"
              density="compact"
              columns={[
                {key: 'name', header: 'Имя', width: proportional(2)},
                {
                  key: 'handle',
                  header: 'Кому',
                  width: proportional(2),
                  renderCell: (t) => `${t.kind}:${t.handle}`,
                },
                {key: 'prefix', header: 'Начало', width: pixel(130)},
                {
                  key: 'role_keys',
                  header: 'Роли',
                  width: proportional(2),
                  renderCell: (t) => (t.role_keys.length ? t.role_keys.join(', ') : 'любые'),
                },
                {
                  key: 'revoked_at',
                  header: 'Состояние',
                  width: pixel(120),
                  renderCell: (t) =>
                    t.revoked_at ? (
                      <Badge variant="neutral" label="отозван" />
                    ) : t.expires_at && new Date(t.expires_at) < new Date() ? (
                      <Badge variant="neutral" label="истёк" />
                    ) : (
                      <Badge variant="success" label="действует" />
                    ),
                },
                {
                  key: 'actions',
                  header: '',
                  width: pixel(110),
                  align: 'end',
                  renderCell: (t) =>
                    t.revoked_at ? null : (
                      <Button size="sm" variant="ghost" label="Отозвать" onClick={() => revoke(t.id)} />
                    ),
                },
              ]}
            />
          )
        }
      </Loaded>
      <Card padding={4}>
        <VStack gap={3}>
          <Heading level={3}>Выдать токен</Heading>
          <FormLayout>
            <TextInput label="Имя" description="по нему токен потом отзывают" value={name} onChange={setName} isRequired />
            <TextInput
              label="Кому"
              description="пусто — себе; agent:reviewer-bot — агенту (нужен уровень admin в проекте)"
              value={principal}
              onChange={setPrincipal}
              isOptional
            />
            <TextInput
              label="Роли специалистов"
              description="через запятую; агент с этим токеном сможет забирать только их этапы"
              value={roles}
              onChange={setRoles}
              isOptional
            />
            <TextInput label="Срок в днях" description="пусто — бессрочно" value={days} onChange={setDays} isOptional />
          </FormLayout>
          <HStack gap={2}>
            <Button variant="primary" label="Выдать" isDisabled={name.trim() === ''} onClick={issue} />
          </HStack>
        </VStack>
      </Card>
    </VStack>
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
    <VStack gap={3}>
      <Heading level={2}>Перенос правил</Heading>
      <Text type="supporting" color="secondary">
        Связка — репозитории, роли с инструкциями, документы и цикл одним JSON. Импорт идемпотентен:
        роль с другой инструкцией получает новую версию, документ с тем же названием обновляется,
        цикл приходит черновиком. Агенту тот же перенос доступен промптом /mcp__sdlc__import_rules.
      </Text>
      {error ? <Failure error={error} /> : null}
      <HStack gap={2}>
        <Button
          label="Экспортировать проект"
          isDisabled={busy}
          onClick={() =>
            run(async () => {
              const bundle = await api.exportBundle(projectKey);
              setExported(JSON.stringify(bundle, null, 2));
            })
          }
        />
      </HStack>
      {exported ? (
        <CodeBlock code={exported} language="json" title="bundle.json" width="100%" maxHeight={360} />
      ) : null}
      <Card padding={4}>
        <VStack gap={3}>
          <Heading level={3}>Импортировать связку</Heading>
          <TextArea
            label="Связка JSON"
            value={text}
            onChange={setText}
            rows={10}
            placeholder='{"version": 1, "roles": [...], "documents": [...]}'
          />
          <HStack gap={2}>
            <Button
              label="Проверить (без изменений)"
              isDisabled={busy || text.trim() === ''}
              onClick={() => run(async () => setReport(await api.importBundle(projectKey, parse(), true)))}
            />
            <Button
              variant="primary"
              label="Применить"
              isDisabled={busy || text.trim() === ''}
              onClick={() => run(async () => setReport(await api.importBundle(projectKey, parse(), false)))}
            />
          </HStack>
          {report ? <Report report={report} /> : null}
        </VStack>
      </Card>
    </VStack>
  );
}

function Report({report}: {report: ImportReport}) {
  const rows: (ImportEntry & {section: string} & Record<string, unknown>)[] = [
    ...report.repositories.map((e) => ({...e, section: 'репозиторий'})),
    ...report.roles.map((e) => ({...e, section: 'роль'})),
    ...report.documents.map((e) => ({...e, section: 'документ'})),
    // Циклов в связке столько, сколько типов задач: у проекта с эпиками их
    // как минимум два (решение 0024).
    ...report.workflows.map((e) => ({...e, section: 'цикл'})),
  ];
  return (
    <VStack gap={2}>
      <Banner
        status={report.dry_run ? 'info' : 'success'}
        title={report.dry_run ? 'Сухой прогон: так изменится проект' : 'Связка применена'}
        collapsible={false}
      />
      {rows.length === 0 ? (
        <EmptyState title="В связке ничего нет" />
      ) : (
        <Table
          data={rows}
          idKey={(r) => `${r.section}/${r.key}`}
          density="compact"
          columns={[
            {key: 'section', header: 'Что', width: pixel(120)},
            {key: 'key', header: 'Ключ', width: proportional(2)},
            {
              key: 'outcome',
              header: 'Итог',
              width: pixel(140),
              renderCell: (r) => <Token label={String(r.outcome)} size="sm" />,
            },
            {key: 'detail', header: 'Подробности', width: proportional(2)},
          ]}
        />
      )}
      {report.workflow_validations.map((validation, i) => (
        <Banner
          key={report.workflows[i]?.key ?? i}
          status={validation.valid ? 'success' : 'warning'}
          title={
            validation.valid
              ? `Цикл «${report.workflows[i]?.key ?? ''}» прошёл проверку графа; активируйте черновик в редакторе цикла`
              : `Черновик цикла «${report.workflows[i]?.key ?? ''}» создан, но проверку не прошёл`
          }
          description={validation.problems.map((p) => p.message).join('; ')}
          collapsible={false}
        />
      ))}
    </VStack>
  );
}
