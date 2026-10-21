import {session, helpers} from './driver.mjs';

// Журнал действий и подробности ленты (CLAB-211) поверх журнала бэкенда
// (CLAB-210). Сценарий заводит себе свою задачу и делает с ней всё ручками
// API — правку постановки, область, переход, сдачу артефакта, отказ гейтов,
// отпуск этапа: так демонстрационные задачи остаются нетронутыми для прочих
// сценариев, а журнал и лента показывают то, что записал бэкенд стенда.
//
// Стенд в режиме header: прав нет, и отказ 403 сервер не отдаёт. Отказ
// чтения журнала (наблюдатель, не-администратор) подменяется в браузере
// ответом одной ручки, как в instance.mjs; отказ «по делу» — 409 гейтов —
// настоящий.
const BASE = process.env.SDLC_UI_URL ?? 'http://localhost:5173';
const API = process.env.SDLC_API_URL ?? 'http://localhost:8088';
const api = (method, path, body, actor = 'e2e') =>
  fetch(API + path, {
    method,
    headers: {'Content-Type': 'application/json', 'X-SDLC-Actor': actor},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── данные ──────────────────────────────────────────────────────────────────
const created = await (await api('POST', '/v1/projects/SDLC/tasks', {
  title: 'Журнал: задача сценария',
  description: 'Исходное описание задачи',
  repositories: ['cadence-lab-tech/sdlc-pipeline-backend'],
})).json();
const KEY = created.key;
if (!KEY) throw new Error('задача не заведена: ' + JSON.stringify(created));
console.log(`задача сценария ${KEY}`);

const steps = [
  await api('PATCH', `/v1/tasks/${KEY}`, {
    title: 'Журнал: новое название',
    priority: 'high',
    labels: ['audit'],
    description: 'Новое описание задачи',
  }),
  await api('PATCH', `/v1/tasks/${KEY}/scope`, {
    add_repositories: ['cadence-lab-tech/sdlc-pipeline-frontend'],
    properties: {multi_repo: true},
    note: 'фронтенд тоже',
  }),
  await api('POST', `/v1/tasks/${KEY}/transitions/start`, {comment: 'поехали'}),
  await api('POST', `/v1/tasks/${KEY}/claim`, {role: 'analyst'}, 'agent:analyst-bot'),
  await api('POST', `/v1/tasks/${KEY}/artifacts`, {
    kind: 'analysis.open_questions',
    title: 'Вопросы сценария журнала',
    format: 'markdown',
    content: 'СЕКРЕТНОЕ-ТЕЛО-АРТЕФАКТА',
  }, 'agent:analyst-bot'),
  await api('POST', `/v1/tasks/${KEY}/release`, {note: 'отпускаю для проверки'}, 'agent:analyst-bot'),
];
check('действия стенда прошли', steps.every((r) => r.ok), steps.map((r) => r.status).join(','));
const refused = await api('POST', `/v1/tasks/${KEY}/transitions/analysis_done`, {});
check('переход отбит гейтами', refused.status === 409, String(refused.status));

const s = await session(BASE + `/p/SDLC/tasks/${KEY}`);
const run = (body) => s.evaluate(helpers + body);
await wait(2500);

// ── лента ───────────────────────────────────────────────────────────────────
console.log('журнал не запрашивается до открытия вкладки');
// Модули интерфейса в dev-сборке тоже ходят запросами (src/components/audit.ts),
// поэтому считаются только запросы к API.
const auditRequests = `return performance.getEntriesByType('resource').filter((e) => /\\/v1\\/.*\\/audit/.test(e.name)).length;`;
check('карточка открыта без запроса журнала', (await run(auditRequests)) === 0);

console.log('подробности ленты');
await run('await press("Лента"); return true;');
await wait(800);
let t = await run('return texts();');
for (const want of [
  'название: «Журнал: задача сценария» → «Журнал: новое название»',
  'приоритет: обычный → высокий',
  'метки: + audit',
  'описание изменено',
  'добавлено: cadence-lab-tech/sdlc-pipeline-frontend',
  'multi_repo: да',
  'заметка: фронтенд тоже',
  'заметка: отпускаю для проверки',
  'start · new → analysis · «поехали»',
]) {
  check(`в ленте «${want}»`, t.includes(want), t.slice(0, 1500));
}
check('мусора в подробностях нет', !/undefined|\[object Object\]/.test(t), t.slice(0, 1500));
check('и всё ещё без запроса журнала', (await run(auditRequests)) === 0);

const expanded = await run(`
  const row = document.querySelector('[data-event="task.updated"]');
  row.querySelector('button').click();
  await sleep(500);
  return {state: row.getAttribute('data-state'), text: row.innerText, code: (row.querySelector('.code-block') || {}).innerText || ''};
`);
check('правка постановки раскрывается', expanded.state === 'open', JSON.stringify(expanded).slice(0, 300));
check('по раскрытию — описание было и стало',
  expanded.text.includes('описание: было') && expanded.text.includes('Исходное описание задачи') &&
    expanded.text.includes('Новое описание задачи'), expanded.text.slice(0, 600));
check('по раскрытию — сырой payload', expanded.code.includes('"changed"'), expanded.code.slice(0, 300));

// ── журнал карточки ─────────────────────────────────────────────────────────
console.log('вкладка «Журнал»');
const rows = `
  return all('[data-audit-entry]').map((el) => ({
    id: el.getAttribute('data-audit-entry'),
    outcome: el.getAttribute('data-outcome'),
    text: el.innerText.replace(/\\s+/g, ' '),
  }));
`;
await run('await press("Журнал"); return true;');
await wait(1200);
check('журнал запрошен при открытии вкладки', (await run(auditRequests)) > 0);
let list = await run(rows);
const fromApi = await (await api('GET', `/v1/tasks/${KEY}/audit`)).json();
check('строки в порядке сервера, новые сверху',
  list.length === fromApi.entries.length && list.every((r, i) => r.id === fromApi.entries[i].id),
  JSON.stringify(list.map((r) => r.id)).slice(0, 300));
check('первая — отказ гейтов', list[0]?.outcome === 'fail' && list[0].text.includes('gates_not_satisfied · 409'),
  JSON.stringify(list[0]));
const all = list.map((r) => r.text).join(' | ');
for (const want of [
  'PATCH /v1/tasks/:taskKey',
  'PATCH /v1/tasks/:taskKey/scope',
  'POST /v1/tasks/:taskKey/transitions/:transitionKey',
  'POST /v1/tasks/:taskKey/artifacts',
  'REST',
  'успех',
  'без токена',
  'analyst-bot (agent)',
]) {
  check(`в журнале «${want}»`, all.includes(want), all.slice(0, 1200));
}

const style = await run(`
  const row = document.querySelector('[data-audit-entry][data-outcome="fail"]');
  const okRow = document.querySelector('[data-audit-entry][data-outcome="ok"]');
  const color = (el) => getComputedStyle(el).borderLeftColor;
  const width = (el) => getComputedStyle(el).borderLeftWidth;
  const html = document.documentElement;
  const wasDark = html.classList.contains('dark');
  html.classList.remove('dark');
  await sleep(200);
  const light = color(row);
  html.classList.add('dark');
  await sleep(200);
  const dark = color(row);
  html.classList.toggle('dark', wasDark);
  return {light, dark, width: width(row), okWidth: width(okRow)};
`);
check('неуспех выделен полосой destructive', style.width !== '0px' && style.okWidth === '0px', JSON.stringify(style));
check('у выделения есть пара в тёмной теме', style.light !== style.dark, JSON.stringify(style));

const artifactRow = await run(`
  const row = all('[data-audit-entry]').find((el) => el.innerText.includes('POST /v1/tasks/:taskKey/artifacts'));
  row.querySelector('button').click();
  await sleep(500);
  return {state: row.getAttribute('data-state'), code: (row.querySelector('.code-block') || {}).innerText || '', text: row.innerText};
`);
check('строка раскрывается до параметров', artifactRow.state === 'open' && artifactRow.code.includes('"body"'), JSON.stringify(artifactRow).slice(0, 400));
check('вместо тела артефакта — размер и sha256',
  artifactRow.code.includes('"sha256"') && artifactRow.code.includes('"size"') && !artifactRow.code.includes('СЕКРЕТНОЕ-ТЕЛО-АРТЕФАКТА'),
  artifactRow.code.slice(0, 400));
check('и request_id', /request_id: [0-9a-f-]{36}/.test(artifactRow.text), artifactRow.text.slice(-200));

console.log('узкий экран');
await s.resize(375, 800);
await wait(600);
const scrollOf = 'return document.documentElement.scrollWidth - document.documentElement.clientWidth;';
check('журнал без горизонтальной прокрутки на 375 px', (await run(scrollOf)) <= 0, String(await run(scrollOf)));
await run('await press("Лента"); return true;');
await wait(600);
await run(`document.querySelector('[data-event="task.updated"] button').click(); await sleep(400); return true;`);
check('лента с раскрытой правкой без горизонтальной прокрутки', (await run(scrollOf)) <= 0, String(await run(scrollOf)));
await s.resize(1280, 900);
await wait(400);

console.log('«Показать ещё» по курсору');
// Страница — 50 записей. Добивается правками приоритета: каждая — запись.
for (let i = 0; i < 50; i++) {
  await api('PATCH', `/v1/tasks/${KEY}`, {priority: i % 2 ? 'high' : 'low'});
}
const total = 7 + 50;
await s.goto(BASE + `/p/SDLC/tasks/${KEY}`);
await wait(2000);
await run('await press("Журнал"); return true;');
await wait(1200);
list = await run(rows);
t = await run('return texts();');
check('первая страница — 50 строк и кнопка', list.length === 50 && t.includes('Показать ещё'), `${list.length}`);
await run('await clickExact("Показать ещё"); await sleep(1200); return true;');
list = await run(rows);
t = await run('return texts();');
check('догружена вторая страница', list.length === total, `${list.length} из ${total}`);
check('на последней странице кнопки нет', !t.includes('Показать ещё'));
check('строки не повторяются', new Set(list.map((r) => r.id)).size === list.length);

console.log('действие на карточке возвращает журнал к первой странице');
await run(`
  all('button[aria-label="Править постановку"]')[0].click();
  await sleep(700);
  await fill("Название", "Журнал: поправлено из карточки");
  await clickExact("Сохранить");
  await sleep(2000);
  return true;
`);
list = await run(rows);
t = await run('return texts();');
check('после правки — снова первая страница', list.length === 50 && t.includes('Показать ещё'), `${list.length}`);
check('и в ней новая запись сверху', list[0]?.text.includes('PATCH /v1/tasks/:taskKey') && list[0].outcome === 'ok', JSON.stringify(list[0]));

console.log('живая аренда перезапрашивает журнал');
await api('POST', `/v1/tasks/${KEY}/claim`, {role: 'analyst'}, 'agent:analyst-bot');
await s.goto(BASE + `/p/SDLC/tasks/${KEY}`);
await wait(2000);
await run('await press("Журнал"); return true;');
await wait(1200);
const before = (await run(rows))[0]?.id;
await api('POST', `/v1/tasks/${KEY}/usage`, {model: 'e2e-model', input_tokens: 1, output_tokens: 1, cost_usd: 0.01}, 'agent:analyst-bot');
await wait(11500);
list = await run(rows);
check('новая запись пришла опросом', list[0]?.id !== before && list[0]?.text.includes('/usage'), JSON.stringify(list[0]));
await api('POST', `/v1/tasks/${KEY}/release`, {note: 'конец проверки опроса'}, 'agent:analyst-bot');

console.log('отказ чтения журнала показан как есть');
// Наблюдателю бэкенд отвечает 403; в режиме header отказа нет, и ответ ручки
// журнала подменяется до кода страницы.
const denyAudit = await s.addInitScript(`
  const realFetch = window.fetch;
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (/\\/v1\\/(tasks\\/[^/]+\\/|projects\\/[^/]+\\/)?audit(\\?|$)/.test(url)) {
      return Promise.resolve(new Response(JSON.stringify({error: {code: 'forbidden', message: 'журнал читает сопровождающий проекта (e2e)'}}), {status: 403, headers: {'Content-Type': 'application/json'}}));
    }
    return realFetch(input, init);
  };
`);
await s.goto(BASE + `/p/SDLC/tasks/${KEY}`);
await wait(2000);
await run('await press("Журнал"); return true;');
await wait(800);
t = await run('return texts();');
check('сообщение сервера как есть', t.includes('журнал читает сопровождающий проекта (e2e)'), t.slice(0, 800));
check('и «Повторить»', t.includes('Повторить'));
check('остальная карточка работает', t.includes('Журнал: поправлено из карточки') && t.includes('Действия'), t.slice(0, 400));

console.log('журнал инстанса: не-администратор');
await s.goto(BASE + '/audit');
await wait(2000);
t = await run('return texts();');
check('прямой заход — отказ сервера', t.includes('журнал читает сопровождающий проекта (e2e)'), t.slice(0, 600));
check('пункта «Журнал» в меню нет', (await run(`return all('a[href="/audit"]').length;`)) === 0);
await s.removeInitScript(denyAudit);

console.log('журнал проекта в настройках');
await s.goto(BASE + '/p/SDLC/settings');
await wait(2500);
const section = `
  const h = all('h2').find((x) => x.innerText.trim() === 'Журнал действий');
  return h ? h.closest('section') : null;
`;
t = await run(`const sec = (() => { ${section} })(); return sec ? sec.innerText.replace(/\\s+/g, ' ') : 'нет раздела';`);
check('раздел «Журнал действий» есть', t !== 'нет раздела' && t.includes('PATCH /v1/tasks/:taskKey'), t.slice(0, 400));
const links = await run(`
  const sec = (() => { ${section} })();
  return Array.from(sec.querySelectorAll('[data-audit-task]')).map((el) => ({tag: el.tagName, text: el.innerText.trim(), href: el.getAttribute('href')}));
`);
check('у записи задачи — ссылка на карточку',
  links.some((l) => l.tag === 'A' && l.text === KEY && l.href === `/p/SDLC/tasks/${KEY}`), JSON.stringify(links.slice(0, 3)));
const order = await run(`
  return all('h2').map((x) => x.innerText.trim()).filter((x) => ['Перенос правил', 'Журнал действий', 'Опасная зона'].includes(x));
`);
check('раздел стоит перед «Опасной зоной»', JSON.stringify(order) === JSON.stringify(['Перенос правил', 'Журнал действий', 'Опасная зона']), JSON.stringify(order));

// Импорт связки той же страницы появляется после «Обновить» — проектной
// записью без задачи.
await run(`
  await clickExact("Экспортировать проект");
  await sleep(1500);
  const code = all('.code-block').find((el) => el.innerText.includes('"roles"'));
  await fill("Связка JSON", code.innerText);
  await sleep(300);
  await clickExact("Проверить (без изменений)");
  await sleep(2000);
  return true;
`);
await run(`
  const sec = (() => { ${section} })();
  Array.from(sec.querySelectorAll('button')).find((b) => b.innerText.trim() === 'Обновить').click();
  await sleep(1500);
  return true;
`);
const importRow = await run(`
  const sec = (() => { ${section} })();
  const row = Array.from(sec.querySelectorAll('[data-audit-entry]')).find((el) => el.innerText.includes('POST /v1/projects/:projectKey/import'));
  if (!row) return null;
  return {first: sec.querySelector('[data-audit-entry]') === row, task: (row.querySelector('[data-audit-task]') || {}).innerText};
`);
check('импорт связки — в журнале, сверху', importRow?.first, JSON.stringify(importRow));
check('у проектной записи вместо задачи прочерк', importRow?.task === '—', JSON.stringify(importRow));

await s.resize(375, 800);
await wait(600);
check('раздел журнала без горизонтальной прокрутки на 375 px', (await run(scrollOf)) <= 0, String(await run(scrollOf)));
await s.resize(1280, 900);

console.log('журнал инстанса: администратор');
// Администратора системы в режиме header нет — признак is_admin подменяется
// в ответе /auth/me; сама ручка журнала инстанса отвечает по-настоящему.
const tokenRes = await api('POST', '/v1/auth/tokens', {name: 'e2e-audit-token'});
check('токен без проекта выдан', tokenRes.ok, String(tokenRes.status));
const asAdmin = await s.addInitScript(`
  const realFetch = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const res = await realFetch(input, init);
    if (!/\\/v1\\/auth\\/me$/.test(url) || !res.ok) return res;
    const me = await res.json();
    me.principal = {...me.principal, is_admin: true};
    return new Response(JSON.stringify(me), {status: 200, headers: {'Content-Type': 'application/json'}});
  };
`);
await s.goto(BASE + '/projects');
await wait(2000);
check('у администратора пункт «Журнал» в меню', (await run(`return all('a[href="/audit"]').map((a) => a.innerText.trim()).join();`)).includes('Журнал'));
await run(`all('a[href="/audit"]')[0].click(); await sleep(1500); return true;`);
t = await run('return texts();');
check('страница журнала инстанса открылась', t.includes('Действия уровня инстанса'), t.slice(0, 400));
check('запись без проекта — выпуск токена', t.includes('POST /v1/auth/tokens'), t.slice(0, 800));
check('колонки задачи нет', (await run(`return all('[data-audit-task]').length;`)) === 0);
await s.removeInitScript(asAdmin);

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
