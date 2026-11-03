// Правила живого обновления страницы по событиям проекта (CLAB-367) — без
// React и без браузера: задержки, решения по коду ответа, схлопывание пачки,
// подписи индикатора и сам цикл долгого опроса (createLiveFeed). Все внешние
// вещи — запрос, таймеры, часы, колбэки — передаются снаружи, поэтому цикл
// проверяется в e2e/overview-live-rules.mjs с поддельными таймерами.
//
// Событие только будит (решение 0067 п. 4): типов событий здесь нет и быть не
// должно — любое пришедшее событие значит «перечитай состояние».

// Сколько секунд сервер держит запрос без событий (его потолок — 25).
export const WAIT_SECONDS = 25;
// Режим без ручки событий: перечитывание раз в 30 с.
export const FALLBACK_MS = 30_000;
// Пачка событий: не больше одного перечитывания за окно.
export const COALESCE_MS = 2_000;
// Пустой ответ быстрее этого — сервер не держал запрос (wait не принят или
// срок запроса мал): без паузы получился бы плотный цикл запросов.
export const MIN_POLL_GAP_MS = 1_000;
// Пауза после ошибки сети или 5xx: 5, 10, 20, 40, 60 с и дальше 60 с.
export const BACKOFF_MS = [5_000, 10_000, 20_000, 40_000, 60_000] as const;

// n-я подряд неудача (с 1): сколько ждать до повтора.
export function backoffMs(failures: number): number {
  const i = Math.min(Math.max(failures, 1), BACKOFF_MS.length) - 1;
  return BACKOFF_MS[i];
}

// Ответ ленты, нужный циклу: сколько событий пришло и новый курсор.
export interface FeedAnswer {
  events: number;
  cursor: string;
}

// Что делать с отказом ленты.
//   retry    — ошибка сети, 5xx и всё непонятное: пауза и повтор;
//   resync   — 400 на курсор: рукопожатие заново и перечитывание;
//   auth     — 401: опрос стоит, на вход уводит оболочка;
//   project  — 403 или 404 проекта: опрос стоит, ошибку проекта показывает страница;
//   fallback — 404 без тела ошибки: сервера нет ручки, перечитывание раз в 30 с.
export type FailureAction = 'retry' | 'resync' | 'auth' | 'project' | 'fallback';

export function classifyFailure(err: unknown): FailureAction {
  const e = (err ?? {}) as {httpStatus?: number; code?: string};
  const status = typeof e.httpStatus === 'number' ? e.httpStatus : 0;
  if (status === 400) return 'resync';
  if (status === 401) return 'auth';
  if (status === 403) return 'project';
  // 404 с кодом ошибки домена — нет проекта; без него — нет маршрута
  // («404 page not found» сервера до CLAB-323).
  if (status === 404) return e.code === 'not_found' ? 'project' : 'fallback';
  return 'retry';
}

export type LiveMode = 'connecting' | 'live' | 'fallback' | 'offline' | 'stopped';
export type StopReason = 'auth' | 'project';

export interface LiveState {
  mode: LiveMode;
  // Рукопожатие закончилось (любым исходом): страница может читать зоны —
  // событие между чтением и подпиской уже не потеряется.
  ready: boolean;
  // Перечитывание зон не удалось (сеть, 5xx), хотя лента отвечает.
  stale: boolean;
  stopReason?: StopReason;
}

export const INITIAL_LIVE_STATE: LiveState = {mode: 'connecting', ready: false, stale: false};

// Что показывает индикатор: связь с лентой и последнее перечитывание вместе.
export type Connection = 'connecting' | 'live' | 'fallback' | 'offline' | 'stopped';

export function connectionOf(s: LiveState): Connection {
  if (s.mode === 'stopped') return 'stopped';
  if (s.mode === 'offline' || (s.stale && s.mode !== 'connecting')) return 'offline';
  return s.mode;
}

export interface IndicatorView {
  // null — индикатора нет (подключение).
  label: string | null;
  title: string;
  // Что нарисовать рядом с подписью; цвет не единственный признак.
  tone: 'ok' | 'muted' | 'warn';
  retry: boolean;
}

export function clockLabel(ms: number | null): string | null {
  if (ms === null) return null;
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function indicator(c: Connection, updatedAt: number | null, reason?: StopReason): IndicatorView {
  const at = clockLabel(updatedAt);
  const since = at ? `данные на ${at}` : 'данные ещё не получены';
  switch (c) {
    case 'live':
      return {label: 'Обновляется само', title: `Страница обновляется по событиям проекта · ${since}`, tone: 'ok', retry: false};
    case 'fallback':
      return {
        label: 'Обновление раз в 30 с',
        title: `Ручки событий нет — страница перечитывает данные сама · ${since}`,
        tone: 'muted',
        retry: false,
      };
    case 'offline':
      return {
        label: at ? `Нет связи · данные на ${at}` : 'Нет связи',
        title: 'Данные могут быть устаревшими',
        tone: 'warn',
        retry: true,
      };
    case 'stopped':
      return {
        label: 'Обновление остановлено',
        title: reason === 'auth' ? 'Нужен вход' : 'Нет доступа к ленте проекта — данные обновляются кнопкой',
        tone: 'muted',
        retry: false,
      };
    default:
      return {label: null, title: '', tone: 'muted', retry: false};
  }
}

// Что объявить вспомогательным технологиям при смене связи: только уход в
// «Нет связи» и возврат из него, а не каждое перечитывание.
export function announcement(prev: Connection, next: Connection): string {
  if (prev === next) return '';
  if (next === 'offline') return 'Нет связи. Данные могут быть устаревшими.';
  if (prev === 'offline' && (next === 'live' || next === 'fallback')) return 'Связь восстановлена.';
  return '';
}

export interface LiveDeps {
  // after: undefined — рукопожатие. Отказ — исключение (classifyFailure).
  fetchPage: (after: string | undefined, signal: AbortSignal) => Promise<FeedAnswer>;
  // Перечитать данные страницы (единственная точка перечитывания).
  onWake: () => void;
  onState: (s: LiveState) => void;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

export interface LiveFeed {
  start: (visible: boolean) => void;
  setVisible: (visible: boolean) => void;
  // «Обновить» и «Повторить»: перечитать сейчас, паузу сбросить.
  refresh: () => void;
  // Итог перечитывания зон страницей: ok — зоны пришли, иначе сеть или 5xx.
  reloadResult: (ok: boolean) => void;
  destroy: () => void;
}

// Цикл долгого опроса. Курсор берётся рукопожатием до первого перечитывания;
// ответ с after не уходит, пока курсора нет. Скрытая вкладка запросов не
// шлёт, а при возврате перечитывает сразу. Смена проекта — новый экземпляр
// (старый destroy отбрасывает свои ответы).
export function createLiveFeed(deps: LiveDeps): LiveFeed {
  let state: LiveState = INITIAL_LIVE_STATE;
  let cursor: string | null = null;
  let gen = 0;
  let destroyed = false;
  let visible = true;
  let started = false;
  let ctl: AbortController | null = null;
  // Один «сон» на цикл: пауза после ошибки, пауза пустого ответа, 30 с запасного режима.
  let sleepTimer: unknown = null;
  let sleepDone: (() => void) | null = null;
  let wakeTimer: unknown = null;
  let reloadTimer: unknown = null;
  let lastWake = Number.NEGATIVE_INFINITY;
  let failures = 0;
  let reloadFailures = 0;
  // После рукопожатия перечитать зоны: разошлись с лентой (400, ошибка, возврат на вкладку).
  let needReload = false;
  let lastWasResync = false;

  const set = (patch: Partial<LiveState>) => {
    state = {...state, ...patch};
    deps.onState(state);
  };

  const wake = () => {
    if (destroyed) return;
    lastWake = deps.now();
    deps.onWake();
  };

  // Пачка событий: первое будит сразу, остальные — не чаще раза в окно, а
  // самое позднее не теряется (его перечитывание стоит в хвосте окна).
  const requestWake = () => {
    if (wakeTimer !== null) return;
    const wait = COALESCE_MS - (deps.now() - lastWake);
    if (wait <= 0) {
      wake();
      return;
    }
    wakeTimer = deps.setTimer(() => {
      wakeTimer = null;
      if (visible) wake();
    }, wait);
  };

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      sleepDone = resolve;
      sleepTimer = deps.setTimer(() => {
        sleepTimer = null;
        sleepDone = null;
        resolve();
      }, ms);
    });

  const interruptSleep = () => {
    if (sleepTimer !== null) deps.clearTimer(sleepTimer);
    sleepTimer = null;
    const done = sleepDone;
    sleepDone = null;
    done?.();
  };

  const clearTimers = () => {
    interruptSleep();
    if (wakeTimer !== null) deps.clearTimer(wakeTimer);
    wakeTimer = null;
    if (reloadTimer !== null) deps.clearTimer(reloadTimer);
    reloadTimer = null;
  };

  const cancelRequest = () => {
    ctl?.abort();
    ctl = null;
  };

  // Запасной режим: ручки нет — раз в 30 с, пока вкладка видима.
  const fallbackLoop = async (g: number) => {
    while (g === gen && visible && !destroyed) {
      await sleep(FALLBACK_MS);
      if (g !== gen || destroyed) return;
      wake();
    }
  };

  const loop = async (g: number) => {
    while (g === gen && visible && !destroyed) {
      const request = new AbortController();
      ctl = request;
      const handshake = cursor === null;
      const t0 = deps.now();
      try {
        const page = await deps.fetchPage(handshake ? undefined : (cursor as string), request.signal);
        if (g !== gen || destroyed) return;
        const recovered = state.mode === 'offline';
        failures = 0;
        cursor = page.cursor;
        if (handshake) {
          set({mode: 'live', ready: true});
          if (needReload || recovered) {
            needReload = false;
            wake();
          }
          continue;
        }
        lastWasResync = false;
        if (state.mode !== 'live') set({mode: 'live', ready: true});
        if (recovered || needReload) {
          needReload = false;
          wake();
        } else if (page.events > 0) {
          requestWake();
        } else if (deps.now() - t0 < MIN_POLL_GAP_MS) {
          await sleep(MIN_POLL_GAP_MS - (deps.now() - t0));
        }
      } catch (err) {
        if (g !== gen || destroyed || request.signal.aborted) return;
        const action = classifyFailure(err);
        if (action === 'resync' && !lastWasResync) {
          // Курсор не принят: события могли пройти мимо — рукопожатие и
          // перечитывание всего.
          lastWasResync = true;
          cursor = null;
          needReload = true;
          continue;
        }
        if (action === 'auth' || action === 'project') {
          set({mode: 'stopped', ready: true, stopReason: action});
          return;
        }
        if (action === 'fallback') {
          set({mode: 'fallback', ready: true});
          void fallbackLoop(g);
          return;
        }
        // Сеть, 5xx или повторный 400 подряд: пауза и повтор. Данные на
        // экране остаются.
        failures += 1;
        needReload = true;
        set({mode: 'offline', ready: true});
        await sleep(backoffMs(failures));
      }
    }
  };

  const run = () => {
    gen += 1;
    if (state.mode === 'fallback') void fallbackLoop(gen);
    else if (state.mode !== 'stopped') void loop(gen);
  };

  return {
    start(isVisible) {
      if (started || destroyed) return;
      started = true;
      visible = isVisible;
      if (!visible) {
        // Вкладка открыта в фоне: данные читаются один раз, лента — при показе.
        needReload = true;
        set({ready: true});
        return;
      }
      run();
    },
    setVisible(next) {
      if (destroyed || !started || next === visible) return;
      visible = next;
      if (!visible) {
        gen += 1;
        cancelRequest();
        clearTimers();
        return;
      }
      if (state.mode === 'stopped') return;
      // Возврат: перечитать сразу (после рукопожатия, если курсора нет) и
      // продолжить с сохранённым курсором.
      if (state.mode !== 'fallback' && cursor === null) needReload = true;
      else wake();
      run();
    },
    refresh() {
      if (destroyed) return;
      failures = 0;
      reloadFailures = 0;
      lastWasResync = false;
      if (reloadTimer !== null) deps.clearTimer(reloadTimer);
      reloadTimer = null;
      wake();
      if (state.mode === 'offline') interruptSleep();
    },
    reloadResult(ok) {
      if (destroyed) return;
      if (reloadTimer !== null) deps.clearTimer(reloadTimer);
      reloadTimer = null;
      if (ok) {
        reloadFailures = 0;
        if (state.stale) set({stale: false});
        return;
      }
      reloadFailures += 1;
      if (!state.stale) set({stale: true});
      if (visible) {
        reloadTimer = deps.setTimer(() => {
          reloadTimer = null;
          wake();
        }, backoffMs(reloadFailures));
      }
    },
    destroy() {
      destroyed = true;
      gen += 1;
      cancelRequest();
      clearTimers();
    },
  };
}
