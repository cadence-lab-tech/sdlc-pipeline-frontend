// Библиотека инструкций на «Пайплайне» (CLAB-351, AC-17, AC-18): сценарий
// UC-1 → UC-4 на своих ролях и своей инструкции (ключи с отметкой прогона),
// повторяется на той же базе. «В библиотеку» у документа роли, «Обновить в
// ролях» с кандидатами и итогом, панель инструкции с версиями, диффом и «Где
// используется», «Новая версия», «есть новее» в списке ролей и у строки
// документа, отказ 409 настоящей гонкой, форма версии роли: «Из библиотеки»,
// «Отвязать», «Вернуть закрепление». Чего стенд в режиме header не даёт
// (наблюдатель, сервер без библиотеки), подменяется ответом одной ручки.
// Светлая и тёмная тема, 1440 и 390 px; SDLC_E2E_SHOTS=<каталог> — снимки.
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
const call = (method, path, body) =>
  fetch(API + '/v1' + path, {
    method,
    headers: {'X-SDLC-Actor': 'e2e', 'Content-Type': 'application/json'},
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null)}));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// ── данные ──────────────────────────────────────────────────────────────────
const mark = Date.now().toString(36);
const KEY = `rule-${mark}`;
const DOC = `${KEY}.md`;
const A = `lib-a-${mark}`;
const B = `lib-b-${mark}`;
const TEXT = `Общее правило прогона ${mark}.\n`;
for (const key of [A, B]) {
  const r = await call('POST', '/projects/SDLC/roles', {
    key, name: `Роль ${key}`,
    version: {documents: [{name: 'main.md', content: `Ты ${key}.\n`}, {name: DOC, content: TEXT}]},
  });
  if (r.status !== 201) throw new Error(`роль ${key} не заведена: ${JSON.stringify(r.body)}`);
}

const s = await session(BASE + `/p/SDLC/pipeline?role=${A}`);
const waitFor = `
  const waitFor = async (sel, n = 60) => {
    for (let i = 0; i < n && !document.querySelector(sel); i++) await sleep(100);
    const el = document.querySelector(sel);
    if (!el) throw new Error('нет на странице: ' + sel);
    return el;
  };
  const inDialog = (sel) => document.querySelector(sel);
`;
const run = (body) => s.evaluate(helpers + waitFor + body);
const shot = async (name) => {
  if (SHOTS) writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(await s.screenshot(), 'base64'));
};
await s.resize(1440, 900);
await run(`localStorage.setItem('sdlc.theme', 'light'); return true;`);
await s.goto(BASE + `/p/SDLC/pipeline?role=${A}`);
await pause(2000);

// ── UC-1: вынести документ роли в библиотеку ────────────────────────────────
console.log('UC-1: «В библиотеку» у документа роли');
const opened = await run(`
  const row = await waitFor('[data-role-document="${DOC}"] button');
  row.click();
  await sleep(400);
  return Boolean(document.querySelector('[data-to-library-open]'));
`);
check('у обычного документа последней версии — «В библиотеку»', opened === true);
const dialog = await run(`
  document.querySelector('[data-to-library-open]').click();
  const d = await waitFor('[data-to-library]');
  const key = all('[data-to-library] input')[0].value;
  return {key, text: d.innerText.replace(/\\s+/g, ' ')};
`);
check('ключ — из имени документа', dialog.key === KEY, dialog.key);
check('пояснение: тип и размер из документа роли', dialog.text.includes(`Вынести ${DOC} в библиотеку`) && dialog.text.includes(`из документа роли ${A}`), dialog.text);
await run(`
  const name = all('[data-to-library] label').find((l) => l.innerText.trim().startsWith('Название'));
  const field = document.getElementById(name.getAttribute('for'));
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, 'Правило прогона');
  field.dispatchEvent(new Event('input', {bubbles: true}));
  await sleep(200);
  await clickExact('Завести инструкцию', '[data-to-library] button');
  await sleep(800);
  return true;
`);
const step2 = await run(`return (document.querySelector('[data-to-library]')?.innerText || '').replace(/\\s+/g, ' ');`);
check('второй шаг: «Инструкция заведена» и «Обновить в ролях»', step2.includes(`Инструкция ${KEY} заведена`) && step2.includes('Обновить в ролях'), step2);
const inst1 = (await call('GET', `/projects/SDLC/instructions/${KEY}`)).body;
check('на сервере инструкция с версией 1 и тем же текстом', inst1?.version?.version === 1 && inst1.version.content === TEXT, JSON.stringify(inst1?.version));
check('роли не изменились: документы обычные', inst1?.usage?.length >= 2 && inst1.usage.filter((u) => [A, B].includes(u.role_key)).every((u) => u.pinned_version === null));
await shot('library-to-library');

console.log('UC-4: «Обновить в ролях» после выноса — кандидаты с тем же текстом отмечены');
const cands = await run(`
  await clickExact('Обновить в ролях', '[data-to-library] button');
  await waitFor('[data-apply-candidates]');
  return all('[data-candidate]').map((li) => ({key: li.getAttribute('data-candidate'), state: li.getAttribute('data-candidate-state'),
    checked: li.querySelector('[role=checkbox]')?.getAttribute('data-state') === 'checked', text: li.innerText.replace(/\\s+/g, ' ')}));
`);
const mine = cands.filter((c) => [A, B].includes(c.key));
check('обе роли — кандидаты «не закреплён»', mine.length === 2 && mine.every((c) => c.state === 'plain'), JSON.stringify(mine));
check('отмечены: текст тот же', mine.every((c) => c.checked && c.text.includes('Текст тот же: документ только закрепится')), JSON.stringify(mine));
const btn = await run(`return document.querySelector('[data-apply-submit]').innerText.trim();`);
check('кнопка считает отмеченные', btn === `Обновить в ${cands.filter((c) => c.checked).length} ${cands.filter((c) => c.checked).length === 1 ? 'роли' : 'ролях'}`, btn);
await shot('library-apply');
const result = await run(`
  document.querySelector('[data-apply-submit]').click();
  await waitFor('[data-apply-result]');
  return all('[data-result-row]').map((li) => li.getAttribute('data-result-row') + ':' + li.getAttribute('data-result-status'));
`);
check('итог: обе роли получили версию', result.includes(`${A}:created`) && result.includes(`${B}:created`), result.join());
const roleA = (await call('GET', `/projects/SDLC/roles/${A}`)).body;
const pinA = roleA.latest_version.documents.find((d) => d.name === DOC)?.instruction;
check('на сервере документ закреплён за v1', pinA?.key === KEY && pinA?.version === 1, JSON.stringify(pinA));
await run(`await clickExact('Закрыть', '[data-apply-dialog] button'); return true;`);

// ── UC-3: новая версия инструкции ───────────────────────────────────────────
console.log('UC-3: панель инструкции и «Новая версия»');
await s.goto(BASE + `/p/SDLC/pipeline?instruction=${KEY}`);
await pause(1500);
const panel = await run(`
  const p = await waitFor('[data-instruction-panel="${KEY}"]');
  return {text: p.innerText.replace(/\\s+/g, ' '), usage: all('[data-usage-row]').map((r) => r.getAttribute('data-usage-row') + ':' + r.getAttribute('data-usage-pinned'))};
`);
check('выбор инструкции — в адресе', panel.text.includes('Правило прогона') && panel.text.includes(KEY));
check('«Где используется»: роли на v1', panel.usage.includes(`${A}:1`) && panel.usage.includes(`${B}:1`), panel.usage.join());
check('первая версия: сравнивать не с чем', panel.text.includes('Первая версия: сравнивать не с чем'));
const sameDisabled = await run(`
  await clickExact('Новая версия');
  await waitFor('[data-instruction-form="version"]');
  return {same: Boolean(document.querySelector('[data-form-same]')), disabled: byText('Сохранить версию 2')?.disabled};
`);
check('без правок — «сохранять нечего», кнопка выключена', sameDisabled.same && sameDisabled.disabled === true, JSON.stringify(sameDisabled));
await run(`
  await fill('Что изменилось', 'добавили строку');
  await fill('Содержимое', ${JSON.stringify(TEXT + 'Вторая строка.\n')});
  return true;
`);
const delta = await run(`return document.querySelector('[data-form-delta]')?.innerText.replace(/\\s+/g, ' ') ?? '';`);
check('счётчик правки «+1 −0»', delta.includes('+1') && delta.includes('−0'), delta);
await run(`await clickExact('Сохранить версию 2'); await waitFor('[data-created-banner]'); return true;`);
const after = await run(`return document.querySelector('[data-instruction-panel]').innerText.replace(/\\s+/g, ' ');`);
check('плашка «Версия 2 заведена. Роли не изменились. Отстают от v2: 2»', after.includes('Версия 2 заведена') && after.includes('Отстают от v2: 2'), after.slice(0, 300));
const usage2 = await run(`return all('[data-usage-row]').map((r) => r.getAttribute('data-usage-row') + ':' + (r.innerText.includes('есть v2') ? 'lag' : 'ok'));`);
check('у ролей «есть v2»', usage2.includes(`${A}:lag`) && usage2.includes(`${B}:lag`), usage2.join());
const diffView = await run(`
  await press('Изменения против v1', '[role=radio], button');
  await waitFor('[data-inst-diff]');
  return {url: location.search, added: all('[data-inst-diff] [data-diff-line="added"]').map((l) => l.innerText.trim())};
`);
check('дифф против предыдущей версии тем же компонентом', diffView.added.some((t) => t.includes('Вторая строка')), JSON.stringify(diffView));
check('режим «Изменения» — в адресе', diffView.url.includes('view=diff'), diffView.url);
await shot('library-panel');

console.log('«есть новее» в списке ролей и в панели роли');
await s.goto(BASE + `/p/SDLC/pipeline`);
await pause(1500);
const lagRows = await run(`
  await waitFor('[data-pipeline-overview]');
  return all('[data-pipeline-role-row]').filter((r) => r.getAttribute('data-role-lag')).map((r) => r.getAttribute('data-pipeline-role-row'));
`);
check('у обеих ролей метка «есть новее»', lagRows.includes(A) && lagRows.includes(B), lagRows.join());
const libRow = await run(`return (document.querySelector('[data-library-row="${KEY}"]')?.innerText || '').replace(/\\s+/g, ' ');`);
check('строка библиотеки: «отстают: 2» и v2', libRow.includes('отстают: 2') && libRow.includes('v2'), libRow);
await s.goto(BASE + `/p/SDLC/pipeline?role=${A}`);
await pause(1500);
const rolePanel = await run(`
  await waitFor('[data-role-lag-banner]');
  const row = document.querySelector('[data-role-document="${DOC}"]');
  return {banner: document.querySelector('[data-role-lag-banner]').innerText.replace(/\\s+/g, ' '), pin: row.getAttribute('data-doc-pin'), row: row.innerText.replace(/\\s+/g, ' ')};
`);
check('плашка «В библиотеке есть новее»', rolePanel.banner.includes('В библиотеке есть новее') && rolePanel.banner.includes('закреплена v1, в библиотеке v2'), rolePanel.banner);
check('строка документа: «git v1» и «есть v2»', rolePanel.pin === `${KEY}@1` && rolePanel.row.includes(`${KEY} v1`) && rolePanel.row.includes('есть v2'), rolePanel.row);

// ── UC-4 из плашки роли, гонка 409 ──────────────────────────────────────────
console.log('UC-4: «Обновить…» из плашки, отказ 409 и повтор');
const pre = await run(`
  document.querySelector('[data-lag-apply]').click();
  await waitFor('[data-apply-candidates]');
  return all('[data-candidate]').filter((li) => li.querySelector('[role=checkbox]')?.getAttribute('data-state') === 'checked').map((li) => li.getAttribute('data-candidate'));
`);
check('из плашки отмечена только эта роль', pre.length === 1 && pre[0] === A, pre.join());
// Пока диалог открыт, кто-то заводит новую версию роли A.
const base = roleA.latest_version;
await call('POST', `/projects/SDLC/roles/${A}/versions`, {
  documents: base.documents.map((d) => (d.instruction ? {instruction: d.instruction} : {name: d.name, kind: d.kind, content: d.content + 'Правка соседа.\n'})),
});
const conflict = await run(`
  document.querySelector('[data-apply-submit]').click();
  await waitFor('[data-apply-notice]');
  return {failure: document.querySelector('[data-apply-failure]')?.innerText.replace(/\\s+/g, ' '), notice: document.querySelector('[data-apply-notice]').innerText};
`);
check('409: «список устарел», роль названа', conflict.failure?.includes('список устарел') && conflict.notice.includes(A), JSON.stringify(conflict));
const retry = await run(`
  await sleep(500);
  document.querySelector('[data-apply-submit]').click();
  await waitFor('[data-apply-result]');
  return all('[data-result-row]').map((li) => li.getAttribute('data-result-row') + ':' + li.getAttribute('data-result-status'));
`);
check('повтор после перечитывания проходит', retry.join() === `${A}:created`, retry.join());
const bAfter = (await call('GET', `/projects/SDLC/roles/${B}`)).body;
check('неотмеченная роль B не изменилась', bAfter.role.latest_version === 2, String(bAfter.role.latest_version));
await run(`await clickExact('Закрыть', '[data-apply-dialog] button'); return true;`);

// ── форма версии роли: закреплённый документ ────────────────────────────────
console.log('форма версии роли: только чтение, «Отвязать», «Вернуть закрепление»');
await s.goto(BASE + `/p/SDLC/pipeline?role=${B}`);
await pause(1500);
const form = await run(`
  await waitFor('[data-role-panel="${B}"]');
  await clickExact('Новая версия');
  await waitFor('[data-doc-editor]');
  all('[data-doc-row="${DOC}"] button')[0].click();
  await sleep(300);
  const card = document.querySelector('[data-doc-pinned]');
  return {pinned: card?.getAttribute('data-doc-pinned'), readOnly: card ? !card.querySelector('textarea') : false,
    pick: Boolean(document.querySelector('[data-library-pick]')), counter: document.querySelector('[data-form-counter]').innerText};
`);
check('закреплённый документ — только чтение', form.pinned === KEY && form.readOnly, JSON.stringify(form));
check('кнопка «Из библиотеки» рядом с «Добавить документ»', form.pick);
check('счётчик: «из библиотеки 1»', form.counter.includes('из библиотеки 1'), form.counter);
const picker = await run(`
  document.querySelector('[data-library-pick]').click();
  await waitFor('[data-picker-row="${KEY}"]');
  return document.querySelector('[data-picker-row="${KEY}"]').innerText.replace(/\\s+/g, ' ');
`);
check('в выборе инструкция уже в наборе', picker.includes(`Уже в наборе: ${DOC} (${KEY} v1)`), picker);
await run(`await clickExact('Закрыть', '[data-library-picker] button'); return true;`);
const unpinned = await run(`
  document.querySelector('[data-doc-unpin]').click();
  await sleep(300);
  return {note: document.querySelector('[data-doc-unpinned]')?.innerText.replace(/\\s+/g, ' ') ?? '', mark: document.querySelector('[data-doc-row="${DOC}"]').getAttribute('data-doc-mark')};
`);
check('«Отвязать»: заметка и метка «изменён»', unpinned.note.includes(`Документ отвязан от библиотеки (${KEY} v1)`) && unpinned.mark === 'changed', JSON.stringify(unpinned));
const repinned = await run(`
  document.querySelector('[data-doc-repin]').click();
  await sleep(300);
  return Boolean(document.querySelector('[data-doc-pinned]'));
`);
check('«Вернуть закрепление» без правок — без подтверждения', repinned === true);
await run(`
  document.querySelector('[data-doc-unpin]').click();
  await sleep(300);
  await fill('Что изменилось', 'отвязали правило');
  await clickExact('Сохранить версию');
  await sleep(1500);
  return true;
`);
const bSaved = (await call('GET', `/projects/SDLC/roles/${B}`)).body;
const bDoc = bSaved.latest_version.documents.find((d) => d.name === DOC);
check('после сохранения документ обычный (unpin), текст тот же', bSaved.role.latest_version === 3 && !bDoc.instruction && bDoc.content === TEXT, JSON.stringify(bDoc));
const pinMark = await run(`return all('[data-diff-mark="pin"]').map((m) => m.innerText.trim());`);
check('дифф версий роли: метка «отвязан от …»', pinMark.some((t) => t.includes(`отвязан от ${KEY} v1`)), pinMark.join());

// ── UC-2: «Из библиотеки» в роли без документа ──────────────────────────────
console.log('UC-2: «Из библиотеки» добавляет закреплённый документ');
const C = `lib-c-${mark}`;
await call('POST', '/projects/SDLC/roles', {key: C, name: `Роль ${C}`, version: {documents: [{name: 'main.md', content: `Ты ${C}.\n`}]}});
await s.goto(BASE + `/p/SDLC/pipeline?role=${C}`);
await pause(1500);
const pickedV1 = await run(`
  await waitFor('[data-role-panel="${C}"]');
  await clickExact('Новая версия');
  await waitFor('[data-library-pick]');
  document.querySelector('[data-library-pick]').click();
  const row = await waitFor('[data-picker-row="${KEY}"]');
  const sel = row.querySelector('select');
  if (sel) { sel.value = '1'; sel.dispatchEvent(new Event('change', {bubbles: true})); await sleep(200); }
  Array.from(row.querySelectorAll('button')).find((b) => b.innerText.includes('Добавить ${DOC}')).click();
  await waitFor('[data-doc-pinned="${KEY}"]');
  return document.querySelector('[data-doc-pinned]').innerText.replace(/\\s+/g, ' ');
`);
check('в наборе — закреплённый документ «ключ.md»', pickedV1.includes(DOC) && pickedV1.includes('Документ из библиотеки: здесь только чтение'), pickedV1);
await run(`await clickExact('Сохранить версию'); await sleep(1500); return true;`);
const cSaved = (await call('GET', `/projects/SDLC/roles/${C}`)).body;
const cPin = cSaved.latest_version.documents.find((d) => d.name === DOC)?.instruction;
check('на сервере документ закреплён за версией инструкции', cPin?.key === KEY && cPin.version >= 1, JSON.stringify(cPin));

// ── E4: «Новая инструкция» из обзора ────────────────────────────────────────
console.log('E4: «Новая инструкция» — ключ не по форме и занятый ключ');
await s.goto(BASE + `/p/SDLC/pipeline`);
await pause(1500);
const badKey = await run(`
  await waitFor('[data-library-new]');
  document.querySelector('[data-library-new]').click();
  await waitFor('[data-instruction-form="create"]');
  await fill('Ключ', 'Bad.Key');
  return {bad: Boolean(document.querySelector('[data-key-bad]')), disabled: byText('Завести инструкцию')?.disabled};
`);
check('ключ не по форме — подсказка и кнопка выключена', badKey.bad && badKey.disabled === true, JSON.stringify(badKey));
const taken = await run(`
  await fill('Ключ', '${KEY}');
  await fill('Название', 'дубль');
  await fill('Содержимое', 'текст');
  await clickExact('Завести инструкцию');
  await waitFor('[data-form-failure]');
  return document.querySelector('[data-form-failure]').innerText.replace(/\\s+/g, ' ');
`);
check('занятый ключ — 409 сервера, введённое осталось', taken.includes('Инструкция не заведена') && taken.includes('уже есть'), taken);

// ── наблюдатель и сервер без библиотеки ─────────────────────────────────────
console.log('наблюдатель (AC-18) и сервер без библиотеки');
const STUB = `
  const prevFetch = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const mode = sessionStorage.getItem('e2e.lib');
    if (mode === 'old' && /\\/instructions/.test(url)) return new Response('404 page not found', {status: 404});
    if (mode === 'viewer' && /\\/v1\\/auth\\/me$/.test(url)) {
      const me = await (await prevFetch(input, init)).json();
      me.mode = 'token';
      me.authenticated = true;
      me.memberships = [{project_key: 'SDLC', project_id: '', principal_id: me.principal.id, handle: me.principal.handle, kind: 'user', display_name: '', role: 'viewer', role_keys: null, created_at: ''}];
      me.teams = [];
      return new Response(JSON.stringify(me), {status: 200, headers: {'Content-Type': 'application/json'}});
    }
    return prevFetch(input, init);
  };
`;
const stubId = await s.addInitScript(STUB);
await run(`sessionStorage.setItem('e2e.lib', 'viewer'); return true;`);
await s.goto(BASE + `/p/SDLC/pipeline?instruction=${KEY}`);
await pause(2000);
const viewer = await run(`
  await waitFor('[data-instruction-panel="${KEY}"]');
  return {apply: Boolean(document.querySelector('[data-instruction-apply]')), version: Boolean(document.querySelector('[data-instruction-new-version]')), meta: Boolean(document.querySelector('[data-instruction-meta]'))};
`);
check('наблюдатель: нет «Обновить в ролях», «Новая версия», «Название и описание»', !viewer.apply && !viewer.version && !viewer.meta, JSON.stringify(viewer));
await s.goto(BASE + `/p/SDLC/pipeline?role=${A}`);
await pause(2000);
const viewerRole = await run(`
  await waitFor('[data-role-panel="${A}"]');
  const row = document.querySelector('[data-role-document="main.md"] button');
  row.click();
  await sleep(300);
  return {toLib: Boolean(document.querySelector('[data-to-library-open]')), lagApply: Boolean(document.querySelector('[data-lag-apply]'))};
`);
check('наблюдатель: нет «В библиотеку» и «Обновить…»', !viewerRole.toLib && !viewerRole.lagApply, JSON.stringify(viewerRole));
await s.goto(BASE + `/p/SDLC/pipeline`);
await pause(2000);
const viewerList = await run(`await waitFor('[data-library]'); return Boolean(document.querySelector('[data-library-new]'));`);
check('наблюдатель: нет «Новая инструкция»', viewerList === false);
await run(`sessionStorage.setItem('e2e.lib', 'old'); return true;`);
await s.goto(BASE + `/p/SDLC/pipeline`);
await pause(2000);
const old = await run(`await waitFor('[data-library-absent]'); return document.querySelector('[data-library]').innerText.replace(/\\s+/g, ' ');`);
check('сервер без библиотеки: «Библиотеки на этом сервере нет», роли работают', old.includes('Библиотеки на этом сервере нет') && old.includes('Роли и их документы работают как раньше'), old);
await run(`sessionStorage.removeItem('e2e.lib'); return true;`);
await s.removeInitScript(stubId);

// ── тёмная тема и узкий экран ───────────────────────────────────────────────
console.log('тёмная тема и 390 px');
await run(`localStorage.setItem('sdlc.theme', 'dark'); return true;`);
await s.goto(BASE + `/p/SDLC/pipeline?instruction=${KEY}`);
await pause(1500);
const dark = await run(`await waitFor('[data-instruction-panel]'); return document.documentElement.classList.contains('dark');`);
check('панель инструкции в тёмной теме', dark === true);
await shot('library-panel-dark');
await s.resize(390, 844);
await s.goto(BASE + `/p/SDLC/pipeline?instruction=${KEY}`);
await pause(1500);
const narrow = await run(`
  const p = await waitFor('[data-instruction-panel]');
  const r = p.getBoundingClientRect();
  return {width: r.width, sheet: Boolean(p.closest('[data-slot=sheet-content]'))};
`);
check('на 390 px панель — Sheet по ширине экрана', narrow.sheet && narrow.width <= 390, JSON.stringify(narrow));
await shot('library-panel-390');
await run(`localStorage.removeItem('sdlc.theme'); return true;`);
await s.resize(1440, 900);

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
