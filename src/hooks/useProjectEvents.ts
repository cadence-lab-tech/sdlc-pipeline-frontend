import {useCallback, useEffect, useRef, useState} from 'react';

import {api} from '../api/client';
import {
  INITIAL_LIVE_STATE,
  WAIT_SECONDS,
  connectionOf,
  createLiveFeed,
  type Connection,
  type LiveFeed,
  type LiveState,
} from './liveFeed';

export interface ProjectEvents {
  // Рукопожатие закончилось: зоны страницы можно читать.
  ready: boolean;
  connection: Connection;
  state: LiveState;
  // «Обновить» и «Повторить»: перечитать сейчас и сбросить паузу.
  refresh: () => void;
  // Страница сообщает итог перечитывания зон (false — сеть или 5xx).
  reloadResult: (ok: boolean) => void;
}

// Подписка на события проекта долгим опросом (CLAB-367, решение 0067 п. 4):
// рукопожатие даёт курсор, дальше запрос с wait=25. Любое событие вызывает
// onWake — страница перечитывает состояние, истина — оно, а не лента. Хук
// ничего не знает о страницах: ключ проекта и колбэк. Правила (паузы,
// схлопывание, коды ответов) — hooks/liveFeed.ts.
export function useProjectEvents(projectKey: string, onWake: () => void): ProjectEvents {
  const wakeRef = useRef(onWake);
  useEffect(() => {
    wakeRef.current = onWake;
  });

  const [live, setLive] = useState<{key: string; state: LiveState}>({key: projectKey, state: INITIAL_LIVE_STATE});
  const feedRef = useRef<LiveFeed | null>(null);

  useEffect(() => {
    const feed = createLiveFeed({
      fetchPage: async (after, signal) => {
        const page = await api.projectEvents(projectKey, {
          after,
          wait: after === undefined ? undefined : WAIT_SECONDS,
          signal,
        });
        return {events: page.events.length, cursor: page.cursor};
      },
      onWake: () => wakeRef.current(),
      onState: (state) => setLive({key: projectKey, state}),
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    });
    feedRef.current = feed;
    const visible = () => document.visibilityState !== 'hidden';
    const onVisibility = () => feed.setVisible(visible());
    document.addEventListener('visibilitychange', onVisibility);
    feed.start(visible());
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      feed.destroy();
      feedRef.current = null;
    };
  }, [projectKey]);

  // Состояние другого проекта не показывается ни секунды после смены адреса.
  const state = live.key === projectKey ? live.state : INITIAL_LIVE_STATE;
  const refresh = useCallback(() => {
    if (feedRef.current) feedRef.current.refresh();
    else wakeRef.current();
  }, []);
  const reloadResult = useCallback((ok: boolean) => feedRef.current?.reloadResult(ok), []);

  return {ready: state.ready, connection: connectionOf(state), state, refresh, reloadResult};
}
