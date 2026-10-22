import {session, helpers} from './driver.mjs';

const BASE = process.env.SDLC_UI_URL ?? 'http://localhost:5173';
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

console.log('доска');
await s.goto(BASE + '/p/SDLC/board');
await new Promise((r) => setTimeout(r, 2000));
t = await run('return texts();');
check('колонки взяты из цикла проекта', t.includes('Code Review') && t.includes('QA'));
check('исполнитель колонки показан', t.includes('Аналитик'));
check('задачи разложены по статусам', t.includes('SDLC-1'));
check('мультирепозиторная задача помечена', t.includes('мультирепо'), t.slice(0, 600));

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

await s.goto(BASE + '/p/SDLC/board');
await new Promise((r) => setTimeout(r, 1800));
t = await run('return texts();');
check('задача появилась на доске', t.includes('Проверка формы свойств'), t.slice(0, 600));

console.log('ошибка загрузки: «Повторить» и объявление загрузки');
// Запрос списка задач перехватывается в самой странице: сначала он
// задерживается — на экране «Загрузка» с role=status; потом отклоняется —
// Failure с кнопкой «Повторить»; после того как сеть «вернулась», «Повторить»
// возвращает доску без перезагрузки вкладки.
await run(`
  window.__origFetch = window.fetch;
  window.__mode = 'slow';
  window.fetch = (url, init) => {
    if (!String(url).includes('/v1/projects/SDLC/tasks?')) return window.__origFetch(url, init);
    if (window.__mode === 'slow') return new Promise((ok) => setTimeout(() => ok(window.__origFetch(url, init)), 2500));
    if (window.__mode === 'fail') return Promise.reject(new TypeError('сеть недоступна'));
    return window.__origFetch(url, init);
  };
  await press("epic", "[role=radio], [role=tab], button");
  await sleep(300);
  return true;
`);
const status = await run(`const el = document.querySelector('[role=status]'); return el ? el.innerText : '';`);
check('загрузка объявлена элементом role=status', status.includes('Загрузка'), status);
await run(`
  await sleep(2500);
  window.__mode = 'fail';
  await press("task", "[role=radio], [role=tab], button");
  await sleep(1000);
  return true;
`);
t = await run('return texts();');
check('ошибка загрузки показана с кнопкой «Повторить»', t.includes('сеть недоступна') && t.includes('Повторить'), t.slice(0, 400));
await run(`window.__mode = 'ok'; await clickExact("Повторить"); await sleep(1500); return true;`);
t = await run('return texts();');
check('«Повторить» вернул доску без перезагрузки вкладки',
  !t.includes('Повторить') && !t.includes('сеть недоступна') && t.includes('Проверка формы свойств'), t.slice(0, 600));

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
