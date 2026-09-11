import {useEffect, useMemo, useRef, useState} from 'react';
import {useNavigate} from 'react-router-dom';

import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Checkbox} from '@/components/ui/checkbox';
import {FormLayout, Selector} from '@/components/fields';
import {EmptyState, Note, Page, PageHeader, Section, Spinner, Token} from '@/components/kit';

import {ApiError, api} from '../api/client';
import {
  GITHUB_CONNECT_PATH,
  clearIntent,
  connectRedirectURI,
  loadIntent,
  startInstall,
  startReauth,
  type ConnectIntent,
} from '../api/github';
import type {GitHubConnection, GitHubRepoChoice, GitHubSettings, Me} from '../api/types';
import {useResource} from '../api/useResource';
import {Failure, Loaded} from '../components/Feedback';
import {InstallationsList} from '../components/Installations';

// Возврат от GitHub (решение 0034). Сюда приходят дважды: с installation_id
// после установки приложения и с кодом после повторной авторизации. Первый
// приход тут же уводит за кодом, второй — отдаёт код бэкенду, который
// записывает установку на команду и возвращает репозитории на выбор.

// С чем пришли: разбирается один раз из адреса и намерения в sessionStorage.
type Arrival =
  | {kind: 'failed'; error: ApiError}
  | {kind: 'orphan'; installation: number}
  | {kind: 'code'; intent: ConnectIntent; code: string}
  | {kind: 'install'; intent: ConnectIntent};

function parseArrival(): Arrival {
  const params = new URLSearchParams(window.location.search);
  const denied = params.get('error');
  if (denied) {
    return {kind: 'failed', error: new ApiError('unauthenticated', params.get('error_description') ?? denied)};
  }
  const code = params.get('code');
  const installation = params.get('installation_id');
  const stored = loadIntent();
  if (!stored) {
    // Пришли не по нашей кнопке: «Redirect on update» из настроек
    // приложения на GitHub. Установка есть, команды нет — спросим.
    if (installation) return {kind: 'orphan', installation: Number(installation)};
    return {
      kind: 'failed',
      error: new ApiError('invalid_input', 'нечего подключать: откройте настройки проекта и нажмите «Подключить GitHub»'),
    };
  }
  if (params.get('state') !== stored.state) {
    return {kind: 'failed', error: new ApiError('unauthenticated', 'ответ GitHub не относится к этому подключению')};
  }
  if (code) return {kind: 'code', intent: stored, code};
  if (installation) return {kind: 'install', intent: {...stored, installation_id: Number(installation)}};
  return {kind: 'failed', error: new ApiError('invalid_input', 'GitHub вернул ни установки, ни кода')};
}

export function GitHubConnect() {
  const navigate = useNavigate();
  const settings = useResource(() => api.githubSettings(), []);
  const me = useResource(() => api.me(), []);
  const [arrival] = useState<Arrival>(parseArrival);
  const [result, setResult] = useState<GitHubConnection>();
  const [error, setError] = useState<ApiError>();
  // Код одноразовый и уход к GitHub тоже: эффект отрабатывает один раз, даже
  // когда React в режиме разработки монтирует страницу дважды.
  const started = useRef(false);

  useEffect(() => {
    if (arrival.kind !== 'code' || started.current) return;
    started.current = true;
    clearIntent();
    window.history.replaceState(null, '', GITHUB_CONNECT_PATH);
    api
      .connectGitHub(arrival.intent.team, {
        code: arrival.code,
        redirect_uri: connectRedirectURI(),
        installation_id: arrival.intent.installation_id,
        project: arrival.intent.project,
      })
      .then(setResult)
      .catch((err: unknown) => setError(err instanceof ApiError ? err : new ApiError('internal', String(err))));
  }, [arrival]);

  // За кодом уходим, как только известен адрес авторизации.
  useEffect(() => {
    if (arrival.kind !== 'install' || !settings.data?.enabled || started.current) return;
    started.current = true;
    startReauth(settings.data, arrival.intent);
  }, [arrival, settings.data]);

  const intent = arrival.kind === 'code' || arrival.kind === 'install' ? arrival.intent : undefined;
  const failure =
    error ??
    (arrival.kind === 'failed' ? arrival.error : undefined) ??
    (arrival.kind === 'install' && settings.data && !settings.data.enabled
      ? new ApiError('invalid_input', 'вход через GitHub на инстансе не настроен')
      : undefined);
  const waiting = !failure && !result && (arrival.kind === 'code' || arrival.kind === 'install');

  return (
    <Page>
      <PageHeader title="Подключение GitHub" />
      {failure ? (
        <div className="space-y-3">
          <Failure error={failure} />
          <Button variant="secondary" onClick={() => navigate(intent?.back ?? '/teams')}>
            Назад
          </Button>
        </div>
      ) : null}
      {waiting ? (
        <Card className="flex items-center gap-3 p-4">
          <Spinner />
          <span className="text-muted-foreground text-sm">
            {arrival.kind === 'code' ? 'Записываем установку и читаем репозитории…' : 'Ждём GitHub…'}
          </span>
        </Card>
      ) : null}
      {arrival.kind === 'orphan' ? (
        <Loaded resource={me}>
          {(who) => (
            <Loaded resource={settings}>
              {(gh) => <Orphan installationID={arrival.installation} me={who} settings={gh} />}
            </Loaded>
          )}
        </Loaded>
      ) : null}
      {result && intent ? (
        <Loaded resource={settings}>
          {(gh) => <Done result={result} intent={intent} settings={gh} onBack={() => navigate(intent.back)} />}
        </Loaded>
      ) : null}
    </Page>
  );
}

// Установка пришла без нашего намерения: человек нажал «Настроить» на самой
// установке в GitHub. Команду он выбирает здесь, а дальше — обычный путь.
function Orphan({installationID, me, settings}: {installationID: number; me: Me; settings: GitHubSettings}) {
  const teams = me.teams.filter((t) => t.role === 'lead');
  const [team, setTeam] = useState(teams[0]?.team_key ?? '');
  return (
    <Section
      title={`Установка ${installationID}`}
      description="GitHub прислал установку приложения, но не сказал, чьей команде она нужна. Выберите команду — и мы проверим, что установка видна вашему аккаунту.">
      <Card className="gap-3 p-4">
        {teams.length === 0 ? (
          <Note title="Вы не лид ни одной команды" description="Подключить установку может лид команды, которой она достанется." />
        ) : (
          <>
            <FormLayout>
              <Selector
                label="Команда"
                value={team}
                onChange={setTeam}
                options={teams.map((t) => ({value: t.team_key, label: t.team_key}))}
              />
            </FormLayout>
            <div>
              <Button
                disabled={!team || !settings.enabled}
                onClick={() => startReauth(settings, {team, installation_id: installationID, back: '/teams'})}>
                Подключить к команде
              </Button>
            </div>
          </>
        )}
      </Card>
    </Section>
  );
}

function Done({
  result,
  intent,
  settings,
  onBack,
}: {
  result: GitHubConnection;
  intent: ConnectIntent;
  settings: GitHubSettings;
  onBack: () => void;
}) {
  return (
    <div className="space-y-6">
      {result.connected ? (
        <Note
          title={`Установка на ${result.connected.account_login} записана на команду ${result.team.name}`}
          description="Репозитории читает установка приложения; ваш токен использован один раз и не сохранён."
        />
      ) : null}
      <Section title="Установки команды" description={`Команда ${result.team.name} (${result.team.key}).`}>
        <InstallationsList installations={result.installations} />
      </Section>
      {intent.project ? (
        <Picker
          projectKey={intent.project}
          teamKey={result.team.key}
          choices={result.repositories}
          settings={settings}
          onDone={onBack}
        />
      ) : (
        <Button variant="secondary" onClick={onBack}>
          Готово
        </Button>
      )}
    </div>
  );
}

// Список на выбор: то, что в установках команды и видно вошедшему. Уже
// привязанные отмечены и не предлагаются; привязка идёт пачкой по установке.
function Picker({
  projectKey,
  teamKey,
  choices,
  settings,
  onDone,
}: {
  projectKey: string;
  teamKey: string;
  choices: GitHubRepoChoice[];
  settings: GitHubSettings;
  onDone: () => void;
}) {
  const project = useResource(() => api.getProject(projectKey), [projectKey]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError>();

  const attached = useMemo(
    () => new Set((project.data?.repositories ?? []).map((r) => `${r.owner}/${r.name}`.toLowerCase())),
    [project.data],
  );
  const key = (c: GitHubRepoChoice) => `${c.owner}/${c.name}`.toLowerCase();
  const toggle = (c: GitHubRepoChoice) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key(c))) next.delete(key(c));
      else next.add(key(c));
      return next;
    });

  const attach = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const byInstallation = new Map<number, GitHubRepoChoice[]>();
      for (const c of choices) {
        if (!picked.has(key(c))) continue;
        byInstallation.set(c.installation_id, [...(byInstallation.get(c.installation_id) ?? []), c]);
      }
      for (const [installation, list] of byInstallation) {
        await api.attachRepositories(projectKey, {
          installation_id: installation,
          repositories: list.map((c) => ({
            owner: c.owner,
            name: c.name,
            default_branch: c.default_branch,
            private: c.private,
            clone_url: c.clone_url,
          })),
        });
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    } finally {
      setBusy(false);
    }
  };

  const groups = useMemo(() => {
    const m = new Map<string, GitHubRepoChoice[]>();
    for (const c of choices) m.set(c.account_login, [...(m.get(c.account_login) ?? []), c]);
    return [...m.entries()];
  }, [choices]);

  return (
    <Section
      title={`Репозитории для проекта ${projectKey}`}
      description="Показано пересечение: репозиторий отдан приложению установкой команды, и вы видите его на GitHub сами. Нет нужного — расширьте установку на стороне GitHub или подключите ещё один аккаунт.">
      {error ? <Failure error={error} /> : null}
      <Card className="gap-4 p-4">
        {groups.length === 0 ? (
          <EmptyState
            title="Выбирать нечего"
            description="Ни одна установка команды не видна вашему аккаунту GitHub, либо в них нет репозиториев."
          />
        ) : (
          groups.map(([account, list]) => (
            <div key={account} className="space-y-2">
              <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{account}</p>
              {list.map((c) => {
                const already = attached.has(key(c));
                const id = `pick-${c.installation_id}-${c.name}`;
                return (
                  <label key={id} htmlFor={id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      id={id}
                      disabled={already || busy}
                      checked={already || picked.has(key(c))}
                      onCheckedChange={() => toggle(c)}
                    />
                    <span className="font-mono">
                      {c.owner}/{c.name}
                    </span>
                    {c.private ? <Token label="private" /> : null}
                    {already ? <span className="text-muted-foreground text-xs">уже в проекте</span> : null}
                  </label>
                );
              })}
            </div>
          ))
        )}
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || picked.size === 0} onClick={attach}>
            {busy ? 'Привязываем…' : `Привязать (${picked.size})`}
          </Button>
          {settings.install_url ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                startInstall(settings.install_url ?? '', {
                  team: teamKey,
                  project: projectKey,
                  back: `/p/${projectKey}/settings`,
                })
              }>
              Подключить ещё аккаунт
            </Button>
          ) : null}
          <Button variant="ghost" disabled={busy} onClick={onDone}>
            К настройкам проекта
          </Button>
        </div>
      </Card>
    </Section>
  );
}
