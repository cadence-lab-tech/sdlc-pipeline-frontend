import {useMemo} from 'react';

import {api} from '../api/client';
import {useResource} from '../api/useResource';

// Последние версии инструкций библиотеки проекта по ключу (CLAB-351): метки
// «есть vN» у закреплённых документов роли. Сервер без библиотеки — пустая
// карта: роли и документы выглядят как раньше. reloadKey — знак перечитать
// после действий библиотеки.
export function useLibraryLatest(projectKey: string, reloadKey?: unknown): Map<string, number> {
  const list = useResource(() => api.listInstructions(projectKey).catch(() => []), [projectKey, reloadKey]);
  return useMemo(() => new Map((list.data ?? []).map((i) => [i.key, i.latest_version])), [list.data]);
}
