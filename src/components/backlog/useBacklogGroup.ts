import {useCallback, useEffect, useRef, useState} from 'react';

import {ApiError} from '../../api/client';
import type {TaskListPage, TaskRow} from '../../api/types';
import {PAGE, reloadLimit} from './rules';

// Чтение страницы группы: смещение и сколько строк.
export type GroupLoader = (offset: number, limit: number) => Promise<TaskListPage>;

export interface BacklogGroup {
  rows: TaskRow[];
  total: number;
  // Первые данные пришли.
  loaded: boolean;
  // Ошибка последнего чтения с начала (первая загрузка или перечитывание);
  // строки, если были, остаются.
  error: ApiError | undefined;
  // Ошибка «Ещё 50»: показанные строки на месте.
  moreFailed: boolean;
  // Идёт чтение с начала (первое или перечитывание).
  loading: boolean;
  moreBusy: boolean;
  more: () => void;
  retry: () => void;
  // Локальная правка строк (оптимистичный перенос, откат). Ответы чтений,
  // начатых до правки, после неё не применяются: они про прежний порядок,
  // а страница всё равно перечитает список после ответа на своё действие.
  mutate: (fn: (rows: TaskRow[]) => TaskRow[]) => void;
  // Одна строка за последней загруженной — сосед ниже для «Ниже».
  peekNext: () => Promise<TaskRow | undefined>;
}

const asApiError = (err: unknown) => (err instanceof ApiError ? err : new ApiError('internal', String(err)));

interface State {
  scope: string;
  key: string;
  rows: TaskRow[];
  total: number;
  loaded: boolean;
  error?: ApiError;
  moreFailed?: boolean;
}

const EMPTY = (scope: string): State => ({scope, key: '', rows: [], total: 0, loaded: false});

// Данные одной группы бэклога — верхнего уровня или детей эпика. scope —
// чья группа (проект, эпик): сменилась — прежние строки не показываются.
// tick — перечитать с начала (события, «Обновить», ответ на своё действие):
// столько строк, сколько уже показано, прежние на экране до прихода новых.
// enabled: false — запроса нет (рукопожатие с лентой событий не закончено).
export function useBacklogGroup(load: GroupLoader, scope: string, tick: number, enabled: boolean): BacklogGroup {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<State>(() => EMPTY(scope));
  const [moreBusy, setMoreBusy] = useState(false);
  const epochRef = useRef(0);
  const loadRef = useRef(load);
  const stateRef = useRef(state);
  useEffect(() => {
    loadRef.current = load;
    stateRef.current = state;
  });

  const key = `${scope}:${tick}:${nonce}`;
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const epoch = epochRef.current;
    const prev = stateRef.current;
    const shown = prev.scope === scope ? prev.rows.length : 0;
    loadRef.current(0, reloadLimit(shown)).then(
      (page) => {
        if (!live) return;
        setState((p) => {
          const base = p.scope === scope ? p : EMPTY(scope);
          // Своя правка после начала чтения — ответ про прежний порядок.
          if (epoch !== epochRef.current && base.loaded) return {...base, key};
          return {scope, key, rows: page.tasks, total: page.total, loaded: true};
        });
      },
      (err: unknown) => {
        if (!live) return;
        setState((p) => {
          const base = p.scope === scope ? p : EMPTY(scope);
          return {...base, key, error: asApiError(err), moreFailed: false};
        });
      },
    );
    return () => {
      live = false;
    };
    // scope — часть key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  const same = state.scope === scope;
  const view = same ? state : EMPTY(scope);

  const more = useCallback(() => {
    if (moreBusy) return;
    const offset = stateRef.current.rows.length;
    setMoreBusy(true);
    loadRef.current(offset, PAGE).then(
      (page) => {
        setMoreBusy(false);
        setState((p) => {
          if (p.scope !== scope) return p;
          const have = new Set(p.rows.map((r) => r.key));
          return {
            ...p,
            rows: [...p.rows, ...page.tasks.filter((t) => !have.has(t.key))],
            total: page.total,
            error: undefined,
            moreFailed: false,
          };
        });
      },
      (err: unknown) => {
        setMoreBusy(false);
        setState((p) => (p.scope === scope ? {...p, error: asApiError(err), moreFailed: true} : p));
      },
    );
  }, [moreBusy, scope]);

  const mutate = useCallback(
    (fn: (rows: TaskRow[]) => TaskRow[]) => {
      epochRef.current++;
      setState((p) => (p.scope === scope ? {...p, rows: fn(p.rows)} : p));
    },
    [scope],
  );

  const peekNext = useCallback(
    () => loadRef.current(stateRef.current.rows.length, 1).then((page) => page.tasks[0]),
    [],
  );

  return {
    rows: view.rows,
    total: view.total,
    loaded: view.loaded,
    error: view.moreFailed ? undefined : view.error,
    moreFailed: view.moreFailed === true,
    loading: enabled && state.key !== key,
    moreBusy,
    more,
    retry: useCallback(() => setNonce((n) => n + 1), []),
    mutate,
    peekNext,
  };
}
