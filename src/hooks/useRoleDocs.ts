// Документы последней версии ролей статуса (CLAB-348): панель статуса и поле
// отбора в диалоге. Каждая роль грузится своим запросом: сбой одной роли не
// прячет счётчик других и не держит правку статуса. Данные не кэшируются —
// роль могла получить новую версию на соседней панели. Набор ролей сменился —
// запросы идут заново, прежний ответ остаётся на экране до нового.
import {useEffect, useState} from 'react';

import {ApiError, api} from '../api/client';
import type {RoleDocument} from '../api/types';

export type RoleDocsState =
  | {state: 'loading'}
  | {state: 'ok'; version: number; documents: RoleDocument[]}
  | {state: 'error'; message: string};

export function useRoleDocs(projectKey: string, roleKeys: string[]): Record<string, RoleDocsState> {
  const [loaded, setLoaded] = useState<Record<string, RoleDocsState>>({});
  const wanted = [...new Set(roleKeys.filter(Boolean))].sort();
  const depsKey = wanted.join('\n');

  useEffect(() => {
    let live = true;
    const keys = depsKey ? depsKey.split('\n') : [];
    for (const key of keys) {
      api.getRole(projectKey, key).then(
        (r) => {
          if (!live) return;
          const v = r.latest_version;
          setLoaded((prev) => ({
            ...prev,
            [key]: v
              ? {state: 'ok', version: v.version, documents: v.documents ?? []}
              : {state: 'error', message: 'у роли нет версий'},
          }));
        },
        (err: unknown) => {
          if (!live) return;
          const message = err instanceof ApiError ? err.message : String(err);
          setLoaded((prev) => ({...prev, [key]: {state: 'error', message}}));
        },
      );
    }
    return () => {
      live = false;
    };
  }, [projectKey, depsKey]);

  // Роль, которой ещё нет в ответах, — «грузится»: счётчик не рисуется, а не
  // показывает ноль.
  const out: Record<string, RoleDocsState> = {};
  for (const key of wanted) out[key] = loaded[key] ?? {state: 'loading'};
  return out;
}
