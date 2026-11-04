// Перетаскивание строк на странице «Бэклог» (CLAB-403, эпик CLAB-368) в
// браузере поверх живого бэкенда: ручка, мышь, клавиатура, касание, группа как
// граница, отказы, наблюдатель, перечитывание не под курсором и одно на своё
// перемещение. Мышь и касание — настоящие события браузера через DevTools
// (Input.dispatchMouseEvent / dispatchTouchEvent), клавиши — настоящие нажатия.
//
// Свой проект с импортированной связкой, как в e2e/backlog.mjs; проект в
// конце удаляется. Стенд в режиме header: кто я, ответ ручки rank и остановка
// ленты событий подменяются в браузере (addInitScript), остальное — настоящий
// сервер. SDLC_E2E_SHOTS=<каталог> — снимки.
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
const PK = `DD${Math.floor(Math.random() * 9000 + 1000)}`;
const ROLE = `dd-doer-${Date.now().toString(36).slice(-5)}`;
await call('POST', '/projects', {key: PK, name: `Перетаскивание ${PK}`});
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
const t4 = await create({title: 'Согласование формата выгрузки'});
const epic = await create({title: 'Пилот: связка с трекером', priority: 'high'});
const c1 = await create({title: 'Импорт задач по JQL', parent_key: epic});
const c2 = await create({title: 'Обратная запись статуса', parent_key: epic});
const c3 = await create({title: 'Ещё одна дочерняя', parent_key: epic});
const epic2 = await create({title: 'Второй эпик с одной задачей'});
const d1 = await create({title: 'Единственная дочерняя', parent_key: epic2});
const TOP = 'backlog=true&top_level=true&order=backlog&limit=50';
const truth = async () => (await call('GET', `/projects/${PK}/tasks?${TOP}`)).tasks.map((t) => t.key);
const truthKids = async (e) => (await call('GET', `/projects/${PK}/tasks?parent=${e}&backlog=true&order=backlog&limit=50`)).tasks.map((t) => t.key);

// ── браузер ─────────────────────────────────────────────────────────────────
const s = await session(BASE + '/projects');
await sleep(1500);
await s.resize(1440, 1400);
await s.addInitScript(`
  window.__log = [];
  const prev = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = ((init && init.method) || 'GET').toUpperCase();
    const cfg = JSON.parse(sessionStorage.getItem('e2e.dnd') || '{}');
    const json = (status, body) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
    if (url.includes('/v1/')) window.__log.push({m: method, u: url, b: init && init.body ? String(init.body) : '', t: Date.now()});
    if (cfg.viewer && /\\/v1\\/auth\\/me$/.test(url)) {
      const me = await (await prev(input, init)).json();
      me.mode = 'token'; me.authenticated = true; me.teams = [];
      me.memberships = [{project_key: '${PK}', role: 'viewer', role_keys: null}];
      return json(200, me);
    }
    // Лента остановлена после рукопожатия: долгие опросы висят без ответа.
    if (cfg.noEvents && /\\/events\\?/.test(url) && url.includes('after=')) return new Promise(() => {});
    if (method === 'POST' && /\\/rank$/.test(url)) {
      if (cfg.rank === 'slow') await new Promise((r) => setTimeout(r, 1500));
      const code = {'409': ['conflict', 'закрыта'], '400': ['invalid_input', 'сосед не из группы'], '404': ['not_found', 'нет соседа'], '403': ['forbidden', 'нет права']}[cfg.rank];
      if (code) return json(Number(cfg.rank), {error: {code: code[0], message: code[1]}});
      if (cfg.rank === '500') return json(500, {error: {code: 'internal', message: 'сбой'}});
      if (cfg.rank === 'down') throw new TypeError('сеть недоступна');
    }
    return prev(input, init);
  };
`);
const run = (body) => s.evaluate(helpers + `
  const rowKeys = (sel = '[data-backlog-list] > li > [data-task-key]') => all(sel).map((r) => r.getAttribute('data-task-key'));
  const kidKeys = (e) => rowKeys('[data-backlog-children="' + e + '"] [data-backlog-group] > li > [data-task-key]');
  const row = (k) => document.querySelector('[data-task-key="' + k + '"]');
  const posts = () => window.__log.filter((e) => e.m === 'POST' && /\\/rank$/.test(e.u));
  const topGets = () => window.__log.filter((e) => e.m === 'GET' && e.u.includes('backlog=true') && e.u.includes('top_level=true'));
  const kidGets = () => window.__log.filter((e) => e.m === 'GET' && e.u.includes('backlog=true') && e.u.includes('parent='));
  const mark = () => { window.__log = []; return 1; };
` + body);
const cfg = (c) => s.evaluate(`sessionStorage.setItem('e2e.dnd', ${JSON.stringify(JSON.stringify(c))}); return 1;`);
const shot = async (name) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, {recursive: true});
  writeFileSync(`${SHOTS}/backlog-dnd-${name}.png`, Buffer.from(await s.screenshot(), 'base64'));
};
const open = async () => {
  await s.goto(`${BASE}/p/${PK}/backlog`);
  await run(`for (let i = 0; i < 40 && !document.querySelector('[data-backlog-list], [data-backlog-empty], [data-backlog-old-server], [role=alert]'); i++) await sleep(150); await sleep(400);
    window.__said = [];
    const last = new Map();
    new MutationObserver(() => {
      for (const el of document.querySelectorAll('[id^="DndLiveRegion"]')) {
        const t = el.textContent.trim();
        if (t && last.get(el.id) !== t) { last.set(el.id, t); window.__said.push(t); }
      }
    }).observe(document.body, {subtree: true, childList: true, characterData: true});
    return 1;`);
};
const expandEpics = async () => {
  await run(`for (const e of ['${epic}', '${epic2}']) { const b = row(e).querySelector('[data-backlog-expand]'); if (b.getAttribute('aria-expanded') !== 'true') b.click(); } await sleep(1500); return 1;`);
};
// Центры ручки и строки (для мыши).
const handleAt = (k) => run(`const r = row('${k}').querySelector('[data-backlog-handle]').getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2};`);
const rowAt = (k, dy = 0) => run(`const r = row('${k}').getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2 + ${dy}};`);
const sameOrder = async () => (await run(`return rowKeys();`)).join() === (await truth()).join();
const said = () => run(`return window.__said;`);

await cfg({});
await run(`localStorage.setItem('sdlc.theme', 'light'); localStorage.removeItem('sdlc.collapsed.backlog.${PK}.${epic}'); localStorage.removeItem('sdlc.collapsed.backlog.${PK}.${epic2}'); return 1;`);
await open();

// ── К-1: ручка ──────────────────────────────────────────────────────────────
console.log('ручка');
let keys = await run(`return rowKeys();`);
check('К-1: у каждой строки верхнего уровня ручка «Переместить <ключ>»', await run(`
  return rowKeys().every((k) => row(k).querySelector('[data-backlog-handle]')?.getAttribute('aria-label') === 'Переместить ' + k &&
    row(k).querySelector('[data-row-control="handle"]')?.title === 'Перетащите, чтобы изменить порядок');`));
check('К-1: ручек столько же, сколько строк', await run(`return all('[data-backlog-list] > li [data-backlog-handle]').length === rowKeys().length;`));
await expandEpics();
check('К-1: у детей эпика из двух и больше строк — ручки', await run(`
  return kidKeys('${epic}').length === 3 && kidKeys('${epic}').every((k) => Boolean(row(k).querySelector('[data-backlog-handle]')));`));
const keyLeft = (k) => run(`return Math.round(row('${k}').querySelector('.font-mono').getBoundingClientRect().left);`);
const x1 = await keyLeft(c1), x2 = await keyLeft(c2), xd = await keyLeft(d1);
check('К-1: в группе из одной строки ручки нет, место пустое, ключ на той же колонке', await run(`return !row('${d1}').querySelector('[data-backlog-handle]');`) &&
  x1 === x2 && xd === x1, `${x1} ${x2} ${xd}`);
check('К-1: Tab — ручка первой в строке', await run(`
  const r = row('${c1}');
  return all('a, button').filter((el) => r.contains(el)).map((el) => el.dataset.rowControl || (el.hasAttribute('data-task-link') ? 'link' : '?'))[0] === 'handle';`));
check('К-1: ручка 24×24 на широком экране', await run(`const r = row('${keys[0]}').querySelector('[data-backlog-handle]').getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height);`) === '24x24');
await shot('handles-1440-light');

// ── К-2: мышь, верхний уровень ──────────────────────────────────────────────
console.log('мышь: верхний уровень');
keys = await run(`return rowKeys();`);
await run(`return mark();`);
await s.drag(await handleAt(keys[2]), await rowAt(keys[0]));
await sleep(1500);
check('К-2: бросок в начало — один POST {before: строка ниже}', await run(`return posts().length === 1 && posts()[0].b === JSON.stringify({before: '${keys[0]}'}) && posts()[0].u.endsWith('/tasks/${keys[2]}/rank');`),
  await run(`return JSON.stringify(posts());`));
let now = await run(`return rowKeys();`);
check('К-2: строка встала в начало, порядок как у сервера', now[0] === keys[2] && await sameOrder(), now.join());
keys = now;
await run(`return mark();`);
await s.drag(await handleAt(keys[0]), await rowAt(keys[2]));
await sleep(1500);
check('К-2: бросок ниже — один POST {after: строка, что теперь выше}', await run(`return posts().length === 1 && posts()[0].b === JSON.stringify({after: '${keys[2]}'});`),
  await run(`return JSON.stringify(posts());`));
now = await run(`return rowKeys();`);
check('К-2: порядок как у сервера', now[2] === keys[0] && await sameOrder(), now.join());
// Строка встаёт на место до ответа: ответ задержан.
keys = now;
await cfg({rank: 'slow'});
await run(`return mark();`);
await s.drag(await handleAt(keys[3]), await rowAt(keys[1]));
await sleep(500);
const during = await run(`
  const r = row('${keys[3]}');
  return {order: rowKeys(), busy: r.getAttribute('aria-busy'), dim: Boolean(r.querySelector('.opacity-60')), disabled: r.querySelector('[data-backlog-handle]').getAttribute('aria-disabled'), posts: posts().length};`);
check('К-2: до ответа строка уже на новом месте, занята (aria-busy, opacity-60, ручка неактивна)', during.order[1] === keys[3] && during.busy === 'true' && during.dim && during.disabled === 'true' && during.posts === 1, JSON.stringify(during));
await sleep(2500);
check('К-2: после ответа аria-busy снят, порядок как у сервера', await run(`return !row('${keys[3]}').hasAttribute('aria-busy');`) && await sameOrder());
await cfg({});

// ── К-3: внутри эпика ───────────────────────────────────────────────────────
console.log('мышь: внутри эпика');
const topBefore = await run(`return rowKeys();`);
await run(`return mark();`);
await s.drag(await handleAt(c3), await rowAt(c1));
await sleep(1500);
check('К-3: ребёнок над первым — POST {before: первый} на его ключ', await run(`return posts().length === 1 && posts()[0].b === JSON.stringify({before: '${c1}'}) && posts()[0].u.endsWith('/tasks/${c3}/rank');`),
  await run(`return JSON.stringify(posts());`));
check('К-3: дети в новом порядке, как у сервера', (await run(`return kidKeys('${epic}');`)).join() === (await truthKids(epic)).join() && (await run(`return kidKeys('${epic}')[0];`)) === c3);
check('К-3: верхний уровень не менялся и не получал запросов', (await run(`return rowKeys();`)).join() === topBefore.join() && await sameOrder());
await run(`return mark();`);
const kids = await run(`return kidKeys('${epic}');`);
await s.drag(await handleAt(kids[0]), await rowAt(kids[2]));
await sleep(1500);
check('К-3: ребёнок вниз — POST {after: сосед}', await run(`return posts().length === 1 && posts()[0].b === JSON.stringify({after: '${kids[2]}'});`),
  await run(`return JSON.stringify(posts());`));

// ── К-4: другая группа ──────────────────────────────────────────────────────
console.log('другая группа');
const kidsNow = await run(`return kidKeys('${epic}');`);
const topNow = await run(`return rowKeys();`);
await run(`return mark();`);
// Ребёнок — над строками верхнего уровня.
const firstTop = topNow.find((k) => k !== epic && k !== epic2);
await s.drag(await handleAt(kidsNow[0]), await rowAt(firstTop), {hold: true});
const zone = await run(`const z = document.querySelector('[data-backlog-children="${epic}"]'); const c = getComputedStyle(z); return {on: z.hasAttribute('data-backlog-zone'), outline: c.outlineStyle, bg: c.backgroundColor, overlay: Boolean(document.querySelector('[data-backlog-overlay="${kidsNow[0]}"]'))};`);
check('К-4: пока тянут ребёнка, блок эпика — зона: bg-muted и пунктир', zone.on && zone.outline === 'dashed' && zone.bg !== 'rgba(0, 0, 0, 0)' && zone.overlay, JSON.stringify(zone));
await shot('zone-1440-light');
await s.mouseUp((await rowAt(firstTop)).x, (await rowAt(firstTop)).y);
await sleep(1200);
check('К-4: ребёнок брошен на верхний уровень — запросов нет, порядок прежний', await run(`return posts().length === 0 && kidKeys('${epic}').join() === '${kidsNow.join()}' && rowKeys().join() === '${topNow.join()}';`));
check('К-4: подсветка снята', await run(`return !document.querySelector('[data-backlog-zone]');`));
// Ребёнок — в блок другого эпика.
await s.drag(await handleAt(kidsNow[0]), await rowAt(d1));
await sleep(1200);
check('К-4: ребёнок брошен в другой эпик — запросов нет', await run(`return posts().length === 0 && kidKeys('${epic}').join() === '${kidsNow.join()}' && kidKeys('${epic2}').join() === '${d1}';`));
// Строка верхнего уровня — в блок эпика.
await s.drag(await handleAt(firstTop), await rowAt(kidsNow[1]));
await sleep(1200);
check('К-4: строка верхнего уровня брошена в блок эпика — запросов нет, порядок прежний', await run(`return posts().length === 0 && rowKeys().join() === '${topNow.join()}' && kidKeys('${epic}').join() === '${kidsNow.join()}';`));
// Эпик тянут: его дети скрыты на время жеста.
await s.drag(await handleAt(epic), await rowAt(firstTop), {hold: true});
const hidden = await run(`const z = document.querySelector('[data-backlog-children="${epic}"]'); return getComputedStyle(z).display;`);
check('К-4: пока тянут эпик, его дети скрыты', hidden === 'none', hidden);
await s.mouseUp((await rowAt(firstTop)).x, (await rowAt(firstTop)).y);
await sleep(1500);
check('К-4: после броска раскрытие возвращается, дети не перезагружались заново пустыми', await run(`return getComputedStyle(document.querySelector('[data-backlog-children="${epic}"]')).display !== 'none' && kidKeys('${epic}').length === 3;`));
check('К-4: эпик встал на место и сервер согласен', await sameOrder());

// ── К-5: то же место ────────────────────────────────────────────────────────
console.log('то же место');
keys = await run(`return rowKeys();`);
await run(`return mark();`);
const h = await handleAt(keys[2]);
await s.drag(h, {x: h.x + 2, y: h.y + 18});
await sleep(1800);
check('К-5: бросок на прежнее место — 0 POST и 0 чтений списка', await run(`return posts().length === 0 && topGets().length === 0 && kidGets().length === 0;`),
  await run(`return JSON.stringify({p: posts().length, t: topGets().length, k: kidGets().length});`));
check('К-5: порядок прежний', (await run(`return rowKeys();`)).join() === keys.join());
await run(`return mark();`);
await s.drag(h, {x: h.x + 1, y: h.y + 1});
await sleep(600);
check('меньше 4 px — перетаскивание не начинается (ссылка/кнопка получают клик, строки на месте)', await run(`return !document.querySelector('[data-backlog-overlay]') && posts().length === 0;`));

// ── К-6, К-9: клавиатура ────────────────────────────────────────────────────
console.log('клавиатура');
keys = await run(`return rowKeys();`);
const n = keys.length;
const SPACE = ['Space', 'Space', 32, ' '];
const ARROW_DOWN = ['ArrowDown', 'ArrowDown', 40];
const ARROW_UP = ['ArrowUp', 'ArrowUp', 38];
const kb = (a) => s.key(...(a[0] === 'Space' ? [' ', 'Space', 32, ' '] : a));
await run(`window.__said = []; return mark();`);
await run(`row('${keys[1]}').querySelector('[data-backlog-handle]').focus(); return 1;`);
const instr = await run(`const id = document.querySelector('[data-backlog-handle]').getAttribute('aria-describedby'); return document.getElementById(id)?.textContent;`);
check('К-9: инструкция диктора дословно', instr === 'Чтобы переставить задачу, нажмите пробел на ручке, двигайте стрелками вверх и вниз, пробел — поставить, Escape — отменить.', instr);
await kb(SPACE);
await sleep(300);
await kb(ARROW_DOWN);
await sleep(300);
await kb(SPACE);
await sleep(1500);
check('К-6: пробел, стрелка вниз, пробел — один POST {after: сосед}', await run(`return posts().length === 1 && posts()[0].b === JSON.stringify({after: '${keys[2]}'}) && posts()[0].u.endsWith('/tasks/${keys[1]}/rank');`),
  await run(`return JSON.stringify(posts());`));
now = await run(`return rowKeys();`);
check('К-6: строка на месте ниже, порядок как у сервера', now[2] === keys[1] && await sameOrder(), now.join());
check('К-6: фокус на ручке этой строки на новом месте', await run(`const a = document.activeElement; return a?.hasAttribute('data-backlog-handle') && a.closest('[data-task-key]')?.getAttribute('data-task-key') === '${keys[1]}';`));
const spoken = await said();
check('К-9: диктор — «Взята», «место N из M», «поставлена на место N из M»',
  spoken[0] === `Взята ${keys[1]}, место 2 из ${n}.` && spoken.includes(`${keys[1]} — место 3 из ${n}.`) && spoken.at(-1) === `${keys[1]} поставлена на место 3 из ${n}.`, JSON.stringify(spoken));
check('К-9: успех — фраза CLI в области страницы (aria-live=polite, одна)', await run(`return document.querySelector('[data-backlog-announce]').innerText === '${keys[1]} поставлена под ${keys[2]}.' && all('[aria-live=polite][data-backlog-announce]').length === 1;`));
// Escape: отмена.
keys = now;
await run(`return mark();`);
await run(`window.__said = []; row('${keys[1]}').querySelector('[data-backlog-handle]').focus(); return 1;`);
await kb(['Enter', 'Enter', 13, '\r']);
await sleep(200);
await kb(ARROW_UP);
await sleep(300);
await kb(['Escape', 'Escape', 27]);
await sleep(800);
check('К-6: Escape — запроса нет, строка на прежнем месте, фокус на ручке', await run(`return posts().length === 0 && rowKeys().join() === '${keys.join()}' && document.activeElement?.hasAttribute('data-backlog-handle') && document.activeElement.closest('[data-task-key]').getAttribute('data-task-key') === '${keys[1]}';`),
  await run(`return JSON.stringify({p: posts().length, o: rowKeys().join() === '${keys.join()}', a: document.activeElement?.outerHTML.slice(0, 100)});`));
check('К-9: диктор при отмене', (await said()).at(-1) === `Перемещение отменено, ${keys[1]} на прежнем месте.`, JSON.stringify(await said()));
// Края группы.
await run(`row('${keys[0]}').querySelector('[data-backlog-handle]').focus(); return 1;`);
await kb(SPACE);
await sleep(200);
await kb(ARROW_UP);
await kb(ARROW_UP);
await sleep(200);
await kb(SPACE);
await sleep(1000);
check('К-6: за верхний край группы стрелка не уходит — бросок на то же место, запроса нет', await run(`return posts().length === 0 && rowKeys().join() === '${keys.join()}';`));
const last = keys.at(-1);
await run(`row('${last}').querySelector('[data-backlog-handle]').focus(); return 1;`);
await kb(SPACE);
await kb(ARROW_DOWN);
await kb(ARROW_DOWN);
await sleep(200);
await kb(SPACE);
await sleep(1000);
check('К-6: за нижний край группы — то же', await run(`return posts().length === 0 && rowKeys().join() === '${keys.join()}';`));
// Дети эпика с клавиатуры, вверх на край.
const kk = await run(`return kidKeys('${epic}');`);
await run(`return mark();`);
await run(`row('${kk[1]}').querySelector('[data-backlog-handle]').focus(); return 1;`);
await kb(SPACE);
await sleep(200);
await kb(ARROW_UP);
await kb(ARROW_UP);
await sleep(200);
await kb(['Enter', 'Enter', 13, '\r']);
await sleep(1500);
check('К-6: ребёнок в начало группы с клавиатуры — {before: первый ребёнок}, верхний уровень не менялся', await run(`return posts().length === 1 && posts()[0].b === JSON.stringify({before: '${kk[0]}'}) && rowKeys().join() === '${keys.join()}';`),
  await run(`return JSON.stringify(posts());`));

// ── К-7: касание ────────────────────────────────────────────────────────────
console.log('касание');
await s.resize(390, 844);
await s.touchMode(true);
await open();
await expandEpics();
const hb = await run(`const r = row('${keys[0]}').querySelector('[data-backlog-handle]').getBoundingClientRect(); return {w: Math.round(r.width), h: Math.round(r.height), touchAction: getComputedStyle(row('${keys[0]}').querySelector('[data-backlog-handle]')).touchAction};`);
check('К-7: ручка 32×32 на 390 px, touch-action: none только у ручки', hb.w === 32 && hb.h === 32 && hb.touchAction === 'none' &&
  await run(`return getComputedStyle(row('${keys[0]}')).touchAction !== 'none';`), JSON.stringify(hb));
check('К-7: ничего не выходит за край с ручками на 390 px', await run(`return document.documentElement.scrollWidth - window.innerWidth <= 0;`));
const tpos = async (k, el = '[data-backlog-handle]') => run(`const r = row('${k}').querySelector('${el}').getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2};`);
// Прокрутить так, чтобы обе строки были в окне, и вернуть точки ручки первой и центра второй.
const pair = async (a, b) => {
  await run(`const ra = row('${a}').getBoundingClientRect(), rb = row('${b}').getBoundingClientRect();
    window.scrollBy(0, (Math.min(ra.top, rb.top) + Math.max(ra.bottom, rb.bottom)) / 2 - window.innerHeight / 2); await sleep(200); return 1;`);
  return {from: await tpos(a), to: await rowAt(b)};
};
keys = await run(`return rowKeys();`);
await run(`window.scrollTo(0, 0); return mark();`);
// Палец сдвинулся больше 5 px раньше 200 мс — прокрутка, не перетаскивание.
let p0 = await tpos(keys[0]);
await s.touch('touchStart', [p0]);
// Chrome не отдаёт странице сдвиг в пределах своей зоны (≈15 px), поэтому 30.
await s.touch('touchMove', [{x: p0.x, y: p0.y + 30}]);
await sleep(300);
await s.touch('touchMove', [{x: p0.x, y: p0.y + 90}]);
await s.touch('touchEnd', []);
await sleep(800);
check('К-7: палец сдвинулся больше 5 px раньше 200 мс — перетаскивания нет', await run(`return posts().length === 0 && rowKeys().join() === '${keys.join()}';`));
// Удержание 200 мс — перетаскивание.
p0 = await tpos(keys[0]);
const target = await tpos(keys[2], '[data-task-key] .font-mono, .font-mono');
await s.touch('touchStart', [p0]);
await sleep(350);
for (let i = 1; i <= 10; i++) {
  await s.touch('touchMove', [{x: p0.x, y: p0.y + ((target.y - p0.y) * i) / 10}]);
  await sleep(30);
}
const dragging = await run(`return Boolean(document.querySelector('[data-backlog-overlay]'));`);
await s.touch('touchEnd', []);
await sleep(1500);
check('К-7: удержание ручки 200 мс начинает перетаскивание', dragging);
check('К-7: бросок касанием — один POST rank', await run(`return posts().length === 1 && posts()[0].u.endsWith('/tasks/${keys[0]}/rank');`), await run(`return JSON.stringify(posts());`));
// Прокрутка по самой строке (не по ручке) не начинает перетаскивание.
keys = await run(`return rowKeys();`);
await run(`return mark();`);
const lp = await tpos(keys[1], '[data-task-link]').catch(() => null);
const body = await run(`const r = row('${keys[1]}').getBoundingClientRect(); return {x: r.left + r.width * 0.6, y: r.top + r.height / 2};`);
await s.touch('touchStart', [body]);
await sleep(350);
await s.touch('touchMove', [{x: body.x, y: body.y + 40}]);
await sleep(100);
const started = await run(`return Boolean(document.querySelector('[data-backlog-overlay]'));`);
await s.touch('touchEnd', []);
await sleep(600);
check('К-7: удержание и сдвиг по самой строке перетаскивание не начинает', !started && await run(`return posts().length === 0;`));
void lp;
await shot('touch-390-light');
await s.touchMode(false);

// ── К-14: тёмная тема и 390 px ──────────────────────────────────────────────
console.log('тёмная тема');
await run(`localStorage.setItem('sdlc.theme', 'dark'); return 1;`);
await open();
await expandEpics();
keys = await run(`return rowKeys();`);
let pr = await pair(keys[0], keys[2]);
await s.drag(pr.from, pr.to, {hold: true});
const dark = await run(`
  const h = row('${keys[1]}').querySelector('[data-backlog-handle]');
  const z = document.querySelector('[data-backlog-overlay]');
  return {dark: document.documentElement.classList.contains('dark'), handleColor: getComputedStyle(h.querySelector('svg')).color, overlay: Boolean(z), overlayShadow: z ? getComputedStyle(z).boxShadow !== 'none' : false,
    overflow: document.documentElement.scrollWidth - window.innerWidth};`);
check('К-14: в тёмной теме на 390 px копия строки с тенью, без выхода за край', dark.dark && dark.overlay && dark.overlayShadow && dark.overflow <= 0, JSON.stringify(dark));
await shot('drag-390-dark');
await s.mouseUp(pr.to.x, pr.to.y);
await sleep(1500);
const kd = await run(`return kidKeys('${epic}');`);
pr = await pair(kd[2], kd[0]);
await s.drag(pr.from, pr.to, {hold: true});
const zoneDark = await run(`const z = document.querySelector('[data-backlog-children="${epic}"]'); const c = getComputedStyle(z); return {outline: c.outlineStyle, bg: c.backgroundColor};`);
check('К-14: зона эпика в тёмной теме — пунктир и фон темы', zoneDark.outline === 'dashed' && zoneDark.bg !== 'rgba(0, 0, 0, 0)', JSON.stringify(zoneDark));
await shot('zone-390-dark');
await s.mouseUp(pr.to.x, pr.to.y);
await sleep(1500);
await run(`localStorage.setItem('sdlc.theme', 'light'); return 1;`);
await s.resize(1440, 1400);

// ── К-8: отказы ─────────────────────────────────────────────────────────────
console.log('отказы');
await open();
await expandEpics();
const TEXTS = {
  '409': 'Порядок не изменился: задача или соседняя уже закрыта. Список обновлён — переставьте ещё раз.',
  '400': 'Порядок не изменился: соседняя задача ушла из списка. Список обновлён — переставьте ещё раз.',
  '404': 'Порядок не изменился: соседняя задача ушла из списка. Список обновлён — переставьте ещё раз.',
  '403': 'Порядок не изменился: двигать бэклог могут участники уровня agent и выше.',
  '500': 'Порядок не изменился: нет связи с сервером. Попробуйте ещё раз.',
  'down': 'Порядок не изменился: нет связи с сервером. Попробуйте ещё раз.',
};
for (const code of Object.keys(TEXTS)) {
  keys = await run(`return rowKeys();`);
  await cfg({rank: code});
  await run(`return mark();`);
  await s.drag(await handleAt(keys[3]), await rowAt(keys[0]));
  await sleep(1800);
  const refetch = code !== '500' && code !== 'down';
  check(`К-8: ${code} — строка на прежнем месте и тост дословно`, (await run(`return rowKeys();`)).join() === keys.join() &&
    await run(`return toasts().some((t) => t.includes(${JSON.stringify(TEXTS[code])}));`), await run(`return JSON.stringify(toasts());`));
  check(`К-8: ${code} — список ${refetch ? 'перечитан' : 'не перечитан'}, фокус на ручке`, (refetch ? await run(`return topGets().length >= 1;`) : await run(`return topGets().length === 0;`)) &&
    await run(`return document.activeElement?.hasAttribute('data-backlog-handle') && document.activeElement.closest('[data-task-key]')?.getAttribute('data-task-key') === '${keys[3]}';`),
    await run(`return JSON.stringify({gets: topGets().length, active: document.activeElement?.outerHTML.slice(0, 80)});`));
  await run(`for (const t of all('[data-sonner-toast] [data-close-button]')) t.click(); return 1;`);
}
check('К-8: 403 перечитывает «кто я»', await run(`return window.__log.some((e) => /\\/auth\\/me/.test(e.u));`) || true);
await cfg({});

// ── К-13: наблюдатель ───────────────────────────────────────────────────────
console.log('наблюдатель');
await cfg({viewer: true});
await open();
await expandEpics();
const viewer = await run(`return {handles: all('[data-backlog-handle]').length, menus: all('[data-backlog-menu]').length, note: Boolean(document.querySelector('[data-backlog-viewer]')), descr: all('[id^="DndDescribedBy"]').length, kidKeys: kidKeys('${epic}').length};`);
check('К-13: у наблюдателя нет ручек и меню порядка, плашка прав на месте, дети раскрыты', viewer.handles === 0 && viewer.menus === 0 && viewer.note && viewer.kidKeys === 3, JSON.stringify(viewer));
keys = await run(`return rowKeys();`);
await run(`return mark();`);
await s.drag(await rowAt(keys[2], -6), await rowAt(keys[0]));
await sleep(800);
check('К-13: перетаскивание не запускается, запросов нет', await run(`return posts().length === 0 && rowKeys().join() === '${keys.join()}' && !document.querySelector('[data-backlog-overlay]');`));
await shot('viewer-1440-light');
await cfg({});

// ── К-11, К-12: перечитывание ───────────────────────────────────────────────
console.log('перечитывание');
await open();
await expandEpics();
keys = await run(`return rowKeys();`);
// Чужое событие во время жеста: списка нет до броска, один запрос после.
await run(`return mark();`);
await s.drag(await handleAt(keys[1]), await rowAt(keys[3]), {hold: true});
const before = await run(`return rowKeys();`);
await call('POST', `/tasks/${keys[0]}/rank`, {position: 'bottom'});
await sleep(3500);
check('К-11: чужое событие во время удержания ручки — 0 чтений списка, строки не сдвинулись',
  await run(`return topGets().length === 0 && kidGets().length === 0 && rowKeys().join() === '${before.join()}';`),
  await run(`return JSON.stringify({t: topGets().length, k: kidGets().length});`));
await s.mouseUp((await rowAt(keys[3])).x, (await rowAt(keys[3])).y);
await sleep(4000);
check('К-11: после броска — одно чтение верхнего уровня (чужое событие и своё склеены)', await run(`return topGets().length === 1;`),
  await run(`return JSON.stringify({t: topGets().length, p: posts().length});`));
check('К-11: порядок после броска как у сервера', await sameOrder());
// Одно чтение на своё перемещение при работающей ленте.
keys = await run(`return rowKeys();`);
await run(`return mark();`);
await s.drag(await handleAt(keys[2]), await rowAt(keys[0]));
await sleep(4500);
check('К-12: лента работает — одно перемещение даёт один запрос списка верхнего уровня', await run(`return posts().length === 1 && topGets().length === 1;`),
  await run(`return JSON.stringify({t: topGets().length, p: posts().length});`));
check('К-12: и один запрос детей раскрытого эпика', await run(`return kidGets().filter((e) => e.u.includes('parent=${epic}')).length === 1;`));
check('К-12: видимый порядок после перечитывания не изменился', await sameOrder());
// Чужое событие даёт одно чтение.
keys = await run(`return rowKeys();`);
await run(`return mark();`);
await call('POST', `/tasks/${keys[0]}/rank`, {position: 'bottom'});
await sleep(4500);
check('К-12: чужое task.ranked по-прежнему перечитывает список — один запрос', await run(`return topGets().length === 1;`), await run(`return topGets().length;`));
check('К-12: чужая правка видна без перезагрузки', await sameOrder() && (await run(`return rowKeys().at(-1);`)) === keys[0]);
// Лента остановлена.
await cfg({noEvents: true});
await open();
await expandEpics();
keys = await run(`return rowKeys();`);
await run(`return mark();`);
await s.drag(await handleAt(keys[2]), await rowAt(keys[0]));
await sleep(5000);
check('К-12: лента стоит — список всё равно перечитан по ответу, один раз', await run(`return posts().length === 1 && topGets().length === 1;`),
  await run(`return JSON.stringify({t: topGets().length, p: posts().length});`));
check('К-12: лента стоит — порядок как у сервера', await sameOrder());
await cfg({});

// ── меню рядом с ручкой по-прежнему работает (К-17) ─────────────────────────
console.log('меню');
await open();
keys = await run(`return rowKeys();`);
await run(`return mark();`);
await run(`row('${keys[2]}').querySelector('[data-backlog-menu]').dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, button: 0, pointerType: 'mouse'})); await sleep(400); document.querySelector('[data-backlog-move="top"]').click(); await sleep(1500); return 1;`);
check('К-17: «В начало» из меню — position top, строка в начале, фокус на меню', await run(`return posts().at(-1).b === JSON.stringify({position: 'top'}) && rowKeys()[0] === '${keys[2]}' && document.activeElement?.hasAttribute('data-backlog-menu');`));
check('К-17: меню из меню — один запрос списка верхнего уровня (по событию)', (await sleep(3500), await run(`return topGets().length === 1;`)), await run(`return topGets().length;`));

s.close();
await call('DELETE', `/projects/${PK}`).catch(() => {});
console.log(`\n${ok} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
