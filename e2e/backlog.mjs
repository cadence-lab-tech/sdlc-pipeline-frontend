// Страница «Бэклог» (CLAB-402, эпик CLAB-368) в браузере поверх живого
// бэкенда: пункт меню и ссылка с «Обзора», запросы и порядок сервера, эпик в
// работе с раскрытием и памятью в браузере, меню порядка с выключенными
// краями и телами запросов, фокус на кнопке меню после переноса, приоритет в
// строке, живое обновление от чужого перемещения, отказы (409, сеть,
// приоритет 403), наблюдатель, состояния (пусто, ошибка, старый сервер),
// 390 px и тёмная тема.
//
// Свой проект с импортированной связкой: цикл из трёх статусов с ключами не
// наших циклов (todo/doing/finished) и типы task и bug — страница не знает ни
// статусов, ни типов. Демонстрационный проект не трогается; проект в конце
// удаляется. Стенд в режиме header: кто я (`/auth/me`), отказы 409 и 403 и
// обрыв сети подменяются в браузере ответом одной ручки, остальное — настоящий
// сервер. SDLC_E2E_SHOTS=<каталог> — снимки страницы.
import {mkdirSync, writeFileSync} from 'node:fs';
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

// ── данные ──────────────────────────────────────────────────────────────────
const PK = `BL${Math.floor(Math.random() * 9000 + 1000)}`;
const ROLE = `bl-doer-${Date.now().toString(36).slice(-5)}`;
await call('POST', '/projects', {key: PK, name: `Бэклог ${PK}`});
const imported = await call('POST', `/projects/${PK}/import`, {
  version: 3,
  roles: [{key: ROLE, name: 'Делающий', documents: [{name: 'main.md', kind: 'instructions', content: 'Делать.'}],
    output_contract: [{kind: 'work.result', title: 'Результат', format: 'markdown', required: true}]}],
  workflows: [{
    name: 'Три статуса',
    task_types: ['task', 'bug'],
    statuses: [
      {key: 'todo', name: 'Todo', category: 'backlog', is_initial: true},
      {key: 'doing', name: 'Doing', category: 'active', role: ROLE},
      {key: 'finished', name: 'Done', category: 'done', is_terminal: true},
    ],
    transitions: [
      {key: 'go', name: 'Начать', from: 'todo', to: 'doing', kind: 'advance'},
      {key: 'end', name: 'Закончить', from: 'doing', to: 'finished', kind: 'advance'},
    ],
  }],
});
for (const w of imported.workflows) if (w.state !== 'active') await call('POST', `/workflows/${w.id}/activate`, {});
const create = async (body) => (await call('POST', `/projects/${PK}/tasks`, body)).key;
const t1 = await create({title: 'Вебхук теряет push', priority: 'urgent'});
const t2 = await create({title: 'Панель бэклога в плагине', priority: 'high', type: 'bug'});
const t3 = await create({title: 'Выгрузка метрик', priority: 'low'});
const t4 = await create({title: 'Согласование формата выгрузки аудита с юридическим отделом заказчика перед открытием доступа к журналу'});
const epic = await create({title: 'Пилот: связка с трекером', priority: 'high'});
const c1 = await create({title: 'Импорт задач по JQL', parent_key: epic});
const c2 = await create({title: 'Обратная запись статуса', parent_key: epic});
const c3 = await create({title: 'Начатая дочерняя', parent_key: epic});
await call('POST', `/tasks/${c3}/transitions/go`, {});
await call('POST', `/tasks/${t1}/links`, {task: t2, rel: 'blocks'});
const TOP = 'backlog=true&top_level=true&order=backlog&limit=50';
const truth = async () => (await call('GET', `/projects/${PK}/tasks?${TOP}`)).tasks.map((t) => t.key);

// ── браузер ─────────────────────────────────────────────────────────────────
const s = await session(BASE + '/projects');
await sleep(1500);
await s.resize(1440, 900);
// Журнал запросов страницы и подмены одной ручки по сессии вкладки.
await s.addInitScript(`
  window.__log = [];
  const prev = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = ((init && init.method) || 'GET').toUpperCase();
    const cfg = JSON.parse(sessionStorage.getItem('e2e.backlog') || '{}');
    const json = (status, body) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
    if (url.includes('/v1/')) window.__log.push({m: method, u: url, b: init && init.body ? String(init.body) : ''});
    if (cfg.viewer && /\\/v1\\/auth\\/me$/.test(url)) {
      const me = await (await prev(input, init)).json();
      me.mode = 'token'; me.authenticated = true; me.teams = [];
      me.memberships = [{project_key: '${PK}', role: 'viewer', role_keys: null}];
      return json(200, me);
    }
    if (method === 'POST' && /\\/rank$/.test(url)) {
      if (cfg.rank === '409') return json(409, {error: {code: 'conflict', message: 'закрыта'}});
      if (cfg.rank === 'down') throw new TypeError('сеть недоступна');
    }
    if (method === 'PATCH' && cfg.patch === '403') return json(403, {error: {code: 'forbidden', message: 'нет права'}});
    if (method === 'GET' && url.includes('backlog=true') && url.includes('top_level=true')) {
      if (cfg.list === 'empty') return json(200, {tasks: [], total: 0});
      if (cfg.list === 'reject') return json(400, {error: {code: 'invalid_input', message: 'некорректный запрос: backlog: неизвестный параметр'}});
      if (cfg.list === 'down') throw new TypeError('сеть недоступна');
    }
    return prev(input, init);
  };
`);
const run = (body) => s.evaluate(helpers + `
  const rowKeys = (sel = '[data-backlog-list] > li > [data-task-key]') => all(sel).map((r) => r.getAttribute('data-task-key'));
  const row = (k) => document.querySelector('[data-task-key="' + k + '"]');
  const openMenu = async (k) => {
    row(k).querySelector('[data-backlog-menu]').dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, button: 0, pointerType: 'mouse'}));
    await sleep(400);
  };
  const items = () => all('[data-backlog-move]').map((i) => ({kind: i.getAttribute('data-backlog-move'), off: i.hasAttribute('data-disabled')}));
  const pick = async (kind) => { document.querySelector('[data-backlog-move="' + kind + '"]').click(); await sleep(1500); };
  const posts = () => window.__log.filter((e) => e.m === 'POST' && /\\/rank$/.test(e.u));
  const patches = () => window.__log.filter((e) => e.m === 'PATCH');
` + body);
const cfg = (c) => s.evaluate(`sessionStorage.setItem('e2e.backlog', ${JSON.stringify(JSON.stringify(c))}); return 1;`);
const shot = async (name) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, {recursive: true});
  writeFileSync(`${SHOTS}/backlog-${name}.png`, Buffer.from(await s.screenshot(), 'base64'));
};
const open = async () => {
  await s.goto(`${BASE}/p/${PK}/backlog`);
  await run(`for (let i = 0; i < 40 && !document.querySelector('[data-backlog-list], [data-backlog-empty], [data-backlog-old-server], [role=alert]'); i++) await sleep(150); await sleep(400); return 1;`);
};
await cfg({});
await run(`localStorage.setItem('sdlc.theme', 'light'); localStorage.removeItem('sdlc.collapsed.backlog.${PK}.${epic}'); return 1;`);

// ── вход ────────────────────────────────────────────────────────────────────
console.log('вход и навигация');
await s.goto(`${BASE}/p/${PK}/overview`);
await sleep(2500);
const link = await run(`const a = document.querySelector('[data-backlog-all] , a[href="/p/${PK}/backlog"]'); return all('a').filter((x) => x.innerText.trim().startsWith('Весь бэклог')).map((x) => x.getAttribute('href'));`);
check('К-2: «Весь бэклог» в шапке блока ведёт на страницу', link.length === 1 && link[0] === `/p/${PK}/backlog`, JSON.stringify(link));
const nav = await run(`return all('[data-sidebar=menu-button]').map((a) => a.innerText.trim()).filter(Boolean);`);
const ov = nav.indexOf('Обзор');
check('К-1: «Бэклог» в меню сразу за «Обзором»', ov >= 0 && nav[ov + 1] === 'Бэклог', nav.join());
await run(`all('a').find((x) => x.innerText.trim().startsWith('Весь бэклог')).click(); await sleep(2000); return 1;`);
check('К-2: переход по ссылке', await run(`return location.pathname;`) === `/p/${PK}/backlog`);
check('К-1: в шапке приложения «<проект> · Бэклог»', await run(`return document.body.innerText.includes('${PK} · Бэклог');`));

// ── список ──────────────────────────────────────────────────────────────────
console.log('список');
await open();
const shown = await run(`return rowKeys();`);
check('К-3: строки в порядке ответа сервера', shown.join() === (await truth()).join(), `${shown} / ${await truth()}`);
check('К-3: верхний уровень — backlog, top_level, order=backlog, limit=50, offset=0',
  await run(`return window.__log.some((e) => /backlog=true/.test(e.u) && /top_level=true/.test(e.u) && /order=backlog/.test(e.u) && /limit=50/.test(e.u) && /offset=0/.test(e.u));`));
check('К-4: ребёнок на верхнем уровне не повторяется', !shown.includes(c1) && !shown.includes(c2) && shown.includes(epic));
const epicRow = await run(`return (row('${epic}').innerText || '').replace(/\\s+/g, ' ');`);
check('К-4: эпик в работе — пометка «в работе», статус из данных', /в работе/.test(epicRow) && /Todo/.test(epicRow), epicRow);
check('К-4: блокированная — «Ждёт <ключ>»', await run(`return row('${t2}').innerText.includes('Ждёт ${t1}');`));
check('К-4: тип токеном из данных', await run(`return row('${t2}').innerText.includes('bug');`));
check('сводка «N на верхнем уровне»', await run(`return document.querySelector('[data-backlog-summary]').innerText.startsWith('${shown.length} на верхнем уровне');`));
check('К-7: «обычный» у редактора виден, «низкий» — пунктиром', await run(`
  const n = row('${t4}').querySelector('[data-backlog-priority]');
  const l = row('${t3}').querySelector('[data-backlog-priority]');
  return n.innerText.trim() === 'обычный' && getComputedStyle(l).borderStyle === 'dashed';`));
check('К-15: подписи кнопок', await run(`
  return row('${t1}').querySelector('[data-backlog-menu]').getAttribute('aria-label') === 'Действия с ${t1}' &&
    row('${t1}').querySelector('[data-backlog-priority]').getAttribute('aria-label') === 'Приоритет ${t1}: срочный. Изменить' &&
    row('${epic}').querySelector('[data-backlog-expand]').getAttribute('aria-label') === 'Показать задачи эпика ${epic}' &&
    !row('${t1}').querySelector('[data-backlog-expand]');`));
check('К-15: Tab в строке — ручка, шеврон, ссылка, приоритет, меню (CLAB-403)', await run(`
  const r = row('${epic}');
  const order = all('a, button').filter((el) => r.contains(el)).map((el) => el.dataset.rowControl || (el.hasAttribute('data-task-link') ? 'link' : '?'));
  return order.join() === 'handle,expand,link,priority,menu' || order.join();`) === true);
await shot('1440-light');

// ── эпик ────────────────────────────────────────────────────────────────────
console.log('эпик');
await run(`row('${epic}').querySelector('[data-backlog-expand]').click(); await sleep(1500); return 1;`);
const kids = await run(`return rowKeys('[data-backlog-children="${epic}"] [data-task-key]');`);
check('К-3, К-4: дети раскрытого эпика — неначатые, в своём порядке', kids.join() === [c1, c2].join(), kids.join());
check('К-3: запрос детей — parent, backlog, order=backlog', await run(`return window.__log.some((e) => /parent=${epic}/.test(e.u) && /backlog=true/.test(e.u) && /order=backlog/.test(e.u) && !/top_level/.test(e.u));`));
check('К-11: раскрытие в localStorage', await run(`return localStorage.getItem('sdlc.collapsed.backlog.${PK}.${epic}') === '1' && row('${epic}').querySelector('[data-backlog-expand]').getAttribute('aria-expanded') === 'true';`));
await open();
check('К-11: раскрытие переживает перезагрузку', (await run(`return rowKeys('[data-backlog-children="${epic}"] [data-task-key]');`)).length === 2);
await run(`row('${c2}').querySelector('[data-backlog-menu]').dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, button: 0, pointerType: 'mouse'})); await sleep(400); return 1;`);
check('К-5: меню ребёнка называет эпик', await run(`return document.querySelector('[data-backlog-menu-content]').innerText.includes('Порядок в эпике ${epic}');`));
await run(`await pick('up'); return 1;`);
check('К-5: ребёнок «Выше» — before соседа по эпику', await run(`return posts().at(-1).b === JSON.stringify({before: '${c1}'});`));
check('К-6: дети в новом порядке', (await run(`return rowKeys('[data-backlog-children="${epic}"] [data-task-key]');`)).join() === [c2, c1].join());

// ── меню порядка ────────────────────────────────────────────────────────────
console.log('меню порядка');
let keys = await run(`return rowKeys();`);
await run(`await openMenu('${keys[0]}'); return 1;`);
let it = await run(`return items();`);
check('К-5: у первой строки выключены «Выше» и «В начало»', it.find((i) => i.kind === 'up').off && it.find((i) => i.kind === 'top').off &&
  !it.find((i) => i.kind === 'down').off, JSON.stringify(it));
check('К-5: заголовок меню «Порядок в бэклоге»', await run(`return document.querySelector('[data-backlog-menu-content]').innerText.includes('Порядок в бэклоге');`));
await s.key('Escape', 'Escape', 27);
await run(`await openMenu('${keys.at(-1)}'); return 1;`);
it = await run(`return items();`);
check('К-5: у последней (всё загружено) выключены «Ниже» и «В конец»', it.find((i) => i.kind === 'down').off && it.find((i) => i.kind === 'bottom').off, JSON.stringify(it));
await s.key('Escape', 'Escape', 27);
const mover = keys[2];
await run(`await openMenu('${mover}'); await pick('up'); return 1;`);
check('К-5: «Выше» — before строки сразу выше', await run(`return posts().at(-1).b === JSON.stringify({before: '${keys[1]}'});`));
keys = await run(`return rowKeys();`);
check('К-6: строка на новом месте и сервер согласен', keys.indexOf(mover) === 1 && keys.join() === (await truth()).join(), keys.join());
check('К-6: фокус на кнопке меню этой строки', await run(`const a = document.activeElement; return a?.hasAttribute('data-backlog-menu') && a.closest('[data-task-key]')?.getAttribute('data-task-key') === '${mover}';`));
check('К-15: объявление успеха', await run(`return document.querySelector('[data-backlog-announce]').innerText === '${mover} поставлена над ${keys[2]}.';`));
await run(`await openMenu('${mover}'); await pick('bottom'); return 1;`);
check('К-5: «В конец» — position bottom', await run(`return posts().at(-1).b === JSON.stringify({position: 'bottom'});`));
keys = await run(`return rowKeys();`);
check('К-6: строка в конце', keys.at(-1) === mover && keys.join() === (await truth()).join(), keys.join());
await run(`await openMenu('${keys[1]}'); await pick('down'); return 1;`);
check('К-5: «Ниже» — after строки сразу ниже', await run(`return posts().at(-1).b === JSON.stringify({after: '${keys[2]}'});`));
await run(`await openMenu('${keys.at(-1)}'); await pick('top'); return 1;`);
check('К-5: «В начало» — position top', await run(`return posts().at(-1).b === JSON.stringify({position: 'top'});`));
check('К-6: порядок совпадает с сервером', (await run(`return rowKeys();`)).join() === (await truth()).join());

// ── приоритет ───────────────────────────────────────────────────────────────
console.log('приоритет в строке');
keys = await run(`return rowKeys();`);
const pos = keys.indexOf(t3);
await run(`row('${t3}').querySelector('[data-backlog-priority]').click(); await sleep(500); return 1;`);
const options = await run(`return all('[data-backlog-priority-option]').map((o) => o.getAttribute('data-backlog-priority-option'));`);
check('К-7: четыре значения сверху вниз', options.join() === 'urgent,high,normal,low', options.join());
await run(`document.querySelector('[data-backlog-priority-option="high"]').click(); await sleep(1800); return 1;`);
check('К-7: PATCH с приоритетом', await run(`return patches().at(-1)?.b === JSON.stringify({priority: 'high'}) && patches().at(-1).u.endsWith('/tasks/${t3}');`));
check('К-7: строка на месте, подпись новая', (await run(`return rowKeys();`)).indexOf(t3) === pos &&
  await run(`return row('${t3}').querySelector('[data-backlog-priority]').innerText.trim() === 'высокий';`));
const before = await run(`return patches().length;`);
await run(`row('${t3}').querySelector('[data-backlog-priority]').click(); await sleep(500); document.querySelector('[data-backlog-priority-option="high"]').click(); await sleep(800); return 1;`);
check('К-7: то же значение — запроса нет', await run(`return patches().length;`) === before);

// ── живое обновление ────────────────────────────────────────────────────────
console.log('живое обновление');
keys = await run(`return rowKeys();`);
await call('POST', `/tasks/${keys.at(-1)}/rank`, {position: 'top'});
let live = false;
for (let i = 0; i < 20 && !live; i++) {
  await sleep(500);
  live = (await run(`return rowKeys();`))[0] === keys.at(-1);
}
check('К-10: чужое перемещение видно без перезагрузки', live);
const created = await create({title: 'Новая из другой вкладки'});
live = false;
for (let i = 0; i < 20 && !live; i++) {
  await sleep(500);
  live = (await run(`return rowKeys();`)).at(-1) === created;
}
check('К-10: новая задача — в конце', live);

// ── ошибки ──────────────────────────────────────────────────────────────────
console.log('ошибки');
keys = await run(`return rowKeys();`);
await cfg({rank: '409'});
await run(`await openMenu('${keys[1]}'); await pick('top'); return 1;`);
check('К-8: 409 — строка на месте и тост', (await run(`return rowKeys();`)).join() === keys.join() &&
  await run(`return toasts().some((t) => t.includes('Порядок не изменился: задача или соседняя уже закрыта. Список обновлён — переставьте ещё раз.'));`));
await cfg({rank: 'down'});
await run(`await openMenu('${keys[1]}'); await pick('top'); return 1;`);
check('К-8: сеть — строка на месте и тост', (await run(`return rowKeys();`)).join() === keys.join() &&
  await run(`return toasts().some((t) => t.includes('Порядок не изменился: нет связи с сервером. Попробуйте ещё раз.'));`));
await cfg({patch: '403'});
await run(`row('${t4}').querySelector('[data-backlog-priority]').click(); await sleep(500); document.querySelector('[data-backlog-priority-option="urgent"]').click(); await sleep(1500); return 1;`);
check('К-8: приоритет 403 — прежнее значение и тост', await run(`return row('${t4}').querySelector('[data-backlog-priority]').innerText.trim() === 'обычный' &&
  toasts().some((t) => t.includes('Приоритет ${t4} не изменился: менять приоритет могут участники уровня agent и выше.'));`));
await shot('error');
await cfg({});

// ── наблюдатель ─────────────────────────────────────────────────────────────
console.log('наблюдатель');
await cfg({viewer: true});
await open();
await sleep(800);
const viewer = await run(`return {
  note: document.querySelector('[data-backlog-viewer]')?.innerText.trim(),
  menus: all('[data-backlog-menu]').length,
  pickers: all('[data-backlog-priority]').length,
  expand: all('[data-backlog-expand]').length,
};`);
check('К-9: плашка прав дословно', viewer.note === 'Порядок и приоритет меняют участники уровня agent и выше. У вас — просмотр.', JSON.stringify(viewer));
check('К-9: без меню и выбора приоритета, шеврон остаётся', viewer.menus === 0 && viewer.pickers === 0 && viewer.expand === 1, JSON.stringify(viewer));
await shot('viewer');
await cfg({});

// ── состояния ───────────────────────────────────────────────────────────────
console.log('состояния');
await cfg({list: 'empty'});
await open();
check('К-12: пусто — «Бэклог пуст», «Новая задача», «На обзор», без сводки', await run(`
  const e = document.querySelector('[data-backlog-empty]');
  return Boolean(e) && e.innerText.includes('Бэклог пуст') && e.innerText.includes('Новая задача') && e.innerText.includes('На обзор') && !document.querySelector('[data-backlog-summary]');`));
await cfg({list: 'reject'});
await open();
check('К-12: сервер без backlog=true — «Сервер ещё не знает порядка бэклога»', await run(`return document.querySelector('[data-backlog-old-server]')?.innerText.includes('Сервер ещё не знает порядка бэклога') && !document.querySelector('[data-backlog-list]');`));
await cfg({list: 'down'});
await open();
check('К-12: ошибка первой загрузки — «Не получилось загрузить бэклог» и «Повторить»', await run(`
  const a = document.querySelector('[role=alert]'); return Boolean(a) && a.innerText.includes('Не получилось загрузить бэклог') && a.innerText.includes('Повторить');`));
await cfg({});

// ── 390 px, тёмная тема ─────────────────────────────────────────────────────
console.log('390 px и тёмная тема');
await run(`localStorage.setItem('sdlc.theme', 'dark'); return 1;`);
await s.resize(390, 844);
await open();
const narrow = await run(`
  const m = row('${t1}').querySelector('[data-backlog-menu]').getBoundingClientRect();
  const kid = document.querySelector('[data-backlog-children="${epic}"]');
  const top = row('${epic}').getBoundingClientRect();
  const first = kid?.querySelector('[data-task-key]')?.getBoundingClientRect();
  return {
    dark: document.documentElement.classList.contains('dark'),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    menu: [Math.round(m.width), Math.round(m.height)],
    indent: first ? Math.round(first.left - top.left) : null,
  };`);
check('К-13: тёмная тема включена', narrow.dark);
check('К-13: ничего не выходит за край на 390 px', narrow.overflow <= 0, JSON.stringify(narrow));
check('К-13: меню 32×32 на узком экране', narrow.menu.join() === '32,32', JSON.stringify(narrow));
check('К-13: отступ детей 12 px', narrow.indent === 12, JSON.stringify(narrow));
await shot('390-dark');
await s.resize(1440, 900);
await open();
await shot('1440-dark');
await run(`localStorage.setItem('sdlc.theme', 'light'); return 1;`);

s.close();
await call('DELETE', `/projects/${PK}`).catch(() => {});
console.log(`\n${ok} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
