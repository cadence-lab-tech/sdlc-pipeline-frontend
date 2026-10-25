import {session, helpers} from './driver.mjs';

// Уровень модели (CLAB-262, решение 0060): ползунок задачи в «Деталях»,
// ползунок в форме версии роли и строка прогона «рекомендован · фактически».
//
// Сценарий заводит себе свою задачу и свои роли (ключи с отметкой времени),
// поэтому демонстрационных данных не трогает и повторяется на той же базе.
// Захват и отчёт о стоимости делает агент ручками API: так снимок уровня и
// учёт прогона на экране — те, что записал бэкенд стенда.
//
// Стенд в режиме header: прав нет, и отказ 403 сервер не отдаёт. Отказ правки
// и уровень доступа подменяются в браузере ответом одной ручки
// (addInitScript), как в audit.mjs; правила права целиком проверяет
// labels.mjs без браузера.
const BASE = process.env.SDLC_UI_URL ?? 'http://localhost:5173';
const API = process.env.SDLC_API_URL ?? 'http://localhost:8088';
const api = (method, path, body, actor = 'e2e') =>
  fetch(API + path, {
    method,
    headers: {'Content-Type': 'application/json', 'X-SDLC-Actor': actor},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const getJSON = async (path) => (await api('GET', path)).json();
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── данные ──────────────────────────────────────────────────────────────────
const created = await (await api('POST', '/v1/projects/SDLC/tasks', {
  title: 'Уровень модели: задача сценария',
  repositories: ['cadence-lab-tech/sdlc-pipeline-frontend'],
})).json();
const KEY = created.key;
if (!KEY) throw new Error('задача не заведена: ' + JSON.stringify(created));
console.log(`задача сценария ${KEY}`);

// Запись запросов правки уровня: тело каждого PATCH задачи сценария. Ответ
// задерживается, чтобы увидеть занятый ползунок; подмена отказа включается
// флагом в sessionStorage, а не новым скриптом на каждый случай.
const recorder = (key) => `
  const realFetch = window.fetch;
  window.__patches = [];
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init && init.method) || 'GET';
    if (method === 'PATCH' && new RegExp('/v1/tasks/${key}$').test(url)) {
      window.__patches.push(init.body);
      await new Promise((r) => setTimeout(r, 1200));
      const deny = sessionStorage.getItem('e2e.denyLevel');
      if (deny) {
        const [status, code, message] = JSON.parse(deny);
        return new Response(JSON.stringify({error: {code, message}}), {status, headers: {'Content-Type': 'application/json'}});
      }
    }
    return realFetch(input, init);
  };
`;

const s = await session('about:blank');
const run = (body) => s.evaluate(helpers + body);
const recorderId = await s.addInitScript(recorder(KEY));
await s.goto(BASE + `/p/SDLC/tasks/${KEY}`);
await wait(2000);

const SLIDER = `document.querySelector('[data-task-model-level] [data-model-level]')`;
const state = `
  const g = ${SLIDER};
  if (!g) return {missing: true};
  const items = Array.from(g.querySelectorAll('[data-level]'));
  return {
    level: g.getAttribute('data-model-level'),
    labels: items.map((b) => (b.innerText || '').trim()),
    disabled: items.map((b) => b.disabled),
    busy: g.getAttribute('aria-busy') === 'true',
    title: g.getAttribute('title'),
    text: (g.closest('[data-task-model-level]')?.innerText || '').trim(),
  };
`;
const pick = (level) => `
  const b = ${SLIDER}.querySelector('[data-level="${level}"]');
  b.click();
  return true;
`;
const patches = () => run('return window.__patches;');
const serverLevel = async () => (await getJSON(`/v1/tasks/${KEY}`)).task.model_level;

console.log('ползунок задачи в «Деталях»');
let st = await run(state);
let t = await run('return texts();');
check('строка «Уровень модели» в «Деталях»', t.includes('Уровень модели'), t.slice(0, 400));
check('четыре положения: авто, low, medium, high', JSON.stringify(st.labels) === '["авто","low","medium","high"]', JSON.stringify(st));
check('null с сервера — «авто»', st.level === 'auto' && (await serverLevel()) === null, JSON.stringify(st));
check('в режиме header ползунок доступен', st.disabled.every((d) => !d), JSON.stringify(st));
check('без выбранного этапа уровня этапа на карточке нет', !t.includes('stage_settings') && !t.includes('Уровень этапа'), t.slice(0, 400));

console.log('выбор high');
await run(`window.__marker = 'та же страница'; return true;`);
await run(pick('high'));
await wait(300);
st = await run(state);
check('пока запрос идёт, ползунок занят', st.busy && st.disabled.every(Boolean), JSON.stringify(st));
await wait(2500);
st = await run(state);
let sent = await patches();
check('ушёл ровно один PATCH с {"model_level":"high"}', sent.length === 1 && sent[0] === '{"model_level":"high"}', JSON.stringify(sent));
check('сервер отдаёт high', (await serverLevel()) === 'high');
check('ползунок стоит на high и снова доступен', st.level === 'high' && !st.busy && st.disabled.every((d) => !d), JSON.stringify(st));
check('карточка перечитана без перезагрузки', (await run('return window.__marker;')) === 'та же страница');
const events = await getJSON(`/v1/tasks/${KEY}/timeline`);
check('в ленте есть task.updated', (events.events ?? []).some((e) => e.type === 'task.updated'), JSON.stringify((events.events ?? []).map((e) => e.type)));

console.log('повторный выбор того же положения');
await run(pick('high'));
await wait(1800);
check('запрос не уходит', (await patches()).length === 1, JSON.stringify(await patches()));

console.log('выбор «авто»');
await run(pick('auto'));
await wait(2800);
sent = await patches();
check('ушёл {"model_level":""}', sent.length === 2 && sent[1] === '{"model_level":""}', JSON.stringify(sent));
check('сервер отдаёт null', (await serverLevel()) === null);
check('ползунок на «авто»', (await run(state)).level === 'auto');

console.log('отказ сервера');
for (const [status, code, message] of [
  [403, 'forbidden', 'уровень задачи меняет сопровождающий (e2e 403)'],
  [400, 'invalid_input', 'недопустимый уровень (e2e 400)'],
]) {
  await run(`sessionStorage.setItem('e2e.denyLevel', ${JSON.stringify(JSON.stringify([status, code, message]))}); return true;`);
  await run(pick('medium'));
  await wait(2800);
  t = await run('return texts();');
  st = await run(state);
  const near = await run(`
    const box = document.querySelector('[data-task-model-level]');
    return box ? box.innerText.replace(/\\s+/g, ' ') : '';
  `);
  check(`${status}: у ползунка ошибка с текстом сервера`, near.includes('Уровень не изменён') && near.includes(message), near);
  check(`${status}: положение вернулось к значению сервера`, st.level === 'auto', JSON.stringify(st));
  check(`${status}: на сервере уровень не изменился`, (await serverLevel()) === null);
}
await run(`sessionStorage.removeItem('e2e.denyLevel'); return true;`);

console.log('только чтение');
// Кто я — подменяется ответ /auth/me; команды проекта стенд отдаёт
// настоящие. Уровень выбирается флагом, чтобы одним скриптом пройти
// наблюдателя, сопровождающего и администратора системы.
const WHO = `
  const prevFetch = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const who = sessionStorage.getItem('e2e.who');
    if (!who || !/\\/v1\\/auth\\/me$/.test(url)) return prevFetch(input, init);
    if (who === 'fail-card' && new Error().stack.includes('useTaskLevelEditable')) {
      return new Response(JSON.stringify({error: {code: 'internal', message: 'сбой (e2e)'}}), {status: 500, headers: {'Content-Type': 'application/json'}});
    }
    const res = await prevFetch(input, init);
    const me = await res.json();
    me.mode = 'token';
    me.authenticated = true;
    if (who === 'viewer' || who === 'maintainer') {
      me.memberships = [{project_key: 'SDLC', project_id: '', principal_id: me.principal.id, handle: me.principal.handle, kind: 'user', display_name: '', role: who, role_keys: null, created_at: ''}];
      me.teams = [];
    }
    if (who === 'admin') me.principal = {...me.principal, is_admin: true};
    return new Response(JSON.stringify(me), {status: 200, headers: {'Content-Type': 'application/json'}});
  };
`;
const asWho = await s.addInitScript(WHO);
const as = async (who) => {
  await run(`sessionStorage.setItem('e2e.who', ${JSON.stringify(who)}); return true;`);
  await s.goto(BASE + `/p/SDLC/tasks/${KEY}`);
  await wait(2000);
  // Под нагрузкой карточка грузится дольше: ждём ползунок, а не только таймер.
  for (let i = 0; i < 20; i++) {
    const st = await run(state);
    if (!st.missing) return st;
    await wait(500);
  }
  return run(state);
};
// Положение задаётся на сервере, чтобы видеть, что выключенный ползунок
// показывает текущее значение, а не «авто».
await api('PATCH', `/v1/tasks/${KEY}`, {model_level: 'medium'});
st = await as('viewer');
check('наблюдатель: ползунок выключен', st.disabled.every(Boolean), JSON.stringify(st));
check('наблюдатель: показан текущий уровень', st.level === 'medium', JSON.stringify(st));
check('наблюдатель: причина — во всплывающей подсказке', st.title === 'Уровень задачи меняет сопровождающий проекта', JSON.stringify(st));
check('наблюдатель: отдельной строки под ползунком нет', !st.text.includes('сопровождающий'), JSON.stringify(st));
const before = (await patches()).length;
await run(pick('high'));
await wait(1800);
check('наблюдатель: клик запроса не шлёт', (await patches()).length === before, JSON.stringify(await patches()));
for (const who of ['maintainer', 'admin']) {
  st = await as(who);
  check(`${who === 'admin' ? 'администратор системы' : 'сопровождающий'}: ползунок доступен`, st.disabled.every((d) => !d), JSON.stringify(st));
  check(`${who === 'admin' ? 'администратор системы' : 'сопровождающий'}: подсказки нет`, !st.title, JSON.stringify(st));
}
st = await as('fail-card');
check('кто я — не загрузилось: ползунок доступен', !st.missing && st.disabled.every((d) => !d), JSON.stringify(st));
await run(`sessionStorage.removeItem('e2e.who'); return true;`);
await s.removeInitScript(asWho);
await s.removeInitScript(recorderId);

// ── строка прогона ──────────────────────────────────────────────────────────
console.log('строка прогона');
await api('PATCH', `/v1/tasks/${KEY}`, {model_level: 'high'});
const steps = [
  await api('POST', `/v1/tasks/${KEY}/transitions/start`, {}),
  await api('POST', `/v1/tasks/${KEY}/claim`, {role: 'analyst'}, 'agent:analyst-bot'),
];
check('этап забран агентом', steps.every((r) => r.ok), steps.map((r) => r.status).join(','));
// Строка прогона стоит в панели его статуса (?stage=), а не в обзоре: список
// всех прогонов на карточке убран вместе с вкладкой (CLAB-286).
const claimedStatus = (await getJSON(`/v1/tasks/${KEY}`)).task.status_key;
const runLines = async () => {
  await s.goto(BASE + `/p/SDLC/tasks/${KEY}?stage=${encodeURIComponent(claimedStatus)}`);
  await wait(2200);
  return run(`return all('[data-run-model]').map((el) => el.innerText.trim());`);
};
let detail = await getJSON(`/v1/tasks/${KEY}`);
const claimed = detail.stage_runs.find((r) => r.claimed_by_handle);
check('снимок на прогоне: high из задачи', claimed?.model_level === 'high' && claimed?.model_level_source === 'task', JSON.stringify(claimed));
let lines = await runLines();
check('без отчёта: «рекомендован high · фактически: нет данных»',
  lines.length === 1 && lines[0] === 'рекомендован high · фактически: нет данных', JSON.stringify(lines));

const usage = (model) => api('POST', `/v1/tasks/${KEY}/usage`, {model, input_tokens: 10, output_tokens: 5, cost_usd: 0.25}, 'agent:analyst-bot');
check('отчёт о стоимости принят', (await usage('claude-opus-5-5')).ok);
lines = await runLines();
check('с отчётом: «рекомендован high · фактически claude-opus-5-5»',
  lines.length === 1 && lines[0] === 'рекомендован high · фактически claude-opus-5-5', JSON.stringify(lines));
await usage('claude-haiku-4-5');
lines = await runLines();
check('две модели — в порядке отчётов',
  lines[0] === 'рекомендован high · фактически claude-opus-5-5, claude-haiku-4-5', JSON.stringify(lines));
t = await run('return texts();');
check('в строке нет источника, стоимости и токенов', !/0\.25|0\.50|источник|токен/.test(lines[0]), lines[0]);
// Прогон статуса new заведён без снимка и без отчёта — строки у него нет,
// даже раскрытого.
const newRun = await (async () => {
  await s.goto(BASE + `/p/SDLC/tasks/${KEY}?stage=new`);
  await wait(2200);
  return run(`
    const card = document.querySelector('[data-stage-panel] [data-stage-run]');
    if (!card) return 'нет';
    const trigger = card.querySelector('[data-slot=collapsible-trigger]');
    if (card.getAttribute('data-state') !== 'open' && trigger) { trigger.click(); await sleep(500); }
    return card.querySelectorAll('[data-run-model]').length;
  `);
})();
check('прогон без снимка и без отчёта — без строки', newRun === 0, String(newRun));
await api('POST', `/v1/tasks/${KEY}/release`, {note: 'сценарий уровня модели'}, 'agent:analyst-bot');

// ── уровень этапа в панели этапа (CLAB-285) ─────────────────────────────────
// Своя задача: уровень этапа берёт следующий захват, а у задачи выше прогон
// уже забран. Статус с ролью и без неё — из версии цикла задачи, а не по
// ключам из головы.
console.log('уровень этапа: ползунок в панели этапа');
const stageTask = await (await api('POST', '/v1/projects/SDLC/tasks', {
  title: 'Уровень этапа: задача сценария',
  repositories: ['cadence-lab-tech/sdlc-pipeline-frontend'],
})).json();
const KEY2 = stageTask.key;
if (!KEY2) throw new Error('задача не заведена: ' + JSON.stringify(stageTask));
const version2 = await getJSON(`/v1/workflows/${stageTask.workflow_id}`);
const byPos = [...version2.statuses].sort((a, b) => a.position - b.position);
const initial2 = byPos.find((x) => x.is_initial) ?? byPos[0];
const startT = version2.transitions.find((x) => x.from_status_id === initial2.id && x.kind === 'advance');
const ROLED = version2.statuses.find((x) => x.id === startT.to_status_id);
const ROLELESS = byPos.filter((x) => !(x.roles ?? []).length);
if (!(ROLED.roles ?? []).length || !ROLELESS.length) throw new Error('в версии нет статуса с ролью или без неё');

const recorder2 = await s.addInitScript(recorder(KEY2));
const STAGE_SLIDER = `document.querySelector('[data-stage-model-level] [data-model-level]')`;
const stageState = state.replace(SLIDER, STAGE_SLIDER).replace("closest('[data-task-model-level]')", "closest('[data-stage-model-level]')");
const stagePick = (level) => pick(level).replace(SLIDER, STAGE_SLIDER);
const openStage = async (key) => {
  await s.goto(BASE + `/p/SDLC/tasks/${KEY2}?stage=${encodeURIComponent(key)}`);
  await wait(1800);
  for (let i = 0; i < 20; i++) {
    const panel = await run(`return Boolean(document.querySelector('[data-stage-panel]'));`);
    if (panel) break;
    await wait(500);
  }
  return run(stageState);
};
const serverStage = async () => (await getJSON(`/v1/tasks/${KEY2}`)).task.stage_settings?.[ROLED.key]?.model_level ?? null;

st = await openStage(ROLED.key);
check('у статуса с ролью — ползунок этапа', !st.missing && JSON.stringify(st.labels) === '["авто","low","medium","high"]', JSON.stringify(st));
check('без уровня этапа — «авто»', st.level === 'auto' && (await serverStage()) === null, JSON.stringify(st));
check('в режиме header ползунок этапа доступен', st.disabled.every((d) => !d), JSON.stringify(st));
for (const x of ROLELESS) {
  st = await openStage(x.key);
  check(`у статуса без роли (${x.name}) ползунка нет`, st.missing, JSON.stringify(st));
}

st = await openStage(ROLED.key);
await run(stagePick('high'));
await wait(300);
st = await run(stageState);
check('пока запрос идёт, ползунок этапа занят', st.busy && st.disabled.every(Boolean), JSON.stringify(st));
await wait(2500);
sent = await run('return window.__patches;');
check('ушёл PATCH с stage_settings по ключу статуса',
  sent.length === 1 && sent[0] === JSON.stringify({stage_settings: {[ROLED.key]: {model_level: 'high'}}}), JSON.stringify(sent));
check('сервер отдаёт уровень этапа high', (await serverStage()) === 'high');
check('уровень задачи не тронут', (await getJSON(`/v1/tasks/${KEY2}`)).task.model_level == null);
check('ползунок этапа на high', (await run(stageState)).level === 'high');
st = await openStage(ROLED.key);
check('после перезагрузки — то же положение', st.level === 'high', JSON.stringify(st));

for (const [status, code, message] of [
  [403, 'forbidden', 'уровень этапа меняет сопровождающий (e2e 403)'],
  [400, 'invalid_input', 'недопустимый уровень этапа (e2e 400)'],
]) {
  await run(`sessionStorage.setItem('e2e.denyLevel', ${JSON.stringify(JSON.stringify([status, code, message]))}); return true;`);
  await run(stagePick('low'));
  await wait(2800);
  const near = await run(`
    const box = document.querySelector('[data-stage-model-level]');
    return box ? box.innerText.replace(/\\s+/g, ' ') : '';
  `);
  check(`этап, ${status}: ошибка у ползунка с текстом сервера`, near.includes('Уровень этапа не изменён') && near.includes(message), near);
  check(`этап, ${status}: положение прежнее`, (await run(stageState)).level === 'high');
  check(`этап, ${status}: на сервере прежний уровень`, (await serverStage()) === 'high');
}
await run(`sessionStorage.removeItem('e2e.denyLevel'); return true;`);

const who2 = await s.addInitScript(WHO);
await run(`sessionStorage.setItem('e2e.who', 'viewer'); return true;`);
st = await openStage(ROLED.key);
check('наблюдатель: ползунок этапа выключен', st.disabled.every(Boolean), JSON.stringify(st));
check('наблюдатель: показан уровень этапа', st.level === 'high', JSON.stringify(st));
check('наблюдатель: причина — во всплывающей подсказке', st.title === 'Уровень этапа меняет сопровождающий проекта', JSON.stringify(st));
const before2 = (await run('return window.__patches;')).length;
await run(stagePick('medium'));
await wait(1800);
check('наблюдатель: клик запроса не шлёт', (await run('return window.__patches;')).length === before2);
await run(`sessionStorage.setItem('e2e.who', 'maintainer'); return true;`);
st = await openStage(ROLED.key);
check('сопровождающий: ползунок этапа доступен', st.disabled.every((d) => !d) && !st.title, JSON.stringify(st));
await run(`sessionStorage.removeItem('e2e.who'); return true;`);
await s.removeInitScript(who2);

// Уровень, выставленный ползунком, берёт следующий захват этапа — с
// источником stage.
const started = await api('POST', `/v1/tasks/${KEY2}/transitions/${startT.key}`, {});
const claim2 = await api('POST', `/v1/tasks/${KEY2}/claim`, {role: ROLED.roles[0].role_key}, 'agent:analyst-bot');
check('этап с уровнем забран агентом', started.ok && claim2.ok, `${started.status} ${claim2.status}`);
const snap = (await getJSON(`/v1/tasks/${KEY2}`)).stage_runs.find((r) => r.status_key === ROLED.key && !r.parent_run_id);
check('снимок прогона: high с источником stage', snap?.model_level === 'high' && snap?.model_level_source === 'stage', JSON.stringify(snap));
await api('POST', `/v1/tasks/${KEY2}/release`, {note: 'сценарий уровня этапа'}, 'agent:analyst-bot');

st = await openStage(ROLED.key);
await run('window.__patches = []; return true;');
await run(stagePick('auto'));
await wait(2800);
sent = await run('return window.__patches;');
check('«авто» — пустая строка в stage_settings',
  sent.length === 1 && sent[0] === JSON.stringify({stage_settings: {[ROLED.key]: {model_level: ''}}}), JSON.stringify(sent));
check('сервер снял уровень этапа', (await serverStage()) === null);
check('ползунок этапа на «авто»', (await run(stageState)).level === 'auto');
await s.removeInitScript(recorder2);

// ── редактор роли ───────────────────────────────────────────────────────────
console.log('редактор роли: ползунок и перенос model_hint');
const stamp = Date.now().toString(36);
const ROLE = `e2e-level-${stamp}`;
const BARE = `e2e-bare-${stamp}`;
const roleRes = await api('POST', '/v1/projects/SDLC/roles', {
  key: ROLE,
  name: `Уровень ${stamp}`,
  version: {instructions: 'Роль сценария уровня модели.', model_hint: 'claude-legacy-hint', model_level: 'medium'},
});
const bareRes = await api('POST', '/v1/projects/SDLC/roles', {key: BARE, name: `Без версий ${stamp}`});
check('роли сценария заведены', roleRes.ok && bareRes.ok, `${roleRes.status} ${bareRes.status}`);

const openRole = async (name) => {
  await s.goto(BASE + '/p/SDLC/roles');
  await wait(1800);
  await run(`
    const row = all('[role=button], button, div').find((el) => (el.innerText || '').trim().startsWith(${JSON.stringify(name)}));
    if (!row) throw new Error('роль не найдена: ' + ${JSON.stringify(name)});
    row.click();
    await sleep(1200);
    return true;
  `);
};
const formLevel = `
  const g = all('[data-model-level]').find((el) => el.closest('[data-slot=card]') && (el.closest('[data-slot=card]').innerText || '').includes('Новая версия'));
  return g ? g.getAttribute('data-model-level') : 'нет ползунка';
`;
const formPick = (level) => `
  const g = all('[data-model-level]').find((el) => el.closest('[data-slot=card]') && (el.closest('[data-slot=card]').innerText || '').includes('Новая версия'));
  g.querySelector('[data-level="${level}"]').click();
  await sleep(300);
  return true;
`;
const versionLevels = () => run(`return all('[data-version-model-level]').map((el) => el.getAttribute('data-version-model-level'));`);

await openRole(`Уровень ${stamp}`);
t = await run('return texts();');
check('карточка версии показывает уровень', (await versionLevels()).join() === 'medium' && t.includes('уровень medium'), t.slice(0, 500));
check('model_hint на экране нет', !t.includes('claude-legacy-hint') && !t.includes('model_hint'), t.slice(0, 500));
await run('await clickExact("Новая версия"); return true;');
check('форма открыта с уровнем базовой версии', (await run(formLevel)) === 'medium', await run(formLevel));
t = await run('return texts();');
check('в форме model_hint нет', !t.includes('claude-legacy-hint') && !t.includes('model_hint'), t.slice(0, 600));
await run(formPick('low'));
await run('await clickExact("Сохранить версию"); await sleep(1500); return true;');
let v = await getJSON(`/v1/projects/SDLC/roles/${ROLE}/versions/2`);
check('версия 2 с уровнем low', v.model_level === 'low', JSON.stringify(v).slice(0, 300));
check('model_hint базовой версии перенесён как был', v.model_hint === 'claude-legacy-hint', String(v.model_hint));
check('у актуальной версии виден уровень low', (await versionLevels())[0] === 'low', JSON.stringify(await versionLevels()));

await run('await clickExact("Новая версия"); return true;');
await run(formPick('auto'));
await run('await clickExact("Сохранить версию"); await sleep(1500); return true;');
v = await getJSON(`/v1/projects/SDLC/roles/${ROLE}/versions/3`);
check('«авто» — версия без уровня', v.version === 3 && v.model_level === undefined, JSON.stringify(v).slice(0, 300));
check('model_hint по-прежнему перенесён', v.model_hint === 'claude-legacy-hint', String(v.model_hint));
check('у версии без уровня метки нет', JSON.stringify(await versionLevels()) === '["low","medium"]', JSON.stringify(await versionLevels()));

console.log('редактор роли: первая версия');
await openRole(`Без версий ${stamp}`);
await run('await clickExact("Новая версия"); return true;');
check('у роли без версий ползунок на «авто»', (await run(formLevel)) === 'auto', await run(formLevel));
await run(`
  const ta = all('textarea')[0];
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, 'Первая версия из формы.');
  ta.dispatchEvent(new Event('input', {bubbles: true}));
  await sleep(300);
  return true;
`);
await run(formPick('high'));
await run('await clickExact("Сохранить версию"); await sleep(1500); return true;');
await run('await clickExact("Новая версия"); return true;');
check('следующая форма открыта с high', (await run(formLevel)) === 'high', await run(formLevel));
await run('await clickExact("Сохранить версию"); await sleep(1500); return true;');
const bare1 = await getJSON(`/v1/projects/SDLC/roles/${BARE}/versions/1`);
const bare2 = await getJSON(`/v1/projects/SDLC/roles/${BARE}/versions/2`);
check('первая версия с high и без model_hint', bare1.model_level === 'high' && bare1.model_hint === undefined, JSON.stringify(bare1).slice(0, 300));
check('у базовой без model_hint — у новой его тоже нет', bare2.model_level === 'high' && bare2.model_hint === undefined, JSON.stringify(bare2).slice(0, 300));

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
