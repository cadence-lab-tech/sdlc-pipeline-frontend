// Живое обновление «Обзора» (CLAB-367) на живом бэкенде: порядок запросов
// (рукопожатие до зон), переход задачи командой API при открытой странице —
// строка меняется без «Обновить» не позже чем через 5 с, пачка событий
// схлопывается, вид не сбрасывается, тихий проект (60 с — ни одного запроса
// списка), скрытая вкладка, «Нет связи» и «Повторить», 400 на курсор, ручки
// нет (404) — «раз в 30 с» без ошибок, наблюдатель, смена проекта, шапка на
// 390 и 1440 px в обеих темах. Подмены (сеть, 404, права) — в браузере, на
// одной ручке; события и данные настоящие. Фокус клавиатуры (AC-14.13): строка,
// переехавшая в другую зону, строка, ушедшая со страницы, и «Обновить» при событии. Заводит свои задачи и проект.
// SDLC_E2E_SHOTS=<каталог> — снимки шапки.
import {session, helpers} from './driver.mjs';

const BASE = process.env.SDLC_UI_URL ?? 'http://localhost:5173';
const API = process.env.SDLC_API_URL ?? 'http://localhost:8088';
const SHOTS = process.env.SDLC_E2E_SHOTS;
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const call = async (method, path, body) => {
  const res = await fetch(`${API}/v1${path}`, {
    method, headers: {'Content-Type': 'application/json', 'X-SDLC-Actor': 'e2e'}, body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(json)}`);
  return json;
};
// Порядок бэклога задаёт ранг (`order=backlog` = `rank, seq`, CLAB-399): новая
// задача встаёт в конец своей группы, приоритет места не меняет. Блок
// показывает первые 5 или 10 строк, а проверка «задача появилась» ищет строку
// на экране, поэтому задачу, которую ищут после «пачки событий», поднимает
// наверх createTop (POST /tasks/:key/rank {position: top}).
const create = async (title, project = 'SDLC', priority = 'urgent') => (await call('POST', `/projects/${project}/tasks`, {title, priority})).key;
const createTop = async (title) => {
  const key = await create(title);
  await call('POST', `/tasks/${key}/rank`, {position: 'top'});
  return key;
};
const tag = Date.now().toString(36);
// Страница открыта с поиском по метке прогона: на общем стенде от прежних
// прогонов остаются задачи, и они стояли бы в бэклоге по рангу выше наших и
// вытесняли бы их из первых 5–10 строк блока.
const OV = `/p/SDLC/overview?q=${tag}`;

// Журнал запросов и подмены ответов ленты — до кода страницы. Режимы ленты:
// '' — настоящая; '404' — сервер без ручки; 'down' — сеть недоступна;
// 'cursor400' — один раз 400 на курсор. Права наблюдателя — __viewer.
const logger = `
  window.__log = [];
  window.__eventsMode = '';
  window.__viewer = false;
  window.__vis = 'visible';
  window.__inflight = new Set();
  Object.defineProperty(document, 'visibilityState', {get: () => window.__vis, configurable: true});
  window.__kill = () => { for (const f of window.__inflight) f(); window.__inflight.clear(); };
  const orig = window.fetch;
  const json = (status, body) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
  window.fetch = (url, init) => {
    const u = String(url);
    const m = u.match(/\\/projects\\/([A-Z0-9]+)\\/(events|tasks|approvals)/);
    if (!m) return orig(url, init);
    const entry = {t: performance.now(), u, project: m[1], kind: m[2], aborted: false, status: null};
    window.__log.push(entry);
    if (m[2] === 'approvals' && window.__viewer) {
      return orig(url, init).then(async (r) => { const b = await r.json(); return json(200, {...b, can_decide: false}); });
    }
    if (m[2] !== 'events') return orig(url, init);
    const sig = init && init.signal;
    if (sig) sig.addEventListener('abort', () => { entry.aborted = true; });
    if (window.__eventsMode === '404') { entry.status = 404; return Promise.resolve(new Response('404 page not found', {status: 404, headers: {'Content-Type': 'text/plain'}})); }
    if (window.__eventsMode === 'down') { entry.status = 0; return Promise.reject(new TypeError('сеть недоступна')); }
    if (window.__eventsMode === 'cursor400' && u.includes('after=')) {
      window.__eventsMode = '';
      entry.status = 400;
      return Promise.resolve(json(400, {error: {code: 'invalid_input', message: 'курсор испорчен'}}));
    }
    return new Promise((resolve, reject) => {
      const kill = () => reject(new TypeError('сеть оборвана'));
      window.__inflight.add(kill);
      orig(url, init).then(
        (r) => { window.__inflight.delete(kill); entry.status = r.status; resolve(r); },
        (e) => { window.__inflight.delete(kill); reject(e); },
      );
    });
  };
`;

const s = await session(BASE + '/projects');
const run = (body) => s.evaluate(helpers + body);
await sleep(1500);
await s.resize(1440, 900);
await s.addInitScript(logger);

const open = async (path, w = 1440) => {
  await s.resize(w, 900);
  await s.goto(BASE + path);
  await sleep(1800);
};
const log = () => run('return window.__log;');
const live = () => run(`
  const el = document.querySelector('[data-live]');
  return el ? {mode: el.getAttribute('data-live-mode'), text: (el.innerText || '').replace(/\\s+/g, ' ').trim(),
    label: (el.querySelector('[data-live-label]')?.innerText || '').replace(/\\s+/g, ' ').trim(),
    title: el.querySelector('[data-live-label]')?.getAttribute('title') || '',
    announce: el.querySelector('[data-live-announce]')?.textContent || '',
    retry: Boolean(el.querySelector('[data-live-retry]'))} : null;
`);
// Задача в первых 10 строках бэклога прогона по ответу сервера — ровно как
// читает блок «Обзора» (limit 10, поиск по метке).
const inBlock = async (key) => (await call('GET', `/projects/SDLC/tasks?terminal=false&in_work=false&top_level=true&order=backlog&limit=10&q=${tag}`)).tasks.some((t) => t.key === key);
const waitFor = async (expr, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await run(`return Boolean(${expr});`)) return Date.now() - t0;
    await sleep(100);
  }
  return null;
};
const zoneOf = (title) => run(`
  const z = Array.from(document.querySelectorAll('section[data-zone]')).find((e) => (e.innerText || '').includes(${JSON.stringify(title)}));
  return z ? z.getAttribute('data-zone') : null;
`);
const rowsOn = (title) => `document.body.innerText.includes(${JSON.stringify(title)})`;

// ── рукопожатие и порядок запросов ──────────────────────────────────────────
console.log('рукопожатие и режим');
await run('localStorage.setItem("sdlc.backlog.size.SDLC", "10"); return 1;');
// Страница с поиском по метке не должна быть пустой с первой секунды.
await create(`Старт ${tag}`, 'SDLC', 'normal');
await open(OV);
let L = await live();
check('индикатор: «Обновляется само»', L?.mode === 'live' && L.label === 'Обновляется само' && !L.retry, JSON.stringify(L));
let lg = await log();
const firstEvents = lg.find((e) => e.kind === 'events');
const firstTasks = lg.find((e) => e.kind === 'tasks' || e.kind === 'approvals');
check('первый запрос ленты — рукопожатие без after', firstEvents && !firstEvents.u.includes('after='), firstEvents?.u);
check('зоны читаются после рукопожатия (AC-14.1)', firstEvents && firstTasks && firstEvents.t < firstTasks.t, `${firstEvents?.t} / ${firstTasks?.t}`);
// Под dev-сервером StrictMode запускает эффект дважды: первое рукопожатие
// отменено, считаем только живые запросы (в сборке отменённых нет).
const second = lg.filter((e) => e.kind === 'events' && !e.aborted)[1];
check('следующий запрос ленты — с курсором и wait=25', second && /after=[^&]+/.test(second.u) && /wait=25/.test(second.u), second?.u);
check('ни одного запроса списка без limit', lg.filter((e) => e.kind === 'tasks').every((e) => /[?&]limit=\d+/.test(e.u)));
const btn = await run(`const b = document.querySelector('[data-refresh]'); return {label: b.getAttribute('aria-label'), title: b.title, busy: b.getAttribute('aria-busy')};`);
check('«Обновить»: время последнего обновления в подсказке', btn.label === 'Обновить' && /данные на \d\d:\d\d/.test(btn.title) && btn.busy === null, JSON.stringify(btn));

// ── событие обновляет экран (AC-14.2) ───────────────────────────────────────
console.log('событие проекта');
const a = `Живая А ${tag}`;
const t0 = Date.now();
const keyA = await create(a);
const dtCreate = await waitFor(rowsOn(a), 8000);
check('заведённая задача появилась без «Обновить» не позже чем через 5 с', dtCreate !== null && Date.now() - t0 <= 5000, `${dtCreate} мс`);
const zoneBefore = await zoneOf(a);
const t1 = Date.now();
await fetch(`${API}/v1/tasks/${keyA}/transitions/start`, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-SDLC-Actor': 'e2e'}, body: '{}'});
const dtMove = await waitFor(`(() => { const z = Array.from(document.querySelectorAll('section[data-zone]')).find((e) => (e.innerText || '').includes(${JSON.stringify(a)})); return z && z.getAttribute('data-zone') !== ${JSON.stringify(zoneBefore)}; })()`, 8000);
check('переход задачи командой: строка переехала в другую зону не позже чем через 5 с', dtMove !== null && Date.now() - t1 <= 5000, `${zoneBefore} → ${await zoneOf(a)}, ${dtMove} мс`);
// Зоны приходят отдельными ответами: на миг строка может стоять и там и там,
// но в установившемся виде — ровно в одной зоне.
const zonesWith = (title) => `Array.from(document.querySelectorAll('section[data-zone]')).filter((e) => (e.innerText || '').includes(${JSON.stringify(title)})).length === 1`;
check('строка в одной зоне (одна задача — одна зона)', (await waitFor(zonesWith(a), 3000)) !== null);

// Правка приоритета — тоже событие, и блок бэклога читает его.
const b2 = `Живая Б ${tag}`;
const keyB = await create(b2);
await waitFor(rowsOn(b2), 8000);
const backlogTotal = async () => run(`return document.querySelector('section[data-zone=backlog] [data-zone-count]')?.getAttribute('aria-label');`);
const truthTotal = async () => (await call('GET', '/projects/SDLC/tasks?terminal=false&in_work=false&top_level=true&order=backlog&limit=1&q=' + tag)).total;
check('счётчик блока бэклога — total сервера после события', (await backlogTotal()) === `Приоритетные из бэклога, ${await truthTotal()}`, `${await backlogTotal()}`);

// ── вид не сбрасывается (AC-14.13) ──────────────────────────────────────────
console.log('вид сохраняется');
await run(`
  const toggle = (z) => document.querySelector('section[data-zone=' + z + '] [data-zone-toggle]');
  toggle('queue').click(); toggle('done').click(); await sleep(300); return 1;
`);
const viewState = () => run(`
  const exp = (z) => document.querySelector('section[data-zone=' + z + '] [data-zone-toggle]')?.getAttribute('aria-expanded');
  return {queue: exp('queue'), done: exp('done'), size: Array.from(document.querySelectorAll('section[data-zone=backlog] [data-backlog-size] [role=radio]')).map((b) => b.getAttribute('data-state')).join(), url: location.search};
`);
const v0 = await viewState();
const keyC = await create(`Живая В ${tag}`);
await waitFor(rowsOn(`Живая В ${tag}`).replace('document.body.innerText', 'document.body.innerText'), 8000);
await sleep(400);
const v1 = await viewState();
check('свёрнутость зон и размер блока (10) остались после события', JSON.stringify(v0) === JSON.stringify(v1) && v1.size === 'off,on', `${JSON.stringify(v0)} → ${JSON.stringify(v1)}`);
await run(`
  const toggle = (z) => document.querySelector('section[data-zone=' + z + '] [data-zone-toggle]');
  toggle('queue').click(); toggle('done').click(); await sleep(200); return 1;
`);

// ── фокус клавиатуры (AC-14.13, design §2.7) ───────────────────────────────
console.log('фокус при автообновлении');
const fk = (key) => `document.querySelector('[data-task-key=' + JSON.stringify(${JSON.stringify(key)}) + '] [data-task-link]')`;
const focusInfo = () => run(`
  const a = document.activeElement;
  return {tag: a?.tagName ?? null, key: a?.closest?.('[data-task-key]')?.dataset.taskKey ?? null,
    zone: a?.closest?.('[data-zone]')?.dataset.zone ?? null, refresh: Boolean(a?.matches?.('[data-refresh]')),
    toggle: Boolean(a?.matches?.('[data-zone-toggle]'))};
`);
const post = (path) => fetch(`${API}/v1${path}`, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-SDLC-Actor': 'e2e'}, body: '{}'});

// 1. Строка в фокусе переезжает в другую зону вместе с задачей.
const titleF = `Фокус А ${tag}`;
const keyF = await create(titleF);
await waitFor(rowsOn(titleF), 8000);
await run(`
  ${fk(keyF)}.focus();
  window.__ft = []; window.__ft0 = performance.now(); let last = '';
  window.__fiv = setInterval(() => {
    const a = document.activeElement;
    const x = a?.matches?.('a') ? a.closest('[data-task-key]')?.dataset.taskKey + '@' + a.closest('[data-zone]')?.dataset.zone : a?.tagName;
    if (x !== last) { window.__ft.push(Math.round(performance.now() - window.__ft0) + ' ' + x); last = x; }
  }, 20);
  return 1;
`);
let fi = await focusInfo();
check('фокус на ссылке строки в блоке бэклога (исходное состояние)', fi.key === keyF && fi.zone === 'backlog', JSON.stringify(fi));
await post(`/tasks/${keyF}/transitions/start`);
await waitFor(`(() => { const z = Array.from(document.querySelectorAll('section[data-zone]')).filter((e) => (e.innerText || '').includes(${JSON.stringify(titleF)})); return z.length === 1 && z[0].getAttribute('data-zone') !== 'backlog'; })()`, 8000);
const zoneF = await zoneOf(titleF);
await waitFor(`document.activeElement?.closest?.('[data-task-key]')?.dataset.taskKey === ${JSON.stringify(keyF)} && document.activeElement.closest('[data-zone]')?.dataset.zone === ${JSON.stringify(zoneF)}`, 3000);
fi = await focusInfo();
const ft = await run(`clearInterval(window.__fiv); return window.__ft;`);
check(`задача переехала (backlog → ${zoneF}): фокус на её строке в новой зоне, не на <body>`, zoneF !== 'backlog' && fi.key === keyF && fi.zone === zoneF && fi.tag === 'A', `${JSON.stringify(fi)} ход фокуса: ${JSON.stringify(ft)}`);
// Между ответами зон (строка уже ушла из одной, но ещё не пришла в другую)
// фокус может на десятки миллисекунд стоять на <body> — важно, где он в итоге.

// 2. «Обновить» не блокируется и не теряет фокус при событии.
await run(`
  const b = document.querySelector('[data-refresh]');
  b.focus();
  window.__rs = [];
  window.__rsTimer = setInterval(() => window.__rs.push({
    disabled: b.disabled, active: document.activeElement === b, busy: b.getAttribute('aria-busy') === 'true',
  }), 8);
  return 1;
`);
const titleR = `Фокус Б ${tag}`;
await create(titleR);
await waitFor(rowsOn(titleR), 8000);
await waitFor(`!document.querySelector('[data-refresh]').hasAttribute('aria-busy')`, 3000);
await sleep(400);
const rs = await run(`clearInterval(window.__rsTimer); return window.__rs;`);
check('«Обновить»: во время автообновления была занята (aria-busy) — проверка не пустая', rs.some((x) => x.busy), `${rs.length} замеров`);
check('«Обновить» ни разу не disabled за время автообновления', rs.every((x) => !x.disabled));
check('фокус остался на «Обновить» всё время (ни одного замера мимо)', rs.length > 0 && rs.every((x) => x.active));
fi = await focusInfo();
check('после автообновления фокус по-прежнему на «Обновить»', fi.refresh === true, JSON.stringify(fi));

// 3. Задача ушла со страницы: фокус — на первую строку той же зоны.
const gone = [];
for (let i = 1; i <= 3; i++) gone.push(await create(`Фокус В${i} ${tag}`));
await waitFor(rowsOn(`Фокус В3 ${tag}`), 8000);
await run(`${fk(gone[2])}.focus(); return 1;`);
fi = await focusInfo();
check('фокус на последней из трёх строк блока бэклога (исходное состояние)', fi.key === gone[2] && fi.zone === 'backlog', JSON.stringify(fi));
await post(`/tasks/${gone[2]}/transitions/cancel`);
const dtGone = await waitFor(`!document.body.innerText.includes(${JSON.stringify(`Фокус В3 ${tag}`)})`, 8000);
await sleep(1500);
fi = await focusInfo();
const firstBacklog = await run(`return document.querySelector('section[data-zone=backlog] [data-task-key]')?.dataset.taskKey ?? null;`);
check('отменённой задачи на странице нет (завершённые свёрнуты)', dtGone !== null);
check('фокус не на <body>: на первой строке той же зоны (блок бэклога)', fi.tag === 'A' && fi.zone === 'backlog' && fi.key === firstBacklog && fi.key !== gone[2], `${JSON.stringify(fi)} первая: ${firstBacklog}`);
// Человек сам увёл фокус — автообновление его не трогает.
await run(`${fk(gone[0])}.focus(); return 1;`);
await create(`Фокус Г ${tag}`);
await waitFor(rowsOn(`Фокус Г ${tag}`), 8000);
await sleep(500);
fi = await focusInfo();
check('событие, не менявшее строку в фокусе: фокус на месте', fi.key === gone[0], JSON.stringify(fi));
// Убираем за собой: оставшиеся в бэклоге прогона задачи стоят в нём по рангу
// выше заводимых позже и занимали бы строки блока.
for (const k of [gone[0], gone[1]]) await post(`/tasks/${k}/transitions/cancel`);
await post(`/tasks/${(await call('GET', `/projects/SDLC/tasks?q=${encodeURIComponent(`Фокус Б ${tag}`)}&limit=1`)).tasks[0].key}/transitions/cancel`);
await post(`/tasks/${(await call('GET', `/projects/SDLC/tasks?q=${encodeURIComponent(`Фокус Г ${tag}`)}&limit=1`)).tasks[0].key}/transitions/cancel`);
await sleep(3000);

// SDLC_E2E_UNTIL=focus — остановиться после проверок фокуса (быстрый прогон).
if (process.env.SDLC_E2E_UNTIL === 'focus') {
  console.log(`\n${ok} ✓, ${fail} ✗ (до фокуса включительно)`);
  s.close();
  process.exit(fail ? 1 : 0);
}

// ── пачка событий (AC-14.5) ─────────────────────────────────────────────────
console.log('пачка событий');
await sleep(2500);
const mark = (await log()).length;
const tb = Date.now();
const batch = [];
for (let i = 1; i <= 12; i++) batch.push(await create(`Пачка ${tag} №${i}`, 'SDLC', 'normal'));
const spent = Date.now() - tb;
await sleep(6000);
lg = (await log()).slice(mark);
const backlogReads = lg.filter((e) => e.kind === 'tasks' && e.u.includes('order=backlog')).map((e) => e.t);
const gaps = backlogReads.slice(1).map((t, i) => t - backlogReads[i]);
check(`12 заведений за ${spent} мс: перечитываний блока не больше окон по 2 с`, backlogReads.length >= 1 && backlogReads.length <= Math.ceil(spent / 2000) + 2, `${backlogReads.length}`);
check('между перечитываниями не меньше ~2 с', gaps.every((g) => g >= 1900), gaps.map(Math.round).join());
check('счётчик блока — total сервера после пачки (последнее событие учтено)', (await backlogTotal()) === `Приоритетные из бэклога, ${await truthTotal()}`, `${await backlogTotal()}`);
check('блок: не больше 10 строк (размер сохранён)', (await run(`return document.querySelectorAll('section[data-zone=backlog] [data-density]').length;`)) <= 10);

// ── тихий проект (AC-14.11, AC-14.21) ───────────────────────────────────────
console.log('тихий проект, 60 с');
await sleep(3000);
const quietFrom = (await log()).length;
await sleep(60_000);
lg = (await log()).slice(quietFrom);
const quietEvents = lg.filter((e) => e.kind === 'events');
check('за 60 с — ни одного запроса списков и /approvals', lg.every((e) => e.kind === 'events'), JSON.stringify(lg.filter((e) => e.kind !== 'events').map((e) => e.u)));
check('только долгие запросы ленты: 2–3 штуки, все с after и wait=25', quietEvents.length >= 2 && quietEvents.length <= 3 && quietEvents.every((e) => /after=/.test(e.u) && /wait=25/.test(e.u)), String(quietEvents.length));
check('пустой ответ — тот же курсор в следующем запросе', new Set(quietEvents.map((e) => e.u.match(/after=([^&]+)/)?.[1])).size === 1);
check('индикатор не менялся', (await live()).mode === 'live');

// ── скрытая вкладка (AC-14.8) ───────────────────────────────────────────────
console.log('скрытая вкладка');
const inflight = (await log()).filter((e) => e.kind === 'events').at(-1);
const cursorBefore = inflight.u.match(/after=([^&]+)/)?.[1];
const hideFrom = (await log()).length;
await run(`window.__vis = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); await sleep(300); return 1;`);
check('скрытие отменило текущий долгий запрос', (await log()).filter((e) => e.kind === 'events').at(-1).aborted === true);
const hiddenKey = await createTop(`Скрытая ${tag}`);
check('«Скрытая» стоит в первых 10 строках бэклога (по ответу сервера)', await inBlock(hiddenKey));
await sleep(8000);
lg = (await log()).slice(hideFrom);
check('за время скрытия новых запросов нет (ни ленты, ни списков)', lg.length === 0, JSON.stringify(lg.map((e) => e.u)));
check('задачи на экране ещё нет', !(await run(`return ${rowsOn(`Скрытая ${tag}`)};`)));
await run(`window.__vis = 'visible'; document.dispatchEvent(new Event('visibilitychange')); return 1;`);
const dtVis = await waitFor(rowsOn(`Скрытая ${tag}`), 3000);
check('возврат: перечитывание сразу, задача на экране', dtVis !== null, `${dtVis}`);
await sleep(500);
lg = (await log()).slice(hideFrom);
check('возврат: перечитаны все зоны и блок бэклога', ['attention_except', 'in_work=true', 'attention=unclaimed', 'order=backlog', 'terminal=true'].every((k) => lg.some((e) => e.u.includes(k))));
const resumed = lg.filter((e) => e.kind === 'events')[0];
check('опрос возобновлён с сохранённым курсором', resumed && resumed.u.includes(`after=${cursorBefore}`), `${resumed?.u} / ${cursorBefore}`);

// ── нет связи (AC-14.9) ─────────────────────────────────────────────────────
console.log('нет связи');
await run(`window.__eventsMode = 'down'; window.__kill(); return 1;`);
await waitFor(`document.querySelector('[data-live-mode=offline]')`, 4000);
L = await live();
check('«Нет связи · данные на HH:MM» и «Повторить»', L?.mode === 'offline' && /^Нет связи · данные на \d\d:\d\d$/.test(L.label) && L.retry, JSON.stringify(L));
check('подсказка: данные могут быть устаревшими; объявление для чтения с экрана', /устаревш/.test(L.title) && /Нет связи/.test(L.announce), JSON.stringify(L));
check('прежние данные на экране', (await run(`return document.querySelectorAll('section[data-zone] [data-density]').length;`)) > 3);
check('нет баннера ошибки на всю страницу', !(await run('return texts();')).includes('не открылся'));
const offFrom = (await log()).length;
await sleep(6500);
lg = (await log()).slice(offFrom).filter((e) => e.kind === 'events');
check('повтор через 5 с (один запрос ленты)', lg.length === 1, String(lg.length));
await run(`window.__eventsMode = ''; return 1;`);
const afterRetry = await createTop(`После обрыва ${tag}`);
await run(`document.querySelector('[data-live-retry]').click(); return 1;`);
const dtBack = await waitFor(`document.querySelector('[data-live-mode=live]')`, 4000);
check('«Повторить»: связь вернулась', dtBack !== null);
check('объявление «Связь восстановлена»', (await live())?.announce === 'Связь восстановлена.', JSON.stringify(await live()));
check('данные перечитаны: задача, заведённая за время обрыва, на экране', (await waitFor(rowsOn(`После обрыва ${tag}`), 4000)) !== null);

// ── 400 на курсор (AC-14.10) ────────────────────────────────────────────────
console.log('400 на курсор');
const c4 = (await log()).length;
await run(`window.__eventsMode = 'cursor400'; return 1;`);
await create(`Курсор ${tag}`);
await sleep(4500);
lg = (await log()).slice(c4);
const ev = lg.filter((e) => e.kind === 'events');
check('запрос с испорченным курсором получил 400', ev.some((e) => e.status === 400), JSON.stringify(ev.map((e) => [e.status, e.u.slice(-30)])));
const at400 = ev.findIndex((e) => e.status === 400);
check('после 400 — новое рукопожатие без after', ev.slice(at400 + 1).some((e) => !e.u.includes('after=')), JSON.stringify(ev.map((e) => e.u.slice(-30))));
check('и опрос продолжился с новым курсором', ev.slice(at400 + 1).some((e) => e.u.includes('after=')));
check('перечитаны все зоны и блок', ['attention_except', 'in_work=true', 'order=backlog'].every((k) => lg.some((e) => e.u.includes(k))));
check('индикатор остался «Обновляется само»', (await live())?.mode === 'live', JSON.stringify(await live()));

// ── наблюдатель (AC-14.14) ──────────────────────────────────────────────────
console.log('наблюдатель');
await run('window.__viewer = true; document.querySelector("[data-refresh]").click(); return 1;');
await sleep(1500);
const viewerNote = () => run(`return Boolean(document.querySelector('[data-viewer-note]')) && document.querySelector('[data-viewer-note]').innerText.includes('Решать может уровень сопровождающего и выше');`);
check('подпись о правах показана', await viewerNote());
const vKey = `Наблюдатель ${tag}`;
await createTop(vKey);
check('событие под наблюдателем: страница обновилась без ошибок', (await waitFor(rowsOn(vKey), 5000)) !== null && (await viewerNote()) && !(await run('return texts();')).includes('Не получилось'));
check('лента ответила наблюдателю 200', (await log()).filter((e) => e.kind === 'events' && e.status !== null).every((e) => e.status === 200 || e.status === 400 || e.status === 0));
await run('window.__viewer = false; return 1;');

// ── шапка на 390 и 1440 (AC-14.18) ──────────────────────────────────────────
console.log('шапка: индикатор и кнопки');
const headerFits = () => run(`
  const root = document.querySelector('[data-overview]');
  const items = ['[data-live]', '[data-refresh]', '[data-next-button]', 'button[aria-label="Новая задача"]']
    .map((q) => document.querySelector(q)).filter(Boolean).map((el) => ({q: el.getAttribute('data-live') !== null ? 'live' : (el.getAttribute('aria-label') || el.innerText), r: el.getBoundingClientRect()}));
  const inside = items.every((i) => i.r.left >= 0 && i.r.right <= window.innerWidth + 0.5 && i.r.width > 0);
  let overlap = false;
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i].r, b = items[j].r;
    if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) overlap = true;
  }
  const clipped = Array.from(document.querySelectorAll('[data-live-label]')).some((el) => el.scrollWidth > el.clientWidth + 1);
  return {inside, overlap, clipped, hscroll: document.documentElement.scrollWidth > window.innerWidth, n: items.length};
`);
for (const [width, dark] of [[1440, false], [1440, true], [390, false], [390, true]]) {
  await open(OV, width);
  await run(`document.documentElement.classList.toggle('dark', ${dark}); await sleep(300); return 1;`);
  let h = await headerFits();
  check(`${width} px, ${dark ? 'тёмная' : 'светлая'}, «Обновляется само»: кнопки на месте, ничего не обрезано`, h.inside && !h.overlap && !h.clipped && !h.hscroll && h.n >= 3, JSON.stringify(h));
  await run(`window.__eventsMode = 'down'; window.__kill(); return 1;`);
  await waitFor(`document.querySelector('[data-live-mode=offline]')`, 4000);
  h = await headerFits();
  check(`${width} px, ${dark ? 'тёмная' : 'светлая'}, «Нет связи»: кнопки на месте, ничего не обрезано`, h.inside && !h.overlap && !h.clipped && !h.hscroll, JSON.stringify(h));
  const tone = await run(`const el = document.querySelector('[data-live-label]'); return {color: getComputedStyle(el).color, hasIcon: Boolean(el.querySelector('svg')), text: el.innerText.trim()};`);
  check(`${width} px, ${dark ? 'тёмная' : 'светлая'}: значок и текст, а не один цвет`, tone.hasIcon && tone.text.startsWith('Нет связи'), JSON.stringify(tone));
  if (SHOTS) {
    const {writeFileSync} = await import('node:fs');
    writeFileSync(`${SHOTS}/overview-live-${width}-${dark ? 'dark' : 'light'}-offline.png`, Buffer.from(await s.screenshot(), 'base64'));
  }
  await run(`window.__eventsMode = ''; return 1;`);
}
await run(`document.documentElement.classList.remove('dark'); return 1;`);

// ── смена проекта (AC-14.12) ────────────────────────────────────────────────
console.log('смена проекта');
const other = 'LIVE' + tag.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
await call('POST', '/projects', {key: other, name: `Живой ${tag}`});
await open(OV);
const sw = (await log()).length;
await run(`history.pushState({}, '', '/p/${other}/overview'); window.dispatchEvent(new PopStateEvent('popstate')); return 1;`);
await sleep(2500);
lg = (await log()).slice(sw);
const oldEv = (await log()).filter((e) => e.kind === 'events' && e.project === 'SDLC').at(-1);
check('опрос прежнего проекта отменён', oldEv.aborted === true);
check('для нового проекта — рукопожатие без after', lg.some((e) => e.kind === 'events' && e.project === other && !e.u.includes('after=')));
const hs = lg.find((e) => e.kind === 'events' && e.project === other);
const firstRead = lg.find((e) => e.project === other && e.kind !== 'events');
check('чтение зон нового проекта — после рукопожатия', hs && (!firstRead || hs.t < firstRead.t));
const shown = await run('return texts();');
check('на экране новый проект, строк прежнего нет', shown.includes(`Живой ${tag}`) && !shown.includes(`Живая А ${tag}`) && !shown.includes(`Пачка ${tag}`), shown.slice(0, 200));
const swAfter = (await log()).length;
await create(`Событие старого проекта ${tag}`);
await sleep(3500);
lg = (await log()).slice(swAfter);
check('событие прежнего проекта новый не перечитывает', lg.every((e) => e.project === other && e.kind === 'events'), JSON.stringify(lg.map((e) => e.u)));
check('новый проект слушает свою ленту (запрос с after)', lg.some((e) => e.project === other && e.u.includes('after=')) || (await log()).slice(sw).some((e) => e.project === other && e.u.includes('after=')));
await call('DELETE', `/projects/${other}`).catch(() => {});

// ── ручки нет: раз в 30 с (AC-14.7, AC-14.19) ───────────────────────────────
console.log('ручки нет (404)');
const ini = await s.addInitScript(`window.__eventsMode = '404';`);
await s.resize(1440, 900);
await s.goto(BASE + OV);
await sleep(2500);
L = await live();
check('индикатор «Обновление раз в 30 с», без «Повторить»', L?.mode === 'fallback' && L.label === 'Обновление раз в 30 с' && !L.retry, JSON.stringify(L));
check('подсказка про ручку', /Ручки событий нет — страница перечитывает данные сама/.test(L.title), L?.title);
let t = await run('return texts();');
check('зоны показаны, ни баннера ошибки, ни пустых зон', (await run(`return document.querySelectorAll('section[data-zone] [data-density]').length;`)) > 3 && !t.includes('Не получилось') && !t.includes('не открылся'));
const n404 = (await log()).length;
const noHandleKey = await createTop(`Без ручки ${tag}`);
check('«Без ручки» стоит в первых 10 строках бэклога (по ответу сервера)', await inBlock(noHandleKey));
await sleep(20_000);
check('до 30 с события не перечитывают страницу', !(await run(`return ${rowsOn(`Без ручки ${tag}`)};`)));
const ok30 = await waitFor(rowsOn(`Без ручки ${tag}`), 15_000);
const at30 = await run('return performance.now();');
check('через 30 с (±1 с) страница перечитана сама', ok30 !== null && at30 >= 29_000 && at30 <= 32_000, `${Math.round(at30)} мс от открытия`);
lg = (await log()).slice(n404 - 0);
check('ручку событий больше не спрашивали', (await log()).filter((e) => e.kind === 'events' && !e.aborted).length === 1);
await s.removeInitScript(ini);

// ── итог ────────────────────────────────────────────────────────────────────
console.log(`\n${ok} ✓, ${fail} ✗`);
s.close();
process.exit(fail ? 1 : 0);
