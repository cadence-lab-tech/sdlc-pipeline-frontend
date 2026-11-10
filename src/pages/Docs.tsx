import {Link, useSearchParams} from 'react-router-dom';

import {Selector} from '@/components/fields';
import {CodeBlock, Note, Page, PageHeader, Section} from '@/components/kit';

import {api} from '../api/client';
import type {AgentKit} from '../api/types';
import {useResource} from '../api/useResource';
import {
  BREW_COMMAND,
  GUIDE_COMMAND,
  KEY_PLACEHOLDER,
  PLUGIN_COMMAND,
  agentSettingsHref,
  codexAddCommand,
  codexTokenCommand,
  installCommand,
  loginCommand,
  markerBlock,
  mcpAddCommand,
  mcpJSON,
  promptCommand,
  releaseVersion,
  setupCommand,
  waitCommand,
} from '../components/cli';
import {useInstance} from '../hooks/useInstance';

// Подключение локального проекта к Cadence Lab (CLAB-232, решение 0050;
// любой агент — CLAB-423, решение 0077): CLI, вход, clab setup по агентам,
// ручной MCP по агентам, набор агента и вход в этап, что есть вокруг. Адрес
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
  const settingsHref = agentSettingsHref(key);
  const release = releaseVersion(instance?.version);

  return (
    <Page className="max-w-4xl">
      <PageHeader
        title="Подключение"
        description="Как связать локальный проект с проектом Cadence Lab: поставить CLI, войти, подключить MCP и набор любому агенту одной командой."
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
          description="В корне локального клона репозитория проекта. Команда ставит набор агента и подключает MCP-сервер проекта каждому найденному агенту; агенту, которого она не подключает сама, печатает конфигурацию MCP. Токен в файлы не попадает.">
          <div className="space-y-3">
            <CodeBlock title="clab setup" language="sh" code={setupCommand(key)} />
            <h3 className="text-sm font-medium">Какому агенту</h3>
            <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm" data-agents>
              <li>
                <code>--agent auto</code> — по умолчанию: каждому агенту, найденному в <code>PATH</code>; не нашлось ни
                одного — как <code>generic</code>.
              </li>
              <li>
                <code>--agent claude</code> — только Claude Code: набор в <code>.claude/skills</code> и{' '}
                <code>.claude/agents</code>, MCP через <code>claude mcp add</code>.
              </li>
              <li>
                <code>--agent codex</code> — только Codex: набор в <code>.agents/skills</code> и{' '}
                <code>.codex/agents</code>, MCP через <code>codex mcp add</code>, токен Codex читает из переменной{' '}
                <code>SDLC_TOKEN</code>.
              </li>
              <li>
                <code>--agent generic</code> — любой другой агент: ядро набора в <code>.agents/skills</code>, MCP не
                подключается, <code>clab setup</code> печатает конфигурацию MCP.
              </li>
              <li>
                Привязку агента, которого этот <code>clab</code> не знает, команда пропускает с предупреждением.
              </li>
            </ul>
            <h3 className="text-sm font-medium">Флаги</h3>
            <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
              <li>
                Повторный запуск безвреден: обновляет набор до версии сервера, файлы, правленные после установки,
                не трогает (<code>--force</code> — перезаписать).
              </li>
              <li>
                <code>--dry-run</code> — показать, что будет сделано, ничего не меняя.
              </li>
              <li>
                <code>--scope user</code> у Claude Code — набор в <code>~/.claude/</code> для всех каталогов, MCP везде.
                У Codex <code>--scope user</code> (по умолчанию) — сервер в <code>~/.codex/config.toml</code>,{' '}
                <code>--scope project</code> — в <code>.codex/config.toml</code> проекта, без токена.
              </li>
              <li>
                <code>--trust</code> у Codex — записать доверие проекту в <code>~/.codex/config.toml</code>; без флага{' '}
                <code>clab</code> только подсказывает.
              </li>
              <li>
                <code>--no-marker</code> — не писать строку привязки каталога (ниже).
              </li>
            </ul>
            <p className="text-muted-foreground text-sm" data-agent-settings>
              Какие модели у уровней и какой прайс у команды — в разделе{' '}
              {settingsHref ? (
                <Link className="underline underline-offset-4" to={settingsHref}>
                  Агенты и модели
                </Link>
              ) : (
                <>«Агенты и модели»</>
              )}{' '}
              настроек проекта.
            </p>
            <div className="space-y-2" data-marker>
              <h3 className="text-sm font-medium">Строка привязки каталога</h3>
              <p className="text-muted-foreground text-sm">
                <code>clab setup</code> пишет этот блок в <code>AGENTS.md</code> и <code>CLAUDE.md</code>, если они
                есть, а нет ни одного — создаёт <code>AGENTS.md</code>. По нему <code>clab</code> берёт проект в этом
                каталоге. Секретов в блоке нет; в git его кладёт человек, сам <code>clab setup</code> ничего не
                коммитит. Образец ниже — для проекта {shown} на этом инстансе, а не рабочий блок: настоящий пишет
                команда.
              </p>
              <CodeBlock title="AGENTS.md / CLAUDE.md" language="markdown" code={markerBlock(origin, key)} />
            </div>
          </div>
        </Section>

        <Section
          title="4. MCP вручную"
          description="Если clab setup не подходит. Токена в командах нет: его подставляет clab auth token или переменная окружения SDLC_TOKEN.">
          <div className="space-y-4">
            <div className="space-y-2" data-agent-block="claude">
              <CodeBlock title="Claude Code" language="sh" code={mcpAddCommand(origin, key)} />
            </div>
            <div className="space-y-2" data-agent-block="codex">
              <CodeBlock title="Codex" language="sh" code={codexAddCommand(origin, key)} />
              <CodeBlock title="Codex: токен" language="sh" code={codexTokenCommand} />
              <p className="text-muted-foreground text-sm">
                Переменная <code>SDLC_TOKEN</code> нужна при запуске Codex: он читает токен из неё, в{' '}
                <code>config.toml</code> токена нет.
              </p>
            </div>
            <div className="space-y-2" data-agent-block="generic">
              <CodeBlock title="другой агент (mcpServers)" language="json" code={mcpJSON(origin, key)} />
              <p className="text-muted-foreground text-sm">
                Ту же конфигурацию печатает <code>clab setup --agent generic</code>. Агент не раскрывает переменные в
                конфигурации — конфигурацию с токеном печатает <code>clab mcp config</code>; класть её в репозиторий
                нельзя.
              </p>
            </div>
          </div>
        </Section>

        <Section
          title="5. Скилы и вход в этап"
          description="Набор ставит clab setup; он приходит с этого сервера и той же версии.">
          <AgentKitList kit={kit.data} failed={!!kit.error} loading={kit.loading} serverVersion={instance?.version} />
          <div className="mt-4 space-y-2" data-entry>
            <h3 className="text-sm font-medium">Вход для любого агента</h3>
            <p className="text-muted-foreground text-sm">
              Справка о <code>clab</code>, проекте и порядке работы — <code>clab guide</code>, вход не нужен.
              Стартовая инструкция этапа — <code>clab prompt work</code> с ключом задачи: тот же текст, что у
              MCP-промпта. Обе команды работают у любого агента, в том числе без скилов и MCP-промптов.
            </p>
            <CodeBlock title="clab guide" language="sh" code={GUIDE_COMMAND} />
            <CodeBlock title="clab prompt work" language="sh" code={promptCommand(key)} />
            {!kit.error ? (
              <p className="text-muted-foreground text-sm" data-skill-call>
                Скил по имени — способ привязки агента, а не единственный вход: в Claude Code{' '}
                <code>/clab-work {shown}-12</code>, в Codex <code>$clab-work {shown}-12</code>.
              </p>
            ) : null}
          </div>
          <div className="mt-4 space-y-2" data-wait>
            <h3 className="text-sm font-medium">Ожидание апрува</h3>
            <p className="text-muted-foreground text-sm">
              На апруве агент не держит чат вопросом: он ждёт решения на сервере и продолжает сам. Апрув ставится где
              удобно — ответом в чате, в панели плагина Claude, в карточке задачи или <code>clab decide</code>. Так ждут скилы{' '}
              <code>/clab-run</code> и <code>/clab-work</code>; та же команда годится для скрипта и CI.
            </p>
            <CodeBlock title="clab wait" language="sh" code={waitCommand(key)} />
            <p className="text-muted-foreground text-sm">
              Коды выхода: 0 — пройден, 3 — возвращён с причиной, 4 — статус сменился иначе, 5 — вышел срок, 1 —
              ошибка, 2 — ждать нечего. <code>--gate</code> — тип или ключ гейта, <code>--transition</code> — только
              этот переход; <code>clab heartbeat … --</code> держит аренду, пока идёт ожидание.
            </p>
          </div>
        </Section>

        <Section title="6. Коннекторы и плагины">
          <div className="mb-3">
            <CodeBlock title="плагин Claude" language="sh" code={PLUGIN_COMMAND} />
          </div>
          <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm" data-connectors>
            <li data-plugin>
              Плагин Claude <code>clab-plugin</code> — панель рядом с чатом. Вкладки: «Этот чат» — задачи чата со
              статусом, гейтами и сданными артефактами по этапам; «Ждут меня» — апрувы и чек-листы проекта,
              ждущие решения; «Задачи» — задачи и эпики проекта. Из карточки можно поставить апрув, вернуть задачу
              с причиной и отметить чек-лист, но только участнику с уровнем <code>maintainer</code> и выше: панель
              ходит вашим <code>clab auth login</code> и делает то, что даёт участие в проекте. Модель в чате задачу
              не меняет. Плагин вшит в clab той же версии и ставится на машину, а не в проект: без GitHub, нужен
              только Claude Code. В чате — <code>/clab-plugin</code> или <code>/clab-plugin {shown}-12</code>;{' '}
              <code>--dry-run</code> — показать, что будет сделано.
            </li>
            <li>
              MCP-сервер проекта <code>{`${origin}/mcp/projects/${shown}`}</code> работает с любым агентом, который
              понимает MCP по HTTP: подключение по агентам — в разделе 4.
            </li>
            <li>
              Задачи связываются с тикетами вашего трекера ссылками: <code>clab create --external-ref jira:PROJ-12=https://…</code>,
              поиск — <code>clab tasks --external PROJ-12</code>.
            </li>
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
}: {
  kit?: AgentKit;
  failed: boolean;
  loading: boolean;
  serverVersion?: string;
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
    </div>
  );
}
