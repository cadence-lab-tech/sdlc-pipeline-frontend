import {mkdirSync, writeFileSync} from 'node:fs';
import {session, helpers} from './driver.mjs';

// Карточка, «Новая задача», гейты и «Пайплайн» по праву сервера (CLAB-409,
// решение 0072, п. 9): интерфейс показывает то, что разрешил сервер, а не то,
// что следует из уровня доступа.
//
// Стенд в режиме header: сервер отвечает actor_rights и actor_may* «можно»
// всем, поэтому «сотрудник» здесь — настоящий ответ сервера при подменённом
// уровне agent в /auth/me (так видно, что уровень карточку не закрывает), а
// «наблюдатель», «закрытая задача» и «сервер прежней версии» — ответ карточки,
// переписанный в браузере (флаг e2e.rights). Сама формула права — тесты
// backend; здесь — устройство экрана и настоящие запросы сотрудника.
//
// Сценарий заводит свой проект с циклом, где есть необязательный этап и гейт
// attempts_limit на возврате; демонстрационный SDLC не трогает и повторяется
// на той же базе и убирает его в конце.
//
// SDLC_E2E_SHOTS=<каталог> — снимки экрана карточки и «Пайплайна» в светлой и
// тёмной темах для сотрудника, наблюдателя и сопровождающего.
const BASE = process.env.SDLC_UI_URL ?? 'http://localhost:5173';
const API = process.env.SDLC_API_URL ?? 'http://localhost:8088';
const SHOTS = process.env.SDLC_E2E_SHOTS;
const api = (method, path, body, actor = 'e2e') =>
  fetch(API + path, {
    method,
    headers: {'Content-Type': 'application/json', 'X-SDLC-Actor': actor},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const json = async (method, path, body) => {
  const res = await api(method, path, body);
  return {code: res.status, body: await res.json().catch(() => null)};
};
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const must = (r, what) => {
  if (r.code >= 300) throw new Error(`${what}: ${r.code} ${JSON.stringify(r.body)}`);
  return r.body;
};

// ── данные ──────────────────────────────────────────────────────────────────
const PK = `TRR${Math.floor(Math.random() * 900 + 100)}`;
must(await json('POST', '/v1/projects', {key: PK, name: `Право на карточку ${PK}`}), 'проект');
const st = (key, category, extra = {}) => ({key, name: key[0].toUpperCase() + key.slice(1), category, ...extra});
const tr = (key, from, to, kind, gates) => ({key, name: key, to, kind, ...(from ? {from} : {}), ...(gates ? {gates} : {})});
const bundle = {
  version: 1,
  workflows: [{
    name: 'Rights',
    task_types: ['task'],
    statuses: [
      st('new', 'backlog', {is_initial: true}),
      st('work', 'active'),
      st('extra', 'active', {is_optional: true, enabled_by_default: true}),
      st('review', 'active'),
      st('done', 'done', {is_terminal: true}),
      st('cancelled', 'cancelled', {is_terminal: true}),
    ],
    transitions: [
      tr('start', 'new', 'work', 'advance'),
      tr('to_extra', 'work', 'extra', 'advance'),
      tr('extra_done', 'extra', 'review', 'advance'),
      tr('back', 'review', 'work', 'reject', [
        {key: 'limit', name: 'Не больше одной попытки', type: 'attempts_limit', config: {max_attempts: 1}, blocking: true},
      ]),
      tr('finish', 'review', 'done', 'advance'),
      tr('cancel', '', 'cancelled', 'cancel'),
    ],
  }],
};
const imported = must(await json('POST', `/v1/projects/${PK}/import`, bundle), 'импорт цикла');
for (const w of imported.workflows) must(await json('POST', `/v1/workflows/${w.id}/activate`, {}), 'активация');
console.log(`проект сценария ${PK}`);

const newTask = async (title) => must(await json('POST', `/v1/projects/${PK}/tasks`, {title}), 'задача').key;
const go = async (key, transition) => must(await json('POST', `/v1/tasks/${key}/transitions/${transition}`, {}), `${key}: ${transition}`);
const serverTask = async (key) => (await json('GET', `/v1/tasks/${key}`)).body;
const KEY = await newTask('Право на карточку: задача сценария');
for (const t of ['start', 'to_extra', 'extra_done']) await go(KEY, t);
// Задача на review: «finish» и «cancel» свободны, «back» держит предел.
const NEW = await newTask('Право на карточку: в бэклоге');
console.log(`задачи сценария ${KEY} ${NEW}`);

// ── браузер: подмены ответов ────────────────────────────────────────────────
//  e2e.who    — уровень доступа в /auth/me: agent | viewer | maintainer;
//  e2e.rights — ответ карточки: viewer | closed | legacy; нет — настоящий.
// Все запросы записи (кроме GET) пишутся в window.__writes.
const MSG_VIEWER = 'Наблюдатель только читает задачи (e2e-текст сервера)';
const MSG_CLOSED = 'Задача закрыта: этапы не выбирают (e2e-текст сервера)';
const STUB = `
  const realFetch = window.fetch;
  window.__writes = [];
  const ss = (k) => sessionStorage.getItem(k);
  const jsonResponse = (body, status = 200) =>
    new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
  const denial = (message, reason) => ({code: 'forbidden', reason, message});
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = ((init && init.method) || (typeof input !== 'string' && input.method) || 'GET').toUpperCase();
    if (method !== 'GET') {
      window.__writes.push({method, url, body: init && init.body});
      const fail = ss('e2e.createFail');
      if (fail && method === 'POST' && /\\/v1\\/projects\\/[^/]+\\/tasks$/.test(url)) {
        return jsonResponse({error: {code: 'invalid_input', message: fail}}, 400);
      }
      return realFetch(input, init);
    }
    const res = await realFetch(input, init);
    const who = ss('e2e.who');
    if (who && /\\/v1\\/auth\\/me$/.test(url)) {
      const me = await res.json();
      me.mode = 'token';
      me.authenticated = true;
      me.memberships = [{project_key: '${PK}', project_id: '', principal_id: me.principal.id, handle: me.principal.handle, kind: 'user', display_name: '', role: who, role_keys: null, created_at: ''}];
      me.teams = [];
      return jsonResponse(me);
    }
    const mode = ss('e2e.rights');
    if (mode && /\\/v1\\/tasks\\/[^/?]+$/.test(url)) {
      const body = await res.json();
      const strip = (o) => { for (const k of Object.keys(o)) if (k.startsWith('actor_')) delete o[k]; return o; };
      if (mode === 'legacy') {
        delete body.actor_rights;
        body.transitions = (body.transitions || []).map((t) => ({...strip(t), gates: t.gates.map((g) => strip({...g}))}));
      } else if (mode === 'viewer') {
        const no = denial(${JSON.stringify(MSG_VIEWER)}, 'viewer');
        body.actor_rights = {
          edit: false, stage_choice: false, create_child: false, assign: false, link: false, scope: false,
          actor_deny: {edit: no, stage_choice: no, create_child: no, assign: no, link: no, scope: no},
        };
        body.transitions = (body.transitions || []).map((t) => ({
          ...strip(t), actor_may: false, actor_deny: no,
          gates: t.gates.map((g) => ({...strip({...g}), actor_may_decide: false, actor_deny: no})),
        }));
      } else if (mode === 'closed') {
        body.actor_rights = {
          ...body.actor_rights, edit: true, stage_choice: false,
          actor_deny: {stage_choice: denial(${JSON.stringify(MSG_CLOSED)}, 'task_closed')},
        };
      }
      return jsonResponse(body);
    }
    return res;
  };
`;

const s = await session(BASE + '/projects');
await s.addInitScript(STUB);
await s.resize(1400, 900);
await s.emulate([{name: 'prefers-color-scheme', value: 'light'}]);
const run = (body) => s.evaluate(helpers + body);
const setFlag = (k, v) =>
  run(v === undefined ? `sessionStorage.removeItem(${JSON.stringify(k)}); return true;` : `sessionStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)}); return true;`);
const writes = () => run('return window.__writes;');
const shot = async (name) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, {recursive: true});
  writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(await s.screenshot(), 'base64'));
};

// Что видит человек на карточке. Всё читается из разметки, текстов и атрибутов.
const CARD = `
  const btn = (t) => all('button').find((b) => (b.innerText || '').trim() === t);
  const g = document.querySelector('[data-task-model-level] [data-model-level]');
  const stages = document.querySelector('[data-task-stages]');
  const page = texts();
  return {
    edit: Boolean(document.querySelector('button[aria-label="Править постановку"]')),
    levelFound: Boolean(g),
    levelDisabled: g ? Array.from(g.querySelectorAll('[data-level]')).every((b) => b.disabled) : null,
    levelTitle: g ? g.getAttribute('title') : null,
    stagesFound: Boolean(stages),
    stagesReadOnly: stages ? stages.getAttribute('data-readonly') === 'true' : null,
    stagesReason: (document.querySelector('[data-task-stages-reason]')?.innerText || '').trim(),
    assign: Boolean(btn('Изменить')),
    assignDeny: (document.querySelector('[data-right-deny="assign"]')?.innerText || '').trim(),
    scope: Boolean(btn('Править свойства и область')),
    scopeDeny: (document.querySelector('[data-right-deny="scope"]')?.innerText || '').trim(),
    performs: all('button').filter((b) => (b.innerText || '').trim() === 'Перевести').length,
    held: all('button').filter((b) => (b.innerText || '').trim() === 'Держат гейты').length,
    transitionDeny: all('[data-transition-deny]').map((e) => e.innerText.trim()),
    gateDeny: all('[data-gate-deny]').map((e) => e.innerText.trim()),
    waive: all('[data-gate-waive]').length,
    legacyHint: page.includes('этапы задачи выбирает сопровождающий проекта'),
    page,
  };
`;
const open = async (path, ready = '[data-task-model-level]') => {
  await s.goto(BASE + path);
  for (let i = 0; i < 30; i++) {
    if (await run(`return Boolean(document.querySelector(${JSON.stringify(ready)}));`)) break;
    await wait(400);
  }
  await wait(500);
};
// Раскрыть «держат N из M» у переходов: гейты читаются из раскрытого списка.
const expandGates = () =>
  run(`
    for (const t of all('button[data-slot=collapsible-trigger]')) {
      if (t.getAttribute('data-state') !== 'open') t.click();
    }
    await sleep(500);
    return true;
  `);

// ── сотрудник: уровень agent, право от сервера ──────────────────────────────
console.log('сотрудник (agent): право сервера открывает всё');
await setFlag('e2e.who', 'agent');
await open(`/p/${PK}/tasks/${KEY}`);
await expandGates();
let c = await run(CARD);
const real = (await serverTask(KEY)).actor_rights;
check('сервер стенда отдаёт actor_rights: edit, stage_choice, assign, scope', real && real.edit && real.stage_choice && real.assign && real.scope, JSON.stringify(real));
check('«Править постановку» в шапке', c.edit, JSON.stringify(c).slice(0, 300));
check('уровень задачи — ползунок доступен, подсказки нет', c.levelFound && c.levelDisabled === false && !c.levelTitle, JSON.stringify([c.levelDisabled, c.levelTitle]));
check('выбор этапов доступен', c.stagesFound && c.stagesReadOnly === false, JSON.stringify([c.stagesFound, c.stagesReadOnly]));
check('подсказки «этапы задачи выбирает сопровождающий проекта» нет', !c.legacyHint && !c.stagesReason, c.stagesReason);
check('«Изменить» исполнителя и «Править свойства и область»', c.assign && c.scope);
check('кнопка «Перевести» у свободных переходов (finish, cancel)', c.performs >= 2, String(c.performs));
check('возврат с пределом — «Держат гейты»', c.held === 1, String(c.held));
check('«Снять предел» у гейта предела', c.waive === 1, String(c.waive));
await shot('1-сотрудник-карточка-светлая');

console.log('сотрудник: настоящие запросы');
await run(`document.querySelector('[data-task-model-level] [data-level="high"]').click(); return true;`);
await wait(2200);
let sent = await writes();
check('ползунок: PATCH {"model_level":"high"}', sent.some((w) => w.method === 'PATCH' && w.body === '{"model_level":"high"}'), JSON.stringify(sent));
check('сервер принял уровень задачи', (await serverTask(KEY)).task.model_level === 'high');
await run(`document.querySelector('[data-optional-stage="extra"] [role=switch], [data-optional-stage="extra"]').click(); return true;`);
await wait(2200);
sent = await writes();
check('выбор этапов: PATCH с optional_stages', sent.some((w) => w.method === 'PATCH' && /optional_stages/.test(w.body ?? '')), JSON.stringify(sent));
check('сервер принял выбор этапов', (await serverTask(KEY)).task.optional_stages?.extra === false, JSON.stringify((await serverTask(KEY)).task.optional_stages));
const events = (await json('GET', `/v1/tasks/${KEY}/timeline`)).body;
check('в ленте task.updated', (events.events ?? []).some((e) => e.type === 'task.updated'));

console.log('сотрудник: снять предел');
await expandGates();
const before = (await writes()).length;
await run(`document.querySelector('[data-gate-waive]').click(); return true;`);
await wait(2500);
sent = (await writes()).slice(before);
const dec = sent.find((w) => w.method === 'POST' && /\/transitions\/back\/gates\/limit\/decision$/.test(w.url));
check('POST решения по гейту предела со status: waived', dec && JSON.parse(dec.body).status === 'waived', JSON.stringify(sent));
await expandGates();
c = await run(CARD);
check('гейт стал «отпущен», кнопки «Снять предел» нет', c.page.includes('отпущен') && c.waive === 0, String(c.waive));
const after = (await serverTask(KEY)).transitions.find((t) => t.key === 'back');
check('сервер: гейт предела waived, возврат доступен', after.gates[0].status === 'waived' && after.allowed === true, JSON.stringify(after.gates[0]));

console.log('сотрудник: «Пайплайн»');
const draft = must(await json('POST', `/v1/projects/${PK}/workflows`, {from: 'active', task_types: ['task']}), 'черновик');
const PIPE = `/p/${PK}/pipeline?wf=${draft.id}`;
await open(PIPE, '[data-pipeline-page]');
await wait(1500);
const PIPE_STATE = `
  const btn = (t) => all('button').find((b) => (b.innerText || '').trim() === t);
  const d = (t) => { const b = btn(t); return b ? b.disabled : null; };
  return {
    addStatus: d('Добавить статус'), head: d('Название и типы'), del: d('Удалить черновик'), activate: d('Активировать'),
    hint: (document.querySelector('[data-pipeline-cycle-hint]')?.innerText || '').trim(),
    page: texts(),
  };
`;
let p = await run(PIPE_STATE);
check('agent: «Добавить статус», «Название и типы», «Удалить черновик», «Активировать» неактивны',
  p.addStatus === true && p.head === true && p.del === true && p.activate === true, JSON.stringify(p));
check('agent: пояснение «цикл правит сопровождающий проекта»', p.hint === 'цикл правит сопровождающий проекта', p.hint);
await shot('2-сотрудник-пайплайн-светлая');
await open(`/p/${PK}/pipeline`, '[data-pipeline-page]');
await wait(1000);
p = await run(PIPE_STATE);
check('agent, активная версия: «Черновик копией этой версии» неактивна, пояснение есть',
  await run(`const b = all('button').find((x) => (x.innerText || '').trim() === 'Черновик копией этой версии'); return b ? b.disabled : null;`) === true && p.hint !== '', JSON.stringify(p.hint));
sent = (await writes()).filter((w) => /\/workflows/.test(w.url) && w.method !== 'GET');
check('«Пайплайн» у agent: ни одного запроса правки цикла', sent.length === 0, JSON.stringify(sent));
await setFlag('e2e.who', 'maintainer');
await open(PIPE, '[data-pipeline-page]');
await wait(1500);
p = await run(PIPE_STATE);
check('maintainer: кнопки правки черновика активны, пояснения нет',
  p.addStatus === false && p.head === false && p.del === false && p.hint === '', JSON.stringify(p));
await setFlag('e2e.who', undefined);
await open(PIPE, '[data-pipeline-page]');
await wait(1500);
p = await run(PIPE_STATE);
check('кто я не определён подменой (режим header): кнопки активны, пояснения нет', p.addStatus === false && p.hint === '', JSON.stringify(p));
must(await json('DELETE', `/v1/workflows/${draft.id}`), 'черновик убран');

console.log('сотрудник: «Новая задача» без эпика');
await setFlag('e2e.who', 'agent');
await open(`/p/${PK}`, 'body');
await wait(1500);
await run(`return clickExact('Новая задача');`);
await wait(900);
await run(`await fill('Название', 'Заведено сотрудником'); return true;`);
await setFlag('e2e.createFail', 'репозиторий не найден (e2e-текст сервера)');
await run(`return clickExact('Создать');`);
await wait(1500);
const dialog = await run(`
  const d = document.querySelector('[role=dialog]');
  const lbl = all('label').find((l) => l.innerText.trim().startsWith('Название'));
  const f = lbl && document.getElementById(lbl.getAttribute('for'));
  return {open: Boolean(d), text: d ? d.innerText.replace(/\\s+/g, ' ') : '', title: f ? f.value : null};
`);
check('отказ сервера показан в диалоге текстом', dialog.open && dialog.text.includes('Задача не создана') && dialog.text.includes('репозиторий не найден (e2e-текст сервера)'), dialog.text.slice(0, 300));
check('введённое название не потеряно', dialog.title === 'Заведено сотрудником', String(dialog.title));
await setFlag('e2e.createFail', undefined);
await run(`return clickExact('Создать');`);
await wait(2500);
sent = (await writes()).filter((w) => w.method === 'POST' && /\/projects\/[^/]+\/tasks$/.test(w.url));
const okBody = JSON.parse(sent[sent.length - 1].body);
check('запрос без parent', !('parent_key' in okBody) || okBody.parent_key === undefined, JSON.stringify(okBody));
const here = await run('return location.pathname;');
check('201: открыта карточка новой задачи', new RegExp(`^/p/${PK}/tasks/${PK}-\\d+$`).test(here), here);
const created = (await serverTask(here.split('/').pop())).task;
check('сервер: задача без родителя', !created.parent_key, JSON.stringify(created.parent_key));

// ── наблюдатель ─────────────────────────────────────────────────────────────
console.log('наблюдатель: сервер запретил, причины — его тексты');
await setFlag('e2e.who', 'viewer');
await setFlag('e2e.rights', 'viewer');
await open(`/p/${PK}/tasks/${KEY}`);
await expandGates();
c = await run(CARD);
check('«Править постановку» скрыта', !c.edit);
check('ползунок только для просмотра, причина — текст сервера дословно', c.levelDisabled === true && c.levelTitle === MSG_VIEWER, JSON.stringify([c.levelDisabled, c.levelTitle]));
check('выбор этапов только для просмотра, причина — текст сервера', c.stagesReadOnly === true && c.stagesReason === `Только просмотр: ${MSG_VIEWER}`, c.stagesReason);
check('нет «этапы задачи выбирает сопровождающий проекта»', !c.legacyHint);
check('«Изменить» исполнителя скрыта, причина видна', !c.assign && c.assignDeny === MSG_VIEWER, c.assignDeny);
check('«Править свойства и область» скрыта, причина видна', !c.scope && c.scopeDeny === MSG_VIEWER, c.scopeDeny);
check('переходы: ни одной кнопки, вместо них текст сервера', c.performs === 0 && c.held === 0 && c.transitionDeny.length >= 3 && c.transitionDeny.every((t) => t === MSG_VIEWER), JSON.stringify(c.transitionDeny));
check('гейт предела: «Снять предел» нет', c.waive === 0);
check('открытая карточка не шлёт ни одного запроса записи', (await writes()).length === 0, JSON.stringify(await writes()));
await shot('3-наблюдатель-карточка-светлая');

console.log('закрытая задача: правка открыта, выбор этапов нет');
await setFlag('e2e.who', 'agent');
await setFlag('e2e.rights', 'closed');
await open(`/p/${PK}/tasks/${KEY}`);
c = await run(CARD);
check('«Править постановку» есть', c.edit);
check('ползунок доступен', c.levelDisabled === false);
check('выбор этапов только для просмотра с текстом сервера дословно', c.stagesReadOnly === true && c.stagesReason === `Только просмотр: ${MSG_CLOSED}`, c.stagesReason);

// ── сервер прежней версии ───────────────────────────────────────────────────
console.log('сервер прежней версии (ни actor_rights, ни actor_may*): как до изменения');
await setFlag('e2e.rights', 'legacy');
await setFlag('e2e.who', 'viewer');
await open(`/p/${PK}/tasks/${KEY}`);
await expandGates();
c = await run(CARD);
check('уровень viewer: ползунок закрыт прежней подсказкой', c.levelDisabled === true && c.levelTitle === 'Уровень задачи меняет сопровождающий проекта', JSON.stringify([c.levelDisabled, c.levelTitle]));
check('уровень viewer: выбор этапов закрыт прежним текстом', c.stagesReadOnly === true && c.legacyHint, c.stagesReason);
check('«Править постановку», «Изменить», «Править свойства и область» стоят, как стояли', c.edit && c.assign && c.scope);
check('«Перевести» по allowed, «Снять предел» нет', c.performs >= 2 && c.waive === 0, JSON.stringify([c.performs, c.waive]));
await setFlag('e2e.who', 'maintainer');
await open(`/p/${PK}/tasks/${KEY}`);
c = await run(CARD);
check('уровень maintainer: ползунок и выбор этапов доступны', c.levelDisabled === false && c.stagesReadOnly === false && !c.legacyHint);

// ── сопровождающий ──────────────────────────────────────────────────────────
console.log('сопровождающий: настоящий ответ сервера');
await setFlag('e2e.rights', undefined);
await open(`/p/${PK}/tasks/${KEY}`);
c = await run(CARD);
check('всё доступно, как и было', c.edit && c.levelDisabled === false && c.stagesReadOnly === false && c.assign && c.scope);
await shot('4-сопровождающий-карточка-светлая');

if (SHOTS) {
  await s.emulate([{name: 'prefers-color-scheme', value: 'dark'}]);
  await run(`localStorage.setItem('theme', 'dark'); document.documentElement.classList.add('dark'); return true;`);
  await setFlag('e2e.who', 'agent');
  await open(`/p/${PK}/tasks/${KEY}`);
  await run(`document.documentElement.classList.add('dark'); return true;`);
  await shot('5-сотрудник-карточка-тёмная');
  await setFlag('e2e.who', 'viewer');
  await setFlag('e2e.rights', 'viewer');
  await open(`/p/${PK}/tasks/${KEY}`);
  await run(`document.documentElement.classList.add('dark'); return true;`);
  await shot('6-наблюдатель-карточка-тёмная');
  await s.resize(390, 900);
  await shot('7-наблюдатель-карточка-390');
}

await setFlag('e2e.who', undefined);
await setFlag('e2e.rights', undefined);
// Проект сценария убирается: его статусы увидели бы сценарии, что сверяют код
// с ключами статусов стенда (stage-panel.mjs).
await json('DELETE', `/v1/projects/${PK}`);
console.log(`\n${ok} ok, ${fail} fail`);
s.close();
process.exit(fail ? 1 : 0);
