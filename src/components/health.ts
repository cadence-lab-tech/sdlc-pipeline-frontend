// Состояние приложения GitHub и нечитаемые репозитории словами (CLAB-79).
//
// Здесь только правила «что сказать» — без разметки: их читают настройки
// проекта, страница команды, состояние индекса и оболочка, а проверяются они
// без браузера (e2e/labels.mjs). Значения state и source — перечни протокола
// бэкенда, по ним выбирать текст можно.
import type {
  GitHubAppStatus,
  GitHubInstallation,
  IndexStatusRow,
  ProjectHealth,
} from '../api/types';

export type NoticeTone = 'info' | 'warning' | 'error';

export interface AppNotice {
  tone: NoticeTone;
  title: string;
  // Абзацы под заголовком: ответ провайдера, что это значит, что проверить.
  lines: string[];
  // Когда спрашивали провайдера: показывается временем, а не строкой.
  checkedAt?: string;
}

// clockNote — расхождение часов словами; undefined — расхождения нет. Плюс —
// часы машины отстают от провайдера.
export function clockNote(seconds?: number): string | undefined {
  if (seconds === undefined || seconds === 0) return undefined;
  const direction = seconds > 0 ? 'отстают от времени провайдера' : 'спешат относительно времени провайдера';
  return `Часы машины ${direction} на ${duration(Math.abs(seconds))} — проверьте синхронизацию времени.`;
}

function duration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s} с`;
  return s === 0 ? `${m} мин` : `${m} мин ${s} с`;
}

// appNotice — что показать про приложение при открытии раздела. undefined —
// показывать нечего: ключ принят и часы в порядке либо бэкенд состояния не
// отдал (он старше интерфейса) — тогда раздел выглядит как раньше.
export function appNotice(app?: GitHubAppStatus): AppNotice | undefined {
  if (!app) return undefined;
  const clock = clockNote(app.clock_offset_seconds);
  switch (app.state) {
    case 'rejected':
      return {
        tone: 'error',
        title: 'Ключ приложения GitHub не принят',
        lines: [
          `Ответ провайдера: ${app.error || 'причина не названа'}`,
          ...(clock ? [clock] : []),
          'Это настройка инстанса, а не проекта или команды: чинит её администратор инстанса. ' +
            'Что проверить: ключ приложения (SDLC_GITHUB_APP_KEY_FILE), идентификатор приложения ' +
            '(SDLC_GITHUB_APP_ID), часы машины. Пока ключ не принят, установки не читают репозитории.',
        ],
        checkedAt: app.checked_at,
      };
    case 'unknown':
      return {
        tone: 'info',
        title: 'Не удалось проверить приложение GitHub',
        lines: [
          `Причина: ${app.error || 'провайдер не ответил'}`,
          ...(clock ? [clock] : []),
          'Это не отказ ключа: провайдер недоступен или не ответил вовремя. Кнопка «Проверить доступ» спросит его ещё раз.',
        ],
        checkedAt: app.checked_at,
      };
    case 'not_configured':
      return {
        tone: 'info',
        title: 'Приложение у инстанса не настроено',
        lines: [
          'Без SDLC_GITHUB_APP_ID и ключа установку прописывать некуда: доступ пойдёт именованным секретом или общим токеном.',
        ],
      };
    case 'ok':
      if (!clock) return undefined;
      return {
        tone: 'warning',
        title: 'Часы машины разошлись с временем GitHub',
        lines: [
          clock,
          'Ключ приложения принят: расхождение измерено и учтено. Если оно вырастет, провайдер начнёт отбивать ключ.',
        ],
        checkedAt: app.checked_at,
      };
    default:
      // Состояние от бэкенда новее интерфейса показывается как есть.
      return {tone: 'info', title: `Приложение GitHub: ${app.state}`, lines: app.error ? [app.error] : []};
  }
}

export interface InstallationState {
  label: string;
  variant: 'default' | 'secondary' | 'destructive';
}

// installationState — бейдж установки. «Работает» — только пока ключ
// приложения принят: живая установка при отбитом ключе ничего не читает.
// Состояние приложения неизвестно (страница подключения, старый бэкенд) —
// бейдж как раньше.
export function installationState(
  i: Pick<GitHubInstallation, 'removed_at' | 'suspended_at'>,
  app?: GitHubAppStatus,
): InstallationState {
  if (i.removed_at) return {label: 'снята', variant: 'destructive'};
  if (i.suspended_at) return {label: 'приостановлена', variant: 'secondary'};
  if (app?.state === 'rejected') return {label: 'ключ приложения не принят', variant: 'destructive'};
  return {label: 'работает', variant: 'default'};
}

export interface RunStateView {
  label: string;
  variant: 'default' | 'secondary' | 'destructive';
  // Всплывающая подсказка: текст ошибки прогона.
  title?: string;
}

// runState — бейдж последнего прогона индексации. Прогон, который упал и
// ждёт повтора, стоит в queued с ошибкой: без своей подписи он выглядит как
// обычная очередь.
export function runState(row: Pick<IndexStatusRow, 'index_enabled' | 'state' | 'error'>): RunStateView {
  if (!row.index_enabled) return {label: 'выключена', variant: 'secondary'};
  if (!row.state) return {label: 'не запускалась', variant: 'secondary'};
  if (row.state === 'failed') return {label: 'сорвался', variant: 'destructive', title: row.error};
  if (row.state === 'queued' && row.error) return {label: 'повтор после сбоя', variant: 'secondary', title: row.error};
  return {label: row.state, variant: 'default'};
}

// failureSource — чем именно репозиторий не читается.
export function failureSource(source: string): string {
  if (source === 'run') return 'прогон индексации не проходит';
  if (source === 'head') return 'голова ветки не читается';
  return source;
}

export interface HealthMarks {
  // Отметка у пункта «Настройки».
  settings?: string;
  // Отметка у пункта «Поиск».
  search?: string;
}

// healthMarks — отметки в боковом меню проекта по сводке. Отметку даёт
// только отказ ключа и нечитаемые репозитории: «не удалось проверить» и
// «не настроено» — не поломка, а сводки нет (ошибка, старый бэкенд) —
// отметок нет.
export function healthMarks(health?: ProjectHealth): HealthMarks {
  const marks: HealthMarks = {};
  if (!health) return marks;
  if (health.app?.state === 'rejected') marks.settings = 'Ключ приложения GitHub не принят';
  const unreadable = health.unreadable_repositories ?? 0;
  if (unreadable > 0) marks.search = `Не читается репозиториев: ${unreadable}`;
  return marks;
}

// Событие «сводку проекта стоит перечитать»: страница узнала о приложении
// что-то новее кэша оболочки (ответ «Проверить доступ»). Оболочка одна на
// все страницы и про кнопки страниц не знает — как и с UNAUTHENTICATED_EVENT.
export const PROJECT_HEALTH_EVENT = 'sdlc:project-health';
