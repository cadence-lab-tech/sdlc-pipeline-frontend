import {Badge} from '@/components/ui/badge';
import {EmptyState, Note, Timestamp, Token} from '@/components/kit';

import type {GitHubAppStatus, GitHubInstallation} from '../api/types';
import {appNotice, installationState} from './health';

// Установки GitHub App команды (решение 0034): общий список для страницы
// команды, настроек проекта и страницы подключения. app — состояние
// приложения у провайдера, если страница его знает: при отбитом ключе живая
// установка не называется работающей (CLAB-79).
export function InstallationsList({
  installations,
  app,
}: {
  installations: GitHubInstallation[];
  app?: GitHubAppStatus;
}) {
  if (installations.length === 0) {
    return (
      <EmptyState
        title="Установок нет"
        description="Нажмите «Подключить GitHub», чтобы поставить приложение на аккаунт или организацию."
      />
    );
  }
  return (
    <div className="space-y-1">
      {installations.map((i) => {
        const state = installationState(i, app);
        return (
          <div key={i.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-mono">{i.account_login}</span>
            <Token label={i.account_type === 'Organization' ? 'организация' : 'аккаунт'} />
            <Badge variant={state.variant}>{state.label}</Badge>
            <span className="text-muted-foreground text-xs">установка {i.installation_id}</span>
          </div>
        );
      })}
    </div>
  );
}

// AppStateNote — состояние приложения GitHub у провайдера: отказ ключа,
// «не удалось проверить», «не настроено», расхождение часов. Ключ принят и
// часы в порядке — ничего не рисует. Показывается при открытии раздела, без
// кнопок: о восемнадцати днях отбитого ключа однажды узнали случайно.
export function AppStateNote({app}: {app?: GitHubAppStatus}) {
  const notice = appNotice(app);
  if (!notice) return null;
  return (
    <div data-app-state={app?.state}>
      <Note tone={notice.tone} title={notice.title}>
        {notice.lines.map((line) => (
          <p key={line} className="break-words opacity-90">
            {line}
          </p>
        ))}
        {notice.checkedAt ? (
          <p className="text-xs opacity-75">
            Проверено <Timestamp value={notice.checkedAt} className="text-xs text-inherit" />
          </p>
        ) : null}
      </Note>
    </div>
  );
}
