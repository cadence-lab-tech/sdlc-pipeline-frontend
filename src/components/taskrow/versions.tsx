import {useCallback, useMemo, useRef, useState, type ReactNode} from 'react';

import {api} from '../../api/client';
import type {UUID} from '../../api/types';
import {Context, type VersionState} from './versionsContext';

// Версии иммутабельны (решение 0016), поэтому читать их дважды незачем:
// страница оборачивает список в WorkflowVersionsProvider, и версия каждого
// `workflow_id` читается один раз за жизнь страницы, а не на каждую строку и
// каждое обновление. Ни на диск, ни в хранилище браузера версия не пишется.
export function WorkflowVersionsProvider({children}: {children: ReactNode}) {
  const [cache, setCache] = useState<Record<string, VersionState>>({});
  // Запрошенные идентификаторы: строки одного цикла вызывают ensure наперегонки,
  // а запрос должен уйти один. Ошибка тоже запоминается: повторять запрос на
  // каждую отрисовку строки значило бы бить в упавший ответ.
  const requested = useRef(new Set<string>());

  const ensure = useCallback((id: UUID) => {
    if (requested.current.has(id)) return;
    requested.current.add(id);
    setCache((c) => ({...c, [id]: {status: 'loading'}}));
    api.getWorkflowVersion(id).then(
      (workflow) => setCache((c) => ({...c, [id]: {status: 'ok', workflow}})),
      () => setCache((c) => ({...c, [id]: {status: 'error'}})),
    );
  }, []);

  const value = useMemo(() => ({cache, ensure}), [cache, ensure]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
