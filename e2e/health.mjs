// Состояние приложения GitHub, нечитаемые репозитории и отметки в меню
// проекта (CLAB-79).
//
// Сценарий не знает заранее, в каком состоянии стенд: на `make up`
// репозитории демонстрационного проекта могут не читаться, в стеке задачи
// приложение бывает намеренно сломано. Поэтому он спрашивает у бэкенда
// сводку, настройки GitHub и состояние индекса и сверяет с ними экран —
// что отдал бэкенд, то и обязано быть нарисовано, ни больше ни меньше.
// Сами правила «что сказать в каждом состоянии» проверяет labels.mjs.
import {session, helpers} from './driver.mjs';

const BASE = process.env.SDLC_UI_URL ?? 'http://localhost:5173';
const API = (process.env.SDLC_API_URL ?? 'http://localhost:8088').replace(/\/v1\/?$/, '') + '/v1';
const ACTOR = {'X-SDLC-Actor': 'e2e', 'Content-Type': 'application/json'};
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};
const get = async (path) => {
  const res = await fetch(API + path, {headers: ACTOR});
  return {status: res.status, body: res.ok ? await res.json() : undefined};
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SETTINGS_MARK = 'Ключ приложения GitHub не принят';
const expectMarks = (health) => ({
  settings: health.app?.state === 'rejected' ? SETTINGS_MARK : null,
  search: (health.unreadable_repositories ?? 0) > 0
    ? `Не читается репозиториев: ${health.unreadable_repositories}` : null,
});

// Отметки в меню, как их видит человек и программа чтения с экрана: пункт,
// текст отметки и видна ли точка на иконке.
const menu = `
  const menuMarks = () => {
    const out = {settings: null, search: null, others: [], dots: true};
    for (const a of all('[data-sidebar=menu-button]')) {
      const label = (a.querySelector(':scope > span:last-child')?.childNodes[0]?.textContent || '').trim();
      const marked = a.hasAttribute('data-nav-mark');
      const text = (a.querySelector('.sr-only')?.textContent || '').replace(/^\\s*—\\s*/, '').trim();
      const dot = a.querySelector('span.bg-destructive');
      if (marked && !(dot && dot.getBoundingClientRect().width > 0)) out.dots = false;
      if (label === 'Настройки') out.settings = marked ? text : null;
      else if (label === 'Поиск') out.search = marked ? text : null;
      else if (marked) out.others.push(label);
    }
    return out;
  };
  const healthRequests = () =>
    performance.getEntriesByType('resource').filter((e) => /\\/projects\\/[^/]+\\/health$/.test(e.name)).length;
`;

const health = (await get('/projects/SDLC/health')).body;
if (!health) {
  console.log('  ✗ сводка проекта не ответила — бэкенд старше интерфейса?');
  process.exit(1);
}
console.log(`стенд: приложение ${health.app?.state}, нечитаемых репозиториев ${health.unreadable_repositories}`);
check('сводка отдаёт состояние приложения и счётчик',
  typeof health.app?.state === 'string' && typeof health.unreadable_repositories === 'number', JSON.stringify(health));
check('в сводке нет текста провайдера и расхождения часов',
  !('error' in health.app) && !('clock_offset_seconds' in health.app), JSON.stringify(health));
let want = expectMarks(health);
// Стенд живой: воркер между двумя строками сценария может прочитать
// репозиторий или дважды не прочитать. Поэтому меню сверяется со сводкой,
// снятой сразу после него, а при расхождении — ещё раз после перезапроса:
// сценарий ловит экран, который врёт о сводке, а не гонку с воркером.
const sameMarks = (m, w) => m.settings === w.settings && m.search === w.search && m.others.length === 0;
const menuMatches = async (reload) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const m = await run('return menuMarks();');
    want = expectMarks((await get('/projects/SDLC/health')).body);
    if (sameMarks(m, want)) return {ok: true, m};
    if (attempt === 2) return {ok: false, m};
    await reload();
  }
};

const s = await session(BASE + '/p/SDLC/board');
const run = (body) => s.evaluate(helpers + menu + body);
await s.resize(1280, 900);
await sleep(2500);

console.log('отметки в меню сверены со сводкой');
const open = (page) => async () => { await s.goto(`${BASE}/p/SDLC/${page}`); await sleep(1500); };
let seen = await menuMatches(open('board'));
let m = seen.m;
check('отметка у «Настроек» — тогда и только тогда, когда ключ не принят', m.settings === want.settings, JSON.stringify({m, want}));
check('отметка у «Поиска» — тогда и только тогда, когда есть нечитаемые', m.search === want.search, JSON.stringify({m, want}));
check('у остальных пунктов отметок нет', m.others.length === 0, JSON.stringify(m.others));
check('точка отметки видна на иконке', m.dots === true);
check('доска отрисована, не дожидаясь сводки', (await run('return texts();')).includes('Доска'));

console.log('отметки на каждой странице проекта');
for (const page of ['board', 'tasks/SDLC-1', 'roles', 'workflow', 'search', 'metrics', 'settings']) {
  await open(page)();
  seen = await menuMatches(open(page));
  check(`${page}: меню сходится со сводкой`, seen.ok, JSON.stringify({m: seen.m, want}));
}

console.log('вне проекта сводка не запрашивается');
for (const page of ['projects', 'teams']) {
  await s.goto(`${BASE}/${page}`);
  await sleep(1500);
  const out = await run('return {marks: all("[data-nav-mark]").length, trigger: all("[data-menu-mark]").length, requests: healthRequests()};');
  check(`${page}: отметок нет и запрос сводки не уходит`,
    out.marks === 0 && out.trigger === 0 && out.requests === 0, JSON.stringify(out));
}

console.log('сводка запрашивается по переходам, а не по таймеру');
await s.goto(BASE + '/p/SDLC/board');
await sleep(2000);
const before = await run('return healthRequests();');
await sleep(5000);
check('страница стоит — новых запросов сводки нет', (await run('return healthRequests();')) === before, String(before));
await run(`
  all('[data-sidebar=menu-button]').find((a) => (a.innerText || '').includes('Роли')).click();
  await sleep(1500);
  return true;
`);
check('переход между страницами проекта — один запрос сводки',
  (await run('return healthRequests();')) === before + 1, String(before));

console.log('меню, свёрнутое до иконок');
const collapse = async () => {
  await run(`document.querySelector('[data-sidebar=trigger]').click(); await sleep(600); return true;`);
};
await collapse();
// Перезапрос сводки при свёрнутом меню — переход по пункту: меню остаётся
// свёрнутым, а оболочка спрашивает сводку заново.
seen = await menuMatches(async () => {
  await run(`all('[data-sidebar=menu-button]').find((a) => a.getAttribute('href')?.endsWith('/metrics')).click(); await sleep(1500); return true;`);
});
m = seen.m;
check('отметки остались на иконках', seen.ok && m.dots === true, JSON.stringify({m, want}));
const collapsedState = await run(`return document.querySelector('[data-slot=sidebar]')?.getAttribute('data-state');`);
check('меню действительно свёрнуто', collapsedState === 'collapsed', String(collapsedState));
if (want.settings || want.search) {
  // Подсказку пункта Radix показывает по фокусу с клавиатуры — так её и
  // получает тот, кто пришёл без мыши.
  const tip = await run(`
    const a = document.querySelector('[data-nav-mark]');
    a.dispatchEvent(new PointerEvent('pointermove', {bubbles: true, pointerType: 'mouse'}));
    a.focus();
    await sleep(900);
    return (document.querySelector('[data-slot=tooltip-content]')?.innerText || '').replace(/\\s+/g, ' ');
  `);
  // Первым в меню стоит «Поиск», за ним «Настройки»: подсказка — у первого
  // отмеченного пункта.
  check('подсказка свёрнутого пункта содержит текст отметки',
    tip.includes(want.search ?? want.settings), tip);
} else {
  console.log('  · отметок на стенде нет — подсказку свёрнутого пункта проверять не на чем');
}
await collapse();

console.log('узкий экран: меню спрятано, отметка на кнопке меню');
await s.resize(600, 900);
await open('board')();
const triggerDot = `
  const dot = document.querySelector('[data-menu-mark]');
  return Boolean(dot) && dot.getBoundingClientRect().width > 0;
`;
let narrow = await run(triggerDot);
want = expectMarks((await get('/projects/SDLC/health')).body);
if (narrow !== Boolean(want.settings || want.search)) {
  await open('board')();
  narrow = await run(triggerDot);
  want = expectMarks((await get('/projects/SDLC/health')).body);
}
check('отметка на кнопке меню — тогда и только тогда, когда есть отметки',
  narrow === Boolean(want.settings || want.search), JSON.stringify({narrow, want}));
const openSheet = async () => {
  await run(`document.querySelector('[data-sidebar=trigger]').click(); await sleep(900); return true;`);
};
await openSheet();
seen = await menuMatches(async () => { await open('board')(); await openSheet(); });
check('в раскрытом меню отметки стоят у своих пунктов', seen.ok, JSON.stringify({m: seen.m, want}));
await s.resize(1280, 900);
await s.goto(BASE + '/p/SDLC/board');
await sleep(1500);
const wide = await run(`
  const dot = document.querySelector('[data-menu-mark]');
  return {dot: Boolean(dot) && dot.getBoundingClientRect().width > 0};
`);
check('на широком экране отметки на кнопке меню нет', wide.dot === false, JSON.stringify(wide));

console.log('тёмная тема: отметка задана токеном темы');
if (want.settings || want.search) {
  const colors = await run(`
    const dot = document.querySelector('[data-nav-mark] span.bg-destructive');
    const light = getComputedStyle(dot).backgroundColor;
    document.documentElement.classList.toggle('dark');
    await sleep(300);
    const dark = getComputedStyle(dot).backgroundColor;
    const token = getComputedStyle(document.documentElement).getPropertyValue('--destructive').trim();
    document.documentElement.classList.toggle('dark');
    return {light, dark, token};
  `);
  check('цвет отметки меняется вместе с темой', colors.light !== colors.dark && colors.token !== '', JSON.stringify(colors));
} else {
  console.log('  · отметок на стенде нет — цвет проверять не на чем');
}

console.log('настройки проекта: состояние приложения видно при открытии');
const gh = (await get('/projects/SDLC/github')).body;
await s.goto(BASE + '/p/SDLC/settings');
await sleep(2500);
const appView = `
  const appNote = () => {
    const el = document.querySelector('[data-app-state]');
    return el ? {state: el.getAttribute('data-app-state'), text: el.innerText.replace(/\\s+/g, ' ')} : null;
  };
  const section = (title) => all('section').find((x) => (x.innerText || '').includes(title));
  const badges = (title) => Array.from(section(title)?.querySelectorAll('[data-slot=badge]') ?? []).map((b) => b.innerText.trim());
`;
const noteFor = (app) => {
  if (!app) return null;
  if (app.state === 'ok') return app.clock_offset_seconds ? 'ok' : null;
  return app.state;
};
const checkNote = (where, note, app) => {
  check(`${where}: заметка о приложении соответствует состоянию ${app?.state}`,
    (note?.state ?? null) === noteFor(app), JSON.stringify({note, app}));
  if (!note || !app) return;
  if (app.state === 'rejected') {
    check(`${where}: отказ назван, с ответом провайдера и тем, что проверить`,
      note.text.includes('Ключ приложения GitHub не принят') && note.text.includes(app.error) &&
      note.text.includes('администратор инстанса') && note.text.includes('SDLC_GITHUB_APP_KEY_FILE') &&
      note.text.includes('SDLC_GITHUB_APP_ID') && note.text.includes('часы машины') && note.text.includes('Проверено'),
      note.text);
  }
  if (app.state === 'unknown') {
    check(`${where}: «не удалось проверить» не называет ключ непринятым`,
      note.text.includes('Не удалось проверить приложение GitHub') && !note.text.includes('не принят'), note.text);
  }
  if (app.state === 'not_configured') {
    check(`${where}: «не настроено» видно без кнопки`, note.text.includes('Приложение у инстанса не настроено'), note.text);
  }
};
let view = await run(appView + `return {note: appNote(), badges: badges('Доступ к GitHub')};`);
checkNote('настройки', view.note, gh.app);
check('при отбитом ключе ни одна установка не «работает»',
  gh.app?.state !== 'rejected' || !view.badges.includes('работает'), JSON.stringify(view.badges));

console.log('«Проверить доступ» обновляет состояние и отметку без перезагрузки');
const requestsBefore = await run('return healthRequests();');
await run(`await clickExact('Проверить доступ'); await sleep(2500); return true;`);
const fresh = (await get('/projects/SDLC/github')).body;
const freshHealth = (await get('/projects/SDLC/health')).body;
view = await run(appView + `return {note: appNote(), requests: healthRequests(), marks: menuMarks(), text: texts()};`);
checkNote('после проверки', view.note, fresh.app);
check('оболочка перечитала сводку', view.requests === requestsBefore + 1, JSON.stringify({requestsBefore, now: view.requests}));
const wantFresh = expectMarks(freshHealth);
// Состояние приложения после свежей проверки воркер не меняет — отметка у
// «Настроек» сверяется строго; счётчик репозиториев мог сдвинуться между
// ответом оболочке и ответом сценарию.
check('отметка у «Настроек» соответствует свежей проверке без перезагрузки',
  view.marks.settings === wantFresh.settings, JSON.stringify({marks: view.marks, wantFresh}));
check('отчёт по репозиториям на месте', view.text.includes('Чем проверяли'), view.text.slice(0, 400));

console.log('нечитаемые репозитории: настройки и состояние индекса');
// Строки индекса и счётчик снимаются подряд; разошлись — воркер успел между
// ними, и пара снимается ещё раз.
let index, unreadable, counted;
for (let attempt = 0; attempt < 3; attempt++) {
  index = (await get('/projects/SDLC/index')).body.repositories ?? [];
  unreadable = index.filter((r) => r.failure);
  counted = (await get('/projects/SDLC/health')).body.unreadable_repositories;
  if (counted === unreadable.length) break;
}
check('счётчик сводки равен числу строк индекса с failure',
  counted === unreadable.length, JSON.stringify({counted, rows: unreadable.length}));
await open('settings')();
await sleep(1000);
const marked = (sel) => `
  return all('${sel} [data-unreadable]').map((el) => ({repo: el.getAttribute('data-unreadable'), text: el.innerText.replace(/\\s+/g, ' ')}));
`;
const sameSet = (rows) => rows.length === unreadable.length && unreadable.every((r) => rows.some((x) => x.repo === r.repository));
let rows = await run(marked('body'));
check('настройки → «Репозитории»: пометка ровно у нечитаемых', sameSet(rows), JSON.stringify({rows, unreadable: unreadable.map((r) => r.repository)}));
for (const r of unreadable) {
  const row = rows.find((x) => x.repo === r.repository);
  check(`${r.repository}: «не читается с» и причина в строке`,
    Boolean(row) && row.text.includes('не читается') && row.text.includes(r.failure.error.slice(0, 40)), row?.text);
}
await s.goto(BASE + '/p/SDLC/search');
await sleep(2500);
rows = await run(marked('body'));
check('«Состояние индекса»: пометка ровно у нечитаемых', sameSet(rows), JSON.stringify(rows));
for (const r of unreadable) {
  const row = rows.find((x) => x.repo === r.repository);
  check(`${r.repository}: причина видна в строке, а не в подсказке`,
    Boolean(row) && row.text.includes('не читается с') && row.text.includes(r.failure.error.slice(0, 40)) &&
    (row.text.includes('индекс собран') || row.text.includes('индекс ещё не собирался')), row?.text);
}
const retrying = index.filter((r) => !r.failure && r.index_enabled && r.state === 'queued' && r.error);
if (retrying.length > 0) {
  check('прогон в повторе подписан «повтор после сбоя»', (await run('return texts();')).includes('повтор после сбоя'));
}

console.log('страница команды: то же состояние приложения');
if (gh.owner_team_key) {
  const team = (await get(`/teams/${gh.owner_team_key}/github/installations`)).body;
  check('ручка команды отдаёт состояние приложения', team?.app?.state === fresh.app?.state, JSON.stringify(team?.app));
  await s.goto(BASE + '/teams');
  await sleep(2000);
  await run(`
    const row = all('button, [role=button], a, li, tr, div').filter((el) => (el.innerText || '').trim().split('\\n')[0].includes('${gh.owner_team_key}'))
      .sort((a, b) => (a.innerText || '').length - (b.innerText || '').length)[0];
    if (row) row.click();
    await sleep(2500);
    return true;
  `);
  view = await run(appView + `return {note: appNote(), badges: section('GitHub') ? badges('GitHub') : [], open: texts().includes('Установки приложения на аккаунтах')};`);
  if (view.open) {
    checkNote('страница команды', view.note, team.app);
    check('страница команды: при отбитом ключе установка не «работает»',
      team.app?.state !== 'rejected' || !view.badges.includes('работает'), JSON.stringify(view.badges));
  } else {
    console.log('  · карточка команды-владельца не открылась кликом — раздел GitHub не проверен');
  }
}

console.log('другой проект: отметки только свои');
const KEY = 'HLTH';
await fetch(`${API}/projects/${KEY}`, {method: 'DELETE', headers: ACTOR});
const created = await fetch(`${API}/projects`, {
  method: 'POST', headers: ACTOR, body: JSON.stringify({key: KEY, name: 'Сводка: второй проект'}),
});
if (created.ok) {
  const other = (await get(`/projects/${KEY}/health`)).body;
  const wantOther = expectMarks(other);
  await s.goto(`${BASE}/p/SDLC/board`);
  await sleep(1500);
  // Переход внутри приложения, без перезагрузки: прежняя сводка осталась бы
  // в оболочке, если бы та не помнила, чей это ответ.
  await run(`history.pushState({}, '', '/p/${KEY}/roles'); dispatchEvent(new PopStateEvent('popstate')); await sleep(1800); return true;`);
  m = await run('return menuMarks();');
  check('в проекте без репозиториев отметки у «Поиска» нет', other.unreadable_repositories === 0 && m.search === null, JSON.stringify({m, other}));
  check('отметки второго проекта — по его сводке', m.settings === wantOther.settings && m.search === wantOther.search, JSON.stringify({m, wantOther}));
  await fetch(`${API}/projects/${KEY}`, {method: 'DELETE', headers: ACTOR});
} else {
  console.log('  · второй проект не завёлся — переход между проектами не проверен:', created.status);
}

console.log('сводка не ответила — страница работает как раньше');
await s.goto(`${BASE}/p/NOSUCH/roles`);
await sleep(1800);
const missing = await run('return {marks: all("[data-nav-mark]").length, text: texts()};');
check('отметок нет, ошибки сводки на странице нет',
  missing.marks === 0 && !missing.text.includes('/health') && !missing.text.includes('сводк'), missing.text.slice(0, 300));

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
