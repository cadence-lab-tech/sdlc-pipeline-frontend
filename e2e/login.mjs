// Страница входа: раскладка в две колонки, терминальная сцена и способы входа.
// Сам вход через GitHub и провайдера сценарием не проверяется — для него нужен
// живой IdP, а обмен кода и подписи проверяет бэкенд.
import {session, helpers} from './driver.mjs';

const BASE = process.env.SDLC_UI_URL ?? 'http://localhost:5173';
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};

const s = await session(BASE + '/login');
const run = (body) => s.evaluate(helpers + body);

console.log('широкий экран: две колонки');
await s.resize(1360, 900);
await s.goto(BASE + '/login');
await new Promise((r) => setTimeout(r, 2000));

let t = await run('return texts();');
check('терминальная сцена показана', t.includes('clab auth login') || t.includes('clab mcp install'), t.slice(0, 500));
check('три тезиса под терминалом', t.includes('Агент в роли специалиста') && t.includes('Гейты на переходе') && t.includes('Последнее слово за человеком'), t.slice(0, 600));
check('ссылка на установку CLI есть', t.includes('как поставить CLI clab'), t.slice(0, 600));

const layout = await run(`
  const aside = all('aside')[0];
  const form = all('button, input').find((el) => /Другие способы входа/.test(el.innerText || ''));
  const column = form && form.closest('div.flex.items-center');
  if (!aside || !column) return {missing: true};
  const asideBox = aside.getBoundingClientRect();
  const columnBox = column.getBoundingClientRect();
  return {
    // Вход первым в разметке: порядок обхода с клавиатуры начинается с него.
    formFirstInDom: Boolean(column.compareDocumentPosition(aside) & Node.DOCUMENT_POSITION_FOLLOWING),
    terminalOnTheLeft: asideBox.left < columnBox.left,
    twoColumns: asideBox.width > 0 && columnBox.width > 0 && Math.abs(asideBox.top - columnBox.top) < 40,
  };
`);
check('колонки стоят рядом, сцена слева', !layout.missing && layout.twoColumns && layout.terminalOnTheLeft, JSON.stringify(layout));
check('вход идёт первым в разметке', layout.formFirstInDom === true, JSON.stringify(layout));

console.log('знак и иконки');
const brand = await run(`
  const links = all('link[rel~=icon], link[rel=apple-touch-icon], link[rel=manifest]').map((l) => l.getAttribute('rel') + ' ' + l.getAttribute('href'));
  const welcome = all('h1').find((h) => /Cadence Lab/.test(h.innerText));
  const svg = welcome && welcome.closest('.flex.items-center')?.querySelector('svg');
  return {links, hasMark: Boolean(svg), viewBox: svg && svg.getAttribute('viewBox')};
`);
check('иконки вкладки подключены (svg и ico)', brand.links.some((l) => l.endsWith('/favicon.svg')) && brand.links.some((l) => l.endsWith('/favicon.ico')), JSON.stringify(brand));
check('apple-touch-icon и манифест подключены', brand.links.includes('apple-touch-icon /apple-touch-icon.png') && brand.links.includes('manifest /manifest.webmanifest'), JSON.stringify(brand));
check('рядом с заголовком стоит знак', brand.hasMark && brand.viewBox === '0 0 138 80', JSON.stringify(brand));
for (const path of ['/favicon.svg', '/favicon.ico', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest']) {
  const res = await fetch(BASE + path);
  const type = res.headers.get('content-type') ?? '';
  check(`${path} отдаётся файлом, а не страницей`, res.ok && !type.includes('text/html'), `${res.status} ${type}`);
}

console.log('способы входа');
t = await run(`
  const field = all('label').find((l) => l.innerText.trim().startsWith('Токен'));
  return field ? 'видно' : 'скрыто';
`);
check('вход токеном спрятан', t === 'скрыто', t);
await run('await clickExact("Другие способы входа"); return true;');
await new Promise((r) => setTimeout(r, 600));
t = await run(`
  const lbl = all('label').find((l) => l.innerText.trim().startsWith('Токен'));
  const field = lbl && document.getElementById(lbl.getAttribute('for'));
  return field ? field.type : 'нет поля';
`);
check('вход токеном раскрывается по кнопке', t === 'password', t);

console.log('ошибка входа');
await run(`
  const lbl = all('label').find((l) => l.innerText.trim().startsWith('Токен'));
  const field = lbl && document.getElementById(lbl.getAttribute('for'));
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, 'clab_pat_нет-такого-токена');
  field.dispatchEvent(new Event('input', {bubbles: true}));
  await sleep(300);
  await clickExact("Войти");
  await sleep(1500);
  return true;
`);
t = await run('return texts();');
check('отказ показан сообщением', t.includes('Войти не удалось'), t.slice(0, 400));
check('способы входа остались на экране', t.includes('Другие способы входа'), t.slice(0, 400));

console.log('узкий экран');
await s.resize(390, 844);
await s.goto(BASE + '/login');
await new Promise((r) => setTimeout(r, 1500));
const narrow = await run(`
  const aside = all('aside')[0];
  return {
    terminalHidden: !aside || aside.getBoundingClientRect().width === 0,
    scrollsSideways: document.documentElement.scrollWidth > window.innerWidth + 1,
    loginVisible: /Cadence Lab/.test(document.body.innerText || ''),
  };
`);
check('сцена на узком экране не показывается', narrow.terminalHidden, JSON.stringify(narrow));
check('вход виден', narrow.loginVisible, JSON.stringify(narrow));
check('горизонтальной прокрутки нет', !narrow.scrollsSideways, JSON.stringify(narrow));

console.log('меньше движения');
await s.resize(1360, 900);
await s.emulate([{name: 'prefers-reduced-motion', value: 'reduce'}]);
await s.goto(BASE + '/login');
await new Promise((r) => setTimeout(r, 1200));
const still = await run(`
  const lines = all('aside .font-mono div').map((d) => d.innerText).filter(Boolean);
  const before = lines.length;
  await sleep(1500);
  const after = all('aside .font-mono div').map((d) => d.innerText).filter(Boolean);
  return {before, same: JSON.stringify(lines) === JSON.stringify(after), text: after.join(' | ')};
`);
check('сцена показана статичным кадром', still.same === true && still.before > 1, JSON.stringify(still).slice(0, 400));
check('в кадре настоящая команда clab', /clab /.test(still.text), still.text.slice(0, 300));

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
