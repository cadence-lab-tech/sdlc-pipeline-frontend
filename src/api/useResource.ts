import {useCallback, useEffect, useRef, useState} from 'react';

import {ApiError} from './client';

export interface Resource<T> {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
  reload: () => void;
}

// Загрузка ресурса с перезапросом. Своего кэша нет намеренно: страницы здесь
// показывают состояние задачи, которое двигают агенты с других машин, и
// показывать сохранённый ответ вместо текущего — хуже, чем сходить в сеть.
//
// Зависимости сворачиваются в строковый ключ: результат принадлежит ключу, на
// котором был запрошен, поэтому ответ на устаревший запрос не подменяет данные
// нового.
//
// При перезапросе тех же данных прежний ответ остаётся на экране: иначе каждое
// обновление после действия пользователя схлопывает страницу в спиннер и
// сбрасывает всё, что она показывала. При смене самих зависимостей — другой
// проект, другая задача — старые данные не показываются, они уже не про это.
export function useResource<T>(load: () => Promise<T>, deps: unknown[]): Resource<T> {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<{key: string; depsKey: string; data?: T; error?: ApiError}>({
    key: '',
    depsKey: '',
  });

  const depsKey = JSON.stringify(deps);
  const key = `${nonce}:${depsKey}`;

  // Загрузчик — свежее замыкание на каждый рендер, но эффект перезапускается
  // только по ключу. Синхронизация идёт отдельным эффектом, объявленным выше:
  // эффекты одного коммита выполняются в порядке объявления.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    let live = true;
    loadRef.current().then(
      (data) => live && setState({key, depsKey, data}),
      (err: unknown) =>
        live &&
        setState({
          key,
          depsKey,
          error: err instanceof ApiError ? err : new ApiError('internal', String(err)),
        }),
    );
    return () => {
      live = false;
    };
    // depsKey — часть key, отдельной зависимостью он бы только удваивал запрос.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const sameResource = state.depsKey === depsKey;
  return {
    data: sameResource ? state.data : undefined,
    error: sameResource ? state.error : undefined,
    loading: state.key !== key,
    reload: useCallback(() => setNonce((n) => n + 1), []),
  };
}
