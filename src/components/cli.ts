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
