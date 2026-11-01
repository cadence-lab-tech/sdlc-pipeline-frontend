// Страница «Пайплайн» (CLAB-346): адрес, старые адреса (404, CLAB-357),
// узлы с ролями и версиями, панель роли, состояния страницы, узкий и
// широкий экран. Данных не меняет: отказы и задержки сервера подменяются в
// браузере ответом одной ручки, остальное сверяется с API стенда.
import {session, helpers} from './driver.mjs';

const BASE = process.env.SDLC_UI_URL ?? 'http://localhost:5173';
const API = process.env.SDLC_API_URL ?? 'http://localhost:8088';
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};
const get = (path) => fetch(API + '/v1' + path, {headers: {'X-SDLC-Actor': 'e2e'}}).then((r) => r.json());
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const s = await session(BASE + '/p/SDLC/board');
const run = (body) => s.evaluate(helpers + body);
await s.resize(1440, 900);
await s.goto(BASE + '/p/SDLC/pipeline');
await pause(2000);

console.log('страница и версия цикла (AC-1)');
const firstType = await run(`return (document.querySelector('[role=tab][data-state=active]')?.innerText || '').trim();`);
const firstActive = await get(`/projects/SDLC/workflow?type=${firstType}`);
let shown = await run(`return {page: Boolean(document.querySelector('[data-pipeline-page]')), wf: document.querySelector('[data-pipeline-version]')?.getAttribute('data-pipeline-version')};`);
check('по умолчанию — активная версия первого типа', shown.page && shown.wf === firstActive.id, JSON.stringify({shown, firstType, id: firstActive.id}));
const taskWf = await get('/projects/SDLC/workflow?type=task');
await run('await press("task"); await sleep(1200); return true;');
shown = await run(`return {wf: document.querySelector('[data-pipeline-version]')?.getAttribute('data-pipeline-version'), url: location.search};`);
check('переключение типа пишет type в адрес и показывает его цикл', shown.url.includes('type=task') && shown.wf === taskWf.id, JSON.stringify(shown));
await s.goto(BASE + '/p/SDLC/pipeline' + shown.url);
await pause(2000);
const again = await run(`return document.querySelector('[data-pipeline-version]')?.getAttribute('data-pipeline-version');`);
check('перезагрузка возвращает тот же вид', again === taskWf.id, String(again));

console.log('узлы: роль, перепроверка, версия (AC-3)');
const roles = (await get('/projects/SDLC/roles?include_archived=true')).roles;
const latest = new Map(roles.map((r) => [r.key, r.latest_version]));
const nodes = await run(`
  return all('[data-pipeline-status]').map((n) => ({
    key: n.getAttribute('data-pipeline-status'),
    roles: Array.from(n.querySelectorAll('[data-pipeline-role]')).map((b) => ({
      key: b.getAttribute('data-pipeline-role'),
      primary: b.hasAttribute('data-pipeline-role-primary'),
      v: b.getAttribute('data-pipeline-role-version'),
      text: (b.innerText || '').replace(/\\s+/g, ' ').trim(),
    })),
    noRole: Boolean(n.querySelector('[data-pipeline-no-role]')),
  }));
`);
const nodeProblems = [];
for (const st of taskWf.statuses) {
  const n = nodes.find((x) => x.key === st.key);
  if (!n) { nodeProblems.push(`${st.key}: нет узла`); continue; }
  const want = st.roles ?? [];
  if (!want.length && !n.noRole) nodeProblems.push(`${st.key}: нет «без исполнителя»`);
  for (const r of want) {
    const b = n.roles.find((x) => x.key === r.role_key);
    if (!b) { nodeProblems.push(`${st.key}: нет роли ${r.role_key}`); continue; }
    if (b.primary !== r.is_primary) nodeProblems.push(`${st.key}/${r.role_key}: не та отметка исполнителя`);
    if (String(latest.get(r.role_key) ?? '') !== b.v) nodeProblems.push(`${st.key}/${r.role_key}: v${b.v} вместо v${latest.get(r.role_key)}`);
    if (latest.get(r.role_key) && !b.text.includes(`v${latest.get(r.role_key)}`)) nodeProblems.push(`${st.key}/${r.role_key}: vN не показан`);
  }
}
check('у каждого статуса роли и vN = latest_version, без роли — «без исполнителя»', nodeProblems.length === 0, nodeProblems.join('; '));

console.log('панель роли и «Назад» (AC-5)');
const someRole = taskWf.statuses.flatMap((x) => x.roles ?? []).find((r) => r.is_primary);
const before = await run('return history.length;');
await run(`document.querySelector('[data-pipeline-role="${someRole.role_key}"]').click(); await sleep(1500); return true;`);
let state = await run(`return {panel: document.querySelector('[data-role-panel]')?.getAttribute('data-role-panel'), url: location.search, len: history.length};`);
check('клик по роли на узле открывает её панель, роль в адресе', state.panel === someRole.role_key && state.url.includes(`role=${someRole.role_key}`), JSON.stringify(state));
check('выбор пишется в историю', state.len === before + 1, `${before} → ${state.len}`);
const focus = await run(`
  return all('[data-pipeline-status]').map((n) => ({key: n.getAttribute('data-pipeline-status'), dim: n.className.includes('opacity-45')}));
`);
const roleNodes = taskWf.statuses.filter((x) => (x.roles ?? []).some((r) => r.role_key === someRole.role_key)).map((x) => x.key);
check('фокус по роли: её узлы яркие, прочие приглушены',
  focus.every((n) => n.dim === !roleNodes.includes(n.key)), JSON.stringify(focus));
await run('history.back(); await sleep(1200); return true;');
state = await run(`return {panel: Boolean(document.querySelector('[data-role-panel]')), url: location.search};`);
check('«Назад» закрывает панель роли', !state.panel && !state.url.includes('role='), JSON.stringify(state));

console.log('выбор статуса: соседи яркие, панель статуса');
const pick = taskWf.statuses.find((x) => (x.roles ?? []).length);
await run(`document.querySelector('[data-pipeline-status="${pick.key}"] [role=button]').click(); await sleep(900); return true;`);
const statusPanel = await run(`return (document.querySelector('[data-pipeline-status-panel]')?.innerText || '').replace(/\\s+/g, ' ');`);
check('панель статуса: «Кто работает», переходы отсюда и сюда', statusPanel.includes('Кто работает') && statusPanel.includes('Переходы отсюда') && statusPanel.includes('Переходы сюда'), statusPanel.slice(0, 300));
const labels = await run(`return all('[data-pipeline-return-label]').length;`);
const hasReturns = taskWf.transitions.some((t) => t.kind === 'reject' && (t.from_status_id === pick.id || t.to_status_id === pick.id));
check('у выбранного узла подписаны его возвраты', hasReturns ? labels > 0 : labels === 0, String(labels));

console.log('старые адреса не открываются (CLAB-357, решение 0068 §7)');
for (const path of ['/p/SDLC/roles', '/p/SDLC/workflow', '/p/SDLC/roles?role=analyst', '/p/SDLC/workflow?workflow=x', '/p/SDLC/no-such-page', '/no-such-page']) {
  await s.goto(BASE + path);
  await pause(2000);
  const nf = await run(`return {path: location.pathname + location.search, notFound: Boolean(document.querySelector('[data-not-found]')),
    text: texts(), canvas: Boolean(document.querySelector('[data-pipeline-canvas]')),
    link: document.querySelector('[data-not-found] a')?.getAttribute('href') || '',
    shell: Boolean(document.querySelector('[data-sidebar=menu-button]'))};`);
  check(`${path}: «Страница не найдена» в оболочке, адрес на месте`,
    nf.notFound && nf.text.includes('Страница не найдена') && nf.shell && nf.path === path && !nf.canvas, JSON.stringify(nf).slice(0, 300));
  check(`${path}: ссылка на проекты`, nf.link === '/projects', nf.link);
}
await s.goto(BASE + '/p/SDLC/workflow');
await pause(2000);
const menu = await run(`return all('[data-sidebar=menu-button]').map((b) => b.innerText.trim());`);
check('в меню один пункт «Пайплайн», «Роли» и «Цикл» нет',
  menu.filter((x) => x === 'Пайплайн').length === 1 && !menu.includes('Роли') && !menu.includes('Цикл'), JSON.stringify(menu));
for (const path of ['/p/SDLC/roles', '/p/SDLC/workflow']) {
  const r = await fetch(BASE + path, {headers: {Accept: 'text/html'}});
  const html = await r.text();
  check(`${path}: сервер отдаёт index.html`, r.ok && html.includes('<div id="root">'), String(r.status));
}

console.log('состояния страницы (AC-13)');
await s.goto(BASE + '/p/SDLC/pipeline?wf=00000000-0000-0000-0000-000000000000');
await pause(2000);
let t = await run('return texts();');
check('неизвестная версия — «Версии цикла нет» и «Открыть активную версию»', t.includes('Версии цикла нет') && t.includes('Открыть активную версию'), t.slice(0, 300));
await run('await clickExact("Открыть активную версию"); await sleep(1500); return true;');
check('«Открыть активную версию» открывает схему', await run(`return Boolean(document.querySelector('[data-pipeline-canvas]'));`));
await s.goto(BASE + '/p/SDLC/pipeline?type=task&status=no-such&transition=no-such&role=no-such&v=99');
await pause(2000);
t = await run(`return {canvas: Boolean(document.querySelector('[data-pipeline-canvas]')), overview: Boolean(document.querySelector('[data-pipeline-overview]'))};`);
check('неизвестные status, transition, role — как без выбора', t.canvas && t.overview, JSON.stringify(t));

const fake = (pattern, status, message, method = 'GET', delay = 0) => `
  (() => {
    const orig = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if ((init?.method || 'GET').toUpperCase() === '${method}' && ${pattern}.test(url)) {
        if (${delay}) await new Promise((r) => setTimeout(r, ${delay}));
        if (${status}) return new Response(JSON.stringify({error: {code: ${status} === 403 ? 'forbidden' : 'internal', message: ${JSON.stringify(message)}}}), {status: ${status}, headers: {'Content-Type': 'application/json'}});
      }
      return orig(input, init);
    };
  })();`;

let script = await s.addInitScript(fake('/\\/projects\\/SDLC\\/workflows$/', 0, '', 'GET', 2500));
await s.goto(BASE + '/p/SDLC/pipeline');
await pause(300);
check('пока данные грузятся — скелет', await run(`return Boolean(document.querySelector('[data-pipeline-skeleton]'));`));
await s.removeInitScript(script);

script = await s.addInitScript(fake('/\\/projects\\/SDLC\\/workflows$/', 500, 'сервис недоступен'));
await s.goto(BASE + '/p/SDLC/pipeline');
await pause(2000);
t = await run('return texts();');
check('сбой сети — «Пайплайн не загрузился» и «Повторить»', t.includes('Пайплайн не загрузился') && t.includes('сервис недоступен') && t.includes('Повторить'), t.slice(0, 300));
await s.removeInitScript(script);

// Ответ списка версий без циклов эпика: у типа нет активного цикла.
script = await s.addInitScript(`
  (() => {
    const orig = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      const res = await orig(input, init);
      if ((init?.method || 'GET').toUpperCase() === 'GET' && /\\/projects\\/SDLC\\/workflows$/.test(url)) {
        const body = await res.clone().json();
        body.workflows = body.workflows.filter((w) => !w.task_types.includes('epic'));
        return new Response(JSON.stringify(body), {status: 200, headers: {'Content-Type': 'application/json'}});
      }
      return res;
    };
  })();`);
await s.goto(BASE + '/p/SDLC/pipeline?type=epic');
await pause(2000);
t = await run('return texts();');
check('у типа нет цикла — EmptyState с «Пустой черновик» и «Копией цикла task»',
  t.includes('Цикла для типа epic нет') && t.includes('Пустой черновик') && t.includes('Копией цикла task'), t.slice(0, 400));
await s.removeInitScript(script);

script = await s.addInitScript(fake('/\\/projects\\/SDLC\\/workflows$/', 403, 'нужен уровень maintainer', 'POST'));
await s.goto(BASE + '/p/SDLC/pipeline?type=task');
await pause(2000);
await run('await clickExact("Черновик копией этой версии"); await sleep(900); return true;');
t = await run('return texts();');
check('403 виден у действия, кнопка не спрятана',
  t.includes('Черновик не создан') && t.includes('нужен уровень maintainer') && t.includes('Черновик копией этой версии'), t.slice(0, 400));
await s.removeInitScript(script);

console.log('широкий экран (AC-12)');
await s.goto(BASE + '/p/SDLC/pipeline?type=task');
await pause(2000);
const wide = await run(`
  const aside = document.querySelector('aside[data-pipeline-inspector]');
  const scroller = document.querySelector('[data-pipeline-scroller]');
  return {aside: aside ? Math.round(aside.getBoundingClientRect().width) : 0,
    asideScroll: aside ? getComputedStyle(aside).overflowY : '', canvasScroll: scroller ? getComputedStyle(scroller).overflow : '',
    zoom: Boolean(document.querySelector('[aria-label="Масштаб схемы"]')), returns: all('[data-pipeline-edge-kind=return]').length};
`);
check('панель 440 px, холст и панель прокручиваются каждый сам',
  wide.aside === 440 && wide.asideScroll === 'auto' && wide.canvasScroll === 'auto', JSON.stringify(wide));
const len0 = await run('return history.length;');
const zoomed = await run(`
  const btn = (l) => document.querySelector('[aria-label="' + l + '"]');
  const z = () => Number(document.querySelector('[data-pipeline-zoom]').getAttribute('data-pipeline-zoom'));
  for (let i = 0; i < 8; i++) { btn('Крупнее').click(); await sleep(150); }
  const max = z(), maxOff = btn('Крупнее').disabled;
  for (let i = 0; i < 12; i++) { btn('Мельче').click(); await sleep(150); }
  const min = z(), minOff = btn('Мельче').disabled;
  btn('Крупнее').click(); await sleep(200);
  const step = z();
  btn('Вписать в экран').click(); await sleep(300);
  const fit = z();
  btn('Мини-карта').click(); await sleep(300);
  const minimap = Boolean(document.querySelector('[data-pipeline-minimap]'));
  const l = all('label').find((x) => x.innerText.trim().startsWith('Возвраты'));
  document.getElementById(l.getAttribute('for')).click(); await sleep(400);
  return {max, maxOff, min, minOff, step, fit, minimap, returns: all('[data-pipeline-edge-kind=return]').length, q: location.search, len: history.length};
`);
check('масштаб 50–150 % с шагом 10 %', zoomed.max === 150 && zoomed.maxOff && zoomed.min === 50 && zoomed.minOff && zoomed.step === 60, JSON.stringify(zoomed));
check('«Вписать» — не выше 70 %', zoomed.fit <= 70 && zoomed.fit >= 50, String(zoomed.fit));
check('мини-карта по кнопке', zoomed.minimap);
check('«Возвраты» скрывают слой', wide.returns > 0 && zoomed.returns === 0, `${wide.returns} → ${zoomed.returns}`);
const zq = new URLSearchParams(zoomed.q);
check('вид холста — в адресе', zq.get('zoom') === (zoomed.fit / 100).toFixed(1) && zq.get('minimap') === '1' && zq.get('returns') === '0', zoomed.q);
check('вид холста не пишется в историю', zoomed.len === len0, `${len0} → ${zoomed.len}`);

console.log('узкий экран (AC-12)');
await s.resize(390, 844);
await s.goto(BASE + '/p/SDLC/pipeline?type=task');
await pause(2000);
const narrow = await run(`
  return {aside: Boolean(document.querySelector('aside[data-pipeline-inspector]')),
    zoom: Boolean(document.querySelector('[aria-label="Масштаб схемы"]')),
    minimap: Boolean(document.querySelector('[data-pipeline-minimap]')),
    returns: all('label').some((x) => x.innerText.trim().startsWith('Возвраты')),
    nodeW: Math.round(document.querySelector('[data-pipeline-status]').getBoundingClientRect().width)};
`);
check('нет боковой панели, масштаба, мини-карты и «Возвраты»', !narrow.aside && !narrow.zoom && !narrow.minimap && !narrow.returns, JSON.stringify(narrow));
await run(`document.querySelector('[data-pipeline-status="${pick.key}"] [role=button]').click(); await sleep(1200); return true;`);
const sheet = await run(`
  const d = document.querySelector('[role=dialog][data-pipeline-inspector]');
  return d ? {w: Math.round(d.getBoundingClientRect().width), crumbs: (d.querySelector('[data-pipeline-crumbs]')?.innerText || '').trim(),
    back: Boolean(d.querySelector('[aria-label="Назад"]')), close: Boolean(d.querySelector('[aria-label="Закрыть панель"]'))} : null;
`);
check('выбор открывает Sheet на всю ширину с крошками, «←» и «×»',
  sheet && sheet.w >= 385 && sheet.crumbs.includes(pick.name) && sheet.back && sheet.close, JSON.stringify(sheet));
await run(`document.querySelector('[role=dialog] [aria-label="Закрыть панель"]').click(); await sleep(800); return true;`);
check('«×» закрывает Sheet', await run(`return !document.querySelector('[role=dialog][data-pipeline-inspector]') && !location.search.includes('status=');`));

const overviewSheet = await run(`
  await clickExact('Обзор');
  await sleep(900);
  const d = document.querySelector('[role=dialog][data-pipeline-inspector]');
  const r = {open: Boolean(d), overview: Boolean(d?.querySelector('[data-pipeline-overview]')), text: (d?.innerText || '').replace(/\\s+/g, ' ')};
  d?.querySelector('[aria-label="Закрыть панель"]')?.click();
  await sleep(800);
  r.closed = !document.querySelector('[role=dialog][data-pipeline-inspector]');
  return r;
`);
check('на узком экране обзор цикла — по кнопке «Обзор» в Sheet', overviewSheet.open && overviewSheet.overview && overviewSheet.text.includes('Роли на этом цикле') && overviewSheet.closed, JSON.stringify(overviewSheet).slice(0, 300));

console.log('тёмная тема');
await s.resize(1440, 900);
await run(`localStorage.setItem('sdlc.theme', 'dark'); return true;`);
await s.goto(BASE + '/p/SDLC/pipeline?type=task&status=' + pick.key);
await pause(2000);
const dark = await run(`return {dark: document.documentElement.classList.contains('dark'), canvas: Boolean(document.querySelector('[data-pipeline-canvas]'))};`);
check('страница в тёмной теме рисуется', dark.dark && dark.canvas, JSON.stringify(dark));
if (process.env.SDLC_E2E_SHOTS) {
  const {writeFileSync} = await import('node:fs');
  writeFileSync(`${process.env.SDLC_E2E_SHOTS}/pipeline-dark.png`, Buffer.from(await s.screenshot(), 'base64'));
}
await run(`localStorage.removeItem('sdlc.theme'); return true;`);

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
