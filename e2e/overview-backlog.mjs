// «Можно брать сейчас» на «Обзоре» (CLAB-366, переработка CLAB-488):
// неначатые свободные в порядке бэклога сервера по правилу clab backlog
// --next (родитель «в работе» отдаёт место свободным детям), ждущие
// блокирующих отдельным подсписком вне счётчика, шапка «можно брать»,
// переключатель 5 | 10 и память в браузере, только GET, «внутри задачи»
// (?parent=), тип с неначатыми задачами — не «Ничего не найдено», пустые
// состояния, 400 на order, ошибка блока и «Повторить», 390 px и тёмная
// тема, доступность переключателя. Заводит свои задачи и родителей, чужих
// не двигает. SDLC_E2E_SHOTS=<каталог> — снимки блока.
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
const create = async (body) => (await call('POST', '/projects/SDLC/tasks', body)).key;
const list = async (query) => call('GET', `/projects/SDLC/tasks?${query}`);

// Свои данные: шесть задач разной срочности (одна заблокирована), эпик с
// двумя детьми в бэклоге, эпик, все дети которого начаты.
const tag = Date.now().toString(36);
const plain = [];
for (const [i, priority] of ['low', 'normal', 'high', 'urgent', 'normal', 'normal'].entries()) {
  plain.push(await create({title: `Бэклог ${tag} №${i + 1}`, priority}));
}
const blocker = plain[0];
const blocked = plain[5];
await call('POST', `/tasks/${blocker}/links`, {task: blocked, rel: 'blocks'});
const epic = await create({title: `Эпик из бэклога ${tag}`, type: 'epic', priority: 'high'});
const kids = [];
for (let i = 1; i <= 2; i++) kids.push(await create({title: `Дочерняя ${tag} №${i}`, parent_key: epic}));
const startedEpic = await create({title: `Эпик с начатым ребёнком ${tag}`, type: 'epic'});
const startedKid = await create({title: `Начатая дочерняя ${tag}`, parent_key: startedEpic});
await fetch(`${API}/v1/tasks/${startedKid}/transitions/start`, {
  method: 'POST', headers: {'Content-Type': 'application/json', 'X-SDLC-Actor': 'e2e'}, body: '{}',
});

// Правда — по правилу --next поверх ответов сервера: верхний уровень
// бэклога, свободная — без blocked_by и не начатая на этапе без роли,
// родитель «в работе» — его свободные неначатые дети.
const keysOf = (page) => page.tasks.map((t) => t.key);
const started = (t) => t.in_work || (t.status_category && t.status_category !== 'backlog');
async function truthFree(extra = '') {
  const top = (await list(`backlog=true&top_level=true&order=backlog&limit=50${extra}`)).tasks;
  const out = [];
  for (const t of top) {
    if (!t.in_work) { if (!started(t) && !(t.blocked_by ?? []).length) out.push(t.key); continue; }
    if ((t.blocked_by ?? []).length || !Object.keys(t.child_counts ?? {}).length) continue;
    const kids = (await list(`parent=${t.key}&terminal=false&in_work=false&category=backlog&order=backlog&limit=200${extra}`)).tasks;
    for (const k of kids) if (!started(k) && !(k.blocked_by ?? []).length) out.push(k.key);
  }
  return out;
}
const freeTotal = async (extra = '') => (await list(`terminal=false&in_work=false&category=backlog&attention_not=blocked&limit=1${extra}`)).total;

const s = await session(BASE + '/projects');
const run = (body) => s.evaluate(helpers + body);
await sleep(1500);
await s.resize(1440, 900);

// Журнал запросов и подмены ответов бэклога — до кода страницы.
const logger = `
  window.__urls = [];
  window.__methods = [];
  window.__mode = '';
  const orig = window.fetch;
  window.fetch = (url, init) => {
    const u = String(url);
    if (u.includes('/projects/SDLC/')) window.__methods.push((init && init.method) || 'GET');
    if (u.includes('/projects/SDLC/tasks')) window.__urls.push(u);
    const free = u.includes('attention_not=blocked') && u.includes('category=backlog');
    if (u.includes('/projects/SDLC/tasks') && (u.includes('order=backlog') || free)) {
      if (window.__mode === 'empty') return Promise.resolve(new Response(JSON.stringify({tasks: [], total: 0}), {status: 200, headers: {'Content-Type': 'application/json'}}));
      if (free) return orig(url, init);
      if (window.__mode === 'reject-order') return Promise.resolve(new Response(JSON.stringify({error: {code: 'invalid_input', message: 'некорректный запрос: order: неизвестный порядок "backlog"'}}), {status: 400, headers: {'Content-Type': 'application/json'}}));
      if (window.__mode === 'down') return Promise.reject(new TypeError('сеть недоступна'));
    }
    return orig(url, init);
  };
`;
await s.addInitScript(logger);

const block = () => run(`
  const z = document.querySelector('section[data-zone=ready]');
  if (!z) return null;
  const rows = Array.from(z.querySelectorAll('[data-ready-group=unstarted] [data-density]'));
  return {
    title: (z.querySelector('h2 > button > span')?.innerText || '').trim(),
    count: z.querySelector('[data-zone-count]')?.getAttribute('aria-label'),
    expanded: z.querySelector('h2 button')?.getAttribute('aria-expanded'),
    rows: rows.map((r) => (r.innerText || '').replace(/\\s+/g, ' ')),
    keys: rows.map((r) => r.getAttribute('data-task-key')),
    waiting: Array.from(z.querySelectorAll('[data-ready-group=waiting] [data-density]')).map((r) => (r.innerText || '').replace(/\\s+/g, ' ')),
    head: (z.querySelector('[data-ready-group=unstarted]')?.innerText || '').split('\\n')[0],
    free: z.querySelector('[data-ready-free]')?.innerText || '',
    skeleton: Boolean(z.querySelector('[data-zone-skeleton]')),
    empty: (z.querySelector('[data-ready-empty]')?.innerText || '').replace(/\\s+/g, ' '),
    text: (z.innerText || '').replace(/\\s+/g, ' '),
    radios: Array.from(z.querySelectorAll('[data-backlog-size] [role=radio]')).map((b) => ({v: b.getAttribute('data-state'), t: b.innerText.trim(), l: b.getAttribute('aria-label')})),
  };
`);
const urls = () => run('return window.__urls.filter((u) => u.includes("order=backlog") || u.includes("in_work=false"));');
const TITLE = 'Можно брать сейчас';

// ── без фильтров ────────────────────────────────────────────────────────────
console.log('блок на «Обзоре» без фильтров');
await run('localStorage.removeItem("sdlc.backlog.size.SDLC"); return 1;');
await s.goto(BASE + '/p/SDLC/overview');
await sleep(2400);
const zoneOrder = await run(`return Array.from(document.querySelectorAll('section[data-zone]')).map((z) => z.getAttribute('data-zone')).join();`);
check('блок стоит в колонке «Дальше» перед завершённым', zoneOrder.includes('ready,done'), zoneOrder);
let b = await block();
const free = await truthFree();
const freeN = await freeTotal();
check('заголовок «Можно брать сейчас»', b?.title === TITLE, JSON.stringify(b));
check('по умолчанию 5 строк неначатых, номера мест 1…5', b.rows.length === Math.min(5, free.length) && b.rows[0].startsWith('1 '), `${b.rows.length}/${free.length}`);
check('AC-3: порядок — правило --next поверх порядка сервера, без пересортировки', b.keys.join() === free.slice(0, 5).join(), `${b.keys} / ${free.slice(0, 5)}`);
check('подраздел: «Неначатые по порядку бэклога · N свободных» — total сервера', b.head.startsWith('Неначатые по порядку бэклога') && b.free === `${freeN} свободных`, `${b.head} / ${freeN}`);
const u0 = await urls();
check('запрос верхнего уровня: backlog, top_level, order=backlog, limit', u0.some((u) => /order=backlog/.test(u) && /backlog=true/.test(u) && /top_level=true/.test(u) && /limit=\d+/.test(u)), JSON.stringify(u0));
check('ни один запрос списка без limit', (await run('return window.__urls;')).every((u) => /[?&]limit=\d+/.test(u)));
check('в строках блока нет стоимости', b.rows.every((r) => !/\$\d/.test(r) && !/нет учёта/.test(r)), b.rows.join(' | '));

await run('localStorage.setItem("sdlc.backlog.size.SDLC", "10"); return 1;');
await s.goto(BASE + '/p/SDLC/overview?q=' + encodeURIComponent(tag));
await sleep(2200);
b = await block();
const withTag = await truthFree(`&q=${encodeURIComponent(tag)}`);
check('поиск в адресе сужает и блок', b.keys.join() === withTag.slice(0, 10).join(), `${b.keys} / ${withTag}`);
const epicRow = b.rows.find((r) => r.includes(epic)) ?? '';
check('неначатый родитель — одной строкой с прогрессом «готово · в работе · в бэклоге»', /0 готово · 0 в работе · 2 в бэклоге/.test(epicRow) && !b.keys.some((k) => kids.includes(k)), epicRow);
check('AC-4: заблокированная — в «Ждут блокирующих» с «Ждёт <ключ>», не в свободных', !b.keys.includes(blocked) && b.waiting.some((r) => r.includes(blocked) && r.includes(`Ждёт ${blocker}`)), JSON.stringify(b.waiting));
const zoneRows = (key) => run(`return Array.from(document.querySelectorAll('section[data-zone] [data-density]')).filter((r) => r.getAttribute('data-task-key') === ${JSON.stringify(key)}).map((r) => r.closest('section[data-zone]').getAttribute('data-zone'));`);
check('CLAB-388: неначатая заблокированная — ровно в одном блоке, «Можно брать»', (await zoneRows(blocked)).join() === 'ready', (await zoneRows(blocked)).join());
const stuckUrls = (await run('return window.__urls;')).filter((u) => u.includes('attention_except='));
check('«Заблокировано» — только начатые: in_work=true или не backlog по категории', stuckUrls.length > 0 && stuckUrls.every((u) => /in_work=true/.test(u) || (/in_work=false/.test(u) && /category=active/.test(u))), JSON.stringify(stuckUrls));
check('в строке приоритет и тип', /(низкий|обычный|высокий|срочный)/i.test(b.rows.join(' ')), b.rows[0]);
const href = await run(`return document.querySelector('[data-ready-group=unstarted] a[href*="/tasks/"]')?.getAttribute('href');`);
check('нажатие на строку ведёт в карточку задачи', /\/tasks\/[A-Z]+-\d+/.test(href ?? ''), String(href));

// ── переключатель 5 | 10 ────────────────────────────────────────────────────
console.log('переключатель 5 | 10');
await run('localStorage.removeItem("sdlc.backlog.size.SDLC"); return 1;');
await s.goto(BASE + '/p/SDLC/overview');
await sleep(2200);
b = await block();
check('переключатель: «5» выбран, «10» нет, подписи для чтения с экрана', b.radios.length === 2 && b.radios[0].v === 'on' && b.radios[1].v === 'off' && b.radios[1].l === 'Показывать 10', JSON.stringify(b.radios));
await run(`document.querySelectorAll('section[data-zone=ready] [data-backlog-size] [role=radio]')[1].click(); await sleep(1200); return 1;`);
b = await block();
check('«10» — до десяти строк по тому же порядку', b.keys.join() === free.slice(0, 10).join(), `${b.keys.length}`);
check('выбор записан в браузер под ключом проекта', (await run('return localStorage.getItem("sdlc.backlog.size.SDLC");')) === '10');
check('ключ не из свёрнутости', (await run(`return Object.keys(localStorage).filter((k) => k.startsWith('sdlc.collapsed.') && k.includes('size')).length;`)) === 0);
await s.goto(BASE + '/p/SDLC/overview');
await sleep(2200);
b = await block();
check('после перезагрузки — по-прежнему 10', b.keys.length === Math.min(10, free.length) && b.radios[1].v === 'on', JSON.stringify(b.radios));
await run(`document.querySelectorAll('section[data-zone=ready] [data-backlog-size] [role=radio]')[0].focus(); return 1;`);
await s.key(' ', 'Space', 32, ' ');
await sleep(1000);
b = await block();
check('с клавиатуры: Space на «5» выбирает пять строк', b.keys.length === Math.min(5, free.length) && b.radios[0].v === 'on', JSON.stringify(b.radios));
check('повторное нажатие на выбранное не снимает выбор', await (async () => {
  await run(`document.querySelectorAll('section[data-zone=ready] [data-backlog-size] [role=radio]')[0].click(); await sleep(600); return 1;`);
  return (await block()).radios[0].v === 'on';
})());
const noStore = await s.addInitScript(`Storage.prototype.setItem = function () { throw new Error('QuotaExceededError'); };`);
await s.goto(BASE + '/p/SDLC/overview');
await sleep(2200);
await run(`document.querySelectorAll('section[data-zone=ready] [data-backlog-size] [role=radio]')[1].click(); await sleep(1200); return 1;`);
b = await block();
check('localStorage не пишется — блок работает, число строк меняется на сессию', b && b.keys.length === Math.min(10, free.length), JSON.stringify(b && b.keys.length));
await s.removeInitScript(noStore);
await run('localStorage.removeItem("sdlc.backlog.size.SDLC"); return 1;');

// ── только чтение ───────────────────────────────────────────────────────────
console.log('блок только читает');
await s.goto(BASE + '/p/SDLC/overview');
await sleep(2200);
check('запросы страницы проекта — только GET', (await run('return window.__methods;')).every((m) => m === 'GET'), JSON.stringify(await run('return [...new Set(window.__methods)];')));
check('«Весь бэклог» ведёт на страницу бэклога', await run(`return Array.from(document.querySelectorAll('section[data-zone=ready] a')).some((a) => a.innerText.trim().startsWith('Весь бэклог') && a.getAttribute('href') === '/p/SDLC/backlog');`));
check('перетаскивания нет', await run(`return !document.querySelector('section[data-zone=ready] [draggable=true]');`));

// ── внутри задачи ───────────────────────────────────────────────────────────
console.log('внутри задачи (?parent=)');
await s.goto(BASE + `/p/SDLC/overview?parent=${epic}`);
await sleep(2400);
b = await block();
const kidsTruth = await list(`parent=${epic}&in_work=false&terminal=false&category=backlog&order=backlog&limit=10`);
check('«Неначатые внутри задачи»: дети в порядке сервера, сам родитель не строкой, без переключателя',
  b.head.startsWith('Неначатые внутри задачи') && b.keys.join() === keysOf(kidsTruth).join() && !b.keys.includes(epic) && b.radios.length === 0, JSON.stringify(b));
const uEpic = (await urls()).filter((u) => u.includes(`parent=${epic}`) && u.includes('order=backlog'));
check('запрос: parent, in_work=false, terminal=false, category=backlog; top_level нет', uEpic.length > 0 && uEpic.every((u) => !u.includes('top_level') && /in_work=false/.test(u) && /terminal=false/.test(u) && /category=backlog/.test(u)), JSON.stringify(uEpic));
let t = await run('return texts();');
check('родитель с детьми только в бэклоге — не «Ничего не найдено по фильтрам»', !t.includes('Ничего не найдено по фильтрам') && !t.includes('пока нет дочерних задач'), t.slice(0, 400));
await s.goto(BASE + `/p/SDLC/overview?parent=${startedEpic}`);
await sleep(2400);
b = await block();
check('все дети начаты — «Неначатых свободных задач нет»', b?.empty.includes('Неначатых свободных задач нет'), JSON.stringify(b));
check('и это не «Ничего не найдено»: начатый ребёнок в блоке', !(await run('return texts();')).includes('Ничего не найдено по фильтрам') && (await run('return texts();')).includes(startedKid));
await s.goto(BASE + '/p/SDLC/overview?type=epic');
await sleep(2400);
b = await block();
check('?type=epic: в блоке неначатые задачи типа, а не «Ничего не найдено по фильтрам»', b.keys.length > 0 && !(await run('return texts();')).includes('Ничего не найдено по фильтрам'), `${b.keys.length}`);
await s.goto(BASE + '/p/SDLC/overview?q=zzzz-ничего-' + tag);
await sleep(2200);
check('пусто везде — «Ничего не найдено по фильтрам»', (await run('return texts();')).includes('Ничего не найдено по фильтрам'));

// ── пустое состояние и ошибки ───────────────────────────────────────────────
console.log('пустое состояние и ошибки');
await s.goto(BASE + '/p/SDLC/overview');
await sleep(1800);
await run(`window.__mode = 'empty'; document.querySelector('[data-refresh]').click(); await sleep(1800); return 1;`);
b = await block();
check('неначатых нет: «Неначатых свободных задач нет», 0 свободных', b.empty.includes('Неначатых свободных задач нет') && b.free === '0 свободных', JSON.stringify(b.empty + ' / ' + b.free));
await run(`window.__urls = []; window.__mode = 'reject-order'; document.querySelector('[data-refresh]').click(); await sleep(2000); return 1;`);
b = await block();
const uRetry = (await run('return window.__urls;')).filter((u) => u.includes('top_level=true'));
check('400 на order: повтор без order, строки на месте, без пометок', uRetry.some((u) => u.includes('order=backlog')) && uRetry.some((u) => !u.includes('order=') && /limit=\d+/.test(u)) && b.keys.length > 0 && !b.text.includes('Не получилось'), JSON.stringify(uRetry));
check('страница жива: все блоки на месте', (await run(`return document.querySelectorAll('section[data-zone]').length;`)) === 6);
await run(`window.__mode = 'down'; document.querySelector('[data-refresh]').click(); await sleep(2000); return 1;`);
b = await block();
check('ошибка блока — «Не получилось загрузить» и «Повторить», прежние строки на месте', b.text.includes(`Не получилось загрузить «${TITLE}»`) && b.text.includes('Повторить') && b.keys.length > 0, b.text.slice(0, 300));
check('остальные блоки не затронуты', !(await run(`return document.querySelector('section[data-zone=work]').innerText.includes('Не получилось');`)));
await run(`window.__mode = ''; const btn = Array.from(document.querySelectorAll('section[data-zone=ready] button')).find((x) => x.innerText.trim() === 'Повторить'); btn.click(); await sleep(1800); return 1;`);
b = await block();
check('«Повторить» вернул блок', !b.text.includes('Не получилось') && b.keys.length > 0);

const slow = await s.addInitScript(`
  const o = window.fetch;
  window.fetch = (u, i) => String(u).includes('order=backlog') ? new Promise((ok) => setTimeout(() => ok(o(u, i)), 4000)) : o(u, i);
`);
await s.goto(BASE + '/p/SDLC/overview');
await sleep(1500);
b = await block();
check('пока блок грузится — скелетон в блоке, шапка видна', b?.skeleton === true && b.title === TITLE, JSON.stringify(b && {skeleton: b.skeleton, title: b.title}));
check('остальные блоки не ждут', (await run(`return document.querySelectorAll('section[data-zone]:not([data-zone=ready]) [data-zone-skeleton]').length;`)) < 4);
await s.removeInitScript(slow);
await sleep(3500);

await s.goto(BASE + '/p/SDLC/overview');
await sleep(2200);
await run(`document.querySelector('section[data-zone=ready] h2 button').click(); await sleep(400); return 1;`);
await s.goto(BASE + '/p/SDLC/overview');
await sleep(2200);
check('блок сворачивается, и браузер это помнит; счётчик на месте', (await block()).expanded === 'false' && /, \d+\+?$/.test((await block()).count));
check('ключ свёрнутости — overview.ready', (await run(`return localStorage.getItem('sdlc.collapsed.overview.ready');`)) === '1');
await run(`document.querySelector('section[data-zone=ready] h2 button').click(); await sleep(400); return 1;`);

// ── вид ─────────────────────────────────────────────────────────────────────
console.log('вид: 1440, 390, тёмная тема');
await s.goto(BASE + '/p/SDLC/overview');
await sleep(2200);
check('1440 px: блок в колонке «Дальше»', await run(`return Boolean(document.querySelector('[data-next-column] section[data-zone=ready]'));`));
await run(`document.documentElement.classList.add('dark'); await sleep(300); return 1;`);
const dark = await run(`
  const z = document.querySelector('section[data-zone=ready]');
  const c = z.querySelector('[data-zone-count]');
  return {bg: getComputedStyle(document.body).backgroundColor, fg: getComputedStyle(c).color, hint: getComputedStyle(z.querySelector('[data-ready-free]')).color};
`);
check('тёмная тема: счётчик и подпись читаются', dark.bg !== 'rgb(255, 255, 255)' && dark.fg !== dark.bg && dark.hint !== dark.bg, JSON.stringify(dark));
if (SHOTS) {
  const {writeFileSync} = await import('node:fs');
  writeFileSync(`${SHOTS}/ready-1440-dark.png`, Buffer.from(await s.screenshot(), 'base64'));
}
await run(`document.documentElement.classList.remove('dark'); return 1;`);
await s.resize(390, 844);
await sleep(800);
await run(`document.querySelector('[data-next-button]').click(); await sleep(800); return 1;`);
const narrow = await run(`
  const p = document.querySelector('[data-next-sheet]');
  const z = p && p.querySelector('section[data-zone=ready]');
  return {
    inSheet: Boolean(z),
    overflow: z ? z.scrollWidth > z.clientWidth + 1 : null,
    page: document.documentElement.scrollWidth > window.innerWidth,
    radios: z ? z.querySelectorAll('[role=radio]').length : 0,
    once: document.querySelectorAll('section[data-zone=ready]').length,
  };
`);
check('390 px: блок в панели «Дальше», один раз, без обрезки', narrow.inSheet && narrow.once === 1 && narrow.overflow === false && narrow.page === false && narrow.radios === 2, JSON.stringify(narrow));
if (SHOTS) {
  const {writeFileSync} = await import('node:fs');
  writeFileSync(`${SHOTS}/ready-390-sheet-light.png`, Buffer.from(await s.screenshot(), 'base64'));
}
await s.key('Escape', 'Escape', 27);
await s.resize(1360, 900);

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
