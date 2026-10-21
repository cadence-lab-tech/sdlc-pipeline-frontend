import {Link, useSearchParams} from 'react-router-dom';

import {Selector} from '@/components/fields';
import {CodeBlock, Note, Page, PageHeader, Section} from '@/components/kit';

import {api} from '../api/client';
import type {AgentKit} from '../api/types';
import {useResource} from '../api/useResource';
import {
  BREW_COMMAND,
  KEY_PLACEHOLDER,
  installCommand,
  loginCommand,
  mcpAddCommand,
  mcpJSON,
  releaseVersion,
  setupCommand,
} from '../components/cli';
import {useInstance} from '../hooks/useInstance';

// Подключение локального проекта к Cadence Lab (CLAB-232, решение 0050):
// CLI, вход, clab setup, ручной MCP, набор агента и что есть вокруг. Адрес
// инстанса — тот, с которого открыта страница, ключ — выбранный проект,
// версия — сервера: одинаково на нашем инстансе и на инстансе компании.
// Правила команд — в components/cli.ts, без разметки.

export function Docs() {
  const origin = window.location.origin;
  const instance = useInstance();
  const [params, setParams] = useSearchParams();
  const projects = useResource(() => api.listProjects(), []);
  // Набор — вспомогательная часть страницы: сервер старше набора или сбой
  // не прячут остальные шаги.
  const kit = useResource(() => api.agentKit(), []);

  const list = projects.data ?? [];
  const asked = params.get('project') ?? '';
  const key = asked || list[0]?.key || '';
  const shown = key || KEY_PLACEHOLDER;
  const release = releaseVersion(instance?.version);

  return (
    <Page className="max-w-4xl">
      <PageHeader
        title="Подключение"
        description="Как связать локальный проект с проектом Cadence Lab: поставить CLI, войти, подключить MCP и набор агента одной командой."
      />
      <div className="space-y-8" data-docs>
        <Section title="Проект">
          {list.length > 0 ? (
            <Selector
              label="Команды ниже — для проекта"
              options={list.map((p) => ({value: p.key, label: `${p.key} — ${p.name}`}))}
              value={key}
              onChange={(v) => setParams({project: v}, {replace: true})}
            />
          ) : projects.data ? (
            <Note
              title={`Проектов пока нет — в командах стоит ${KEY_PLACEHOLDER}`}
              description={
                <>
                  Заведите проект на странице <Link className="underline underline-offset-4" to="/projects">«Проекты»</Link>{' '}
                  или попросите у коллеги приглашение, затем вернитесь сюда.
                </>
              }
            />
          ) : null}
        </Section>

        <Section
          title="1. Поставить CLI"
          description={
            release
              ? `Версия сервера — ${release}; install.sh ставит ту же версию clab.`
              : 'Последний выпуск clab — Homebrew или install.sh.'
          }>
          <div className="space-y-3">
            <CodeBlock title="Homebrew" language="sh" code={BREW_COMMAND} />
            <CodeBlock title="install.sh" language="sh" code={installCommand(instance?.version)} />
          </div>
        </Section>

        <Section title="2. Войти" description="Код в терминале, подтверждение в браузере — на этот же инстанс.">
          <CodeBlock title="вход" language="sh" code={loginCommand(origin)} />
        </Section>

        <Section
          title="3. Связать локальный проект"
          description="В корне локального клона репозитория проекта. Команда подключает MCP-сервер проекта к Claude Code и кладёт набор агента в .claude/ проекта; токен в файлы не попадает.">
          <div className="space-y-3">
            <CodeBlock title="clab setup" language="sh" code={setupCommand(key)} />
            <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
              <li>
                Повторный запуск безвреден: обновляет набор до версии сервера, файлы, правленные после установки,
                не трогает (<code>--force</code> — перезаписать).
              </li>
              <li>
                <code>--scope user</code> — набор в <code>~/.claude/</code> для всех каталогов, MCP везде.
              </li>
              <li>
                <code>--agent other</code> — без Claude Code: печатает конфигурацию MCP для другого агента.
              </li>
              <li>
                <code>--dry-run</code> — показать, что будет сделано, ничего не меняя.
              </li>
            </ul>
          </div>
        </Section>

        <Section
          title="4. MCP вручную"
          description="Если clab setup не подходит. Токен подставляет clab auth token; ту же конфигурацию с токеном печатает clab mcp config.">
          <div className="space-y-3">
            <CodeBlock title="Claude Code" language="sh" code={mcpAddCommand(origin, key)} />
            <CodeBlock title="другие агенты (mcpServers)" language="json" code={mcpJSON(origin, key)} />
          </div>
        </Section>

        <Section title="5. Скилы агента" description="Ставит clab setup; набор приходит с этого сервера и той же версии.">
          <AgentKitList kit={kit.data} failed={!!kit.error} loading={kit.loading} serverVersion={instance?.version} projectKey={shown} />
        </Section>

        <Section title="6. Коннекторы и плагины">
          <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm" data-connectors>
            <li>
              MCP-сервер проекта <code>{`${origin}/mcp/projects/${shown}`}</code> работает с любым агентом, который
              понимает MCP по HTTP.
            </li>
            <li>
              Задачи связываются с тикетами вашего трекера ссылками: <code>clab create --external-ref jira:PROJ-12=https://…</code>,
              поиск — <code>clab tasks --external PROJ-12</code>.
            </li>
            <li>Плагина Claude Code пока нет: набор ставит clab setup.</li>
          </ul>
        </Section>
      </div>
    </Page>
  );
}

function AgentKitList({
  kit,
  failed,
  loading,
  serverVersion,
  projectKey,
}: {
  kit?: AgentKit;
  failed: boolean;
  loading: boolean;
  serverVersion?: string;
  projectKey: string;
}) {
  if (failed) {
    return (
      <Note
        tone="warning"
        title="Набор агента недоступен на этой версии сервера"
        description={`Сервер${serverVersion ? ` ${serverVersion}` : ''} не раздаёт скилы: clab setup подключит MCP без них. Набор появится после обновления инстанса.`}
      />
    );
  }
  if (!kit) return loading ? <p className="text-muted-foreground text-sm">Загрузка…</p> : null;
  return (
    <div className="space-y-3" data-kit-version={kit.version}>
      <p className="text-muted-foreground text-sm">Версия набора — {kit.version}.</p>
      <dl className="divide-y rounded-lg border" data-skills>
        {kit.skills.map((s) => (
          <div key={s.name} className="grid gap-1 p-3 md:grid-cols-[12rem_1fr]">
            <dt className="font-mono text-sm">/{s.name}</dt>
            <dd className="text-muted-foreground text-sm">{s.description}</dd>
          </div>
        ))}
        {kit.agents.map((a) => (
          <div key={a.name} className="grid gap-1 p-3 md:grid-cols-[12rem_1fr]">
            <dt className="font-mono text-sm">агент {a.name}</dt>
            <dd className="text-muted-foreground text-sm">{a.description}</dd>
          </div>
        ))}
      </dl>
      <p className="text-muted-foreground text-sm">
        В Claude Code скил зовётся по имени: <code>/clab-work {projectKey}-12</code>. Справка о CLI и цикле —
        скил <code>clab-guide</code>, агент подключает его сам.
      </p>
    </div>
  );
}
