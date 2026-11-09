// Раздел «Агенты и модели» в настройках проекта (CLAB-429, решение 0077):
// пустое состояние, заведение черновика, правка таблицей и JSON, проверка
// сервера по полям (AC-6, AC-7), разница, активация и удаление, история с
// панелью версии, предупреждение об уходе, право (maintainer, наблюдатель,
// агент), отказы 403/404/409/5xx и сервер без ручек.
//
// Свой проект `AS<число>`, заведённый ручкой API, — сценарий повторяется на той
// же базе. Стенд в режиме header: кто я (`/auth/me`) и отказы, которых header
// не даёт (403, 409 активации, сбои чтения, сервер без ручек), подменяются в
// браузере ответом одной ручки; всё остальное идёт в настоящий сервер.
import {writeFileSync} from 'node:fs';
import {session, helpers} from './driver.mjs';

const BASE = process.env.SDLC_UI_URL ?? 'http://localhost:5173';
const API = process.env.SDLC_API_URL ?? 'http://localhost:8088';
const SHOTS = process.env.SDLC_E2E_SHOTS;
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};
const call = (method, path, body, actor = 'e2e') =>
  fetch(API + '/v1' + path, {
    method,
    headers: {'X-SDLC-Actor': actor, 'Content-Type': 'application/json'},
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null)}));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const sortDeep = (v) => Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])])) : v;
const eq = (a, b) => JSON.stringify(sortDeep(a)) === JSON.stringify(sortDeep(b));

const PK = `AS${Math.floor(Math.random() * 9000 + 1000)}`;
const created = await call('POST', '/projects', {key: PK, name: `Агенты ${PK}`});
check('свой проект заведён (API)', created.status === 201, JSON.stringify(created).slice(0, 200));
const AS = `/projects/${PK}/agent-settings`;
const url = `${BASE}/p/${PK}/settings`;

const s = await session(url);
await s.addInitScript(`
  window.__log = [];
  const prev = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = ((init && init.method) || 'GET').toUpperCase();
    const cfg = JSON.parse(sessionStorage.getItem('e2e.as') || '{}');
    const json = (status, body) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
    if (url.includes('agent-settings')) window.__log.push({m: method, u: url.replace(/^.*\\/v1/, ''), b: init && init.body ? String(init.body) : ''});
    if (cfg.me && /\\/v1\\/auth\\/me$/.test(url)) {
      const me = await (await prev(input, init)).json();
      me.mode = 'token'; me.authenticated = true; me.teams = [];
      if (cfg.kind) me.principal.kind = cfg.kind;
      me.principal.is_admin = false;
      me.memberships = [{project_key: '${PK}', role: cfg.me, role_keys: null}];
      return json(200, me);
    }
    if (cfg.oldServer && url.includes('agent-settings')) return new Response('404 page not found', {status: 404});
    if (cfg.readFails && method === 'GET' && /agent-settings$/.test(url)) return json(500, {error: {code: 'internal', message: 'сбой хранилища (e2e)'}});
    if (cfg.versionsFail && method === 'GET' && /agent-settings\\/versions$/.test(url)) return json(500, {error: {code: 'internal', message: 'список версий недоступен (e2e)'}});
    if (cfg.deny && method !== 'GET' && url.includes('agent-settings')) {
      return json(403, {error: {code: 'forbidden', message: 'настройку агентов проекта правит сопровождающий (e2e-текст сервера)', details: {reason: cfg.deny}}});
    }
    if (cfg.activate409 && method === 'POST' && /draft\\/activate$/.test(url)) {
      return json(409, {error: {code: 'conflict', message: 'черновик — версия 5', details: {draft_version: 5, requested: 4}}});
    }
    return prev(input, init);
  };
`);
const setup = async (cfg = {}, actor = 'e2e') => {
  await s.evaluate(`
    sessionStorage.setItem('e2e.as', ${JSON.stringify(JSON.stringify(cfg))});
    localStorage.setItem('sdlc.actor', ${JSON.stringify(actor)});
    localStorage.setItem('sdlc.theme', ${JSON.stringify(cfg.theme ?? 'light')});
    return true;
  `);
};
const open = async () => {
  await s.goto(url);
  await pause(1200);
  await run(`await waitFor('#agent-settings'); await waitFor('[data-block], [role=status], [role=alert], p', 8000); await sleep(1500); return true;`);
};
const WAIT = `
  const waitFor = async (sel, ms = 6000) => {
    for (let i = 0; i < ms / 100 && !document.querySelector(sel); i++) await sleep(100);
    const el = document.querySelector(sel);
    if (!el) throw new Error('нет на странице: ' + sel);
    return el;
  };
  const gone = async (sel, ms = 5000) => {
    for (let i = 0; i < ms / 100 && document.querySelector(sel); i++) await sleep(100);
    return !document.querySelector(sel);
  };
  const sec = () => (document.querySelector('#agent-settings')?.innerText || '').replace(/\\s+/g, ' ');
  const field = (path) => Array.from(document.querySelectorAll('[data-path="' + path + '"]')).find((e) => /^(INPUT|TEXTAREA|BUTTON)$/.test(e.tagName));
  const errCaption = (path) => Array.from(document.querySelectorAll('p[data-path="' + path + '"]')).map((e) => e.innerText)[0];
  const setVal = async (el, value) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', {bubbles: true}));
    await sleep(200);
  };
  const setField = async (path, value) => { const el = field(path); if (!el) throw new Error('нет поля ' + path); await setVal(el, value); };
  const byLabel = (t) => {
    const lbl = all('label').find((l) => l.innerText.trim().startsWith(t));
    return lbl && document.getElementById(lbl.getAttribute('for'));
  };
  const setLabel = async (t, value) => { const el = byLabel(t); if (!el) throw new Error('нет поля ' + t); await setVal(el, value); };
  const btn = (t) => all('#agent-settings button').find((b) => (b.innerText || '').trim() === t);
  const aria = (t) => all('#agent-settings button').find((b) => b.getAttribute('aria-label') === t);
  const act = (a) => document.querySelector('#agent-settings [data-action="' + a + '"]');
  const log = () => window.__log;
  // Выбор в Radix Select: он открывается по pointerdown и закрывается по клику на пункте.
  const pick = async (path, label) => {
    const f = field(path);
    f.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, button: 0, pointerType: 'mouse'}));
    await sleep(500);
    const o = all('[role=option]').find((x) => x.innerText.trim() === label);
    if (!o) throw new Error('нет пункта ' + label + ': ' + all('[role=option]').map((x) => x.innerText.trim()).join('|'));
    o.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, pointerType: 'mouse'}));
    o.click();
    await sleep(500);
  };
  const dlg = () => (document.querySelector('[role=alertdialog]')?.innerText || '').replace(/\\s+/g, ' ');
  const tab = (t) => all('#agent-settings [role=tab]').find((e) => e.innerText.trim() === t);
`;
const run = (body) => s.evaluate(helpers + WAIT + body);
const shot = async (name) => {
  if (SHOTS) writeFileSync(`${SHOTS}/agent-settings-${name}.png`, Buffer.from(await s.screenshot(), 'base64'));
};
const apiState = async () => (await call('GET', AS)).body;
const draftApi = async () => {
  const list = (await call('GET', `${AS}/versions`)).body.versions;
  const d = list.find((v) => v.state === 'draft');
  return d ? (await call('GET', `${AS}/versions/${d.version}`)).body : null;
};
await s.resize(1440, 1000);

// ── пустое состояние (UC-2, AC-3) ───────────────────────────────────────────
console.log('настройки нет: пустое состояние и форма заведения (AC-3, AC-4)');
await setup();
await open();
let t = await run(`return sec();`);
check('заголовок и описание раздела', t.includes('Агенты и модели') && t.includes('Версии идут по цепочке: черновик, активна, снята'), t.slice(0, 200));
check('«Настройки агентов нет» и что берут агенты', t.includes('Настройки агентов нет') && t.includes('агенты берут таблицу привязки по умолчанию') && t.includes('суммы считаются так, как их сообщил агент'));
check('три строки умолчаний', t.includes('claude: low → haiku, medium → sonnet, high → opus') && t.includes('codex: таблицы нет') && t.includes('generic: таблицы нет'));
check('ошибки нет', !t.includes('не загрузилась'));
check('форма «Завести черновик» у сопровождающего', await run(`return Boolean(act('create'));`));
check('«Основа» только «Пустым» и выключена, пока активной нет', await run(`const f = field('create.from'); return f && f.disabled && f.innerText.includes('Пустым');`));
check('Note «только чтение» нет', !t.includes('Только чтение'));
check('другие разделы страницы на месте', (await run(`return texts();`)).includes('Перенос правил'));

await run(`await setField('changelog', 'Первая настройка'); act('create').click(); await sleep(1500); return true;`);
let tt = await run(`return sec();`);
check('заведён черновик: редактор «Черновик · версия 1»', tt.includes('Черновик · версия 1') && await run(`return Boolean(act('save'))`), tt.slice(0, 300));
check('тост «Черновик версии 1 заведён»', (await run(`return toasts();`)).some((x) => x.includes('Черновик версии 1 заведён')));
let d1 = await draftApi();
check('на сервере черновик 1, changelog передан, документ пустой', d1 && d1.version === 1 && d1.changelog === 'Первая настройка' && eq(d1.document, {}));
check('тело запроса: from empty и changelog', await run(`const p = log().find((x) => x.m === 'POST' && /draft$/.test(x.u)); return p && p.b === JSON.stringify({from: 'empty', changelog: 'Первая настройка'});`));
check('«изменено» нет, «Сохранить» и «Сбросить» выключены', await run(`return act('save').disabled && act('reset').disabled && !sec().includes('изменено');`));
check('якорь раздела и data-state', await run(`return document.querySelector('#agent-settings [data-draft][data-state=draft]') !== null;`));

// ── правка таблицей (UC-4, AC-5) ────────────────────────────────────────────
console.log('черновик: правка таблицей и сохранение (AC-5)');
await run(`btn('Добавить агента').click(); await sleep(500); return true;`);
check('агент claude добавлен', (await run(`return sec();`)).includes('Доступные модели') && await run(`return Boolean(document.querySelector('[data-path="agents.claude"]'));`));
check('«изменено» появилось и объявлено', await run(`return sec().includes('изменено') && document.querySelector('[role=status]').innerText.includes('Есть несохранённые правки');`));
check('«Сохранить» доступна', await run(`return !act('save').disabled && !act('reset').disabled;`));
check('подсказка «Список пуст: доступны любые модели»', (await run(`return sec();`)).includes('Список пуст: доступны любые модели'));
await run(`await setField('agents.claude.levels.high.model', 'claude-opus-5-5'); await setField('agents.claude.levels.high.effort', 'high'); await setField('agents.claude.levels.low.model', 'claude-haiku-4-5'); return true;`);
await run(`btn('Добавить прайс').click(); await sleep(400); btn('Добавить модель в прайс').click(); await sleep(400); return true;`);
await run(`await setLabel('Id модели 1', 'gpt-6.1-sol'); await setField('pricing.models.gpt-6.1-sol.input', '1.5'); await setField('pricing.models.gpt-6.1-sol.output', '0.'); await setField('pricing.as_of', '2026-11-01'); return true;`);
check('цену можно набрать с точкой: «0.» остаётся в поле', await run(`return field('pricing.models.gpt-6.1-sol.output').value === '0.';`));
check('поле прайса с id с точками найдено по серверному пути', await run(`return Boolean(field('pricing.models.gpt-6.1-sol.cache_read'));`));
await run(`act('save').click(); await sleep(1500); return true;`);
d1 = await draftApi();
check('PUT: документ целиком ушёл и сохранён', eq(d1.document, {agents: {claude: {levels: {high: {effort: 'high', model: 'claude-opus-5-5'}, low: {model: 'claude-haiku-4-5'}}}}, pricing: {as_of: '2026-11-01', models: {'gpt-6.1-sol': {input: 1.5, output: 0}}}}), JSON.stringify(d1.document));
check('тост «Черновик сохранён», «изменено» снято', (await run(`return toasts();`)).some((x) => x.includes('Черновик сохранён')) && !(await run(`return sec();`)).includes('изменено'));
check('тело PUT: document и changelog', await run(`const p = log().filter((x) => x.m === 'PUT').pop(); const b = JSON.parse(p.b); return Object.keys(b).sort().join() === 'changelog,document' && b.changelog === 'Первая настройка';`));

// ── проверка сервера по полям (AC-6, AC-7) ──────────────────────────────────
console.log('отказ проверки: баннер, поле, значения целы (AC-6, AC-7)');
await run(`await setField('agents.claude.levels.high.effort', 'bad effort!'); act('save').click(); await sleep(1500); return true;`);
tt = await run(`return sec();`);
check('баннер «Черновик не сохранён» с пояснением, что на сервере прежний', tt.includes('Черновик не сохранён') && tt.includes('Черновик на сервере остался прежним') && tt.includes('по одной ошибке'), tt.slice(0, 600));
check('баннер: role=alert, путь поля и текст сервера', await run(`const a = document.querySelector('#agent-settings [role=alert]'); const x = a ? a.innerText : ''; return x.includes('Путь: agents.claude.levels.high.effort') && x.includes('effort');`));
check('ошибка у поля по точному пути: aria-invalid и подпись', await run(`const f = field('agents.claude.levels.high.effort'); return f.getAttribute('aria-invalid') === 'true' && Boolean(errCaption('agents.claude.levels.high.effort')) && f.getAttribute('aria-describedby') !== null;`));
check('фокус на поле с ошибкой', await run(`return document.activeElement === field('agents.claude.levels.high.effort');`));
check('набранные значения остались, чужие поля без ошибки', await run(`return field('agents.claude.levels.high.effort').value === 'bad effort!' && field('agents.claude.levels.high.model').value === 'claude-opus-5-5' && !field('agents.claude.levels.low.model').hasAttribute('aria-invalid');`));
check('«Перейти к полю» есть', await run(`return all('#agent-settings button').some((b) => b.innerText.trim() === 'Перейти к полю');`));
check('на сервере черновик прежний', eq((await draftApi()).document.agents.claude.levels.high, {effort: 'high', model: 'claude-opus-5-5'}));
check('тост об ошибке короткий, без текста сервера', (await run(`return toasts();`)).every((x) => !x.includes('effort —')) && (await run(`return toasts();`)).some((x) => x.includes('Черновик не сохранён')));
await run(`await setField('agents.claude.levels.high.effort', 'high'); return true;`);
check('правка поля снимает его ошибку', await run(`return !field('agents.claude.levels.high.effort').hasAttribute('aria-invalid') && !errCaption('agents.claude.levels.high.effort');`));

// Секрет: значение не выводится ни в баннер, ни в подпись, ни в тост
await run(`btn('Добавить модель').click(); await sleep(400); await setLabel('Модель 1 агента claude', 'sdlc_TOPSECRETVALUE123'); act('save').click(); await sleep(1500); return true;`);
const leak = await run(`
  const a = document.querySelector('#agent-settings [role=alert]');
  const caps = all('p[data-path]').map((p) => p.innerText).join(' ');
  return {banner: a ? a.innerText : '', caps, toast: toasts().join(' '), page: sec()};
`);
check('секрет: баннер с путём models[0] есть', leak.banner.includes('agents.claude.models[0]'), leak.banner.slice(0, 300));
check('секрет: значения нет ни в баннере, ни в подписи под полем, ни в тосте, ни в тексте раздела', !JSON.stringify(leak).includes('TOPSECRETVALUE'), JSON.stringify(leak).slice(0, 400));
check('секрет: на сервере его нет', !JSON.stringify(await draftApi()).includes('TOPSECRETVALUE'));
await run(`await setLabel('Модель 1 агента claude', 'claude-opus-5-5'); return true;`);
await run(`act('save').click(); await sleep(1500); return true;`);
check('с моделью из списка: уровни low заданы моделью вне списка — отказ у поля модели уровня low', await run(`const f = field('agents.claude.levels.low.model'); return f.getAttribute('aria-invalid') === 'true' && sec().includes('Путь: agents.claude.levels.low.model');`));
await run(`await pick('agents.claude.levels.low.model', '— не задан —'); act('save').click(); await sleep(1500); return true;`);
d1 = await draftApi();
check('убрали модель low — сохранено; уровень low ушёл, пустого объекта нет', !('low' in d1.document.agents.claude.levels) && eq(d1.document.agents.claude.models, ['claude-opus-5-5']), JSON.stringify(d1.document));
check('при models уровень выбирается из списка (Selector, не текст)', await run(`const f = field('agents.claude.levels.high.model'); return f.tagName === 'BUTTON' && f.getAttribute('role') === 'combobox';`));
check('уровни low/medium/high всегда три строки', await run(`return all('#agent-settings [data-level]').map((e) => e.getAttribute('data-level')).join() === 'low,medium,high';`));
await run(`
  const f = field('agents.claude.levels.medium.model');
  f.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, button: 0, pointerType: 'mouse'}));
  await sleep(500); return true;`);
const opts = await run(`return all('[role=option]').map((o) => o.innerText.trim());`);
check('Selector модели: «— не задан —» и модель из списка', opts.includes('— не задан —') && opts.includes('claude-opus-5-5'), JSON.stringify(opts));
await run(`document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); await sleep(400); return true;`);
await run(`await pick('agents.claude.levels.medium.model', 'claude-opus-5-5'); return true;`);
check('выбор из списка попал в буфер («изменено»)', await run(`return sec().includes('изменено');`));
await run(`act('save').click(); await sleep(1400); return true;`);
check('сохранён уровень medium', (await draftApi()).document.agents.claude.levels.medium?.model === 'claude-opus-5-5');

// ── дубль id прайса, JSON ───────────────────────────────────────────────────
console.log('дубль id в прайсе и вкладка JSON (AC-8)');
await run(`btn('Добавить модель в прайс').click(); await sleep(400); const ids = all('#agent-settings [data-price-row]'); return ids.length;`);
await run(`const rows = all('#agent-settings [data-price-row]'); const lastId = rows[rows.length - 1].querySelector('input'); await setVal(lastId, 'gpt-6.1-sol'); return true;`);
tt = await run(`return sec();`);
check('дубль: подпись «Такой id уже есть в прайсе» у обоих рядов, «Сохранить» выключена', (tt.match(/Такой id уже есть в прайсе/g) || []).length === 2 && await run(`return act('save').disabled && act('activate').disabled;`), String((tt.match(/Такой id уже есть/g) || []).length));
check('при дубле вкладки JSON и «Разница» недоступны', await run(`return tab('JSON').getAttribute('aria-disabled') === 'true' && Boolean(tab('JSON').title);`));
await run(`const rows = all('#agent-settings [data-price-row]'); const b = rows[rows.length - 1].querySelector('button[aria-label^="Убрать модель"]'); b.click(); await sleep(400); return true;`);
check('дубль убран — «Сохранить» снова по правкам', !(await run(`return sec();`)).includes('Такой id уже есть'));
await run(`await press('JSON'); return true;`);
let jtext = await run(`return field('document').value;`);
check('JSON: канонический вид (ключи по алфавиту, отступ 2)', jtext.startsWith('{\n  "agents"') && jtext.indexOf('"agents"') < jtext.indexOf('"pricing"') && JSON.stringify(JSON.parse(jtext), null, 2) === jtext.replace(/\n$/, ''), jtext.slice(0, 80));
await run(`await setField('document', field('document').value.replace('"high"', '"high" ,, ')); return true;`);
tt = await run(`return sec();`);
check('сломанный JSON: «JSON не разбирается», «Сохранить» и «Активировать» выключены, вкладки заблокированы', tt.includes('JSON не разбирается') && await run(`return act('save').disabled && act('activate').disabled && tab('Таблица').getAttribute('aria-disabled') === 'true' && tab('Разница').getAttribute('aria-disabled') === 'true' && field('document').getAttribute('aria-invalid') === 'true';`), tt.slice(-300));
const putsBefore = await run(`return log().filter((x) => x.m === 'PUT').length;`);
await run(`await press('Таблица'); return true;`);
check('на таблицу из сломанного JSON не уйти', await run(`return Boolean(field('document'));`));
await run(`await setField('document', ${JSON.stringify(jtext)}); return true;`);
check('исправили JSON — ошибка ушла, вкладки доступны', await run(`return !sec().includes('JSON не разбирается') && tab('Таблица').getAttribute('aria-disabled') !== 'true';`));
check('запрос при сломанном JSON не уходил', await run(`return log().filter((x) => x.m === 'PUT').length;`) === putsBefore);
await run(`await press('Таблица'); return true;`);
check('круг «JSON → Таблица» вернулся без потерь', await run(`return Boolean(field('agents.claude.levels.high.model')) && field('agents.claude.levels.high.model').textContent.includes('claude-opus-5-5');`));

// ── разница и активация (UC-6, AC-9, AC-10) ─────────────────────────────────
console.log('разница и активация (AC-9, AC-10)');
await run(`await setField('changelog', 'Первая версия: opus на high'); return true;`);
check('несохранённые правки: «Активировать» выключена, подсказка «Сначала сохраните правки.»', await run(`return act('activate').disabled && sec().includes('Сначала сохраните правки.') && act('activate').getAttribute('aria-describedby') !== null;`));
await run(`await press('Разница'); return true;`);
tt = await run(`return sec();`);
check('Разница: активной нет — «всё содержимое новое», знаки «+», «Нет отличий» нет', tt.includes('Активной версии нет: всё содержимое новое') && await run(`return all('#agent-settings [data-diff-op]').length > 3 && all('#agent-settings [data-diff-op]').every((r) => r.getAttribute('data-diff-op') === '+');`));
check('Разница: несохранённые правки в неё не входят — сказано', tt.includes('Несохранённые правки в неё не входят'));
check('Разница: итог и путь с точками', tt.includes('Добавлено') && await run(`return Boolean(document.querySelector('[data-diff-path="pricing.models.gpt-6.1-sol.input"]'));`));
await run(`await press('Таблица'); act('save').click(); await sleep(1500); return true;`);
d1 = await draftApi();
check('changelog сохранён', d1.changelog === 'Первая версия: opus на high');
await run(`act('activate').click(); await sleep(700); return true;`);
let dt = await run(`return dlg();`);
check('диалог: заголовок, «первой активной», прогоны остаются, изменения', dt.includes('Активировать версию 1?') && dt.includes('Активной версии сейчас нет: версия 1 станет первой активной.') && dt.includes('Идущие прогоны остаются на своей версии настройки, новые захваты этапов берут версию 1.') && dt.includes('Изменения: добавлено'), dt);
check('диалог: строки «+ путь: значение», не больше 6, остаток', /\+ agents\.claude\./.test(dt) && (dt.match(/…и ещё \d+, см\. вкладку «Разница»/g) || []).length <= 1);
const postsBefore = await run(`return log().filter((x) => x.m === 'POST' && /activate/.test(x.u)).length;`);
await run(`all('[role=alertdialog] button').find((b) => b.innerText.trim() === 'Отмена').click(); await sleep(600); return true;`);
check('«Отмена» ничего не шлёт', await run(`return log().filter((x) => x.m === 'POST' && /activate/.test(x.u)).length;`) === postsBefore && (await apiState()).version === null);
await run(`act('activate').click(); await sleep(600); await confirm('Активировать'); await sleep(1200); return true;`);
check('активация: POST с номером черновика', await run(`const p = log().filter((x) => x.m === 'POST' && /draft\\/activate$/.test(x.u)).pop(); return p && p.b === JSON.stringify({version: 1});`));
let act1 = await apiState();
check('на сервере версия 1 активна', act1.version === 1 && act1.state === 'active');
check('тост «Версия 1 активна»', (await run(`return toasts();`)).some((x) => x.trim() === 'Версия 1 активна' || x.includes('Версия 1 активна')));
tt = await run(`return sec();`);
check('блок «Действующая версия»: номер, «активна», sha, кто и когда, changelog', await run(`const a = document.querySelector('[data-active-version="1"]'); return Boolean(a) && a.querySelector('[data-state=active]') !== null;`) && /Версия 1/.test(tt) && tt.includes('активна') && tt.includes('Активирована') && tt.includes('Changelog: Первая версия: opus на high') && tt.includes('sha256 ' + act1.sha256.slice(0, 7)), tt.slice(0, 500));
check('карточка агента: три уровня, усилие, «не задан: берётся таблица привязки» для low', tt.includes('claude') && tt.includes('claude-opus-5-5') && tt.includes('не задан: берётся таблица привязки'));
check('прайс с as_of и единицей', tt.includes('Прайс на 2026-11-01 · USD за 1 000 000 токенов') && tt.includes('gpt-6.1-sol') && tt.includes('1.5'));
check('после активации — форма заведения (черновика нет), «Основа» — копией активной', (await run(`return Boolean(act('create'));`)) && (await run(`return field('create.from').innerText.includes('Копией активной');`)));

// ── второй черновик копией, разница, снятие предыдущей ──────────────────────
console.log('второй черновик: копией активной, разница, «снята»');
await run(`await setField('changelog', 'high на другой модели'); act('create').click(); await sleep(1500); return true;`);
check('черновик 2 — копия: документ совпал с активной', eq((await draftApi()).document, act1.document) && (await draftApi()).version === 2);
check('тело: from active', await run(`const p = log().filter((x) => x.m === 'POST' && /draft$/.test(x.u)).pop(); return JSON.parse(p.b).from === 'active';`));
await run(`await setField('agents.claude.levels.high.effort', 'medium'); await setField('pricing.models.gpt-6.1-sol.input', '2'); return true;`);
await run(`btn('Добавить агента').click(); await sleep(400); return true;`);
await run(`await press('Таблица'); return true;`);
await run(`act('save').click(); await sleep(1400); await press('Разница'); return true;`);
tt = await run(`return sec();`);
check('разница с активной: итог по знакам', /Добавлено 1 · Изменено 2 · Удалено 0/.test(tt) || /Добавлено \d+ · Изменено 2/.test(tt), tt.match(/Добавлено[^А-я]*Изменено[^А-я]*Удалено \d+/)?.[0]);
check('разница: знак и слово, пути', await run(`const r = document.querySelector('[data-diff-path="agents.claude.levels.high.effort"]'); return r && r.getAttribute('data-diff-op') === '~' && r.innerText.includes('изменено') && r.innerText.includes('high') && r.innerText.includes('medium') && document.querySelector('[data-diff-path="agents.codex"]')?.getAttribute('data-diff-op') === '+';`));
check('разница: колонки «Активная v1» и «Черновик v2», changelog справочно', tt.includes('Активная v1') && tt.includes('Черновик v2') && tt.includes('Changelog черновика: high на другой модели') && tt.includes('Changelog активной: Первая версия'));
await run(`act('activate').click(); await sleep(700); return true;`);
dt = await run(`return dlg();`);
check('диалог: «версия 2 станет активной, версия 1 — снятой», строка «~ … → …»', dt.includes('Версия 2 станет активной, версия 1 — снятой.') && /~ agents\.claude\.levels\.high\.effort: high → medium/.test(dt), dt);
await run(`await confirm('Активировать'); await sleep(1200); return true;`);
const st = (await call('GET', `${AS}/versions`)).body.versions;
check('сервер: v2 активна, v1 снята', st.find((v) => v.version === 2).state === 'active' && st.find((v) => v.version === 1).state === 'retired');
check('тост «Версия 2 активна, версия 1 снята»', (await run(`return toasts();`)).some((x) => x.includes('Версия 2 активна, версия 1 снята')));

// ── история и панель версии (UC-8, AC-13) ───────────────────────────────────
console.log('история версий и просмотр (AC-13)');
check('«История версий (2)» свёрнута', await run(`const b = all('#agent-settings button').find((x) => x.innerText.includes('История версий')); return b && b.innerText.includes('(2)') && b.getAttribute('aria-expanded') === 'false';`));
await run(`all('#agent-settings button').find((x) => x.innerText.includes('История версий')).click(); await sleep(600); return true;`);
tt = await run(`return document.querySelector('[data-block=history]').innerText.replace(/\\s+/g, ' ');`);
check('таблица: версии по убыванию, состояния словом, changelog, sha', /v2.*активна.*v1.*снята/.test(tt) && tt.includes('high на другой модели') && tt.includes((await apiState()).sha256.slice(0, 7)), tt);
check('кнопки «Открыть версию N»', await run(`return Boolean(aria('Открыть версию 1')) && Boolean(aria('Открыть версию 2'));`));
await run(`aria('Открыть версию 1').click(); await sleep(1200); return true;`);
tt = await run(`return (document.querySelector('[data-version-sheet]')?.innerText || '').replace(/\\s+/g, ' ');`);
check('панель версии 1: заголовок, состояние «снята», содержимое', tt.includes('Версия 1') && tt.includes('снята') && tt.includes('claude-opus-5-5'), tt.slice(0, 300));
check('в панели нет кнопок правки', await run(`const p = document.querySelector('[data-version-sheet]'); return !Array.from(p.querySelectorAll('button')).some((b) => ['Сохранить', 'Активировать', 'Удалить черновик', 'Завести черновик'].includes(b.innerText.trim()));`));
await run(`await press('Разница с активной', '[data-version-sheet] [role=tab]'); return true;`);
tt = await run(`return (document.querySelector('[data-version-sheet]')?.innerText || '').replace(/\\s+/g, ' ');`);
check('разница версии 1 с активной: колонки «Активная v2» и «Версия 1», знаки «−»/«~»', tt.includes('Активная v2') && tt.includes('Версия 1') && /−|~/.test(tt) && tt.includes('есть в версии, нет в активной'), tt.slice(0, 400));
await run(`document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); all('[data-version-sheet] button').find((b) => b.innerText.includes('Close'))?.click(); await sleep(700); return true;`);
check('панель закрывается', await run(`return !document.querySelector('[data-version-sheet]');`));
await run(`aria('Открыть версию 2').click(); await sleep(1000); return true;`);
tt = await run(`return (document.querySelector('[data-version-sheet]')?.innerText || '').replace(/\\s+/g, ' ');`);
check('у активной версии вкладки «Разница» нет: «Это действующая версия»', tt.includes('Это действующая версия') && !tt.includes('Разница с активной'));
await run(`all('[data-version-sheet] button').find((b) => b.innerText.includes('Close'))?.click(); await sleep(600); return true;`);

// ── предупреждение об уходе (AC-5) ──────────────────────────────────────────
console.log('уход со страницы с правками (AC-5)');
await run(`await setField('changelog', 'правка'); act('create').click(); await sleep(1500); return true;`);
await run(`await setField('changelog', 'несохранённая правка'); return true;`);
check('правки есть — «изменено»', await run(`return sec().includes('изменено');`));
await run(`document.querySelector('a[href^="/p/${PK}/"]:not([href*="settings"])').click(); await sleep(700); return true;`);
check('перехват ссылки меню: «Уйти без сохранения?»', (await run(`return dlg();`)).includes('Уйти без сохранения?') && (await run(`return dlg();`)).includes('Несохранённые правки черновика агентов пропадут.'));
await run(`await confirm('Остаться'); return true;`);
check('«Остаться» — страница та же, правка на месте', (await s.evaluate(`return location.pathname;`)) === `/p/${PK}/settings` && await run(`return field('changelog').value === 'несохранённая правка';`));
await run(`document.querySelector('a[href^="/p/${PK}/"]:not([href*="settings"])').click(); await sleep(700); await confirm('Уйти'); await sleep(800); return true;`);
check('«Уйти» — ушли со страницы', (await s.evaluate(`return location.pathname;`)) !== `/p/${PK}/settings`);
await open();
check('черновик на сервере цел, правка с последнего «Сохранить» потеряна', await run(`return field('changelog').value === 'правка';`));
await run(`await setField('changelog', 'другая'); return true;`);
await run(`act('reset').click(); await sleep(600); return true;`);
check('«Сбросить правки» просит подтверждения с текстом', (await run(`return dlg();`)).includes('Сбросить правки?') && (await run(`return dlg();`)).includes('черновик на сервере останется как есть'));
await run(`await confirm('Сбросить'); return true;`);
check('после сброса буфер = серверный, «изменено» снято', await run(`return field('changelog').value === 'правка' && !sec().includes('изменено');`));

// ── гонки: сервер изменился, черновик удалён, 409 (AC-11) ───────────────────
console.log('гонки и перечитывание (AC-11)');
await run(`await setField('changelog', 'моя правка в форме'); return true;`);
const cur = await draftApi();
const doc2 = structuredClone(cur.document); doc2.agents.claude.models = ['claude-opus-5-5', 'claude-sonnet-5'];
await call('PUT', `${AS}/draft`, {document: doc2, changelog: 'из CLI'});
await run(`all('#agent-settings button').find((b) => (b.getAttribute('aria-label') || '').startsWith('Обновить'))?.click(); await sleep(1500); return true;`);
tt = await run(`return sec();`);
check('сервер сменил черновик, правки есть — буфер цел и предупреждение', tt.includes('Черновик на сервере изменился') && await run(`return field('changelog').value === 'моя правка в форме';`), tt.slice(0, 300));
await run(`all('#agent-settings button').find((b) => b.innerText.trim() === 'Взять серверный').click(); await sleep(500); await confirm('Заменить'); return true;`);
check('«Взять серверный» — буфер заменён, «изменено» снято', await run(`return field('changelog').value === 'из CLI' && !sec().includes('изменено') && Boolean(field('agents.claude.models[1]'));`));
// 404 на сохранении
await run(`await setField('changelog', 'осиротевшая правка'); return true;`);
await call('DELETE', `${AS}/draft`);
await run(`act('save').click(); await sleep(1800); return true;`);
tt = await run(`return sec();`);
check('черновик удалён в другом месте: Note с буфером, без тупика', tt.includes('Черновик удалён в другом месте') && tt.includes('Ваши правки не сохранены') && tt.includes('Завести черновик из этих правок') && await run(`return Boolean(document.querySelector('#agent-settings .code-block'));`), tt.slice(0, 400));
await run(`btn('Завести черновик из этих правок').click(); await sleep(1500); return true;`);
d1 = await draftApi();
check('черновик заведён из правок: документ и changelog', d1 && d1.changelog === 'осиротевшая правка' && Boolean(d1.document.agents.claude.models), JSON.stringify(d1)?.slice(0, 200));
// 409 активации (подмена)
await setup({activate409: true});
await open();
await run(`act('activate').click(); await sleep(600); await confirm('Активировать'); await sleep(1500); return true;`);
tt = await run(`return sec();`);
check('409 активации: «Черновик изменился», номера из details, раздел перечитан', tt.includes('Черновик изменился') && tt.includes('Пока вы подтверждали версию 4, черновиком стала версия 5'), tt.slice(0, 400));
// 409 на заведении — не ошибка (реальный)
await setup();
await open();
await run(`btn('Удалить черновик').click(); await sleep(600); return true;`);
dt = await run(`return dlg();`);
check('удаление: заголовок и текст «Активная версия не изменится»', dt.includes('Удалить черновик версии') && dt.includes('Активная версия не изменится'), dt);
await run(`await confirm('Удалить'); await sleep(1200); return true;`);
check('удалён: на сервере черновика нет, активная прежняя, тост, форма заведения', (await draftApi()) === null && (await apiState()).version === 2 && (await run(`return toasts();`)).some((x) => x.includes('Черновик удалён')) && await run(`return Boolean(act('create'));`));
// «черновик уже есть» при заведении: заводим через API перед нажатием
await call('POST', `${AS}/draft`, {from: 'empty'});
await run(`act('create').click(); await sleep(1500); return true;`);
check('заведение при уже заведённом (409) — без ошибки: показан существующий, тост', await run(`return Boolean(act('save')) && !sec().includes('Не получилось');`) && (await run(`return toasts();`)).some((x) => x.includes('Черновик уже был заведён — показан он')));
await call('DELETE', `${AS}/draft`);
await open();

// ── право (UC-9, AC-14, AC-15) ──────────────────────────────────────────────
console.log('право: наблюдатель, агент, отказ сервера (AC-14, AC-15)');
await call('POST', `${AS}/draft`, {from: 'active', changelog: 'для чтения'});
for (const [name, cfg, text] of [
  ['наблюдатель (viewer)', {me: 'viewer'}, 'Настройку агентов правит сопровождающий проекта (уровень maintainer или admin). Вы можете смотреть'],
  ['агентский принципал даже с maintainer', {me: 'maintainer', kind: 'agent'}, 'Вы вошли как агент или бот'],
  ['участник уровня agent', {me: 'agent'}, 'Только чтение'],
]) {
  await setup(cfg);
  await open();
  tt = await run(`return sec();`);
  check(`${name}: Note «Только чтение» с текстом`, tt.includes('Только чтение') && tt.includes(text), tt.slice(0, 200));
  check(`${name}: ни полей, ни кнопок правки`, await run(`return !['Сохранить', 'Активировать', 'Удалить черновик', 'Завести черновик', 'Сбросить правки', 'Добавить агента'].some((t) => btn(t)) && !document.querySelector('#agent-settings textarea, #agent-settings input');`));
  check(`${name}: действующая версия и история читаются`, tt.includes('Действующая версия') && tt.includes('История версий'));
  check(`${name}: черновик — просмотр с вкладками «Содержимое / Разница с активной»`, await run(`return Boolean(tab('Содержимое')) && Boolean(tab('Разница с активной')) && sec().includes('Черновик · версия');`));
}
await setup({me: 'viewer'});
await open();
await call('DELETE', `${AS}/draft`);
await open();
check('наблюдатель, черновика нет: «Черновика нет.» без формы', (await run(`return sec();`)).includes('Черновика нет.') && !(await run(`return Boolean(act('create'));`)));
await shot('viewer');
await call('POST', `${AS}/draft`, {from: 'active', changelog: 'для 403'});
await setup({deny: 'level'});
await open();
check('«не знаю» (header): кнопки есть', await run(`return Boolean(act('save')) && Boolean(act('activate'));`));
await run(`await setField('changelog', 'пробую'); act('save').click(); await sleep(1500); return true;`);
tt = await run(`return sec();`);
check('403 на записи: «Нет права на это действие», текст сервера как есть, строка по reason', tt.includes('Нет права на это действие') && tt.includes('настройку агентов проекта правит сопровождающий (e2e-текст сервера)') && tt.includes('Нужен уровень maintainer или admin в проекте.'), tt.slice(-400));
check('403: форма и данные целы, кнопки на месте', await run(`return field('changelog').value === 'пробую' && Boolean(act('save'));`));
await setup({deny: 'human_action'});
await open();
await run(`await setField('changelog', 'пробую'); act('save').click(); await sleep(1500); return true;`);
check('403 human_action: «Правит человек…»', (await run(`return sec();`)).includes('Правит человек: агентский принципал не правит настройку даже с уровнем maintainer.'));
await call('DELETE', `${AS}/draft`);

// ── состояния чтения (UC-10, AC-12, AC-16) ──────────────────────────────────
console.log('состояния: загрузка, ошибка, сервер без ручек (AC-12, AC-16)');
await setup({oldServer: true});
await open();
tt = await run(`return sec();`);
check('сервер без ручек: «Сервер не знает настройки агентов», «Проверить снова»', tt.includes('Сервер не знает настройки агентов') && tt.includes('Обновите сервер до версии') && tt.includes('Проверить снова') && !tt.includes('Не получилось'), tt.slice(0, 300));
check('остальные разделы страницы работают', (await run(`return texts();`)).includes('Перенос правил') && (await run(`return texts();`)).includes('Токены'));
await setup({readFails: true});
await open();
tt = await run(`return sec();`);
check('сбой чтения: «Настройка агентов не загрузилась», сообщение сервера, «Повторить»', tt.includes('Настройка агентов не загрузилась') && tt.includes('сбой хранилища (e2e)') && tt.includes('Повторить'));
check('сбой чтения: остальные разделы работают', (await run(`return texts();`)).includes('Перенос правил'));
await setup({versionsFail: true});
await open();
tt = await run(`return sec();`);
check('сбой списка версий: действующая версия показана, у черновика и истории свои ошибки', tt.includes('Действующая версия') && tt.includes('Черновик не определён: список версий не загрузился') && tt.includes('История версий не загрузилась'), tt.slice(0, 500));
// загрузка: ответ задержан
await setup();
await s.evaluate(`localStorage.setItem('sdlc.actor','e2e'); return 1;`);
await s.addInitScript(`
  (() => { const p = window.fetch; window.fetch = async (i, n) => { const u = typeof i === 'string' ? i : i.url; if (/agent-settings$/.test(u) && sessionStorage.getItem('e2e.slow')) await new Promise((r) => setTimeout(r, 4500)); return p(i, n); }; })();
`);
await s.evaluate(`sessionStorage.setItem('e2e.slow', '1'); return 1;`);
await s.goto(url);
await pause(1500);
check('загрузка: «Загрузка настройки агентов», заголовок на месте', await run(`return sec().includes('Загрузка настройки агентов') && sec().includes('Агенты и модели');`));
await s.evaluate(`sessionStorage.removeItem('e2e.slow'); return 1;`);
await pause(4000);

// ── вид: узкий экран и тёмная тема ──────────────────────────────────────────
console.log('вид: 390 px и тёмная тема');
await call('POST', `${AS}/draft`, {from: 'active'});
await setup({theme: 'dark'});
await open();
await shot('dark-1440');
await s.resize(390, 900);
await pause(600);
const overflow = await run(`const el = document.querySelector('#agent-settings'); return {sw: el.scrollWidth, cw: el.clientWidth, doc: document.documentElement.scrollWidth, win: window.innerWidth};`);
check('390 px: раздел без горизонтальной прокрутки страницы', overflow.doc <= overflow.win + 1, JSON.stringify(overflow));
check('390 px: «Активировать» и «Удалить черновик» в окне', await run(`return [act('activate'), act('discard')].every((b) => { const r = b.getBoundingClientRect(); return r.right <= window.innerWidth + 1 && r.left >= -1; });`));
await shot('dark-390');
check('тёмная тема: класс dark', await run(`return document.documentElement.classList.contains('dark');`));
await s.resize(1440, 1000);
await call('DELETE', `${AS}/draft`);

// ── уборка ──────────────────────────────────────────────────────────────────
const gone = await call('DELETE', `/projects/${PK}`);
check('свой проект удалён', gone.status === 204 || gone.status === 200, JSON.stringify(gone).slice(0, 200));
s.close();
console.log(`\n${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
