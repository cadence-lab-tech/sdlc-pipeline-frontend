import {Badge} from '@/components/ui/badge';
import {EmptyState, Token} from '@/components/kit';

import type {GitHubInstallation} from '../api/types';

// Установки GitHub App команды (решение 0034): общий список для страницы
// команды, настроек проекта и страницы подключения.
function stateOf(i: GitHubInstallation): {label: string; variant: 'default' | 'secondary' | 'destructive'} {
  if (i.removed_at) return {label: 'снята', variant: 'destructive'};
  if (i.suspended_at) return {label: 'приостановлена', variant: 'secondary'};
  return {label: 'работает', variant: 'default'};
}

export function InstallationsList({installations}: {installations: GitHubInstallation[]}) {
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
        const state = stateOf(i);
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
