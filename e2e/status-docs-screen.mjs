// Отбор документов роли на статусе — экран (CLAB-348, AC-348.13–.15): поле
// «Документы роли на этом этапе» в диалоге статуса черновика и счётчик
// «Документов N» со строкой «Отбор: …» в панели статуса.
//
// Сценарий заводит свой проект: две роли (исполнитель из трёх документов,
// проверяющий из двух) и цикл импортом связки формата 3 — демонстрационный SDLC
// не трогает и повторяется на той же базе. Тело PUT …/roles перехватывается,
// запрос уходит настоящий; сохранённое сверяется с GET версии цикла.
// Медленная загрузка и сбой версии роли подменяются в браузере флагами
// sessionStorage (e2e.slowRoles, e2e.failRole): стенд их не даёт. Правила без
// браузера — status-docs.mjs.
//
// SDLC_E2E_SHOTS=<каталог> — снимки панели и диалога в светлой и тёмной теме и
// на 390 px.
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
const call = async (method, path, body) => {
  const res = await fetch(API + '/v1' + path, {
    method,
    headers: {'X-SDLC-Actor': 'e2e', 'Content-Type': 'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {code: res.status, body: await res.json().catch(() => null)};
};
const must = (r, what) => {
  if (r.code >= 300) throw new Error(`${what}: ${r.code} ${JSON.stringify(r.body)}`);
  return r.body;
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (s, name) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, {recursive: true});
  writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(await s.screenshot(), 'base64'));
};

// ── данные ──────────────────────────────────────────────────────────────────
const mark = Date.now().toString(36).slice(-5);
const PK = `SD${Math.floor(Math.random() * 9000 + 1000)}`;
const DOER = `sd-doer-${mark}`;
const CHECKER = `sd-check-${mark}`;
must(await call('POST', '/projects', {key: PK, name: `Отбор документов ${PK}`}), 'проект');
const doc = (name, content) => ({name, kind: 'instructions', content});
const imported = must(await call('POST', `/projects/${PK}/import`, {
  version: 3,
  roles: [
    {key: DOER, name: 'Исполнитель отбора', documents: [doc('main.md', 'Правила.'), doc('git.md', 'Ветки.'), doc('release.md', 'Выпуск.')],
      output_contract: [{kind: 'work.result', title: 'Результат', format: 'markdown', required: true}]},
    {key: CHECKER, name: 'Проверяющий отбора', documents: [doc('main.md', 'Проверка.'), doc('list.md', 'Чек-лист.')],
      output_contract: [{kind: 'check.result', title: 'Проверка', format: 'markdown', required: true}]},
  ],
  workflows: [{
    name: 'Отбор',
    task_types: ['task'],
    statuses: [
      {key: 'new', name: 'Новая', category: 'backlog', is_initial: true},
      {key: 'work', name: 'Работа', category: 'active', role: DOER, reviewers: [CHECKER]},
      {key: 'done', name: 'Готово', category: 'done', is_terminal: true},
    ],
    transitions: [
      {key: 'start', name: 'Начать', from: 'new', to: 'work', kind: 'advance'},
      {key: 'finish', name: 'Закончить', from: 'work', to: 'done', kind: 'advance'},
    ],
  }],
}), 'импорт связки');
const WF = imported.workflows[0].id;
const statusRoles = async () => {
  const wf = must(await call('GET', `/workflows/${WF}`), 'версия цикла');
  const st = wf.statuses.find((x) => x.key === 'work');
  return Object.fromEntries((st.roles ?? []).map((r) => [r.role_key, r.document_names ?? null]));
};
console.log(`проект сценария ${PK}, черновик ${WF}`);

// ── браузер ─────────────────────────────────────────────────────────────────
const SCRIPT = `
  const realFetch = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init && init.method) || 'GET';
    const ss = (k) => sessionStorage.getItem(k);
    const role = method === 'GET' ? (url.match(/\\/projects\\/[^/]+\\/roles\\/([^/?]+)$/) || [])[1] : undefined;
    if (role && ss('e2e.slowRoles')) await new Promise((r) => setTimeout(r, 2500));
    if (role && ss('e2e.failRole') === role) {
      return new Response(JSON.stringify({error: {code: 'internal', message: 'сбой роли (e2e)'}}), {status: 500, headers: {'Content-Type': 'application/json'}});
    }
    return realFetch(input, init);
  };
`;
const PAGE = `${BASE}/p/${PK}/pipeline?wf=${WF}&status=work`;
const s = await session(PAGE);
await s.addInitScript(SCRIPT);
// Тема — явно: «системная» в headless-Chrome следует за машиной.
await s.evaluate(`localStorage.setItem('sdlc.theme', 'light'); return true;`);
await s.resize(1440, 900);
await s.goto(PAGE);
await pause(1500);

const pipe = `
  const waitFor = async (sel, n = 50) => {
    for (let i = 0; i < n && !document.querySelector(sel); i++) await sleep(100);
    return document.querySelector(sel);
  };
  const panel = () => document.querySelector('[data-pipeline-inspector]');
  const text = (el) => (el?.innerText || '').replace(/\\s+/g, ' ').trim();
  const count = (k) => text(document.querySelector('[data-status-docs-count="' + k + '"]'));
  const line = (k) => text(document.querySelector('[data-status-docs-selection="' + k + '"]'));
  const dialog = () => document.querySelector('[role=dialog]');
  const field = (k) => dialog()?.querySelector('[data-status-docs="' + k + '"]');
  const mode = async (k, m) => {
    const b = field(k).querySelector('[data-status-docs-option="' + m + '"]');
    b.click();
    await sleep(300);
  };
  const tick = async (k, name) => {
    field(k).querySelector('[data-status-doc="' + name + '"] button').click();
    await sleep(250);
  };
  const ticked = (k) => Array.from(field(k).querySelectorAll('[data-status-doc]')).map((li) =>
    li.getAttribute('data-status-doc') + (li.querySelector('button').getAttribute('data-state') === 'checked' ? '+' : '-') +
    (li.hasAttribute('data-status-doc-missing') ? '!' : ''));
  const saveBtn = () => Array.from(dialog().querySelectorAll('button')).find((b) => (b.innerText || '').trim() === 'Сохранить');
  const openEdit = async () => {
    const b = Array.from(panel().querySelectorAll('button')).find((x) => (x.innerText || '').trim() === 'Править статус');
    b.click();
    await waitFor('[role=dialog] [data-status-docs]');
    await sleep(600);
  };
  const spy = () => {
    window.__puts = [];
    if (!window.__spied) {
      const orig = window.fetch;
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input.url;
        if ((init?.method || '').toUpperCase() === 'PUT' && /\\/roles$/.test(url)) window.__puts.push(JSON.parse(init.body));
        return orig(input, init);
      };
      window.__spied = true;
    }
  };
  const save = async () => { saveBtn().click(); await sleep(1800); };
`;
const run = (body) => s.evaluate(helpers + pipe + body);

// ── панель без отбора ───────────────────────────────────────────────────────
console.log('панель статуса без отбора (AC-348.14)');
let r = await run(`await waitFor('[data-status-docs-count]'); await sleep(400);
  return {doer: count('${DOER}'), checker: count('${CHECKER}'), lines: document.querySelectorAll('[data-status-docs-selection]').length};`);
check('исполнитель — «Документов 3»', r.doer.includes('Документов 3'), r.doer);
check('проверяющий — «Документов 2»', r.checker.includes('Документов 2'), r.checker);
check('без отбора строки «Отбор» нет', r.lines === 0, String(r.lines));

console.log('загрузка и сбой версии роли (AC-348.15)');
await run(`sessionStorage.setItem('e2e.slowRoles', '1'); return true;`);
await s.goto(PAGE);
r = await run(`await waitFor('[data-pipeline-status-panel]'); await sleep(300);
  return {panel: Boolean(document.querySelector('[data-pipeline-status-panel]')), counters: document.querySelectorAll('[data-status-docs-count]').length, txt: text(panel())};`);
check('пока версии грузятся, счётчика нет', r.panel && r.counters === 0 && !r.txt.includes('Документов 0'), r.txt.slice(0, 200));
await pause(3200);
r = await run(`return document.querySelectorAll('[data-status-docs-count]').length;`);
check('после загрузки счётчики появились', r === 2, String(r));
await run(`sessionStorage.removeItem('e2e.slowRoles'); sessionStorage.setItem('e2e.failRole', '${DOER}'); return true;`);
await s.goto(PAGE);
await pause(1200);
r = await run(`return {doer: count('${DOER}'), checker: count('${CHECKER}'), panel: Boolean(document.querySelector('[data-pipeline-status-panel]'))};`);
check('сбой версии одной роли не ломает панель и чужой счётчик', r.panel && r.doer === '' && r.checker.includes('Документов 2'), JSON.stringify(r));
r = await run(`await openEdit(); await mode('${DOER}', 'picked');
  return {err: text(field('${DOER}').querySelector('[data-status-docs-error]')), open: Boolean(dialog())};`);
check('правка статуса открывается, поле говорит о сбое', r.open && r.err.includes('сбой роли (e2e)'), JSON.stringify(r));
await run(`Array.from(dialog().querySelectorAll('button')).find((b) => (b.innerText || '').trim() === 'Отмена').click(); await sleep(500);
  sessionStorage.removeItem('e2e.failRole'); return true;`);
await s.goto(PAGE);
await pause(1200);
await run(`await waitFor('[data-status-docs-count]'); return true;`);
await shot(s, 'status-docs-panel-none');

// ── диалог: отбор у исполнителя ─────────────────────────────────────────────
console.log('поле в диалоге статуса (AC-348.13)');
r = await run(`spy(); await openEdit();
  return {doer: field('${DOER}')?.getAttribute('data-status-docs-mode'), checker: field('${CHECKER}')?.getAttribute('data-status-docs-mode'),
    label: text(field('${DOER}')).includes('Документы роли на этом этапе')};`);
check('у исполнителя и проверяющего поле, по умолчанию «Все»', r.doer === 'all' && r.checker === 'all' && r.label, JSON.stringify(r));
r = await run(`await mode('${DOER}', 'picked'); return {list: ticked('${DOER}'), save: saveBtn().disabled, hint: text(field('${DOER}').querySelector('[data-status-docs-empty]'))};`);
check('«Выбранные» перечисляют документы версии по порядку', r.list.join() === 'main.md-,git.md-,release.md-', r.list.join());
check('«Выбранные» без отметок блокируют «Сохранить»', r.save === true && r.hint.includes('Отметьте'), JSON.stringify(r));
r = await run(`await tick('${DOER}', 'release.md'); await tick('${DOER}', 'main.md'); return {list: ticked('${DOER}'), save: saveBtn().disabled};`);
check('отмеченные видны, «Сохранить» доступна', r.list.join() === 'main.md+,git.md-,release.md+' && r.save === false, JSON.stringify(r));
await shot(s, 'status-docs-dialog-light');
r = await run(`await save(); return {puts: window.__puts, open: Boolean(dialog()), toasts: toasts()};`);
const put = r.puts[0] ?? {roles: []};
const pd = put.roles.find((x) => x.role === DOER);
const pc = put.roles.find((x) => x.role === CHECKER);
check('сохранение шлёт document_names в порядке версии', pd && JSON.stringify(pd.document_names) === '["main.md","release.md"]', JSON.stringify(put));
check('у роли без отбора ключа нет', pc && !('document_names' in pc), JSON.stringify(pc));
check('диалог закрыт с тостом', !r.open && r.toasts.some((t) => t.includes('сохранён')), JSON.stringify(r.toasts));
let saved = await statusRoles();
check('сервер хранит отбор', JSON.stringify(saved[DOER]) === '["main.md","release.md"]' && saved[CHECKER] === null, JSON.stringify(saved));
r = await run(`await sleep(800); return {doer: count('${DOER}'), line: line('${DOER}')};`);
check('панель — «Документов 2 из 3»', r.doer.includes('Документов 2 из 3'), r.doer);
check('панель — строка отбора', r.line === 'Отбор: main.md, release.md', r.line);
await shot(s, 'status-docs-panel-light');

console.log('правка без смены ролей не стирает отбор (UC-1 3в)');
r = await run(`spy(); await openEdit();
  const before = {mode: field('${DOER}').getAttribute('data-status-docs-mode'), list: ticked('${DOER}')};
  await fill('Название', 'Работа ${mark}'); await save(); return {before, puts: window.__puts};`);
check('диалог открылся с сохранённым отбором', r.before.mode === 'picked' && r.before.list.join() === 'main.md+,git.md-,release.md+', JSON.stringify(r.before));
check('роли переотправлены с прежним отбором', JSON.stringify(r.puts[0]?.roles.find((x) => x.role === DOER)?.document_names) === '["main.md","release.md"]', JSON.stringify(r.puts));
saved = await statusRoles();
check('после правки названия отбор на сервере прежний', JSON.stringify(saved[DOER]) === '["main.md","release.md"]', JSON.stringify(saved));

console.log('отбор у проверяющего');
r = await run(`spy(); await openEdit(); await mode('${CHECKER}', 'picked'); await tick('${CHECKER}', 'list.md'); await save();
  await sleep(600); return {puts: window.__puts, checker: count('${CHECKER}'), line: line('${CHECKER}')};`);
check('проверяющий уходит со своим отбором', JSON.stringify(r.puts[0]?.roles.find((x) => x.role === CHECKER)?.document_names) === '["list.md"]', JSON.stringify(r.puts));
check('панель проверяющего — «Документов 1 из 2»', r.checker.includes('Документов 1 из 2') && r.line === 'Отбор: list.md', JSON.stringify(r));

// ── имя вне версии роли ─────────────────────────────────────────────────────
console.log('имя вне версии роли (AC-348.13, .14)');
must(await call('PUT', `/workflows/${WF}/statuses/work/roles`, {roles: [
  {role: DOER, is_primary: true, position: 0, document_names: ['main.md', 'gone.md']},
  {role: CHECKER, is_primary: false, position: 1},
]}), 'отбор с отсутствующим именем');
await s.goto(PAGE);
await pause(1500);
r = await run(`await waitFor('[data-status-docs-count]'); await sleep(300);
  return {doer: count('${DOER}'), line: line('${DOER}'), marked: Array.from(document.querySelectorAll('[data-status-docs-selection="${DOER}"] [data-status-doc-missing]')).map((x) => text(x))};`);
check('панель — «Документов 1 из 3»', r.doer.includes('Документов 1 из 3'), r.doer);
check('отсутствующее имя помечено', r.marked.length === 1 && r.marked[0].includes('gone.md') && r.marked[0].includes('нет в версии роли'), JSON.stringify(r));
r = await run(`spy(); await openEdit(); await sleep(300); const before = ticked('${DOER}');
  await tick('${DOER}', 'gone.md'); const after = ticked('${DOER}'); await save(); return {before, after, puts: window.__puts};`);
check('в диалоге отсутствующее имя помечено и отмечено', r.before.join() === 'main.md+,git.md-,release.md-,gone.md+!', r.before.join());
check('снятое отсутствующее имя пропадает из списка', r.after.join() === 'main.md+,git.md-,release.md-', r.after.join());
saved = await statusRoles();
check('сохранён отбор без отсутствующего имени', JSON.stringify(saved[DOER]) === '["main.md"]', JSON.stringify(saved));

// ── смена роли ──────────────────────────────────────────────────────────────
console.log('смена исполнителя сбрасывает отбор (UC-1 3г)');
r = await run(`await openEdit();
  const clear = Array.from(dialog().querySelectorAll('button')).find((b) => /очистить|сбросить/i.test(b.getAttribute('aria-label') || ''));
  if (!clear) return {skipped: true};
  clear.click(); await sleep(400);
  const gone = !field('${DOER}');
  Array.from(dialog().querySelectorAll('button')).find((b) => (b.innerText || '').trim() === 'Отмена').click(); await sleep(500);
  return {gone};`);
if (r.skipped) console.log('  · у выбора исполнителя нет кнопки очистки — смена роли проверена правилами');
else check('без исполнителя поля отбора исполнителя нет', r.gone === true, JSON.stringify(r));

// ── тёмная тема и узкий экран ───────────────────────────────────────────────
console.log('темы и узкий экран (AC-348.15)');
await run(`localStorage.setItem('sdlc.theme', 'dark'); return true;`);
await s.goto(PAGE);
await pause(1500);
r = await run(`await waitFor('[data-status-docs-count]'); return {dark: document.documentElement.classList.contains('dark'), doer: count('${DOER}')};`);
check('тёмная тема — счётчик на месте', r.dark && r.doer.includes('Документов 1 из 3'), JSON.stringify(r));
await shot(s, 'status-docs-panel-dark');
await run(`await openEdit(); await mode('${DOER}', 'picked'); return true;`);
await shot(s, 'status-docs-dialog-dark');
await run(`Array.from(dialog().querySelectorAll('button')).find((b) => (b.innerText || '').trim() === 'Отмена').click(); await sleep(500);
  localStorage.setItem('sdlc.theme', 'light'); return true;`);
await s.resize(390, 844);
await s.goto(PAGE);
await pause(1800);
r = await run(`await waitFor('[data-status-docs-count]'); await sleep(300);
  const inside = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const box = el.getBoundingClientRect();
    const row = el.closest('[data-pipeline-inspector], [role=dialog]') || document.body;
    const outer = row.getBoundingClientRect();
    // Счётчик не обрезан многоточием и не выходит за панель.
    return box.right <= Math.min(outer.right, window.innerWidth) + 1 && el.parentElement.scrollWidth <= el.parentElement.clientWidth + 1;
  };
  return {doer: count('${DOER}'), count: inside('[data-status-docs-count="${DOER}"]'), line: inside('[data-status-docs-selection="${DOER}"]'),
    scroll: document.documentElement.scrollWidth <= window.innerWidth + 1};`);
check('390 px — счётчик и строка отбора видны целиком', r.doer.includes('Документов 1 из 3') && r.count && r.line && r.scroll, JSON.stringify(r));
await shot(s, 'status-docs-panel-390');
await s.resize(1440, 900);

// ── активная версия ─────────────────────────────────────────────────────────
console.log('активная версия — то же без правки (AC-348.14)');
must(await call('POST', `/workflows/${WF}/activate`, {}), 'активация');
await s.goto(`${BASE}/p/${PK}/pipeline?wf=${WF}&status=work`);
await pause(1500);
r = await run(`await waitFor('[data-status-docs-count]'); await sleep(300);
  return {doer: count('${DOER}'), line: line('${DOER}'), edit: Array.from(panel().querySelectorAll('button')).some((b) => (b.innerText || '').trim() === 'Править статус')};`);
check('активная — счётчик и строка отбора', r.doer.includes('Документов 1 из 3') && r.line === 'Отбор: main.md', JSON.stringify(r));
check('активная — без кнопки правки', r.edit === false);
const refused = await call('PUT', `/workflows/${WF}/statuses/work/roles`, {roles: [{role: DOER, is_primary: true, position: 0}]});
check('правка отбора активной версии — отказ сервера', refused.code === 409, JSON.stringify(refused));

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
