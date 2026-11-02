import {createContext, useContext, useEffect} from 'react';

import type {UUID, Workflow} from '../../api/types';

// Версия цикла задачи для подписей гейтов и переходов (провайдер —
// WorkflowVersionsProvider в versions.tsx).
export type VersionState =
  | {status: 'loading'}
  | {status: 'ok'; workflow: Workflow}
  | {status: 'error'};

export interface VersionsContext {
  cache: Record<string, VersionState>;
  ensure: (id: UUID) => void;
}

export const Context = createContext<VersionsContext | null>(null);

// Версия цикла для строки. Читается только когда нужна (`needed`): строка без
// гейтов в причинах подписей версии не просит. Без провайдера версии нет —
// строка показывает ключи, как есть.
export function useWorkflowVersion(id: UUID, needed: boolean): VersionState | undefined {
  const ctx = useContext(Context);
  const ensure = ctx?.ensure;
  useEffect(() => {
    if (needed && ensure) ensure(id);
  }, [needed, ensure, id]);
  return ctx?.cache[id];
}
