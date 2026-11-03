// Проекты и «Обзор» (CLAB-365): адрес и старые закладки /board, меню, зоны
// с рамкой и сворачиванием, очередь со своей задачей, фильтры в адресе и
// поиск, состояния (тип и эпик, которых нет, пустой результат), ошибка одной
// зоны и скелетоны, запросы только с limit, панель «Дальше» на 390 px и
// колонка на 1440, тёмная тема. SDLC_E2E_SHOTS=<каталог> — снимки в обеих
// темах на 1440 и 390 px.
import {session, helpers} from './driver.mjs';

const BASE = process.env.SDLC_UI_URL ?? 'http://localhost:5173';
const API = process.env.SDLC_API_URL ?? 'http://localhost:8088';
const SHOTS = process.env.SDLC_E2E_SHOTS;
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};

const s = await session(BASE + '/projects');
const run = (body) => s.evaluate(helpers + body);
await new Promise((r) => setTimeout(r, 2000));

console.log('проекты');
let t = await run('return texts();');
check('проект показан', t.includes('SDLC Pipeline'));
check('репозитории проекта показаны', t.includes('sdlc-pipeline-backend'));

// Знак вместо временной иконки (CLAB-245): виден в шапке меню целиком, ступени
// берут цвет из --logo-accent, подпись у ссылки остаётся.
console.log('знак в шапке меню');
// На узком окне меню — выезжающая панель, шапки в разметке нет.
await s.resize(1360, 900);
await new Promise((r) => setTimeout(r, 800));
const mark = await run(`
  const link = document.querySelector('[data-sidebar=header] a');
  const svg = link && link.querySelector('svg');
  if (!svg) return {missing: true};
  const box = svg.getBoundingClientRect();
  const btn = link.getBoundingClientRect();
  return {
    viewBox: svg.getAttribute('viewBox'),
    width: box.width,
    inside: box.left >= btn.left && box.right <= btn.right,
    dark: document.documentElement.classList.contains('dark'),
    accent: getComputedStyle(document.documentElement).getPropertyValue('--logo-accent').trim(),
    name: link.innerText,
  };
`);
check('знак стоит в шапке меню', !mark.missing && mark.viewBox === '0 0 138 80' && mark.width > 20, JSON.stringify(mark));
check('знак внутри кнопки, не обрезан', mark.inside === true, JSON.stringify(mark));
check('цвет ступеней задан переменной темы', (mark.dark ? /^#2DD4BF$/i : /^#0F9488$/i).test(mark.accent), JSON.stringify(mark));
check('подпись «Cadence Lab» у ссылки на месте', /Cadence Lab/.test(mark.name || ''), JSON.stringify(mark));

// Проект заводит любой вошедший (решение 0030): в режиме header это
// действующее лицо из заголовка, и кнопка для него есть.
console.log('создание проекта');
await run(`
  await clickExact("Новый проект");
  await sleep(300);
  await fill("Ключ", "e2e");
  await fill("Название", "Проект e2e");
  await sleep(200);
  await clickExact("Создать проект");
  await sleep(2000);
  return true;
`);
t = await run('return texts();');
check('проект заведён', t.includes('Проект e2e') && t.includes('E2E'), t.slice(0, 600));
check('форма закрылась', !t.includes('Создать проект'), t.slice(0, 300));

console.log('«Обзор»: адрес и меню');
const loc = () => run('return location.pathname + location.search;');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await s.goto(BASE + '/p/SDLC');
await sleep(1500);
check('/p/:key открывает «Обзор»', (await loc()) === '/p/SDLC/overview', await loc());
await s.goto(BASE + '/p/SDLC/board?parent=SDLC-4&foo=1');
await sleep(1500);
check('старая закладка /board → /overview с той же строкой запроса', (await loc()) === '/p/SDLC/overview?parent=SDLC-4&foo=1', await loc());
await s.goto(BASE + '/p/SDLC/overview');
await sleep(2000);
const menu = await run(`
  const group = all('[data-sidebar=group]').find((g) => (g.querySelector('[data-sidebar=group-label]')?.innerText || '').trim() === 'SDLC');
  const items = group ? Array.from(group.querySelectorAll('[data-sidebar=menu-button]')) : [];
  return {
    labels: items.map((a) => (a.innerText || '').trim().split('\\n')[0]),
    active: items.filter((a) => a.getAttribute('data-active') === 'true').map((a) => (a.innerText || '').trim()),
    header: (document.querySelector('header')?.innerText || '').trim(),
  };
`);
check('«Обзор» — первый пункт меню проекта и подсвечен', menu.labels[0] === 'Обзор' && menu.active.join() === 'Обзор', JSON.stringify(menu));
check('«Доски» в меню нет', !menu.labels.includes('Доска'), JSON.stringify(menu.labels));
check('заголовок вкладки «SDLC · Обзор»', menu.header.includes('SDLC · Обзор'), menu.header);

console.log('зоны');
const zones = async () => run(`
  return all('section[data-zone]').map((z) => ({
    zone: z.getAttribute('data-zone'),
    h2: (z.querySelector('h2')?.innerText || '').replace(/\\s+/g, ' ').trim(),
    expanded: z.querySelector('h2 button')?.getAttribute('aria-expanded'),
    label: z.querySelector('[data-zone-count]')?.getAttribute('aria-label'),
    labelledby: Boolean(z.getAttribute('aria-labelledby')) && document.getElementById(z.getAttribute('aria-labelledby'))?.tagName,
  }));
`);
let zs = await zones();
check('зоны «Обзора» на месте, блок «Приоритетные из бэклога» между очередью и завершённым', zs.map((z) => z.zone).join() === 'decisions,stuck,work,queue,backlog,done', JSON.stringify(zs.map((z) => z.zone)));
check('каждая зона — section с h2 и кнопкой aria-expanded', zs.every((z) => z.labelledby === 'H2' && (z.expanded === 'true' || z.expanded === 'false')), JSON.stringify(zs));
check('счётчик с подписью «<Зона>, N»', zs.every((z) => /^[^,]+, (\d+\+?|—)$/.test(z.label || '')), JSON.stringify(zs.map((z) => z.label)));
check('по умолчанию свёрнута только «Завершено недавно»', zs.filter((z) => z.expanded === 'false').map((z) => z.zone).join() === 'done', JSON.stringify(zs));
check('заголовки зон не повторяются', new Set(zs.map((z) => z.h2)).size === zs.length);

console.log('создание задачи');
await run(`
  await clickExact("Новая задача");
  await fill("Название", "Проверка формы свойств");
  await sleep(200);
  // включить системное свойство multi_repo
  const sw = all('[role=switch], input[type=checkbox]').find(c => {
    const lbl = c.getAttribute('id') && document.querySelector('label[for="' + c.id + '"]');
    return lbl && lbl.innerText.includes('Мультирепозиторная');
  });
  if (!sw) throw new Error('свойство multi_repo не найдено');
  sw.click();
  await sleep(300);
  await clickExact("Создать");
  await sleep(2000);
  return true;
`);
t = await run('return texts();');
check('после создания открылась карточка задачи', t.includes('Проверка формы свойств'), t.slice(0, 400));
check('свойство сохранилось', t.includes('Мультирепозиторная'), t.slice(0, 600));
const KEY = (await run('return location.pathname;')).split('/').pop();

// Задача уходит в работу — этап с ролью ждёт исполнителя: она в «Очереди».
await fetch(`${API}/v1/tasks/${KEY}/transitions/start`, {
  method: 'POST', headers: {'Content-Type': 'application/json', 'X-SDLC-Actor': 'e2e'}, body: '{}',
});
await s.goto(BASE + '/p/SDLC/overview');
await sleep(2000);
const queueText = await run(`return (document.querySelector('[data-zone=queue]')?.innerText || '').replace(/\\s+/g, ' ');`);
check('начатая задача — в «Очереди», «можно забрать»', queueText.includes(KEY) && queueText.includes('можно забрать'), queueText.slice(0, 400));
const inZones = await run(`return all('section[data-zone] [data-density]').filter((r) => (r.innerText || '').includes(${JSON.stringify(KEY)})).length;`);
check('одна задача — одна зона', inZones === 1, String(inZones));

console.log('сворачивание помнит браузер');
await run(`document.querySelector('[data-zone=stuck] h2 button').click(); await sleep(400); return true;`);
await s.goto(BASE + '/p/SDLC/overview');
await sleep(1800);
zs = await zones();
check('свёрнутая «Застряло» осталась свёрнутой после перезагрузки', zs.find((z) => z.zone === 'stuck').expanded === 'false', JSON.stringify(zs));
check('у свёрнутой зоны счётчик на месте', /^Застряло, /.test(zs.find((z) => z.zone === 'stuck').label || ''));
await run(`document.querySelector('[data-zone=stuck] h2 button').click(); await sleep(400); return true;`);
check('развернулась', (await zones()).find((z) => z.zone === 'stuck').expanded === 'true');

console.log('фильтры в адресе');
await s.goto(BASE + '/p/SDLC/overview?type=incident-nope');
await sleep(1800);
t = await run('return texts();');
check('тип, которого нет, — заметка, зон нет', t.includes('Типа incident-nope в проекте нет') && (await zones()).length === 0, t.slice(0, 400));
await run('await clickExact("Сбросить фильтр"); await sleep(1200); return true;');
check('сброс убрал тип из адреса', (await loc()) === '/p/SDLC/overview', await loc());
await s.goto(BASE + '/p/SDLC/overview?parent=NOPE-999');
await sleep(2200);
t = await run('return texts();');
check('эпика нет — заметка, зон нет', t.includes('Эпика NOPE-999 в проекте нет') && (await zones()).length === 0, t.slice(0, 400));
await s.goto(BASE + '/p/SDLC/overview?q=zzzz-ничего');
await sleep(2000);
t = await run('return texts();');
check('пустой результат — «Ничего не найдено по фильтрам», не пустой проект',
  t.includes('Ничего не найдено по фильтрам') && t.includes('Поиск: «zzzz-ничего»') && !t.includes('В проекте пока нет задач'), t.slice(0, 500));
check('поле поиска показывает значение из адреса', (await run(`return document.querySelector('[data-filter-q]').value;`)) === 'zzzz-ничего');
await run('await clickExact("Сбросить"); await sleep(1500); return true;');
check('«Сбросить» убрал фильтр из адреса', (await loc()) === '/p/SDLC/overview', await loc());
const lenBefore = await run('return history.length;');
await run(`
  const input = document.querySelector('[data-filter-q]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(KEY)});
  input.dispatchEvent(new Event('input', {bubbles: true}));
  await sleep(1500);
  return true;
`);
check('ввод с паузой — в ?q=', (await loc()) === `/p/SDLC/overview?q=${KEY}`, await loc());
check('поиск не копит историю (replace)', (await run('return history.length;')) === lenBefore);
t = await run('return texts();');
check('по ключу найдена своя задача', t.includes(KEY) && t.includes('Сбросить'), t.slice(0, 500));
await run(`
  const input = document.querySelector('[data-filter-q]');
  input.focus();
  input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
  await sleep(800);
  return true;
`);
check('Esc очищает поиск и адрес', (await loc()) === '/p/SDLC/overview' && (await run(`return document.querySelector('[data-filter-q]').value;`)) === '', await loc());

console.log('запросы только с limit, скелетоны');
const seen = await s.addInitScript(`
  window.__tasksUrls = [];
  const orig = window.fetch;
  window.fetch = (url, init) => {
    const u = String(url);
    if (u.includes('/tasks')) window.__tasksUrls.push(u);
    if (u.includes('/projects/SDLC/tasks')) return new Promise((ok) => setTimeout(() => ok(orig(url, init)), 1500));
    return orig(url, init);
  };
`);
await s.goto(BASE + '/p/SDLC/overview');
const early = await run(`return {h1: (document.querySelector('h1')?.innerText || ''), skeletons: all('[data-zone-skeleton]').length, spinner: all('[role=status]').length};`);
check('пока зоны грузятся — шапка и скелетоны, без спиннера', early.h1 === 'Обзор' && early.skeletons >= 3 && early.spinner === 0, JSON.stringify(early));
await sleep(2500);
const urls = await run('return window.__tasksUrls;');
const listUrls = urls.filter((u) => u.includes('/projects/SDLC/tasks'));
check('ни одного запроса списка без limit', listUrls.length >= 6 && listUrls.every((u) => /[?&]limit=\d+/.test(u)), JSON.stringify(listUrls));
check('список эпиков — не больше 200', listUrls.some((u) => u.includes('top_level=true') && u.includes('limit=200')), JSON.stringify(listUrls));
await s.removeInitScript(seen);

console.log('ошибка одной зоны');
await s.goto(BASE + '/p/SDLC/overview');
await sleep(2000);
await run(`
  window.__origFetch = window.fetch;
  window.fetch = (url, init) => String(url).includes('attention_except') ? Promise.reject(new TypeError('сеть недоступна')) : window.__origFetch(url, init);
  document.querySelector('[data-refresh]').click();
  await sleep(1500);
  return true;
`);
let stuckText = await run(`return (document.querySelector('[data-zone=stuck]')?.innerText || '').replace(/\\s+/g, ' ');`);
const queueAfter = await run(`return (document.querySelector('[data-zone=queue]')?.innerText || '').replace(/\\s+/g, ' ');`);
check('упавшая зона — «Не получилось загрузить» и «Повторить»', stuckText.includes('Не получилось загрузить «Застряло»') && stuckText.includes('Повторить'), stuckText);
check('счётчик упавшей зоны — «—»', (await zones()).find((z) => z.zone === 'stuck').label === 'Застряло, —');
check('остальные зоны работают', queueAfter.includes(KEY), queueAfter.slice(0, 300));
await run(`window.fetch = window.__origFetch; await clickIn('Не получилось загрузить', 'Повторить'); await sleep(1500); return true;`);
stuckText = await run(`return (document.querySelector('[data-zone=stuck]')?.innerText || '').replace(/\\s+/g, ' ');`);
check('«Повторить» вернул зону', !stuckText.includes('Не получилось'), stuckText);

console.log('колонка «Дальше» и панель');
await s.resize(1440, 900);
await s.goto(BASE + '/p/SDLC/overview');
await sleep(2000);
let next = await run(`return {column: Boolean(document.querySelector('[data-next-column] [data-zone=queue]')), button: Boolean(document.querySelector('[data-next-button]'))};`);
check('1440 px: «Дальше» — колонка, кнопки нет', next.column && !next.button, JSON.stringify(next));
if (SHOTS) {
  const {writeFileSync} = await import('node:fs');
  writeFileSync(`${SHOTS}/overview-1440-light.png`, Buffer.from(await s.screenshot(), 'base64'));
  await run(`document.documentElement.classList.add('dark'); await sleep(300); return true;`);
  writeFileSync(`${SHOTS}/overview-1440-dark.png`, Buffer.from(await s.screenshot(), 'base64'));
  await run(`document.documentElement.classList.remove('dark'); return true;`);
}
await s.resize(390, 844);
await sleep(800);
next = await run(`return {
  column: Boolean(document.querySelector('[data-next-column]')),
  button: Boolean(document.querySelector('[data-next-button]')),
  queue: all('[data-zone=queue]').length,
  hscroll: document.documentElement.scrollWidth > window.innerWidth,
  refresh: document.querySelector('[data-refresh]')?.getAttribute('aria-label'),
};`);
check('390 px: колонки нет, кнопка «Дальше» в шапке', !next.column && next.button && next.queue === 0, JSON.stringify(next));
check('390 px: нет горизонтальной прокрутки страницы', next.hscroll === false, JSON.stringify(next));
check('«Обновить» иконкой с aria-label', next.refresh === 'Обновить');
if (SHOTS) {
  const {writeFileSync} = await import('node:fs');
  writeFileSync(`${SHOTS}/overview-390-light.png`, Buffer.from(await s.screenshot(), 'base64'));
}
await run(`document.querySelector('[data-next-button]').click(); await sleep(700); return true;`);
const sheet = await run(`
  const p = document.querySelector('[data-next-sheet]');
  return {
    open: Boolean(p),
    title: p ? (p.innerText || '').split('\\n')[0] : '',
    queue: p ? Boolean(p.querySelector('[data-zone=queue]')) : false,
    h2: all('h2').filter((h) => (h.innerText || '').includes('Очередь')).length,
    key: p ? (p.innerText || '').includes(${JSON.stringify(KEY)}) : false,
    width: p ? Math.round(p.getBoundingClientRect().width) : 0,
    close: p ? Boolean(p.querySelector('[aria-label="Закрыть"]')) : false,
  };
`);
check('панель «Дальше» с очередью и своей задачей', sheet.open && sheet.title === 'Дальше' && sheet.queue && sheet.key, JSON.stringify(sheet));
check('зона в DOM один раз', sheet.h2 === 1, JSON.stringify(sheet));
check('ширина панели — вся минус 3rem', sheet.width === 390 - 48, JSON.stringify(sheet));
check('крестик подписан «Закрыть»', sheet.close);
if (SHOTS) {
  const {writeFileSync} = await import('node:fs');
  writeFileSync(`${SHOTS}/overview-390-sheet-light.png`, Buffer.from(await s.screenshot(), 'base64'));
  await run(`document.documentElement.classList.add('dark'); await sleep(300); return true;`);
  writeFileSync(`${SHOTS}/overview-390-sheet-dark.png`, Buffer.from(await s.screenshot(), 'base64'));
  await run(`document.documentElement.classList.remove('dark'); return true;`);
}
await s.key('Escape', 'Escape', 27);
await sleep(500);
const closed = await run(`return {open: Boolean(document.querySelector('[data-next-sheet]')), focus: document.activeElement?.hasAttribute('data-next-button')};`);
check('Esc закрывает панель, фокус — на кнопке «Дальше»', !closed.open && closed.focus, JSON.stringify(closed));
await run(`document.querySelector('[data-next-button]').click(); await sleep(700); return true;`);
await s.resize(1440, 900);
await sleep(900);
next = await run(`return {sheet: Boolean(document.querySelector('[data-next-sheet]')), column: Boolean(document.querySelector('[data-next-column] [data-zone=queue]'))};`);
check('расширение окна закрывает панель, колонка на месте', !next.sheet && next.column, JSON.stringify(next));
await s.resize(1360, 900);

console.log('тёмная тема');
await run(`document.documentElement.classList.add('dark'); await sleep(300); return true;`);
const dark = await run(`
  const c = document.querySelector('[data-zone=queue] [data-zone-count]');
  return {bg: getComputedStyle(document.body).backgroundColor, count: c ? getComputedStyle(c).color : ''};
`);
check('тёмная тема применяется к странице', dark.bg !== 'rgb(255, 255, 255)' && dark.count !== '', JSON.stringify(dark));
await run(`document.documentElement.classList.remove('dark'); return true;`);

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
