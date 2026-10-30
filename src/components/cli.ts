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

// Конфигурация для агентов, понимающих MCP по HTTP. Вместо токена —
// подсказка: настоящий заголовок печатает clab mcp config.
export const mcpJSON = (origin: string, key?: string) =>
  JSON.stringify(
    {mcpServers: {sdlc: {type: 'http', url: mcpURL(origin, key), headers: {Authorization: 'Bearer <clab auth token>'}}}},
    null,
    2,
  );

// Ожидание апрува агентом (CLAB-323): clab wait держит долгий опрос событий
// задачи, а clab heartbeat вокруг — аренду этапа. Номер задачи — пример:
// ждут конкретную задачу, а на странице есть только ключ проекта.
export const waitCommand = (key?: string) =>
  `clab heartbeat ${key || KEY_PLACEHOLDER}-12 --with-credentials -- \\\n` +
  `  clab wait ${key || KEY_PLACEHOLDER}-12 --gate human_approval --timeout 8h --json`;

// Адрес страницы с выбранным проектом: ссылка со страниц проекта приносит
// его ключ.
export const docsHref = (key?: string) => (key ? `/docs?project=${encodeURIComponent(key)}` : '/docs');
