// Правила живого обновления «Обзора» (CLAB-367) — без браузера и бэкенда:
// паузы, коды ответов, схлопывание пачки, рукопожатие и порядок запросов,
// скрытая вкладка, запасной режим, смена проекта, подписи индикатора.
// Модуль hooks/liveFeed.ts — чистый, проверяется прямо в исходниках; цикл
// опроса идёт на поддельных часах и таймерах, запрос — заглушка.
// Здесь же — поиск литералов типов событий в коде хука и страницы (AC-14.3) и
// импортов страницы в хуке (AC-14.15).
import {readFileSync, readdirSync} from 'node:fs';
import {registerHooks} from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(specifier + '.ts', context);
      throw err;
    }
  },
});

const L = await import('../src/hooks/liveFeed.ts');

let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};

// ── поддельные часы, таймеры и лента ────────────────────────────────────────
function rig(opts = {}) {
  let now = 1_000_000;
  let seq = 0;
  const timers = new Map();
  const log = {calls: [], wakes: [], states: []};
  const pending = []; // запросы, ждущие ответа
  const fetchPage = (after, signal) =>
    new Promise((resolve, reject) => {
      const call = {after, signal, at: now, resolve, reject, done: false};
      log.calls.push(call);
      pending.push(call);
      signal.addEventListener('abort', () => {
        const e = new Error('aborted'); e.name = 'AbortError';
        reject(e);
      });
    });
  const feed = L.createLiveFeed({
    fetchPage,
    onWake: () => log.wakes.push(now),
    onState: (s) => log.states.push(s),
    now: () => now,
    setTimer: (fn, ms) => { const id = ++seq; timers.set(id, {at: now + ms, fn}); return id; },
    clearTimer: (id) => timers.delete(id),
  });
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  const api = {
    feed, log,
    get state() { return log.states.at(-1); },
    get now() { return now; },
    get open() { return log.calls.filter((c) => !c.done && !c.signal.aborted); },
    // Ответить на последний открытый запрос.
    async answer(page) { const c = api.open.at(-1); c.done = true; c.resolve(page); await flush(); return c; },
    async fail(err) { const c = api.open.at(-1); c.done = true; c.reject(err); await flush(); return c; },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        let next = null;
        for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next.t.at)) next = {id, t};
        if (!next) break;
        now = Math.max(now, next.t.at);
        timers.delete(next.id);
        next.t.fn();
        await flush();
      }
      now = end;
      await flush();
    },
    timers: () => timers.size,
  };
  return api;
}
const page = (events, cursor) => ({events: events.length, cursor});

// ── задержки ────────────────────────────────────────────────────────────────
console.log('паузы после ошибок');
check('5, 10, 20, 40, 60 с', [1, 2, 3, 4, 5].map(L.backoffMs).join() === '5000,10000,20000,40000,60000');
check('дальше 60 с', L.backoffMs(6) === 60_000 && L.backoffMs(50) === 60_000);
check('нулевая неудача — первая пауза', L.backoffMs(0) === 5_000);
check('wait ленты — 25 с, запасной режим — 30 с', L.WAIT_SECONDS === 25 && L.FALLBACK_MS === 30_000);

// ── коды ответов ────────────────────────────────────────────────────────────
console.log('решение по коду ответа');
const E = (httpStatus, code) => ({httpStatus, code});
check('400 — рукопожатие заново', L.classifyFailure(E(400, 'invalid_input')) === 'resync');
check('401 — стоп без повторов', L.classifyFailure(E(401, 'unauthenticated')) === 'auth');
check('403 — стоп, ошибка проекта', L.classifyFailure(E(403, 'forbidden')) === 'project');
check('404 с кодом домена — нет проекта', L.classifyFailure(E(404, 'not_found')) === 'project');
check('404 без тела ошибки — нет ручки, раз в 30 с', L.classifyFailure(E(404, 'internal')) === 'fallback');
check('5xx — пауза и повтор', L.classifyFailure(E(502, 'internal')) === 'retry' && L.classifyFailure(E(500, 'internal')) === 'retry');
check('сеть (статуса нет) — пауза и повтор', L.classifyFailure(new Error('x')) === 'retry' && L.classifyFailure(undefined) === 'retry');
check('429 и прочее — пауза и повтор', L.classifyFailure(E(429)) === 'retry' && L.classifyFailure(E(200)) === 'retry');

// ── рукопожатие и порядок запросов (AC-14.1) ────────────────────────────────
console.log('рукопожатие');
{
  const r = rig();
  r.feed.start(true);
  await r.advance(0);
  check('первый запрос — без after', r.log.calls.length === 1 && r.log.calls[0].after === undefined);
  check('зоны ещё не читаются: ready=false', r.state === undefined || r.state.ready === false);
  await r.answer(page([], 'c1'));
  check('после курсора: ready, режим live', r.state.ready === true && r.state.mode === 'live');
  check('второй запрос — с курсором из ответа', r.log.calls.length === 2 && r.log.calls[1].after === 'c1');
  check('первое рукопожатие зоны не перечитывает (страница читает сама)', r.log.wakes.length === 0);
  r.feed.destroy();
}

// ── событие будит, пустой ответ — нет (AC-14.2, AC-14.11) ──────────────────
console.log('событие и пустой ответ');
{
  const r = rig();
  r.feed.start(true);
  await r.answer(page([], 'c1'));
  await r.advance(25_000);
  await r.answer(page([{}], 'c2'));
  check('одно событие — одно перечитывание сразу', r.log.wakes.length === 1);
  check('следующий запрос — с новым курсором', r.open.at(-1)?.after === 'c2');
  await r.advance(25_000);
  const before = r.log.wakes.length;
  await r.answer(page([], 'c2'));
  check('пустой ответ: зоны не перечитываются', r.log.wakes.length === before);
  check('пустой ответ: тот же курсор', r.open.at(-1)?.after === 'c2');
  check('пустой ответ: режим не меняется', r.state.mode === 'live');
  r.feed.destroy();
}

// ── схлопывание пачки (AC-14.5) ─────────────────────────────────────────────
console.log('пачка событий');
{
  const r = rig();
  r.feed.start(true);
  await r.answer(page([], 'c0'));
  // 20 ответов по событию за 2 с — каждые 100 мс.
  for (let i = 1; i <= 20; i++) {
    await r.advance(100);
    await r.answer(page([{}], 'c' + i));
  }
  const first = r.log.wakes.length;
  check('20 событий за 2 с: не больше 2 перечитываний (сразу и хвост окна)', first <= 2, String(first));
  await r.advance(2_500);
  check('самое позднее событие отражено в пределах 5 с', r.log.wakes.length >= 2 && r.now - r.log.wakes.at(-1) < 5_000);
  const gaps = r.log.wakes.slice(1).map((t, i) => t - r.log.wakes[i]);
  check('между перечитываниями не меньше окна', gaps.every((g) => g >= L.COALESCE_MS), gaps.join());
  r.feed.destroy();
}
{
  const r = rig();
  r.feed.start(true);
  await r.answer(page([], 'c0'));
  await r.answer(page([{}], 'c1'));
  check('первое событие будит сразу', r.log.wakes.length === 1);
  await r.advance(500);
  await r.answer(page([{}], 'c2'));
  check('второе внутри окна ждёт хвоста окна', r.log.wakes.length === 1);
  await r.advance(1_600);
  check('хвост окна перечитывает один раз', r.log.wakes.length === 2);
  r.feed.destroy();
}

// ── 400: курсор не принят (AC-14.10) ────────────────────────────────────────
console.log('400 на курсор');
{
  const r = rig();
  r.feed.start(true);
  await r.answer(page([], 'c1'));
  await r.fail(E(400, 'invalid_input'));
  check('новое рукопожатие — запрос без after', r.open.at(-1)?.after === undefined);
  await r.answer(page([], 'c9'));
  check('после рукопожатия зоны перечитаны', r.log.wakes.length === 1);
  check('и опрос идёт с новым курсором', r.open.at(-1)?.after === 'c9');
  check('режим остаётся live, без «Нет связи»', r.state.mode === 'live');
  // 400 два раза подряд не превращается в плотный цикл.
  await r.fail(E(400, 'invalid_input'));
  check('повторные 400 подряд — пауза, а не плотный цикл', r.state.mode === 'offline' && r.open.length === 0);
  r.feed.destroy();
}

// ── 401 / 403 / 404 проекта ─────────────────────────────────────────────────
console.log('401, 403, 404 проекта');
for (const [status, code, reason] of [[401, 'unauthenticated', 'auth'], [403, 'forbidden', 'project'], [404, 'not_found', 'project']]) {
  const r = rig();
  r.feed.start(true);
  await r.answer(page([], 'c1'));
  await r.fail(E(status, code));
  check(`${status}: опрос остановлен (${reason})`, r.state.mode === 'stopped' && r.state.stopReason === reason);
  const n = r.log.calls.length;
  await r.advance(120_000);
  check(`${status}: повторов нет`, r.log.calls.length === n && r.log.wakes.length === 0);
  r.feed.destroy();
}
{
  const r = rig();
  r.feed.start(true);
  await r.fail(E(403, 'forbidden'));
  check('403 на рукопожатии: ready=true, зоны не заблокированы', r.state.ready === true && r.state.mode === 'stopped');
  r.feed.destroy();
}

// ── 404 маршрута: запасной режим (AC-14.7, AC-14.19) ────────────────────────
console.log('ручки нет (404)');
{
  const r = rig();
  r.feed.start(true);
  await r.fail(E(404, 'internal'));
  check('режим fallback, ready', r.state.mode === 'fallback' && r.state.ready === true);
  check('зоны сразу не перечитываются (страница читает сама)', r.log.wakes.length === 0);
  await r.advance(29_000);
  check('до 30 с тихо', r.log.wakes.length === 0);
  await r.advance(1_500);
  check('раз в 30 с (±1 с)', r.log.wakes.length === 1 && Math.abs(r.log.wakes[0] - r.log.calls[0].at - 30_000) <= 1_000, JSON.stringify(r.log.wakes));
  await r.advance(30_000);
  check('и ещё раз', r.log.wakes.length === 2);
  check('ручку повторно не спрашивает', r.log.calls.length === 1);
  r.feed.setVisible(false);
  const w = r.log.wakes.length;
  await r.advance(120_000);
  check('вкладка скрыта: не перечитывает', r.log.wakes.length === w);
  r.feed.setVisible(true);
  check('возврат: перечитывание сразу', r.log.wakes.length === w + 1);
  await r.advance(30_500);
  check('и снова раз в 30 с', r.log.wakes.length === w + 2);
  check('и всё ещё без повторной проверки ручки', r.log.calls.length === 1);
  r.feed.destroy();
}
{
  const r = rig();
  r.feed.start(true);
  await r.answer(page([], 'c1'));
  await r.fail(E(404, 'internal'));
  check('404 позже рукопожатия — тот же режим', r.state.mode === 'fallback');
  r.feed.destroy();
}

// ── скрытая вкладка (AC-14.8) ───────────────────────────────────────────────
console.log('скрытая вкладка');
{
  const r = rig();
  r.feed.start(true);
  await r.answer(page([], 'c1'));
  const inflight = r.open.at(-1);
  r.feed.setVisible(false);
  check('скрытие отменяет текущий долгий запрос', inflight.signal.aborted === true);
  const n = r.log.calls.length;
  await r.advance(60_000);
  check('за 60 с скрытия новых запросов нет', r.log.calls.length === n);
  r.feed.setVisible(true);
  check('возврат: перечитывание сразу', r.log.wakes.length === 1);
  check('и опрос с сохранённым курсором', r.open.at(-1)?.after === 'c1' && r.open.length === 1);
  r.feed.destroy();
}
{
  // Ответ, пришедший после скрытия, не будит и не двигает курсор.
  const r = rig();
  r.feed.start(true);
  await r.answer(page([], 'c1'));
  const c = r.open.at(-1);
  r.feed.setVisible(false);
  c.resolve(page([{}], 'late'));
  await r.advance(0);
  check('ответ после скрытия не перечитывает', r.log.wakes.length === 0);
  r.feed.setVisible(true);
  check('курсор остался прежним', r.open.at(-1)?.after === 'c1');
  r.feed.destroy();
}
{
  // Страница открыта в фоне.
  const r = rig();
  r.feed.start(false);
  check('вкладка в фоне: запросов нет, зоны читаются один раз', r.log.calls.length === 0 && r.state.ready === true);
  r.feed.setVisible(true);
  check('показ: рукопожатие без after', r.log.calls.length === 1 && r.log.calls[0].after === undefined);
  await r.answer(page([], 'c1'));
  check('после рукопожатия — перечитывание и опрос', r.log.wakes.length === 1 && r.open.at(-1)?.after === 'c1');
  r.feed.destroy();
}
{
  // Скрытие во время ожидания в паузе.
  const r = rig();
  r.feed.start(true);
  await r.answer(page([], 'c1'));
  await r.fail(new Error('network'));
  r.feed.setVisible(false);
  const n = r.log.calls.length;
  await r.advance(120_000);
  check('пауза после ошибки при скрытой вкладке запросов не шлёт', r.log.calls.length === n);
  r.feed.destroy();
}

// ── сеть и 5xx (AC-14.9) ────────────────────────────────────────────────────
console.log('сеть и 5xx');
{
  const r = rig();
  r.feed.start(true);
  await r.answer(page([], 'c1'));
  await r.fail(new Error('network'));
  check('«Нет связи»: режим offline', r.state.mode === 'offline');
  const starts = [];
  for (const wait of [5_000, 10_000, 20_000, 40_000, 60_000, 60_000]) {
    const n = r.log.calls.length;
    await r.advance(wait - 1);
    const early = r.log.calls.length === n;
    await r.advance(2);
    const retried = r.log.calls.length === n + 1;
    starts.push(early && retried);
    await r.fail(E(502, 'internal'));
  }
  check('повторы через 5, 10, 20, 40, 60, 60 с', starts.every(Boolean), starts.join());
  await r.advance(60_001);
  await r.answer(page([], 'c1'));
  check('успех: режим live', r.state.mode === 'live');
  check('успех: данные перечитаны', r.log.wakes.length === 1);
  await r.fail(new Error('network'));
  const n = r.log.calls.length;
  await r.advance(4_999);
  check('пауза сброшена: снова 5 с', r.log.calls.length === n);
  await r.advance(2);
  check('и ровно через 5 с повтор', r.log.calls.length === n + 1);
  r.feed.destroy();
}
{
  const r = rig();
  r.feed.start(true);
  await r.answer(page([], 'c1'));
  await r.fail(new Error('network'));
  await r.advance(5_001);
  await r.fail(new Error('network'));
  const n = r.log.calls.length;
  r.feed.refresh();
  await r.advance(0);
  check('«Повторить»: немедленный запрос', r.log.calls.length === n + 1);
  check('«Повторить»: страница перечитывается', r.log.wakes.length >= 1);
  await r.fail(new Error('network'));
  const m = r.log.calls.length;
  await r.advance(4_900);
  check('«Повторить»: пауза сброшена (снова 5 с)', r.log.calls.length === m);
  await r.advance(200);
  check('«Повторить»: и повтор ровно через 5 с', r.log.calls.length === m + 1);
  r.feed.destroy();
}
{
  // Рукопожатие не удалось: курсора нет, зоны не заблокированы.
  const r = rig();
  r.feed.start(true);
  await r.fail(new Error('network'));
  check('ошибка на рукопожатии: ready=true, offline', r.state.ready === true && r.state.mode === 'offline');
  await r.advance(5_001);
  check('повтор — снова рукопожатие, не опрос', r.open.at(-1)?.after === undefined);
  await r.answer(page([], 'c1'));
  check('после успеха — перечитывание', r.log.wakes.length === 1);
  r.feed.destroy();
}

// ── перечитывание зон не удалось ────────────────────────────────────────────
console.log('ошибка перечитывания зон');
{
  const r = rig();
  r.feed.start(true);
  await r.answer(page([], 'c1'));
  r.feed.reloadResult(false);
  check('индикатор: нет связи, хотя лента отвечает', L.connectionOf(r.state) === 'offline');
  await r.advance(4_900);
  check('до паузы зоны не перечитываются', r.log.wakes.length === 0);
  await r.advance(200);
  check('через 5 с перечитывание', r.log.wakes.length === 1);
  r.feed.reloadResult(false);
  await r.advance(9_900);
  check('вторая неудача — пауза 10 с', r.log.wakes.length === 1);
  await r.advance(200);
  check('и перечитывание после неё', r.log.wakes.length === 2);
  r.feed.reloadResult(true);
  check('успех снимает «Нет связи»', L.connectionOf(r.state) === 'live');
  await r.advance(60_000);
  check('и таймер не остаётся', r.log.wakes.length === 2);
  r.feed.destroy();
}

// ── смена проекта (AC-14.12) ────────────────────────────────────────────────
console.log('смена проекта');
{
  const r = rig();
  r.feed.start(true);
  await r.answer(page([], 'c1'));
  const c = r.open.at(-1);
  r.feed.destroy();
  check('прежний опрос отменён', c.signal.aborted === true);
  c.resolve(page([{}], 'late'));
  await r.advance(10_000);
  check('ответ после смены отброшен: перечитываний нет', r.log.wakes.length === 0);
  check('и новых запросов старый экземпляр не шлёт', r.log.calls.length === 2);
  r.feed.refresh();
  check('destroy: refresh не будит', r.log.wakes.length === 0);
}

// ── пустой ответ быстрее срока: нет плотного цикла ─────────────────────────
console.log('мгновенный пустой ответ');
{
  const r = rig();
  r.feed.start(true);
  await r.answer(page([], 'c1'));
  await r.answer(page([], 'c1'));
  const n = r.log.calls.length;
  await r.advance(500);
  check('мгновенный пустой ответ даёт паузу', r.log.calls.length === n);
  await r.advance(600);
  check('и затем следующий запрос', r.log.calls.length === n + 1);
  r.feed.destroy();
}

// ── индикатор ───────────────────────────────────────────────────────────────
console.log('индикатор');
{
  const at = new Date(2026, 10, 3, 9, 5).getTime();
  const live = L.indicator('live', at);
  check('live: «Обновляется само»', live.label === 'Обновляется само' && live.retry === false);
  check('live: время в подсказке', live.title.includes('09:05'));
  const fb = L.indicator('fallback', at);
  check('fallback: «Обновление раз в 30 с»', fb.label === 'Обновление раз в 30 с');
  check('fallback: подсказка про ручку', fb.title.startsWith('Ручки событий нет — страница перечитывает данные сама'));
  const off = L.indicator('offline', at);
  check('offline: «Нет связи · данные на HH:MM» и «Повторить»', off.label === 'Нет связи · данные на 09:05' && off.retry === true);
  check('offline: предупреждающий тон и подсказка про устаревшие данные', off.tone === 'warn' && /устаревш/.test(off.title));
  check('offline без времени — без хвоста', L.indicator('offline', null).label === 'Нет связи');
  check('подключение — без индикатора', L.indicator('connecting', null).label === null);
  check('stopped: подпись остановки', L.indicator('stopped', null, 'auth').label === 'Обновление остановлено');
  check('объявление: только уход в «Нет связи» и возврат', L.announcement('live', 'offline') !== '' && L.announcement('offline', 'live') !== '');
  check('объявление: смена live ↔ connecting молчит', L.announcement('connecting', 'live') === '' && L.announcement('live', 'live') === '');
  check('объявление: перечитывание ничего не объявляет', L.announcement('live', 'live') === '');
  check('связь: stale при live даёт offline', L.connectionOf({mode: 'live', ready: true, stale: true}) === 'offline');
  check('связь: stale при остановке остаётся stopped', L.connectionOf({mode: 'stopped', ready: true, stale: true}) === 'stopped');
}

// ── структура и литералы (AC-14.3, AC-14.15) ───────────────────────────────
console.log('структура');
{
  const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
  const files = {
    'src/hooks/liveFeed.ts': read('src/hooks/liveFeed.ts'),
    'src/hooks/useProjectEvents.ts': read('src/hooks/useProjectEvents.ts'),
    'src/pages/Overview.tsx': read('src/pages/Overview.tsx'),
    ...Object.fromEntries(
      readdirSync(new URL('../src/components/overview/', import.meta.url)).map((f) => [
        'src/components/overview/' + f,
        read('src/components/overview/' + f),
      ]),
    ),
  };
  const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  const literal = /['"`](?:stage|gate|lease|task|artifact|review|drift)\.[a-z_]*['"`]/;
  const offenders = Object.entries(files).filter(([, s]) => literal.test(noComments(s))).map(([f]) => f);
  check('литералов типов событий в хуке и странице нет', offenders.length === 0, offenders.join());
  const hook = noComments(files['src/hooks/useProjectEvents.ts'] + files['src/hooks/liveFeed.ts']);
  check('хук не импортирует «Обзор»', !/from\s+['"][^'"]*(components\/overview|pages\/Overview)/.test(hook));
  check('хук принимает ключ проекта и колбэк', /useProjectEvents\(projectKey: string, onWake: \(\) => void\)/.test(files['src/hooks/useProjectEvents.ts']));
  check('liveFeed.ts без React и DOM', !/from\s+['"]react['"]/.test(files['src/hooks/liveFeed.ts']) && !/\bdocument\b|\bwindow\b/.test(noComments(files['src/hooks/liveFeed.ts'])));
  const uses = readdirSync(new URL('../src/', import.meta.url), {recursive: true})
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => /useProjectEvents\(/.test(read('src/' + f)) && !f.endsWith('useProjectEvents.ts'));
  check('хук подключён к «Обзору» в одной точке', uses.length === 1 && /Overview\.tsx$/.test(uses[0]), uses.join());
  const overview = noComments(files['src/pages/Overview.tsx']);
  check('страница перечитывает одним путём: reloadAll', /reloadRef\.current = data\.reloadAll/.test(overview) && /onCreated=\{data\.reloadAll\}/.test(overview));
}

console.log(`\n${ok} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
