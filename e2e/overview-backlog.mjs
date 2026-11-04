// Блок «Приоритетные из бэклога» на «Обзоре» (CLAB-366): выборка и порядок
// сервера, шапка с total, строки, переключатель 5 | 10 и память в браузере,
// только GET, нарезка эпика («Неначатые в эпике», без top_level), дефект из
// проверки CLAB-365 (эпик с детьми только в бэклоге и тип с неначатыми
// задачами — не «Ничего не найдено»), пустые состояния, 400 на order,
// ошибка блока и «Повторить», 390 px и тёмная тема, доступность переключателя.
// Заводит свои задачи и эпики, чужих не двигает. SDLC_E2E_SHOTS=<каталог> —
// снимки блока.
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

const TOP = 'terminal=false&in_work=false&top_level=true&order=backlog';
const truth = async (n) => list(`${TOP}&limit=${n}`);
const keysOf = (page) => page.tasks.map((t) => t.key);

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
    if (u.includes('/projects/SDLC/tasks') && u.includes('order=backlog')) {
      if (window.__mode === 'empty') return Promise.resolve(new Response(JSON.stringify({tasks: [], total: 0}), {status: 200, headers: {'Content-Type': 'application/json'}}));
      if (window.__mode === 'reject-order') return Promise.resolve(new Response(JSON.stringify({error: {code: 'invalid_input', message: 'некорректный запрос: order: неизвестный порядок "backlog"'}}), {status: 400, headers: {'Content-Type': 'application/json'}}));
      if (window.__mode === 'down') return Promise.reject(new TypeError('сеть недоступна'));
    }
    return orig(url, init);
  };
`;
await s.addInitScript(logger);

const block = (extra = '') => run(`
  const z = document.querySelector('section[data-zone=backlog]');
  if (!z) return null;
  const rows = Array.from(z.querySelectorAll('[data-density]'));
  return {
    title: (z.querySelector('h2 > button > span')?.innerText || '').trim(),
    count: z.querySelector('[data-zone-count]')?.getAttribute('aria-label'),
    expanded: z.querySelector('h2 button')?.getAttribute('aria-expanded'),
    rows: rows.map((r) => (r.innerText || '').replace(/\\s+/g, ' ')),
    skeleton: Boolean(z.querySelector('[data-zone-skeleton]')),
    empty: (z.querySelector('[data-backlog-empty]')?.innerText || '').replace(/\\s+/g, ' '),
    text: (z.innerText || '').replace(/\\s+/g, ' '),
    total: z.querySelector('[data-backlog-total]')?.innerText || '',
    radios: Array.from(z.querySelectorAll('[data-backlog-size] [role=radio]')).map((b) => ({v: b.getAttribute('data-state'), t: b.innerText.trim(), l: b.getAttribute('aria-label')})),
    ${extra}
  };
`);
const urls = () => run('return window.__urls.filter((u) => u.includes("order=backlog") || u.includes("in_work=false"));');
const keyOfRow = (r) => (r.match(/[A-Z]+-\d+/) ?? [''])[0];

// ── без фильтров ────────────────────────────────────────────────────────────
console.log('блок на «Обзоре» без фильтров');
await run('localStorage.removeItem("sdlc.backlog.size.SDLC"); return 1;');
await s.goto(BASE + '/p/SDLC/overview');
await sleep(2200);
const zoneOrder = await run(`return Array.from(document.querySelectorAll('section[data-zone]')).map((z) => z.getAttribute('data-zone')).join();`);
check('блок стоит между очередью и завершённым', zoneOrder.includes('queue,backlog,done'), zoneOrder);
let b = await block();
const t5 = await truth(5);
check('заголовок «Приоритетные из бэклога»', b?.title === 'Приоритетные из бэклога', JSON.stringify(b));
check('по умолчанию 5 строк — столько же, сколько в ответе сервера', b.rows.length === 5 && t5.tasks.length === 5, `${b.rows.length}/${t5.tasks.length}`);
check('порядок строк — порядок ответа сервера, без пересортировки', b.rows.map(keyOfRow).join() === keysOf(t5).join(), `${b.rows.map(keyOfRow)} / ${keysOf(t5)}`);
check('счётчик шапки — total, а не число строк (AC-8.2)', b.count === `Приоритетные из бэклога, ${t5.total}` && t5.total > 5 && b.total === 'в бэклоге', `${b.count} / ${t5.total}`);
const u0 = await urls();
check('запрос блока: limit=5, order=backlog, top_level, без начатых и завершённых',
  u0.some((u) => /order=backlog/.test(u) && /limit=5(&|$)/.test(u) && /top_level=true/.test(u) && /in_work=false/.test(u) && /terminal=false/.test(u)), JSON.stringify(u0));
check('ни один запрос списка без limit', (await run('return window.__urls;')).every((u) => /[?&]limit=\d+/.test(u)));
const fullBacklog = await list(`${TOP}&limit=200`);
const blockedPos = keysOf(fullBacklog).indexOf(blocked);
check('заблокированная задача — позади незаблокированных (порядок сервера)', blockedPos > keysOf(fullBacklog).indexOf(plain[1]), keysOf(fullBacklog).join());
check('в строках блока нет стоимости', b.rows.every((r) => !/\$\d/.test(r) && !/нет учёта/.test(r)), b.rows.join(' | '));
check('эпик в бэклоге — строка с прогрессом «в бэклоге», дети отдельными строками не идут',
  !keysOf(fullBacklog).some((k) => kids.includes(k)));

// Строка блока.
await run('localStorage.setItem("sdlc.backlog.size.SDLC", "10"); return 1;');
await s.goto(BASE + '/p/SDLC/overview?q=' + encodeURIComponent(tag));
await sleep(2000);
b = await block();
const withTag = await list(`${TOP}&q=${encodeURIComponent(tag)}&limit=10`);
check('поиск в адресе сужает и блок', b.rows.length === withTag.tasks.length && b.rows.map(keyOfRow).join() === keysOf(withTag).join(), b.rows.map(keyOfRow).join());
const epicRow = b.rows.find((r) => r.includes(epic)) ?? '';
check('строка эпика: «готово · в работе · в бэклоге»', /0 готово · 0 в работе · 2 в бэклоге/.test(epicRow), epicRow);
const blockedRow = b.rows.find((r) => r.includes(blocked)) ?? '';
check('у заблокированной — «Ждёт <ключ блокирующей>»', blockedRow.includes(`Ждёт ${blocker}`), blockedRow || b.rows.join(' | '));
// CLAB-388: неначатая заблокированная задача — бэклог, а не «Застряло».
const zoneRows = (key) => run(`return Array.from(document.querySelectorAll('section[data-zone] [data-density]')).filter((r) => (r.innerText || '').includes(${JSON.stringify(key)})).map((r) => r.closest('section[data-zone]').getAttribute('data-zone'));`);
const blockedZones = await zoneRows(blocked);
check('CLAB-388: неначатая заблокированная задача на странице ровно в одной зоне — «бэклог»', blockedZones.join() === 'backlog', blockedZones.join());
const stuckUrls = (await run('return window.__urls;')).filter((u) => u.includes('attention_except='));
check('CLAB-388: запрос «Застряло» ограничен начатыми (in_work=true)', stuckUrls.length > 0 && stuckUrls.every((u) => /in_work=true/.test(u)), JSON.stringify(stuckUrls));
const stuckTruth = await list('in_work=true&attention_not=awaits_human&attention_except=awaits_human,returned,unclaimed&limit=200');
check('CLAB-388: сервер на запросе «Застряло» неначатую заблокированную не отдаёт', !keysOf(stuckTruth).includes(blocked), keysOf(stuckTruth).join());
check('в строке приоритет и тип', /(низкий|обычный|высокий|срочный|low|normal|high|urgent)/i.test(b.rows[0] ?? ''), b.rows[0]);
const href = await run(`return document.querySelector('section[data-zone=backlog] a[href*="/tasks/"]')?.getAttribute('href');`);
check('нажатие на строку ведёт в карточку задачи', /\/tasks\/[A-Z]+-\d+/.test(href ?? ''), String(href));

// ── переключатель 5 | 10 ────────────────────────────────────────────────────
console.log('переключатель 5 | 10');
await run('localStorage.removeItem("sdlc.backlog.size.SDLC"); return 1;');
await s.goto(BASE + '/p/SDLC/overview');
await sleep(2000);
b = await block();
check('переключатель: «5» выбран, «10» нет, подписи для чтения с экрана', b.radios.length === 2 && b.radios[0].v === 'on' && b.radios[1].v === 'off' && b.radios[1].l === 'Показывать 10', JSON.stringify(b.radios));
await run(`document.querySelectorAll('section[data-zone=backlog] [data-backlog-size] [role=radio]')[1].click(); await sleep(1500); return 1;`);
b = await block();
const t10 = await truth(10);
check('«10» — до десяти строк, как в ответе сервера', b.rows.length === Math.min(10, t10.total) && b.rows.map(keyOfRow).join() === keysOf(t10).join(), `${b.rows.length}`);
check('запрос с limit=10', (await urls()).some((u) => /order=backlog/.test(u) && /limit=10(&|$)/.test(u)));
check('выбор записан в браузер под ключом проекта', (await run('return localStorage.getItem("sdlc.backlog.size.SDLC");')) === '10');
check('ключ не из свёрнутости', (await run(`return Object.keys(localStorage).filter((k) => k.startsWith('sdlc.collapsed.') && k.includes('size')).length;`)) === 0);
await s.goto(BASE + '/p/SDLC/overview');
await sleep(2000);
b = await block();
check('после перезагрузки — по-прежнему 10', b.rows.length === Math.min(10, t10.total) && b.radios[1].v === 'on', JSON.stringify(b.radios));
// Клавиатура: фокус на «5», Space выбирает.
await run(`document.querySelectorAll('section[data-zone=backlog] [data-backlog-size] [role=radio]')[0].focus(); return 1;`);
await s.key(' ', 'Space', 32, ' ');
await sleep(1200);
b = await block();
check('с клавиатуры: Space на «5» выбирает пять строк', b.rows.length === 5 && b.radios[0].v === 'on', JSON.stringify(b.radios));
check('повторное нажатие на выбранное не снимает выбор', await (async () => {
  await run(`document.querySelectorAll('section[data-zone=backlog] [data-backlog-size] [role=radio]')[0].click(); await sleep(800); return 1;`);
  return (await block()).radios[0].v === 'on';
})());
// Хранилище не пишется (приватный режим): блок не падает.
const noStore = await s.addInitScript(`Storage.prototype.setItem = function () { throw new Error('QuotaExceededError'); };`);
await s.goto(BASE + '/p/SDLC/overview');
await sleep(2000);
await run(`document.querySelectorAll('section[data-zone=backlog] [data-backlog-size] [role=radio]')[1].click(); await sleep(1500); return 1;`);
b = await block();
check('localStorage не пишется — блок работает, число строк меняется на сессию', b && b.rows.length === Math.min(10, t10.total), JSON.stringify(b && b.rows.length));
await s.removeInitScript(noStore);
await run('localStorage.removeItem("sdlc.backlog.size.SDLC"); return 1;');

// ── только чтение ───────────────────────────────────────────────────────────
console.log('блок только читает');
await s.goto(BASE + '/p/SDLC/overview');
await sleep(2000);
check('запросы страницы проекта — только GET', (await run('return window.__methods;')).every((m) => m === 'GET'), JSON.stringify(await run('return [...new Set(window.__methods)];')));
// Ссылку «Весь бэклог» добавила страница бэклога (CLAB-402, К-2): переход
// по ней — GET страницы, блок по-прежнему ничего не пишет.
check('«Весь бэклог» ведёт на страницу бэклога', await run(`return Array.from(document.querySelectorAll('section[data-zone=backlog] a')).some((a) => a.innerText.trim().startsWith('Весь бэклог') && a.getAttribute('href') === '/p/SDLC/backlog');`));
check('перетаскивания нет', await run(`return !document.querySelector('section[data-zone=backlog] [draggable=true]');`));

// ── нарезка эпика ───────────────────────────────────────────────────────────
console.log('нарезка эпика');
await s.goto(BASE + `/p/SDLC/overview?parent=${epic}`);
await sleep(2400);
b = await block();
const kidsTruth = await list(`parent=${epic}&in_work=false&terminal=false&order=backlog&limit=5`);
check('блок «Неначатые в эпике» со счётчиком неначатых детей', b?.title === 'Неначатые в эпике' && b.count === `Неначатые в эпике, ${kidsTruth.total}` && kidsTruth.total === 2, JSON.stringify(b));
check('в блоке дети эпика в порядке сервера, сам эпик не строкой', b.rows.map(keyOfRow).join() === keysOf(kidsTruth).join() && !b.rows.some((r) => r.includes(epic)), b.rows.join(' | '));
const uEpic = (await urls()).filter((u) => u.includes(`parent=${epic}`) && u.includes('order=backlog'));
check('запрос нарезки: parent, in_work=false, terminal=false, order, limit; top_level нет', uEpic.length > 0 && uEpic.every((u) => !u.includes('top_level') && /limit=\d+/.test(u) && /in_work=false/.test(u) && /terminal=false/.test(u)), JSON.stringify(uEpic));
let t = await run('return texts();');
check('дефект CLAB-365: эпик с детьми только в бэклоге — не «Ничего не найдено по фильтрам» (AC-8.8)', !t.includes('Ничего не найдено по фильтрам') && !t.includes('У эпика ещё нет задач'), t.slice(0, 400));
check('в нарезке счётчик — число неначатых детей, без подписи «в бэклоге»', b.total === '');
// Эпик, все дети которого начаты.
await s.goto(BASE + `/p/SDLC/overview?parent=${startedEpic}`);
await sleep(2400);
b = await block();
check('все дети начаты — «Неначатых задач в эпике нет. Всё начатое — в зонах выше.»', b?.empty.includes('Неначатых задач в эпике нет. Всё начатое — в зонах выше.'), JSON.stringify(b));
check('и это не «Ничего не найдено»: начатый ребёнок в зоне', !(await run('return texts();')).includes('Ничего не найдено по фильтрам') && (await run('return texts();')).includes(startedKid));
// Тип: все задачи типа не начаты.
await s.goto(BASE + '/p/SDLC/overview?type=epic');
await sleep(2400);
b = await block();
const typed = await list(`${TOP}&type=epic&limit=5`);
check('?type=epic: в блоке эпики, а не «Ничего не найдено по фильтрам» (AC-8.8)', b.rows.length > 0 && b.rows.map(keyOfRow).join() === keysOf(typed).join() && !(await run('return texts();')).includes('Ничего не найдено по фильтрам'), `${b.rows.length} / ${await run('return texts();').then((x) => x.slice(0, 200))}`);

// Пусто и в блоке, и в зонах — по-прежнему «Ничего не найдено».
await s.goto(BASE + '/p/SDLC/overview?q=zzzz-ничего-' + tag);
await sleep(2000);
check('пусты и зоны, и блок — «Ничего не найдено по фильтрам»', (await run('return texts();')).includes('Ничего не найдено по фильтрам'));

// ── пустое состояние ────────────────────────────────────────────────────────
console.log('пустое состояние и ошибки');
await s.goto(BASE + '/p/SDLC/overview');
await sleep(1500);
await run(`window.__mode = 'empty'; document.querySelector('[data-refresh]').click(); await sleep(1500); return 1;`);
b = await block();
check('пустой бэклог: «Бэклог пуст», подсказка и «Новая задача»', b.empty.includes('Бэклог пуст') && b.empty.includes('Всё начатое — в зонах выше. Новая задача попадёт сюда.') && b.empty.includes('Новая задача'), JSON.stringify(b.empty));
check('счётчик пустого блока — 0, «в бэклоге»', b.count === 'Приоритетные из бэклога, 0');
// 400 на order — блок повторяет запрос без order.
await run(`window.__urls = []; window.__mode = 'reject-order'; document.querySelector('[data-refresh]').click(); await sleep(1800); return 1;`);
b = await block();
const uRetry = (await run('return window.__urls;')).filter((u) => u.includes('in_work=false') && u.includes('top_level=true'));
check('400 на order: повтор без order, строки на месте, без пометок', uRetry.some((u) => u.includes('order=backlog')) && uRetry.some((u) => !u.includes('order=') && /limit=\d+/.test(u)) && b.rows.length > 0 && !b.text.includes('Не получилось'), JSON.stringify(uRetry));
check('страница жива: остальные зоны на месте', (await run(`return document.querySelectorAll('section[data-zone]').length;`)) === 6);
// Ошибка сети — Failure в блоке, «Повторить», прежние строки не стираются.
await run(`window.__mode = 'down'; document.querySelector('[data-refresh]').click(); await sleep(1800); return 1;`);
b = await block();
check('ошибка блока — «Не получилось загрузить» и «Повторить», прежние строки на месте', b.text.includes('Не получилось загрузить «Приоритетные из бэклога»') && b.text.includes('Повторить') && b.rows.length > 0, b.text.slice(0, 300));
check('остальные зоны не затронуты', !(await run(`return document.querySelector('section[data-zone=queue]').innerText.includes('Не получилось');`)));
await run(`window.__mode = ''; const btn = Array.from(document.querySelectorAll('section[data-zone=backlog] button')).find((x) => x.innerText.trim() === 'Повторить'); btn.click(); await sleep(1500); return 1;`);
b = await block();
check('«Повторить» вернул блок', !b.text.includes('Не получилось') && b.rows.length > 0);

// Первая загрузка: скелетон, остальное не ждёт.
const slow = await s.addInitScript(`
  const o = window.fetch;
  window.fetch = (u, i) => String(u).includes('order=backlog') ? new Promise((ok) => setTimeout(() => ok(o(u, i)), 4000)) : o(u, i);
`);
await s.goto(BASE + '/p/SDLC/overview');
b = await block();
check('пока блок грузится — скелетон в блоке, шапка видна', b?.skeleton === true && b.title === 'Приоритетные из бэклога', JSON.stringify(b && {skeleton: b.skeleton, title: b.title}));
check('остальные зоны не ждут блок', (await run(`return document.querySelectorAll('section[data-zone]:not([data-zone=backlog]) [data-zone-skeleton]').length;`)) < 5);
await s.removeInitScript(slow);
await sleep(3500);

// Блок сворачивается, свёрнутость помнит браузер.
await s.goto(BASE + '/p/SDLC/overview');
await sleep(2000);
await run(`document.querySelector('section[data-zone=backlog] h2 button').click(); await sleep(400); return 1;`);
await s.goto(BASE + '/p/SDLC/overview');
await sleep(2000);
check('блок сворачивается, и браузер это помнит; счётчик на месте', (await block()).expanded === 'false' && /, \d+$/.test((await block()).count));
await run(`document.querySelector('section[data-zone=backlog] h2 button').click(); await sleep(400); return 1;`);

// ── вид ─────────────────────────────────────────────────────────────────────
console.log('вид: 1440, 390, тёмная тема');
await s.goto(BASE + '/p/SDLC/overview');
await sleep(2000);
const col = await run(`return Boolean(document.querySelector('[data-next-column] section[data-zone=backlog]'));`);
check('1440 px: блок в колонке «Дальше»', col);
await run(`document.documentElement.classList.add('dark'); await sleep(300); return 1;`);
const dark = await run(`
  const z = document.querySelector('section[data-zone=backlog]');
  const c = z.querySelector('[data-zone-count]');
  const cs = getComputedStyle(c);
  return {bg: getComputedStyle(document.body).backgroundColor, fg: cs.color, hint: getComputedStyle(z.querySelector('[data-backlog-total]')).color};
`);
check('тёмная тема: счётчик и подпись читаются', dark.bg !== 'rgb(255, 255, 255)' && dark.fg !== dark.bg && dark.hint !== dark.bg, JSON.stringify(dark));
if (SHOTS) {
  const {writeFileSync} = await import('node:fs');
  writeFileSync(`${SHOTS}/backlog-1440-dark.png`, Buffer.from(await s.screenshot(), 'base64'));
}
await run(`document.documentElement.classList.remove('dark'); return 1;`);
if (SHOTS) {
  const {writeFileSync} = await import('node:fs');
  writeFileSync(`${SHOTS}/backlog-1440-light.png`, Buffer.from(await s.screenshot(), 'base64'));
}
await s.resize(390, 844);
await sleep(800);
await run(`document.querySelector('[data-next-button]').click(); await sleep(800); return 1;`);
const narrow = await run(`
  const p = document.querySelector('[data-next-sheet]');
  const z = p && p.querySelector('section[data-zone=backlog]');
  return {
    inSheet: Boolean(z),
    overflow: z ? z.scrollWidth > z.clientWidth + 1 : null,
    page: document.documentElement.scrollWidth > window.innerWidth,
    radios: z ? z.querySelectorAll('[role=radio]').length : 0,
    once: document.querySelectorAll('section[data-zone=backlog]').length,
  };
`);
check('390 px: блок в панели «Дальше», один раз, без обрезки', narrow.inSheet && narrow.once === 1 && narrow.overflow === false && narrow.page === false && narrow.radios === 2, JSON.stringify(narrow));
if (SHOTS) {
  const {writeFileSync} = await import('node:fs');
  writeFileSync(`${SHOTS}/backlog-390-sheet-light.png`, Buffer.from(await s.screenshot(), 'base64'));
  await run(`document.documentElement.classList.add('dark'); await sleep(300); return 1;`);
  writeFileSync(`${SHOTS}/backlog-390-sheet-dark.png`, Buffer.from(await s.screenshot(), 'base64'));
  await run(`document.documentElement.classList.remove('dark'); return 1;`);
}
await s.key('Escape', 'Escape', 27);
await s.resize(1360, 900);

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
