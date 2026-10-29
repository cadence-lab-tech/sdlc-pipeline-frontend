import {mkdirSync, writeFileSync} from 'node:fs';
import {session, helpers} from './driver.mjs';

// Необязательные этапы в интерфейсе (CLAB-318, решение 0066): выбор этапов в
// форме новой задачи и в «Деталях» карточки, состояния «пропущен» и
// «выключен» на схеме цикла, фактическое назначение перехода, недоступный
// возврат, подписи ленты и панели этапа.
//
// Сценарий заводит свой проект с циклом, где design (выключен по умолчанию),
// docs (включён) и qa (выключен) необязательные, плюс цикл без таких этапов
// другого типа; демонстрационный SDLC не трогает и повторяется на той же
// базе. Задачи двигаются ручками API — экран показывает то, что записал
// бэкенд стенда. Правила без браузера — labels.mjs и cycle-layout.mjs; здесь
// — экран. Отказ 403, сбой цикла, ответ старого сервера и уровень доступа
// подменяются в браузере ответом одной ручки (addInitScript), как в
// model-level.mjs: стенд в режиме header отказов не отдаёт.
//
// SDLC_E2E_SHOTS=<каталог> — снимки экрана (форма, карточка, схема в светлой и
// тёмной темах, узкий экран, «Недоступен») складываются туда.
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
const PK = `OPT${Math.floor(Math.random() * 900 + 100)}`;
must(await json('POST', '/v1/projects', {key: PK, name: `Необязательные этапы ${PK}`}), 'проект');
const st = (key, category, extra = {}) => ({key, name: key[0].toUpperCase() + key.slice(1), category, ...extra});
const tr = (key, from, to, kind) => ({key, name: key, to, kind, ...(from ? {from} : {})});
const bundle = {
  version: 1,
  workflows: [
    {
      name: 'Skip',
      task_types: ['task'],
      statuses: [
        st('new', 'backlog', {is_initial: true}),
        st('analysis', 'active'),
        st('design', 'active', {is_optional: true, enabled_by_default: false}),
        st('docs', 'active', {is_optional: true}),
        st('development', 'active'),
        st('qa', 'active', {is_optional: true, enabled_by_default: false}),
        st('done', 'done', {is_terminal: true}),
        st('cancelled', 'cancelled', {is_terminal: true}),
      ],
      transitions: [
        tr('start', 'new', 'analysis', 'advance'),
        tr('analysis_done', 'analysis', 'design', 'advance'),
        tr('design_done', 'design', 'docs', 'advance'),
        tr('docs_done', 'docs', 'development', 'advance'),
        tr('finish', 'development', 'qa', 'advance'),
        tr('qa_done', 'qa', 'done', 'advance'),
        tr('back_to_design', 'development', 'design', 'reject'),
        tr('cancel', '', 'cancelled', 'cancel'),
      ],
    },
    {
      name: 'Plain',
      task_types: ['plain'],
      statuses: [
        st('new', 'backlog', {is_initial: true}),
        st('work', 'active'),
        st('done', 'done', {is_terminal: true}),
      ],
      transitions: [tr('start', 'new', 'work', 'advance'), tr('finish', 'work', 'done', 'advance')],
    },
  ],
};
const imported = must(await json('POST', `/v1/projects/${PK}/import`, bundle), 'импорт цикла');
for (const w of imported.workflows) must(await json('POST', `/v1/workflows/${w.id}/activate`, {}), 'активация');
console.log(`проект сценария ${PK}`);

const newTask = async (title, extra = {}) => must(await json('POST', `/v1/projects/${PK}/tasks`, {title, ...extra}), 'задача').key;
const go = async (key, transition) => must(await json('POST', `/v1/tasks/${key}/transitions/${transition}`, {}), `${key}: ${transition}`);
const serverTask = async (key) => (await json('GET', `/v1/tasks/${key}`)).body.task;
// Набор этапов с сервера — объект без гарантированного порядка ключей.
const sorted = (o) => JSON.stringify(Object.fromEntries(Object.entries(o ?? {}).sort(([a], [b]) => a.localeCompare(b))));

// ── браузер: запись и подмены запросов ──────────────────────────────────────
// Подмены включаются флагами sessionStorage, а не новым скриптом на случай:
//  e2e.wfFail      — цикл по типу (GET .../workflow?type=) отвечает 500;
//  e2e.createFail  — заведение задачи отвечает 400 с перечнем допустимых;
//  e2e.patch       — [status, code, message] для PATCH задачи;
//  e2e.who         — уровень доступа в /auth/me (viewer | maintainer);
//  e2e.strip       — ответы без полей CLAB-315 (сервер старше);
//  e2e.odd         — у недоступных переходов карточки незнакомая причина.
const SCRIPT = `
  const realFetch = window.fetch;
  window.__calls = [];
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init && init.method) || 'GET';
    const ss = (k) => sessionStorage.getItem(k);
    if (method !== 'GET') window.__calls.push({method, url, body: init && init.body});
    else if (/\\/workflow\\?type=/.test(url)) window.__calls.push({method, url});
    if (method === 'GET' && /\\/projects\\/[^/]+\\/workflow\\?type=/.test(url) && ss('e2e.wfFail')) {
      return new Response(JSON.stringify({error: {code: 'internal', message: 'сбой цикла (e2e)'}}), {status: 500, headers: {'Content-Type': 'application/json'}});
    }
    if (method === 'POST' && /\\/projects\\/[^/]+\\/tasks$/.test(url) && ss('e2e.createFail')) {
      return new Response(JSON.stringify({error: {code: 'invalid_input', message: 'ключ этапа не принят (e2e 400)', details: {allowed: ['design', 'docs', 'qa']}}}), {status: 400, headers: {'Content-Type': 'application/json'}});
    }
    if (method === 'PATCH' && /\\/v1\\/tasks\\/[^/]+$/.test(url)) {
      await new Promise((r) => setTimeout(r, 900));
      const deny = ss('e2e.patch');
      if (deny) {
        const [status, code, message] = JSON.parse(deny);
        return new Response(JSON.stringify({error: {code, message}}), {status, headers: {'Content-Type': 'application/json'}});
      }
    }
    const res = await realFetch(input, init);
    if (method !== 'GET') return res;
    if (/\\/v1\\/auth\\/me$/.test(url) && ss('e2e.who')) {
      const me = await res.json();
      me.mode = 'token';
      me.authenticated = true;
      me.memberships = [{project_key: '${PK}', project_id: '', principal_id: me.principal.id, handle: me.principal.handle, kind: 'user', display_name: '', role: ss('e2e.who'), role_keys: null, created_at: ''}];
      me.teams = [];
      return new Response(JSON.stringify(me), {status: 200, headers: {'Content-Type': 'application/json'}});
    }
    const strip = ss('e2e.strip');
    const odd = ss('e2e.odd');
    if ((strip || odd) && /\\/v1\\/(tasks\\/[^/]+|workflows\\/[^/]+|projects\\/[^/]+\\/workflow(\\?.*)?)$/.test(url)) {
      const data = await res.json();
      const task = data.task;
      if (strip) {
        if (task) delete task.optional_stages;
        for (const t of data.transitions || []) { delete t.lands_in; delete t.skips; delete t.unavailable; }
        for (const s of (data.statuses || (data.workflow && data.workflow.statuses) || [])) { delete s.is_optional; delete s.enabled_by_default; }
      }
      if (odd) for (const t of data.transitions || []) if (t.unavailable) t.unavailable = odd;
      return new Response(JSON.stringify(data), {status: 200, headers: {'Content-Type': 'application/json'}});
    }
    return res;
  };
`;

const s = await session('about:blank');
const run = (body) => s.evaluate(helpers + body);
await s.addInitScript(SCRIPT);
await s.resize(1280, 1000);
const setFlag = (k, v) => run(`sessionStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)}); return true;`);
const clearFlags = () => run(`sessionStorage.clear(); return true;`);
const calls = () => run('return window.__calls;');
const open = async (path) => {
  await s.goto(BASE + path);
  await wait(1800);
};
const shot = async (name) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, {recursive: true});
  writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(await s.screenshot(), 'base64'));
};
const theme = (t) => run(t ? `localStorage.setItem('sdlc.theme', '${t}'); return true;` : `localStorage.removeItem('sdlc.theme'); return true;`);

// Выпадающий список по подписи поля: кнопка находится по label[for].
const choose = (label, option) => `
  const lbl = all('label').find((l) => l.innerText.trim().startsWith(${JSON.stringify(label)}));
  const sel = lbl && document.getElementById(lbl.getAttribute('for'));
  if (!sel) throw new Error('поле не найдено: ' + ${JSON.stringify(label)});
  sel.click();
  await sleep(400);
  const o = all('[role=option]').find((e) => e.innerText.trim() === ${JSON.stringify(option)});
  if (!o) throw new Error('нет варианта: ' + ${JSON.stringify(option)});
  o.click();
  await sleep(600);
  return true;
`;
const formStages = () => run(`
  const box = document.querySelector('[data-optional-stages]');
  if (!box) return null;
  return {
    legend: (box.querySelector('legend')?.innerText || '').trim(),
    stages: all('[data-optional-stages] [data-optional-stage]').map((b) => ({
      key: b.getAttribute('data-optional-stage'),
      on: b.getAttribute('aria-checked') === 'true',
      label: (document.querySelector('label[for="' + b.id + '"]')?.innerText || '').trim(),
    })),
  };
`);
const cardStages = () => run(`
  const box = document.querySelector('[data-task-stages]');
  if (!box) return null;
  return {
    stages: all('[data-task-stages] [data-optional-stage]').map((b) => ({
      key: b.getAttribute('data-optional-stage'),
      on: b.getAttribute('aria-checked') === 'true',
      disabled: b.disabled,
      label: (document.querySelector('label[for="' + b.id + '"]')?.innerText || '').trim(),
      hint: (document.querySelector('label[for="' + b.id + '"]')?.parentElement?.innerText || '').replace(/\\s+/g, ' ').trim(),
    })),
    text: box.innerText.replace(/\\s+/g, ' ').trim(),
    busy: box.getAttribute('aria-busy') === 'true',
    readonly: box.getAttribute('data-readonly') === 'true',
  };
`);
const flip = (key) => run(`document.querySelector('[data-task-stages] [data-optional-stage="${key}"]').click(); return true;`);
const nodes = () => run(`return all('[data-cycle-status]').map((n) => ({
  key: n.getAttribute('data-cycle-status'),
  state: n.getAttribute('data-cycle-state'),
  label: n.getAttribute('aria-label'),
}));`);
const stateOf = async (key) => (await nodes()).find((n) => n.key === key);
const noCodes = async (where) => {
  const t = await run('return document.body.innerText;');
  const html = await run('return document.body.innerHTML;');
  check(`${where}: в тексте нет кодов stage_disabled и optional_*`, !/stage_disabled|optional_[a-z]/.test(t), t.match(/stage_disabled|optional_[a-z_]+/)?.[0]);
  return html;
};

// ── форма новой задачи ──────────────────────────────────────────────────────
console.log('форма новой задачи: блок «Необязательные этапы»');
await open(`/p/${PK}`);
await run(`return clickExact('Новая задача');`);
await wait(900);
let types = await run(choose('Тип', 'task'));
let form = await formStages();
check('блок с заголовком «Необязательные этапы»', form?.legend === 'Необязательные этапы', JSON.stringify(form));
check('переключатели в порядке position, подписи — имена статусов',
  form?.stages.map((x) => `${x.key}:${x.label}`).join() === 'design:Design,docs:Docs,qa:Qa', JSON.stringify(form));
check('положения — умолчания цикла', form?.stages.map((x) => x.on).join() === 'false,true,false', JSON.stringify(form));
let sent = await calls();
check('цикл типа запрошен: GET .../workflow?type=task', sent.some((c) => /\/workflow\?type=task$/.test(c.url)), JSON.stringify(sent));
await shot('1-форма-новой-задачи');
await run(choose('Тип', 'plain'));
check('тип без необязательных этапов — блока нет', (await formStages()) === null);
await run(choose('Тип', 'task'));
form = await formStages();
check('вернули тип — набор снова с умолчаниями', form?.stages.length === 3 && form.stages.map((x) => x.on).join() === 'false,true,false', JSON.stringify(form));

console.log('форма: тело запроса');
await run(`await fill('Название', 'Без правок блока'); return true;`);
await run(`return clickExact('Создать');`);
await wait(1800);
sent = (await calls()).filter((c) => c.method === 'POST' && /\/tasks$/.test(c.url));
check('без правок блока поля optional_stages в запросе нет', sent.length === 1 && !('optional_stages' in JSON.parse(sent[0].body)), JSON.stringify(sent));
const keyA = (await run('return location.pathname.split("/").pop();'));
check('задача заведена, карточка открыта', /^OPT\d+-\d+$/.test(keyA), keyA);
check('сервер заполнил умолчания цикла', sorted((await serverTask(keyA)).optional_stages) === '{"design":false,"docs":true,"qa":false}', sorted((await serverTask(keyA)).optional_stages));

await open(`/p/${PK}`);
await run(`return clickExact('Новая задача');`);
await wait(900);
await run(choose('Тип', 'task'));
await run(`await fill('Название', 'С включённым design');
  document.querySelector('[data-optional-stages] [data-optional-stage="design"]').click(); await sleep(300); return true;`);
form = await formStages();
check('переключатель design включился', form?.stages.find((x) => x.key === 'design')?.on === true, JSON.stringify(form));
await run(`return clickExact('Создать');`);
await wait(1800);
sent = (await calls()).filter((c) => c.method === 'POST' && /\/tasks$/.test(c.url));
check('уходит ровно {"design": true} — только изменённый ключ',
  sent.length === 1 && JSON.stringify(JSON.parse(sent[0].body).optional_stages) === '{"design":true}', JSON.stringify(sent));
const keyB = await run('return location.pathname.split("/").pop();');
check('сервер отдаёт полный набор', sorted((await serverTask(keyB)).optional_stages) === '{"design":true,"docs":true,"qa":false}', sorted((await serverTask(keyB)).optional_stages));
await wait(600);
let cs = await cardStages();
check('карточка показывает design включённым', cs?.stages.find((x) => x.key === 'design')?.on === true, JSON.stringify(cs));

console.log('форма: ошибка заведения и сбой цикла');
const before = (await json('GET', `/v1/projects/${PK}/tasks`)).body.tasks.length;
await open(`/p/${PK}`);
await setFlag('e2e.createFail', '1');
await run(`return clickExact('Новая задача');`);
await wait(900);
await run(choose('Тип', 'task'));
await run(`await fill('Название', 'Не создастся'); document.querySelector('[data-optional-stages] [data-optional-stage="qa"]').click(); await sleep(200); return true;`);
await run(`return clickExact('Создать');`);
await wait(1200);
let t = await run(`return document.querySelector('[role=dialog]')?.innerText.replace(/\\s+/g, ' ') ?? '';`);
check('400 показана как ошибка заведения', t.includes('Задача не создана') && t.includes('ключ этапа не принят (e2e 400)'), t.slice(0, 300));
form = await formStages();
check('форма осталась с введённым', (await run(`return all('label').find((l) => l.innerText.trim().startsWith('Название')) && document.getElementById(all('label').find((l) => l.innerText.trim().startsWith('Название')).getAttribute('for')).value;`)) === 'Не создастся'
  && form?.stages.find((x) => x.key === 'qa')?.on === true, JSON.stringify(form));
check('задача не создана', (await json('GET', `/v1/projects/${PK}/tasks`)).body.tasks.length === before);
await clearFlags();
// Сбой ставится после загрузки доски: доска сама читает цикл тем же запросом.
await open(`/p/${PK}`);
await setFlag('e2e.wfFail', '1');
await run(`return clickExact('Новая задача');`);
await wait(900);
await run(choose('Тип', 'task'));
check('цикл не загрузился — блока нет', (await formStages()) === null);
await run(`await fill('Название', 'Без цикла в форме'); return true;`);
await run(`return clickExact('Создать');`);
await wait(1800);
const keyNoWf = await run('return location.pathname.split("/").pop();');
check('«Создать» работает: задача заведена без optional_stages',
  /^OPT\d+-\d+$/.test(keyNoWf) && !('optional_stages' in JSON.parse((await calls()).filter((c) => c.method === 'POST' && /\/tasks$/.test(c.url)).at(-1).body)), keyNoWf);
await clearFlags();

// ── блок «Этапы» в карточке ─────────────────────────────────────────────────
console.log('карточка: блок «Этапы»');
const keyC = await newTask('Карточка: выбор этапов');
await open(`/p/${PK}/tasks/${keyC}`);
cs = await cardStages();
check('строка на каждый необязательный статус версии задачи',
  cs?.stages.map((x) => `${x.key}:${x.label}`).join() === 'design:Design,docs:Docs,qa:Qa', JSON.stringify(cs));
check('положения — из task.optional_stages', cs?.stages.map((x) => x.on).join() === 'false,true,false', JSON.stringify(cs));
check('у задачи в new ничего не заблокировано', cs?.stages.every((x) => !x.disabled), JSON.stringify(cs));
let page = await run('return texts();');
check('подпись строки — «Этапы»', /Этапы/.test(page), page.slice(0, 200));
await shot('2-карточка-блок-этапы');

await run(`window.__marker = 'та же страница'; return true;`);
await flip('docs');
await wait(300);
cs = await cardStages();
check('пока запрос идёт, блок занят', cs?.busy && cs.stages.every((x) => x.disabled), JSON.stringify(cs));
await wait(2200);
cs = await cardStages();
sent = (await calls()).filter((c) => c.method === 'PATCH');
check('PATCH несёт ровно один ключ', sent.length === 1 && sent[0].body === '{"optional_stages":{"docs":false}}', JSON.stringify(sent));
check('положение — серверное, блок снова доступен', cs?.stages.find((x) => x.key === 'docs')?.on === false && !cs.busy && cs.stages.every((x) => !x.disabled), JSON.stringify(cs));
check('сервер: docs выключен', (await serverTask(keyC)).optional_stages.docs === false);
check('карточка перечитана без перезагрузки', (await run('return window.__marker;')) === 'та же страница');
await run(`await openSection('timeline'); return true;`);
t = await run('return texts();');
check('в ленте: «этапы: docs вкл → выкл»', t.includes('постановка поправлена') && t.includes('этапы: docs вкл → выкл'), t.slice(0, 500));
await noCodes('карточка');

console.log('карточка: текущий этап и закрытая задача');
await flip('docs');
await wait(2500);
await go(keyC, 'start');
await go(keyC, 'analysis_done');
await open(`/p/${PK}/tasks/${keyC}`);
cs = await cardStages();
const cur = cs?.stages.find((x) => x.key === 'docs');
check('design выключен, поэтому задача прошла мимо него и стоит на docs', (await serverTask(keyC)).status_key === 'docs', (await serverTask(keyC)).status_key);
check('переключатель текущего этапа недоступен с подсказкой «этап идёт сейчас»', cur?.disabled && cur.hint.includes('этап идёт сейчас'), JSON.stringify(cur));
check('остальные доступны', cs?.stages.filter((x) => x.key !== 'docs').every((x) => !x.disabled), JSON.stringify(cs));
const keyClosed = await newTask('Карточка: закрытая');
await go(keyClosed, 'cancel');
await open(`/p/${PK}/tasks/${keyClosed}`);
cs = await cardStages();
check('закрытая задача: все недоступны с подсказкой «задача закрыта»',
  cs?.stages.length === 3 && cs.stages.every((x) => x.disabled && x.hint.includes('задача закрыта')), JSON.stringify(cs));

console.log('карточка: отказы сервера');
const keyD = await newTask('Карточка: отказы');
await open(`/p/${PK}/tasks/${keyD}`);
await setFlag('e2e.patch', JSON.stringify([409, 'conflict', 'этап идёт сейчас (e2e 409)']));
await flip('qa');
await wait(2200);
cs = await cardStages();
t = await run(`return document.querySelector('[data-task-stages]').innerText.replace(/\\s+/g, ' ');`);
check('409 показан в блоке текстом сервера', t.includes('Этапы не изменены') && t.includes('этап идёт сейчас (e2e 409)'), t);
check('положение осталось серверным', cs?.stages.find((x) => x.key === 'qa')?.on === false && !cs.readonly, JSON.stringify(cs));
check('после 409 блок остаётся доступным', cs?.stages.every((x) => !x.disabled), JSON.stringify(cs));
await setFlag('e2e.patch', JSON.stringify([403, 'forbidden', 'этапы задачи выбирает сопровождающий (e2e 403)']));
await flip('qa');
await wait(2200);
cs = await cardStages();
check('403 переводит блок в «только просмотр»', cs?.readonly && cs.stages.every((x) => x.disabled), JSON.stringify(cs));
check('причина — текст ответа сервера', cs?.text.includes('Только просмотр') && cs.text.includes('этапы задачи выбирает сопровождающий (e2e 403)'), cs?.text);
check('положение прежнее', cs?.stages.find((x) => x.key === 'qa')?.on === false);
check('на сервере выбор не изменился', (await serverTask(keyD)).optional_stages.qa === false);

console.log('карточка: право по уровню доступа');
await clearFlags();
await setFlag('e2e.who', 'viewer');
await open(`/p/${PK}/tasks/${keyD}`);
cs = await cardStages();
const patchesBefore = (await calls()).filter((c) => c.method === 'PATCH').length;
check('наблюдатель: только просмотр с причиной до любого запроса',
  cs?.readonly && cs.stages.every((x) => x.disabled) && cs.text.includes('Только просмотр: этапы задачи выбирает сопровождающий проекта'), JSON.stringify(cs));
await flip('qa');
await wait(1500);
check('наблюдатель: клик запроса не шлёт', (await calls()).filter((c) => c.method === 'PATCH').length === patchesBefore);
await setFlag('e2e.who', 'maintainer');
await open(`/p/${PK}/tasks/${keyD}`);
cs = await cardStages();
check('сопровождающий: блок переключается', !cs?.readonly && cs.stages.every((x) => !x.disabled), JSON.stringify(cs));
await clearFlags();

// ── схема цикла, «Действия», панель этапа ───────────────────────────────────
console.log('схема: выключенные этапы и переход с пропуском');
const keyE = await newTask('Схема: пропуски');
await go(keyE, 'start');
await open(`/p/${PK}/tasks/${keyE}`);
let n = await nodes();
check('design и qa — «выключен»', n.find((x) => x.key === 'design')?.state === 'disabled' && n.find((x) => x.key === 'qa')?.state === 'disabled', JSON.stringify(n));
check('docs (включён) — «впереди», обязательные — как раньше',
  n.find((x) => x.key === 'docs')?.state === 'future' && n.find((x) => x.key === 'analysis')?.state === 'current' && n.find((x) => x.key === 'development')?.state === 'future', JSON.stringify(n));
check('подпись узла называет состояние словами', /выключен/.test(n.find((x) => x.key === 'design')?.label ?? ''), JSON.stringify(n.find((x) => x.key === 'design')));
let shapes = await run(`
  const rect = (key) => { const r = document.querySelector('[data-cycle-status="' + key + '"]').querySelectorAll('rect'); return r[r.length - 1]; };
  const text = (key) => document.querySelector('[data-cycle-status="' + key + '"] text');
  return {
    disabled: rect('design').getAttribute('stroke-dasharray'),
    future: rect('docs').getAttribute('stroke-dasharray'),
    disabledStyle: getComputedStyle(text('design')).fontStyle,
    badge: document.querySelector('[data-cycle-status="design"] circle') !== null,
  };
`);
check('«выключен» отличается не только цветом: точечная рамка, курсив, значок',
  shapes.disabled === '1 3' && shapes.future === '4 3' && shapes.disabledStyle === 'italic' && shapes.badge, JSON.stringify(shapes));
let legend = await run(`return (document.querySelector('ul[aria-label="Обозначения"]')?.innerText || '').replace(/\\s+/g, ' ');`);
check('легенда: «выключен» есть, «пропущен» нет (таких узлов нет)', legend.includes('выключен') && !legend.includes('пропущен'), legend);
let edge = await run(`const e = document.querySelector('[data-cycle-transition="analysis_done"]'); return {lands: e.getAttribute('data-cycle-lands'), title: e.querySelector('title')?.textContent};`);
check('ребро перехода с пропуском: data-cycle-lands = docs', edge.lands === 'docs', JSON.stringify(edge));
check('подсказка ребра: «analysis_done: Analysis → Design (пропуск: Design; встанет в Docs)»',
  edge.title === 'analysis_done: Analysis → Design (пропуск: Design; встанет в Docs)', edge.title);
check('у переходов без пропуска data-cycle-lands нет',
  (await run(`return all('[data-cycle-transition]').filter((e) => e.getAttribute('data-cycle-lands') !== null).map((e) => e.getAttribute('data-cycle-transition')).join();`)) === 'analysis_done');
t = await run(`return document.querySelector('[data-cycle-landing-line="analysis_done"]')?.innerText ?? '';`);
check('под схемой строка о переходе с пропуском', t === 'analysis_done → Docs (пропуск: Design)', t);
t = await run(`const el = document.querySelector('[data-transition-target]'); return el ? [el.innerText.trim(), el.getAttribute('title'), el.getAttribute('data-transition-skips')] : null;`);
check('«Действия»: «→ docs (пропуск: design)», цикловое назначение в подсказке',
  t?.[0] === '→ docs (пропуск: design)' && t[1] === 'в цикле переход ведёт в Design' && t[2] === 'design', JSON.stringify(t));
await run(`window.location.search; return true;`);
await open(`/p/${PK}/tasks/${keyE}?stage=design`);
t = await run(`return document.querySelector('[data-stage-unstarted]')?.innerText.replace(/\\s+/g, ' ') ?? '';`);
check('панель выключенного и не пройденного этапа: «Этап выключен у задачи»', t.includes('Этап выключен у задачи') && !t.includes('ещё не начинался'), t);
await open(`/p/${PK}/tasks/${keyE}`);
await noCodes('схема');

console.log('переход с пропуском');
await run(`return clickIn('analysis_done', 'Перевести');`);
await wait(1500);
t = (await run('return toasts();')).join(' | ');
sent = (await calls()).filter((c) => c.method === 'POST' && /transitions\/analysis_done$/.test(c.url));
check('запрос ушёл на запрошенный переход', sent.length === 1, JSON.stringify(sent));
check('уведомление: «Задача перешла в Docs, пропущено: Design»', t.includes('Задача перешла в Docs, пропущено: Design'), t);
check('задача на фактическом статусе', (await serverTask(keyE)).status_key === 'docs');
n = await nodes();
check('design — «пропущен», docs — текущий', n.find((x) => x.key === 'design')?.state === 'skipped' && n.find((x) => x.key === 'docs')?.state === 'current', JSON.stringify(n));
check('подпись узла: «пропущен»', /пропущен/.test(n.find((x) => x.key === 'design')?.label ?? ''), JSON.stringify(n.find((x) => x.key === 'design')));
shapes = await run(`
  const text = document.querySelector('[data-cycle-status="design"] text');
  const r = document.querySelector('[data-cycle-status="design"]').querySelectorAll('rect');
  return {dash: r[r.length - 1].getAttribute('stroke-dasharray'), deco: getComputedStyle(text).textDecorationLine};
`);
check('«пропущен» не только цветом: точечная рамка и перечёркнутая подпись', shapes.dash === '1 3' && shapes.deco.includes('line-through'), JSON.stringify(shapes));
legend = await run(`return (document.querySelector('ul[aria-label="Обозначения"]')?.innerText || '').replace(/\\s+/g, ' ');`);
check('легенда называет оба состояния', legend.includes('пропущен') && legend.includes('выключен'), legend);
await open(`/p/${PK}/tasks/${keyE}?stage=design`);
t = await run(`return document.querySelector('[data-stage-unstarted]')?.innerText.replace(/\\s+/g, ' ') ?? '';`);
check('панель пропущенного этапа: «Этап пропущен»', t.includes('Этап пропущен') && !t.includes('ещё не начинался'), t);
await open(`/p/${PK}/tasks/${keyE}`);
await run(`await openSection('timeline'); return true;`);
t = await run('return texts();');
check('лента: «этап пропущен» со статусом и обходным переходом', t.includes('этап пропущен') && t.includes('design · обход: design_done · по переходу analysis_done'), t.slice(0, 700));
check('лента: task.advanced с «пропущено: design»', t.includes('пропущено: design'), t.slice(0, 700));

console.log('недоступный возврат в выключенный этап');
await go(keyE, 'docs_done');
await open(`/p/${PK}/tasks/${keyE}`);
const back = await run(`
  const row = all('[data-transition-unavailable]').map((e) => e.getAttribute('data-transition-unavailable'));
  const reason = document.querySelector('[data-transition-unavailable="back_to_design"]');
  const card = reason && reason.closest('[data-slot=card]');
  const btn = card && card.querySelector('button');
  return {row, button: btn && btn.innerText.trim(), disabled: btn && btn.disabled, text: card && card.innerText.replace(/\\s+/g, ' ')};
`);
check('возврат помечен недоступным', back.row.join() === 'back_to_design', JSON.stringify(back));
check('кнопка «Недоступен» (не «Держат гейты») и нажать нельзя', back.button === 'Недоступен' && back.disabled === true, JSON.stringify(back));
check('причина человеческим текстом', back.text.includes('Этап Design выключен у задачи; включите его в «Деталях»'), back.text);
await noCodes('недоступный возврат');
t = await run(`return all('[data-cycle-landing-line]').map((e) => e.innerText).join(' | ');`);
check('под схемой: «back_to_design: недоступен: этап Design выключен» и пропуск finish → qa',
  t.includes('back_to_design: недоступен: этап Design выключен') && t.includes('finish → Done (пропуск: Qa)'), t);
n = await nodes();
check('схема: design пропущен, qa выключен, development текущий',
  n.find((x) => x.key === 'design')?.state === 'skipped' && n.find((x) => x.key === 'qa')?.state === 'disabled' && n.find((x) => x.key === 'development')?.state === 'current', JSON.stringify(n));
// «Системная» тема в headless-Chrome следует за машиной, поэтому обе темы
// ставятся явно.
await theme('light');
await open(`/p/${PK}/tasks/${keyE}`);
check('светлая тема включилась', await run(`return !document.documentElement.classList.contains('dark');`));
await shot('3-недоступен-в-действиях');
await shot('4-схема-светлая-тема');
await theme('dark');
await open(`/p/${PK}/tasks/${keyE}`);
const dark = await run(`
  const paint = (key) => { const r = document.querySelector('[data-cycle-status="' + key + '"]').querySelectorAll('rect'); return getComputedStyle(r[r.length - 1]).stroke + '|' + getComputedStyle(r[r.length - 1]).fill; };
  return {dark: document.documentElement.classList.contains('dark'), skipped: paint('design'), disabled: paint('qa'), future: paint('done')};
`);
check('тёмная тема включилась, у обоих состояний есть пара', dark.dark && dark.skipped && dark.disabled && dark.skipped !== dark.disabled, JSON.stringify(dark));
await shot('5-схема-тёмная-тема');
await theme(undefined);

console.log('незнакомая причина недоступности');
await setFlag('e2e.odd', 'something_new');
await open(`/p/${PK}/tasks/${keyE}`);
t = await run(`return document.querySelector('[data-transition-unavailable]')?.innerText ?? '';`);
check('«Переход недоступен» без показа значения', t === 'Переход недоступен', t);
check('значения причины на экране нет', !(await run('return document.body.innerText;')).includes('something_new'));
await clearFlags();

console.log('включение этапа и возврат');
await open(`/p/${PK}/tasks/${keyE}`);
await flip('design');
await wait(2600);
cs = await cardStages();
check('design включён, блок доступен', cs?.stages.find((x) => x.key === 'design')?.on === true && !cs.busy, JSON.stringify(cs));
const after = await run(`return {has: document.querySelector('[data-transition-unavailable]') !== null, target: document.querySelector('[data-transition-target]') && all('[data-transition-target]').map((e) => e.innerText.trim()).join(' | ')};`);
check('«Недоступен» ушёл, возврат доступен', !after.has, JSON.stringify(after));
n = await nodes();
check('design снова «впереди» (включён после пропуска)', n.find((x) => x.key === 'design')?.state === 'future', JSON.stringify(n));
await run(`return clickIn('back_to_design', 'Перевести');`);
await wait(1500);
check('возврат выполнен', (await serverTask(keyE)).status_key === 'design', (await serverTask(keyE)).status_key);

console.log('узкий экран');
const keyM = await newTask('Схема: узкий экран');
await go(keyM, 'start');
await go(keyM, 'analysis_done');
await go(keyM, 'docs_done');
await s.resize(420, 900);
await theme('light');
await open(`/p/${PK}/tasks/${keyM}`);
const stepper = await run(`return document.querySelector('[data-cycle-diagram]')?.getAttribute('data-cycle-diagram');`);
n = await nodes();
check('степпер вместо круга', stepper === 'stepper', stepper);
check('степпер: те же состояния и подписи',
  n.find((x) => x.key === 'design')?.state === 'skipped' && /пропущен/.test(n.find((x) => x.key === 'design').label)
  && n.find((x) => x.key === 'qa')?.state === 'disabled' && /выключен/.test(n.find((x) => x.key === 'qa').label), JSON.stringify(n));
legend = await run(`return (document.querySelector('ul[aria-label="Обозначения"]')?.innerText || '').replace(/\\s+/g, ' ');`);
check('легенда на узком экране называет состояния', legend.includes('пропущен') && legend.includes('выключен'), legend);
check('горизонтальной прокрутки нет', await run('return document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1;'));
await shot('6-схема-узкий-экран');
await theme(undefined);
await s.resize(1280, 1000);

console.log('ответы сервера без новых полей');
await setFlag('e2e.strip', '1');
await open(`/p/${PK}/tasks/${keyE}`);
check('блока «Этапы» нет', (await cardStages()) === null);
n = await nodes();
check('схема без состояний «пропущен» и «выключен»', n.length > 0 && n.every((x) => ['current', 'passed', 'future'].includes(x.state)), JSON.stringify(n));
t = await run(`return all('[data-transition-target]').map((e) => e.innerText.trim()).join(' | ');`);
check('«Действия» как прежде: назначение из цикла', t.startsWith('→ ') && !t.includes('пропуск'), t);
check('нет строк о пропуске под схемой', (await run(`return document.querySelector('[data-cycle-landing]') === null;`)));
await open(`/p/${PK}`);
await run(`return clickExact('Новая задача');`);
await wait(900);
await run(choose('Тип', 'task'));
check('форма без блока «Необязательные этапы»', (await formStages()) === null);
await clearFlags();
await noCodes('ответ без полей');

await s.close?.();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
