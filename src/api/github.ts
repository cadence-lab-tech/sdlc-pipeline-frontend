import type {GitHubSettings} from './types';

// Подключение GitHub по кнопке (решение 0034).
//
// Два перехода на сторону GitHub и один возврат. «Подключить GitHub» уводит
// на страницу установки приложения; GitHub возвращает на GITHUB_CONNECT_PATH
// с installation_id. Право на установку доказывает не её номер, а список
// установок, видимых вошедшему, — за ним бэкенду нужен код повторной
// авторизации, поэтому страница возврата тут же уводит на авторизацию и
// принимает код на тот же адрес. Для уже входившего GitHub возвращает без
// вопросов. Тем же путём — «Выбрать репозитории» без установки: один переход
// за кодом, и список репозиториев из установок команды.
//
// Намерение живёт в sessionStorage: чья команда, из какого проекта пришли и
// одноразовый state, чтобы чужой возврат не сошёл за наш.
export const GITHUB_CONNECT_PATH = '/settings/github/callback';
const INTENT_KEY = 'sdlc.github.connect';

export interface ConnectIntent {
  state: string;
  team: string;
  project?: string;
  installation_id?: number;
  // Куда вернуться, когда всё сделано.
  back: string;
}

export function connectRedirectURI(): string {
  return `${window.location.origin}${GITHUB_CONNECT_PATH}`;
}

export function loadIntent(): ConnectIntent | undefined {
  try {
    const raw = sessionStorage.getItem(INTENT_KEY);
    return raw ? (JSON.parse(raw) as ConnectIntent) : undefined;
  } catch {
    return undefined;
  }
}

export function clearIntent(): void {
  sessionStorage.removeItem(INTENT_KEY);
}

function save(intent: ConnectIntent): void {
  sessionStorage.setItem(INTENT_KEY, JSON.stringify(intent));
}

function freshState(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

// Первый переход: установка приложения на аккаунт GitHub.
export function startInstall(installURL: string, intent: Omit<ConnectIntent, 'state'>): void {
  const state = freshState();
  save({...intent, state});
  window.location.assign(`${installURL}?${new URLSearchParams({state})}`);
}

// Второй переход (или единственный при выборе из уже подключённых установок):
// код повторной авторизации на адрес возврата.
export function startReauth(settings: GitHubSettings, intent: Omit<ConnectIntent, 'state'>): void {
  const state = freshState();
  save({...intent, state});
  const query = new URLSearchParams({
    client_id: settings.client_id ?? '',
    redirect_uri: connectRedirectURI(),
    state,
  });
  window.location.assign(`${settings.authorization_endpoint}?${query}`);
}
