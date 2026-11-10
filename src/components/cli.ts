// Команды CLI на странице входа (CLAB-89): поставить clab той версии, что у
// сервера, и войти на этот же адрес. Здесь только правила, без разметки, —
// они проверяются без браузера (e2e/instance.mjs).

export const INSTALL_SCRIPT = 'https://raw.githubusercontent.com/cadence-lab-tech/homebrew-tap/main/install.sh';

// Версия выпуска — по тому же правилу, что parseRelease в CLI
// (backend/cmd/clab/version.go): vMAJOR.MINOR.PATCH, суффикс после «-» или
// «+» допустим. dev, SHA нашего инстанса и всё прочее выпуском не считаются.
export function releaseVersion(version?: string): string | undefined {
  const v = version?.trim();
  return v && /^v\d+\.\d+\.\d+(?:[-+].*)?$/.test(v) ? v : undefined;
}

// Установка той же версии, что у сервера. Сервер не выпускной (dev, SHA) или
// не ответил — без CLAB_VERSION, то есть последний выпуск. Переменная стоит
// после «|»: она нужна sh, который исполняет скрипт, а не curl.
export function installCommand(serverVersion?: string): string {
  const v = releaseVersion(serverVersion);
  return `curl -fsSL ${INSTALL_SCRIPT} | ${v ? `CLAB_VERSION=${v} ` : ''}sh`;
}

// Вход на тот адрес, с которого открыта страница: у инстанса компании свой
// домен, и подставлять наш нельзя.
export const loginCommand = (origin: string) => `clab auth login --host ${origin}`;

// ── страница /docs (CLAB-232) ───────────────────────────────────────────────
// Подключение локального проекта: те же правила — адрес инстанса из
// window.location.origin, ключ — выбранный проект, версия — сервера. Без
// проекта в командах стоит заглушка KEY_PLACEHOLDER.

export const BREW_COMMAND = 'brew install cadence-lab-tech/tap/clab';

export const KEY_PLACEHOLDER = '<KEY>';

// Корень локального клона, привязанного к проекту: проект clab нашёл бы и по
// git remote, но с --project команда работает из любого каталога.
export const setupCommand = (key?: string) => `clab setup --project ${key || KEY_PLACEHOLDER}`;

// Плагин Claude clab-plugin (CLAB-329, решение 0067): вшит в clab, ставится
// на машину, а не в проект, — поэтому без ключа и адреса.
export const PLUGIN_COMMAND = 'clab setup --plugin';

export const mcpURL = (origin: string, key?: string) => `${origin}/mcp/projects/${key || KEY_PLACEHOLDER}`;

// Ручное подключение Claude Code: токен в команду подставляет сам clab
// (clab auth token), на странице его нет и быть не должно.
export const mcpAddCommand = (origin: string, key?: string) =>
  `claude mcp add --transport http --scope local sdlc ${mcpURL(origin, key)} \\\n` +
  `  --header "Authorization: Bearer $(clab auth token)"`;

// Переменная окружения, из которой токен читают Codex и «другие агенты»: ни в
// команде, ни в конфигурации самого агента токена нет (CLAB-423, решение 0077,
// п. 9). Имя то же, что у clab setup (codexTokenEnv в backend/cmd/clab).
export const TOKEN_ENV = 'SDLC_TOKEN';

// Имя MCP-сервера Codex: адрес проектный, а пользовательский конфиг Codex
// один на машину, поэтому имя несёт ключ проекта в нижнем регистре — как
// agentMCPName в backend/cmd/clab/setup_agents.go. Без проекта — заглушка.
export const codexServerName = (key?: string) => `sdlc-${(key || 'key').toLowerCase()}`;

// Токен в переменную кладёт сам clab; она нужна при запуске Codex.
export const codexTokenCommand = `export ${TOKEN_ENV}="$(clab auth token)"`;

// Ручное подключение Codex: токен — именем переменной, не значением. Форма
// та же, что печатает clab setup (codexAddCommand в setup_agents.go).
export const codexAddCommand = (origin: string, key?: string) =>
  `codex mcp add ${codexServerName(key)} --url ${mcpURL(origin, key)} --bearer-token-env-var ${TOKEN_ENV}`;

// Конфигурация для агентов, понимающих MCP по HTTP: та же, что печатает
// clab setup --agent generic. Токена нет — заголовок раскрывает переменная;
// конфигурацию с настоящим заголовком печатает clab mcp config.
export const mcpJSON = (origin: string, key?: string) =>
  JSON.stringify(
    {mcpServers: {sdlc: {type: 'http', url: mcpURL(origin, key), headers: {Authorization: `Bearer \${${TOKEN_ENV}}`}}}},
    null,
    2,
  );

// Блок привязки каталога к проекту (решение 0077, п. 6): его пишет clab setup
// в AGENTS.md и CLAUDE.md, по нему clab берёт проект в этом каталоге. Четыре
// строки как markerBlockLines в backend/cmd/clab/setup_marker.go; только ключ
// и адрес инстанса — ни токена, ни модели, ни путей конфига.
export const markerBlock = (origin: string, key?: string) => {
  const k = key || KEY_PLACEHOLDER;
  return [
    '<!-- cadence-lab:begin -->',
    `<!-- cadence-lab: project=${k} host=${origin} -->`,
    `Cadence Lab: this directory works with project ${k} at ${origin}; the \`clab\` CLI takes the project from this block.`,
    '<!-- cadence-lab:end -->',
  ].join('\n');
};

// Справка механизма для любого агента — тело набора clab-guide; вход не
// нужен. Требует сервер v0.28.0 или новее.
export const GUIDE_COMMAND = 'clab guide';

// Стартовая инструкция этапа — тот же текст, что у MCP-промпта work_on_task,
// для агента без скилов и MCP-промптов. Номер задачи — пример, как у
// waitCommand: на странице есть только ключ проекта.
export const promptCommand = (key?: string) => `clab prompt work ${key || KEY_PLACEHOLDER}-12`;

// Ожидание апрува агентом (CLAB-323): clab wait держит долгий опрос событий
// задачи, а clab heartbeat вокруг — аренду этапа. Номер задачи — пример:
// ждут конкретную задачу, а на странице есть только ключ проекта.
export const waitCommand = (key?: string) =>
  `clab heartbeat ${key || KEY_PLACEHOLDER}-12 --with-credentials -- \\\n` +
  `  clab wait ${key || KEY_PLACEHOLDER}-12 --gate human_approval --timeout 8h --json`;

// Адрес страницы с выбранным проектом: ссылка со страниц проекта приносит
// его ключ.
export const docsHref = (key?: string) => (key ? `/docs?project=${encodeURIComponent(key)}` : '/docs');

// Настройки проекта, где раздел «Агенты и модели»: модели уровней и прайс
// команды. Без проекта ссылки нет.
export const agentSettingsHref = (key?: string) => (key ? `/p/${encodeURIComponent(key)}/settings` : undefined);
