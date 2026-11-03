import {useCallback, useEffect, useRef, useState} from 'react';

import {ApiError} from '../../api/client';

export interface ZoneData<T> {
  data: T | undefined;
  // Ошибка последнего запроса зоны.
  error: ApiError | undefined;
  // Ошибка пришла на «Ещё N» или листание: показанные строки — прежнего вида,
  // и зона говорит «не получилось загрузить ещё», а не падает целиком.
  moreFailed: boolean;
  loading: boolean;
  retry: () => void;
}

// Данные одной зоны «Обзора». Отличие от useResource — три ключа вместо
// одного:
//   scope   — фильтры страницы: сменились — прежние строки уже не про это и
//             не показываются, зона снова в скелетонах;
//   variant — вид зоны («Ещё N», страница листания): прежние строки остаются
//             на месте, пока не придут новые, чтобы они не мигали;
//   tick    — «Обновить» всей страницы: перечитать всё, прежние данные на
//             экране до прихода новых.
// Ошибка прежних данных не стирает. enabled: false — запроса нет (страница
// знает, что зоны не рисуются: эпика или типа нет).
export function useZoneData<T>(
  load: () => Promise<T>,
  scope: string,
  variant: string,
  tick: number,
  enabled = true,
): ZoneData<T> {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<{
    key: string;
    scope: string;
    variant: string;
    data?: T;
    error?: ApiError;
    errorVariant?: string;
  }>({key: '', scope: '', variant: ''});

  const key = `${tick}:${nonce}:${scope}:${variant}`;
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    loadRef.current().then(
      (data) => live && setState({key, scope, variant, data}),
      (err: unknown) =>
        live &&
        setState((prev) => ({
          key,
          scope,
          // Прежние данные той же выборки остаются вместе со своим видом.
          variant: prev.scope === scope ? prev.variant : variant,
          data: prev.scope === scope ? prev.data : undefined,
          error: err instanceof ApiError ? err : new ApiError('internal', String(err)),
          errorVariant: variant,
        })),
    );
    return () => {
      live = false;
    };
    // scope и variant — части key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  const same = state.scope === scope;
  const data = same ? state.data : undefined;
  const error = same && state.errorVariant === variant ? state.error : undefined;
  return {
    data,
    error,
    moreFailed: error !== undefined && data !== undefined && state.variant !== variant,
    loading: enabled && state.key !== key,
    retry: useCallback(() => setNonce((n) => n + 1), []),
  };
}
