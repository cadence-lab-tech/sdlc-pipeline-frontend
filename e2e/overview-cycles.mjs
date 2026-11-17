// «Обзор» на двух своих циклах (CLAB-488) в браузере поверх живого бэкенда.
// Ни один цикл не копирует наш: «Короткий» — один тип item, todo → doing →
// closed, ролей нет; «Длинный» — типы feature и defect на одном цикле с
// необязательным этапом, статусом без роли категории waiting с длинным
// именем, апрувом человека и возвратами, тип initiative на своём цикле
// (родитель с детьми) и задача на статусе прежней версии цикла.
//
// Проверяется: блоки по правилу «одна задача — один блок» (число строк равно
// total незавершённых сервера), «Можно брать сейчас» в порядке бэклога и с
// детьми родителя «в работе», группы «Что делается сейчас» по статусам,
// «Требуют решения» и «Заблокировано» с причиной и «кто и что», «Сводка»
// против total сервера, переход по счётчику на страницу «Задачи» и назад,
// незнакомый код причины, пустой проект, 390 px, тёмная тема, слова чужой
// настройки на экране. Свои проекты, демонстрационный не трогается; проекты
// в конце удаляются. SDLC_E2E_SHOTS=<каталог> — снимки.
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
const call = async (method, path, body, actor = 'e2e') => {
  const res = await fetch(`${API}/v1${path}`, {
    method, headers: {'Content-Type': 'application/json', 'X-SDLC-Actor': actor}, body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(json)}`);
  return json;
};
const sfx = Date.now().toString(36).slice(-4);
const rnd = () => Math.floor(Math.random() * 9000 + 1000);

// ── «Короткий» ──────────────────────────────────────────────────────────────
const SK = `SH${rnd()}`;
await call('POST', '/projects', {key: SK, name: `Короткий ${SK}`});
for (const w of (await call('POST', `/projects/${SK}/import`, {
  version: 3,
  workflows: [{
    name: 'Короткий',
    task_types: ['item'],
    statuses: [
      {key: 'todo', name: 'Новая', category: 'backlog', is_initial: true},
      {key: 'doing', name: 'Делаем', category: 'active'},
      {key: 'closed', name: 'Закрыта', category: 'done', is_terminal: true},
    ],
    transitions: [
      {key: 'go', name: 'Взять', from: 'todo', to: 'doing', kind: 'advance'},
      {key: 'close', name: 'Закрыть', from: 'doing', to: 'closed', kind: 'advance'},
    ],
  }],
})).workflows) if (w.state !== 'active') await call('POST', `/workflows/${w.id}/activate`, {});
const sNew = async (title) => (await call('POST', `/projects/${SK}/tasks`, {title, type: 'item'})).key;
const a1 = await sNew('Разобрать входящие заявки');
const a2 = await sNew('Обновить шаблон отчёта');
const a3 = await sNew('Выгрузка после разбора');
const b1 = await sNew('Починить выгрузку в CSV');
const b2 = await sNew('Ответить клиенту');
const c1 = await sNew('Закрытая задача');
await call('POST', `/tasks/${a1}/links`, {task: a3, rel: 'blocks'});
for (const k of [b1, b2, c1]) await call('POST', `/tasks/${k}/transitions/go`, {});
await call('POST', `/tasks/${c1}/transitions/close`, {});

// ── «Длинный» ───────────────────────────────────────────────────────────────
const LK = `LG${rnd()}`;
const ENG = `eng-${sfx}`;
const SEN = `senior-${sfx}`;
await call('POST', '/projects', {key: LK, name: `Длинный ${LK}`});
const roleDef = (key, name) => ({key, name, documents: [{name: 'main.md', kind: 'instructions', content: 'Работать.'}],
  output_contract: [{kind: 'work.result', title: 'Результат', format: 'markdown', required: false}]});
const delivery = (withUx) => ({
  name: 'Delivery',
  task_types: ['feature', 'defect'],
  statuses: [
    {key: 'intake', name: 'Intake', category: 'backlog', is_initial: true, color: '#9ca3af'},
    {key: 'discovery', name: 'Discovery & sizing', category: 'active', role: ENG},
    ...(withUx ? [{key: 'ux', name: 'UX exploration', category: 'active', is_optional: true}] : []),
    {key: 'signoff', name: 'Waiting for customer sign-off on scope and budget', category: 'waiting'},
    {key: 'build', name: 'Build', category: 'active', role: ENG, color: '#3b82f6'},
    {key: 'peer', name: 'Peer review', category: 'active', role: ENG},
    {key: 'shipped', name: 'Shipped', category: 'done', is_terminal: true},
    {key: 'wontdo', name: "Won't do", category: 'cancelled', is_terminal: true},
  ],
  transitions: [
    {key: 'start', name: 'Start', from: 'intake', to: 'discovery', kind: 'advance'},
    {key: 'sized', name: 'Sized', from: 'discovery', to: withUx ? 'ux' : 'signoff', kind: 'advance'},
    ...(withUx ? [{key: 'ux_done', name: 'UX done', from: 'ux', to: 'signoff', kind: 'advance'}] : []),
    {key: 'signed', name: 'Signed', from: 'signoff', to: 'build', kind: 'advance'},
    {key: 'built', name: 'Ship', from: 'build', to: 'peer', kind: 'advance',
      gates: [{key: 'release_ok', name: 'Release approval', type: 'human_approval', blocking: true}]},
    {key: 'reviewed', name: 'Reviewed', from: 'peer', to: 'shipped', kind: 'advance'},
    {key: 'rework', name: 'Rework', from: 'peer', to: 'build', kind: 'reject'},
    {key: 'resize', name: 'Resize', from: 'build', to: 'discovery', kind: 'reject'},
    {key: 'drop', name: 'Drop', to: 'wontdo', kind: 'cancel'},
  ],
});
const initiatives = {
  name: 'Initiatives',
  task_types: ['initiative'],
  statuses: [
    {key: 'proposed', name: 'Proposed', category: 'backlog', is_initial: true},
    {key: 'running', name: 'Running', category: 'active'},
    {key: 'closed', name: 'Closed', category: 'done', is_terminal: true},
  ],
  transitions: [
    {key: 'launch', name: 'Launch', from: 'proposed', to: 'running', kind: 'advance'},
    {key: 'finish', name: 'Finish', from: 'running', to: 'closed', kind: 'advance'},
  ],
};
for (const w of (await call('POST', `/projects/${LK}/import`, {version: 3, roles: [roleDef(ENG, 'Engineer'), roleDef(SEN, 'Senior engineer')],
  workflows: [delivery(true), initiatives]})).workflows) if (w.state !== 'active') await call('POST', `/workflows/${w.id}/activate`, {});
const lNew = async (title, extra = {}) => (await call('POST', `/projects/${LK}/tasks`, {title, ...extra})).key;
const go = async (key, ...ts) => { for (const t of ts) await call('POST', `/tasks/${key}/transitions/${t}`, {}); };
// Задача на статусе, которого в следующей версии цикла не будет: новая версия
// без «UX exploration» активируется сразу, остальные задачи — уже на ней.
const F10 = await lNew('Old flow on retired stage', {type: 'feature'});
await go(F10, 'start', 'sized');
for (const w of (await call('POST', `/projects/${LK}/import`, {version: 3, workflows: [delivery(false)]})).workflows) {
  if (w.state !== 'active') await call('POST', `/workflows/${w.id}/activate`, {});
}
const F1 = await lNew('Audit log export to S3', {type: 'feature', priority: 'high'});
const D1 = await lNew('Retry storm on connector restart', {type: 'defect'});
const F3 = await lNew('Ingestion: backpressure metrics', {type: 'feature'});
const F4 = await lNew('Data residency for EU tenants', {type: 'feature'});
const F5 = await lNew('Export pipeline: retry policy for partial batches', {type: 'feature'});
const F6 = await lNew('Lineage view for derived tables', {type: 'feature'});
const D2 = await lNew('Wrong totals on the usage page', {type: 'defect'});
const F7 = await lNew('Backfill job ignores source timezone', {type: 'feature'});
const I1 = await lNew('Unified billing', {type: 'initiative'});
const F8 = await lNew('Invoice preview API', {type: 'feature', parent_key: I1});
const F9 = await lNew('Tax rules per region', {type: 'feature', parent_key: I1});
const F11 = await lNew('Shipped already', {type: 'feature'});
await go(F3, 'start');
await go(F4, 'start', 'sized');
await go(F5, 'start', 'sized', 'signed');
await go(F6, 'start');
await call('POST', `/tasks/${F6}/claim`, {role: ENG}, 'agent:runner-a');
await go(D2, 'start');
await call('POST', `/tasks/${D2}/claim`, {role: ENG}, 'agent:runner-b');
await go(F7, 'start', 'sized', 'signed');
await call('POST', `/tasks/${F7}/transitions/built/gates/release_ok/decision`, {status: 'failed', details: {reason: 'нет теста на летнее время'}});
await go(F9, 'start');
await go(F11, 'start', 'sized', 'signed');
await call('POST', `/tasks/${F11}/transitions/built/gates/release_ok/decision`, {status: 'passed'});
await go(F11, 'built', 'reviewed');
console.log(`проекты сценария: ${SK} ${LK}`);

// ── браузер ─────────────────────────────────────────────────────────────────
const s = await session(BASE + '/projects');
await sleep(1500);
await s.resize(1440, 1000);
await s.addInitScript(`
  window.__log = [];
  const prev = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/v1/')) window.__log.push(url);
    const res = await prev(input, init);
    const cfg = JSON.parse(sessionStorage.getItem('e2e.cycles') || '{}');
    if (cfg.foo && url.includes('attention_except') && url.includes('in_work=true')) {
      const body = await res.clone().json();
      for (const t of body.tasks || []) t.attention = [{code: 'foo_bar', since: null}];
      return new Response(JSON.stringify(body), {status: 200, headers: {'Content-Type': 'application/json'}});
    }
    if (cfg.summaryDown && /[?&]limit=1(&|$)/.test(url) && !url.includes('attention')) {
      return new Response(JSON.stringify({error: {code: 'internal', message: 'сбой сводки'}}), {status: 500, headers: {'Content-Type': 'application/json'}});
    }
    return res;
  };
`);
const run = (body) => s.evaluate(helpers + `
  const zoneKeys = (z) => all('section[data-zone="' + z + '"] [data-task-key]').map((r) => r.getAttribute('data-task-key'));
  const zoneText = (z) => (document.querySelector('section[data-zone="' + z + '"]')?.innerText || '').replace(/\\s+/g, ' ');
` + body);
const cfg = (c) => s.evaluate(`sessionStorage.setItem('e2e.cycles', ${JSON.stringify(JSON.stringify(c))}); return 1;`);
const shot = async (name) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, {recursive: true});
  writeFileSync(`${SHOTS}/overview-${name}.png`, Buffer.from(await s.screenshot(), 'base64'));
};
const open = async (pk, query = '') => {
  await s.goto(`${BASE}/p/${pk}/overview${query}`);
  await run(`for (let i = 0; i < 60 && (document.querySelector('[data-zone-skeleton]') || !document.querySelector('[data-summary], [data-overview] [role=alert], [data-overview] .border-dashed')); i++) await sleep(150); await sleep(1200); return 1;`);
};
const total = async (pk, q) => (await call('GET', `/projects/${pk}/tasks?${q}&limit=1`)).total;
const BAD = /эпик|аналитик|нарезк|агент возьм|(?-i:Без роли)/i;
// «Без роли» хвостом дорожки — с заглавной; «этап без роли» — подпись понятия сервиса.
await cfg({});
await run(`localStorage.setItem('sdlc.theme', 'light'); return 1;`);

// ── «Короткий» ──────────────────────────────────────────────────────────────
console.log('«Короткий»');
await open(SK);
let page = await run(`return {
  zones: all('section[data-zone]').map((z) => z.getAttribute('data-zone')),
  parent: Boolean(document.querySelector('[data-filter-parent]')),
  type: Boolean(document.querySelector('[data-filter-type]')),
  groups: all('[data-work-group]').map((g) => ({id: g.getAttribute('data-work-group'), text: g.innerText.replace(/\\s+/g, ' ')})),
  work: zoneKeys('work'), ready: zoneKeys('ready'), blocked: zoneKeys('blocked'), decisions: zoneKeys('decisions'),
  free: all('[data-ready-group="unstarted"] [data-task-key]').map((r) => r.getAttribute('data-task-key')),
  waiting: all('[data-ready-group="waiting"] [data-task-key]').map((r) => r.getAttribute('data-task-key')),
  text: document.querySelector('[data-overview]').innerText,
};`);
check('блоки по design.spec', page.zones.join() === 'summary,decisions,blocked,work,ready,done', page.zones.join());
check('AC-2: фильтров родителя и типа нет', !page.parent && !page.type);
check('AC-13: «Делаем» — одна группа по статусу, «этап без роли исполнителя — ведут люди»', page.groups.length === 1 && page.groups[0].id === 'item:doing' &&
  page.groups[0].text.includes('Делаем') && page.groups[0].text.includes('этап без роли исполнителя — ведут люди'), JSON.stringify(page.groups));
check('AC-6: задачи на этапе без роли — в «Что делается», не в «Можно брать»', [b1, b2].every((k) => page.work.includes(k) && !page.ready.includes(k)));
check('AC-3: неначатые свободные по порядку бэклога', page.free.join() === [a1, a2].join(), page.free.join());
check('AC-4: ждущая блокирующую — подсписком, вне счётчика', page.waiting.join() === a3);
const nonTerminalS = await total(SK, 'terminal=false');
const shownS = [...page.work, ...page.ready, ...page.blocked, ...page.decisions];
check('AC-17: каждая незавершённая — ровно в одном блоке', shownS.length === nonTerminalS && new Set(shownS).size === shownS.length, `${shownS.length} ≠ ${nonTerminalS}`);
check('AC-1, AC-2: на экране нет слов чужой настройки', !BAD.test(page.text), (page.text.match(BAD) || [''])[0]);
const sum = await run(`return {
  chips: all('[data-summary-count="status"]').map((a) => [a.getAttribute('data-summary-status'), a.innerText.replace(/\\s+/g, ' ')]),
  cats: Boolean(document.querySelector('[data-summary-categories]')),
  total: document.querySelector('section[data-zone="summary"] [data-zone-count]')?.innerText,
};`);
const truthS = {todo: await total(SK, 'type=item&status=todo'), doing: await total(SK, 'type=item&status=doing'), closed: await total(SK, 'type=item&status=closed')};
check('AC-8: чипы — все статусы версии в порядке, числа = total сервера', sum.chips.map(([k]) => k).join() === 'todo,doing,closed' &&
  sum.chips.every(([k, t]) => t.endsWith(' ' + truthS[k])), JSON.stringify(sum.chips));
check('AC-8: без пустого разреза по категориям на коротком цикле', sum.cats === false);
check('AC-9: итог сводки = total проекта', sum.total === String(await total(SK, '')), sum.total);
await shot('short-1440-light');

console.log('страница «Задачи» по счётчику');
await run(`document.querySelector('[data-summary-status="doing"]').click(); await sleep(1800); return 1;`);
let list = await run(`return {path: location.pathname + location.search, keys: all('[data-task-list] [data-task-key]').map((r) => r.getAttribute('data-task-key')),
  total: document.querySelector('[data-task-list-total]')?.innerText, sel: document.querySelector('[data-task-list-selection]')?.innerText.replace(/\\s+/g, ' ')};`);
check('AC-10: отбор в адресе', list.path === `/p/${SK}/tasks?type=item&status=doing`, list.path);
check('AC-10: строк столько же, сколько на счётчике', list.keys.length === truthS.doing && list.total.startsWith(String(truthS.doing)), JSON.stringify(list));
check('токены отбора: тип и имя статуса из версии', list.sel.includes('Тип: item') && list.sel.includes('Статус: Делаем'), list.sel);
await s.goto(`${BASE}/p/${SK}/tasks?type=item&status=doing`);
await sleep(1800);
check('AC-10: ссылка в новой вкладке — тот же результат', (await run(`return all('[data-task-list] [data-task-key]').length;`)) === truthS.doing);
await s.goto(`${BASE}/p/${SK}/tasks?status=doing`);
await sleep(1200);
check('без типа — «Отбор не задан»', (await run(`return document.body.innerText.includes('Отбор не задан');`)) === true);
await open(SK, '?q=выгруз');
await run(`document.querySelector('[data-summary-count="type"]').click(); await sleep(1500); history.back(); await sleep(2000); return 1;`);
check('AC-10: «Назад» — «Обзор» с прежними фильтрами', (await run(`return location.pathname + location.search;`)) === `/p/${SK}/overview?q=${encodeURIComponent('выгруз')}`);

console.log('390 px и тёмная тема');
await s.resize(390, 844);
await open(SK);
let narrow = await run(`return {button: document.querySelector('[data-next-button] [aria-label]')?.getAttribute('aria-label'),
  hscroll: document.documentElement.scrollWidth > window.innerWidth + 1, column: Boolean(document.querySelector('[data-next-column]'))};`);
check('AC-19: 390 px — «Дальше» с счётчиком «можно брать», без колонки и прокрутки', narrow.button === 'можно брать: 2' && !narrow.hscroll && !narrow.column, JSON.stringify(narrow));
await run(`localStorage.setItem('sdlc.theme', 'dark'); return 1;`);
await open(SK);
await shot('short-390-dark');
await run(`document.querySelector('[data-next-button]').click(); await sleep(800); return 1;`);
check('панель «Дальше» — «Можно брать сейчас»', (await run(`return Boolean(document.querySelector('[data-next-sheet] section[data-zone="ready"]'));`)) === true);
await shot('short-390-dark-sheet');
await run(`localStorage.setItem('sdlc.theme', 'light'); return 1;`);
await s.resize(1440, 1000);

// ── «Длинный» ───────────────────────────────────────────────────────────────
console.log('«Длинный»');
await open(LK);
await sleep(1500);
await open(LK);
page = await run(`return {
  parent: Boolean(document.querySelector('[data-filter-parent]')),
  type: Boolean(document.querySelector('[data-filter-type]')),
  groups: all('[data-work-group]').map((g) => ({id: g.getAttribute('data-work-group'), text: g.innerText.replace(/\\s+/g, ' ')})),
  work: zoneKeys('work'), ready: zoneKeys('ready'), blocked: zoneKeys('blocked'), decisions: zoneKeys('decisions'),
  stages: all('[data-ready-group="stages"] [data-task-key]').map((r) => r.getAttribute('data-task-key')),
  free: all('[data-ready-group="unstarted"] [data-task-key]').map((r) => ({k: r.getAttribute('data-task-key'), note: r.querySelector('[data-row-note]')?.innerText || ''})),
  decisionsText: zoneText('decisions'), blockedText: zoneText('blocked'),
  text: document.querySelector('[data-overview]').innerText,
};`);
check('фильтры типа и родителя есть (типов больше одного, есть задача с детьми)', page.type && page.parent);
const ids = page.groups.map((g) => g.id);
check('AC-14: «Discovery & sizing» у feature и defect — две группы, тип в заголовке', ids.includes('feature:discovery') && ids.includes('defect:discovery') &&
  page.groups.find((g) => g.id === 'defect:discovery').text.includes('· defect'), ids.join());
const signoff = page.groups.find((g) => g.id === 'feature:signoff');
check('AC-13: статус без роли категории waiting — обычная группа', signoff && signoff.text.includes('Waiting for customer sign-off') && signoff.text.includes('этап без роли исполнителя'), JSON.stringify(signoff));
const old = page.groups.find((g) => g.id === 'feature:ux');
check('прежняя версия: группа статуса, которого нет в действующей, с пометкой', old && old.text.includes('прежняя версия цикла'), ids.join());
check('пометка прежней версии — только у задачи на ней', page.groups.filter((g) => g.id !== 'feature:ux').every((g) => !g.text.includes('прежняя версия цикла')));
check('AC-14: исполнитель живой аренды на строке', page.groups.find((g) => g.id === 'defect:discovery').text.includes('runner-b'));
check('AC-15: «Требуют решения» — тип гейта, имя гейта и перехода, куда ведёт, «Решаете вы»', page.decisions.includes(F5) &&
  page.decisionsText.includes('Апрув человеком «Release approval» · «Ship» → Peer review') && page.decisionsText.includes('Решаете вы'), page.decisionsText.slice(0, 400));
check('AC-16: отклонённый гейт — причина и «Переделывает Engineer»', page.blocked.includes(F7) &&
  page.blockedText.includes('«Release approval» отклонён: нет теста на летнее время') && page.blockedText.includes('Переделывает Engineer'), page.blockedText.slice(0, 400));
check('AC-5: этапы без исполнителя — в «Можно брать»', [F3, F9].every((k) => page.stages.includes(k)), page.stages.join());
const free = page.free.map((x) => x.k);
check('AC-3: родитель «в работе» отдаёт место детям — «↳ внутри KEY»', free.includes(F8) && !free.includes(I1) &&
  page.free.find((x) => x.k === F8).note.includes(`внутри ${I1} — она уже в работе`), JSON.stringify(page.free));
check('AC-3: порядок верхнего уровня — бэклог сервера', free.indexOf(F1) < free.indexOf(D1) && free.indexOf(D1) < free.indexOf(F8), free.join());
const nonTerminalL = await total(LK, 'terminal=false');
const shownL = [...page.work, ...page.ready, ...page.blocked, ...page.decisions];
check('AC-17: каждая незавершённая — ровно в одном блоке', shownL.length === nonTerminalL && new Set(shownL).size === shownL.length, `${shownL.length} ≠ ${nonTerminalL}: ${shownL.join()}`);
check('AC-1: на экране нет слов чужой настройки', !BAD.test(page.text), (page.text.match(BAD) || [''])[0]);

console.log('«Сводка» «Длинного»');
const sumL = await run(`return all('[data-summary-type]').map((g) => ({type: g.getAttribute('data-summary-type'),
  chips: Array.from(g.querySelectorAll('[data-summary-count="status"]')).map((a) => [a.getAttribute('data-summary-status'), Number(a.innerText.trim().split(/\\s+/).pop())]),
  old: g.querySelector('[data-summary-count="old-open"]')?.innerText.replace(/\\s+/g, ' ') || '',
  role: g.getAttribute('role'), tabs: Array.from(g.querySelectorAll('[data-roving]')).filter((a) => a.tabIndex === 0).length}));`);
// Сервер объявляет тип по умолчанию в перечне type всегда; без цикла и без
// задач он в сводке не рисуется.
check('строки — типы проекта из данных, тип без цикла и без задач скрыт', sumL.map((t) => t.type).join() === 'feature,defect,initiative', sumL.map((t) => t.type).join());
const feat = sumL.find((t) => t.type === 'feature');
let match = true;
for (const [k, n] of feat.chips) if (n !== await total(LK, `type=feature&status=${k}`)) match = false;
check('AC-8: числа статусов = total сервера', match, JSON.stringify(feat.chips));
const featTotal = await total(LK, 'type=feature');
const featOld = Number((feat.old.match(/(\d+)\s*$/) || [0, 0])[1]);
check('AC-9: задача на статусе прежней версии учтена — сумма счётчиков = total типа', featOld === 1 &&
  feat.chips.reduce((n, [, c]) => n + c, 0) + featOld === featTotal, `${feat.old} / ${featTotal}`);
check('§7: строка типа — группа с одним шагом Tab', feat.role === 'group' && feat.tabs === 1);
const detail = await call('GET', `/projects/${LK}`);
const allTypes = new Set([...detail.active_workflows.flatMap((w) => w.task_types), ...(detail.task_property_defs.find((d) => d.key === 'type')?.enum_values ?? [])]);
let statusCount = 0;
for (const w of detail.active_workflows) statusCount += (await call('GET', `/workflows/${w.id}`)).statuses.length * w.task_types.length;
const plan = await run(`return window.__log.filter((u) => /[?&]limit=1(&|$)/.test(u) && !u.includes('attention')).length;`);
check('AC-12: запросов сводки не больше Σ статусов + 2·типов + 1', plan <= statusCount + 2 * allTypes.size + 1, `${plan} > ${statusCount} + 2·${allTypes.size} + 1`);

console.log('незнакомый код, ошибка сводки, родитель');
await cfg({foo: true});
await open(LK);
const foo = await run(`return zoneText('blocked');`);
check('AC-16: код foo_bar — «Причина: foo_bar», задача видна', foo.includes('Причина: foo_bar') && foo.includes('Откройте задачу — подробности причины в карточке'), foo.slice(0, 300));
await cfg({summaryDown: true});
await open(LK);
const down = await run(`return {summary: zoneText('summary'), work: zoneKeys('work').length};`);
check('AC-20: ошибка сводки не роняет блоки', down.summary.includes('Не получилось загрузить «Сводка»') && down.work > 0, JSON.stringify(down).slice(0, 300));
await cfg({});
await open(LK, `?parent=${I1}`);
const inside = await run(`return {strip: (document.querySelector('[data-parent-strip]')?.innerText || '').replace(/\\s+/g, ' '),
  head: (document.querySelector('[data-ready-group="unstarted"]')?.innerText || '').split('\\n')[0],
  free: all('[data-ready-group="unstarted"] [data-task-key]').map((r) => r.getAttribute('data-task-key'))};`);
check('полоса «Внутри задачи» и «Неначатые внутри задачи»', inside.strip.startsWith('Внутри задачи') && inside.strip.includes(I1) && inside.head.startsWith('Неначатые внутри задачи') &&
  inside.free.join() === F8, JSON.stringify(inside));
await shot('long-parent-1440-light');
await open(LK);
await shot('long-1440-light');
await run(`localStorage.setItem('sdlc.theme', 'dark'); return 1;`);
await open(LK);
await shot('long-1440-dark');
await s.resize(390, 844);
await open(LK);
await shot('long-390-dark');
check('390 px «Длинный»: без горизонтальной прокрутки', (await run(`return document.documentElement.scrollWidth <= window.innerWidth + 1;`)) === true);
await run(`localStorage.setItem('sdlc.theme', 'light'); return 1;`);
await s.resize(1440, 1000);

console.log('пустой проект');
const EK = `EM${rnd()}`;
await call('POST', '/projects', {key: EK, name: `Пустой ${EK}`});
await s.goto(`${BASE}/p/${EK}/overview`);
await sleep(3500);
const empty = await run(`return document.querySelector('[data-overview]').innerText.replace(/\\s+/g, ' ');`);
check('AC-20: пустой проект — без обещаний про агента и роль', empty.includes('В проекте пока нет задач') && empty.includes('этапы без роли ведут участники проекта') && !BAD.test(empty), empty.slice(0, 300));
await shot('empty-1440-light');

for (const pk of [SK, LK, EK]) await call('DELETE', `/projects/${pk}`).catch((e) => console.log('удаление', pk, e.message));
s.close();
console.log(`\n${ok} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
