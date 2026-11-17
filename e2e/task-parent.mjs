import {session, helpers} from './driver.mjs';

// Родитель задачи в «Деталях» (CLAB-196): строка «Родитель» у задачи с
// родителем и без, перенос поиском среди задач верхнего уровня, снятие,
// ссылка «↑» в шапке и лента после перечитывания, у задачи с детьми — только
// пояснение, отказ сервера его текстом (настоящий 400: кандидат стал вложенным,
// пока человек выбирал), а без права и без поля права (сервер до CLAB-196) —
// ответ карточки, переписанный в браузере (флаг e2e.parentRights).
//
// Сценарий заводит свой проект со своим циклом, демонстрационный SDLC не
// трогает, повторяется на той же базе и убирает проект в конце.
const BASE = process.env.SDLC_UI_URL ?? 'http://localhost:5173';
const API = process.env.SDLC_API_URL ?? 'http://localhost:8088';
const json = async (method, path, body) => {
  const res = await fetch(API + path, {
    method,
    headers: {'Content-Type': 'application/json', 'X-SDLC-Actor': 'e2e'},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {code: res.status, body: await res.json().catch(() => null)};
};
const must = (r, what) => {
  if (r.code >= 300) throw new Error(`${what}: ${r.code} ${JSON.stringify(r.body)}`);
  return r.body;
};
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── данные ──────────────────────────────────────────────────────────────────
const PK = `PAR${Math.floor(Math.random() * 900 + 100)}`;
must(await json('POST', '/v1/projects', {key: PK, name: `Родитель ${PK}`}), 'проект');
const imported = must(await json('POST', `/v1/projects/${PK}/import`, {
  version: 1,
  workflows: [{
    name: 'Tree',
    task_types: ['task'],
    statuses: [
      {key: 'todo', name: 'Todo', category: 'backlog', is_initial: true},
      {key: 'doing', name: 'Doing', category: 'active'},
      {key: 'over', name: 'Over', category: 'done', is_terminal: true},
    ],
    transitions: [
      {key: 'go', name: 'go', from: 'todo', to: 'doing', kind: 'advance'},
      {key: 'end', name: 'end', from: 'doing', to: 'over', kind: 'advance'},
    ],
  }],
}), 'импорт цикла');
for (const w of imported.workflows) must(await json('POST', `/v1/workflows/${w.id}/activate`, {}), 'активация');
const newTask = async (title, parent) =>
  must(await json('POST', `/v1/projects/${PK}/tasks`, {title, ...(parent ? {parent_key: parent} : {})}), title).key;
const TOP = await newTask('Узел с ребёнком');
const KID = await newTask('Ребёнок узла', TOP);
const OTHER = await newTask('Другой узел');
const LONE = await newTask('Одиночка');
const LATE = await newTask('Кандидат, который уйдёт вниз');
const parentOf = async (key) => (await json('GET', `/v1/tasks/${key}`)).body.task.parent_key ?? null;
console.log(`проект сценария ${PK}`);

// ── браузер ─────────────────────────────────────────────────────────────────
// e2e.parentRights — ответ карточки: denied | legacy; нет — настоящий.
const DENY = 'Смена родителя — решение человека (e2e-текст сервера)';
const STUB = `
  const realFetch = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = ((init && init.method) || 'GET').toUpperCase();
    const res = await realFetch(input, init);
    const mode = sessionStorage.getItem('e2e.parentRights');
    if (method === 'GET' && mode && /\\/v1\\/tasks\\/[^/?]+$/.test(url)) {
      const body = await res.json();
      if (mode === 'legacy') delete body.actor_rights.reparent;
      else {
        body.actor_rights.reparent = false;
        body.actor_rights.actor_deny = {...(body.actor_rights.actor_deny || {}),
          reparent: {code: 'forbidden', reason: 'human_action', message: ${JSON.stringify(DENY)}}};
      }
      return new Response(JSON.stringify(body), {status: 200, headers: {'Content-Type': 'application/json'}});
    }
    return res;
  };
`;
const s = await session(BASE + '/projects');
await s.addInitScript(STUB);
await s.resize(1400, 1000);
const run = (body) => s.evaluate(helpers + body);
const card = async (key) => {
  await s.goto(`${BASE}/p/${PK}/tasks/${key}`);
  for (let i = 0; i < 30; i++) {
    if (await run(`return Boolean(document.querySelector('[data-parent-row]'));`)) break;
    await wait(400);
  }
  await wait(600);
};
const ROW = `
  const r = document.querySelector('[data-parent-row]');
  const header = all('a').find((a) => (a.innerText || '').trim().startsWith('↑'));
  return r && {
    text: r.innerText.replace(/\\s+/g, ' ').trim(),
    link: r.querySelector('a')?.innerText.trim() ?? null,
    edit: Boolean(r.querySelector('[data-parent-edit]')),
    search: Boolean(r.querySelector('[data-parent-search]')),
    submit: Boolean(r.querySelector('[data-parent-submit]')),
    detach: Boolean(r.querySelector('[data-parent-detach]')),
    hint: r.querySelector('[data-parent-hint]')?.innerText.trim() ?? null,
    deny: r.querySelector('[data-right-deny="reparent"]')?.innerText.trim() ?? null,
    header: header ? header.innerText.trim() : null,
  };
`;
const row = () => run(ROW);
const openEdit = () => run(`document.querySelector('[data-parent-edit]').click(); await sleep(500); return true;`);
// Радикс-Select открывается по pointerdown и закрывается по клику на пункте
// или Escape на открытом списке.
const OPEN = `
  const lbl = all('label').find((l) => l.innerText.trim().startsWith('Новый родитель'));
  const trigger = document.getElementById(lbl.getAttribute('for'));
  trigger.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, button: 0, pointerType: 'mouse'}));
  await sleep(500);
`;
const options = (query) => run(`
  await fill('Найти родителя', ${JSON.stringify(query)});
  await sleep(1200);
  ${OPEN}
  const out = all('[role=option]').map((o) => o.innerText.trim());
  const list = document.querySelector('[role=listbox]');
  if (list) { list.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); await sleep(400); }
  return out;
`);
const choose = (key) => run(`
  ${OPEN}
  const o = all('[role=option]').find((x) => x.innerText.trim().startsWith(${JSON.stringify(key)} + ' ·'));
  if (!o) throw new Error('нет пункта ' + ${JSON.stringify(key)} + ': ' + all('[role=option]').map((x) => x.innerText.trim()).join('|'));
  o.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, pointerType: 'mouse'}));
  o.click();
  await sleep(400);
  return true;
`);
const clickData = (attr) => run(`document.querySelector('[${attr}]').click(); await sleep(1500); return true;`);

console.log('задача без родителя: «—», перенос поиском');
await card(LONE);
let r = await row();
check('строка «Родитель» есть и без родителя', r && r.link === null && r.text.startsWith('—'), JSON.stringify(r));
check('право сервера — «Изменить»', r?.edit === true);
await openEdit();
r = await row();
check('выбор поиском, «Снять» нет — родителя нет', r.search && r.submit && !r.detach, JSON.stringify(r));
let opts = await options('узел');
check('кандидаты — задачи верхнего уровня', opts.some((o) => o.startsWith(TOP + ' ·')) && opts.some((o) => o.startsWith(OTHER + ' ·')), JSON.stringify(opts));
opts = await options('');
check('без самой задачи и без вложенной', opts.length > 0 && !opts.some((o) => o.startsWith(LONE + ' ·')) && !opts.some((o) => o.startsWith(KID + ' ·')), JSON.stringify(opts));
await choose(OTHER);
await clickData('data-parent-submit');
r = await row();
check('после переноса — ссылка на нового родителя', r.link === OTHER && !r.search, JSON.stringify(r));
check('ссылка «↑» в шапке обновлена', r.header === `↑ ${OTHER}`, String(r.header));
check('сервер: родитель сменился', (await parentOf(LONE)) === OTHER);
const feed = await run(`
  await openSection('timeline');
  return document.querySelector('[data-overview-section="timeline"]').innerText.replace(/\\s+/g, ' ');
`);
check('лента: «родитель изменён» с ключами', feed.includes('родитель изменён') && feed.includes(`${LONE}: верхний уровень → ${OTHER}`), feed.slice(0, 400));

console.log('снятие с родителя');
await openEdit();
r = await row();
check('у вложенной задачи без детей — выбор и «Снять с родителя»', r.search && r.detach, JSON.stringify(r));
await clickData('data-parent-detach');
r = await row();
check('после снятия — «—» и без «↑»', r.link === null && r.header === null, JSON.stringify(r));
check('сервер: родителя нет', (await parentOf(LONE)) === null);

console.log('задача с детьми');
await card(TOP);
await openEdit();
r = await row();
check('выбора нет, пояснение про один уровень', !r.search && !r.submit && r.hint?.includes('один уровень'), JSON.stringify(r));
check('снимать нечего — родителя нет', !r.detach);

console.log('отказ сервера');
await card(LONE);
await openEdit();
await options('Кандидат');
await choose(LATE);
must(await json('PUT', `/v1/tasks/${LATE}/parent`, {parent_key: OTHER}), 'кандидат уходит вниз');
await clickData('data-parent-submit');
r = await row();
const failure = await run(`return (document.querySelector('[data-parent-row]').innerText || '').replace(/\\s+/g, ' ');`);
check('текст сервера, строка прежняя', failure.includes(`${LATE} сама вложена в ${OTHER}`) && r.link === null, failure);
check('сервер: ничего не изменилось', (await parentOf(LONE)) === null);

console.log('без права и сервер прежней версии');
await run(`sessionStorage.setItem('e2e.parentRights', 'denied'); return true;`);
await card(KID);
r = await row();
check('без права — правки нет, текст отказа дословно', !r.edit && r.deny === DENY && r.link === TOP, JSON.stringify(r));
await run(`sessionStorage.setItem('e2e.parentRights', 'legacy'); return true;`);
await card(KID);
r = await row();
check('поля права нет — правки и текста нет, ссылка есть', !r.edit && r.deny === null && r.link === TOP, JSON.stringify(r));
await run(`sessionStorage.removeItem('e2e.parentRights'); return true;`);

// ── уборка ───────────────────────────────────────────────────────────────────
await json('DELETE', `/v1/projects/${PK}`);
console.log(`\n${ok} ok, ${fail} fail`);
s.close();
process.exit(fail ? 1 : 0);
