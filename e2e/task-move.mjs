import {mkdirSync, writeFileSync} from 'node:fs';
import {session, helpers} from './driver.mjs';

// Перевод в статус вне цикла (CLAB-407, эпик CLAB-404, design.spec): кнопка и
// диалог в «Действиях», перевод настоящим запросом на стенде, отказы сервера,
// лента, попытка этапа и метрики. Право считает сервер (actor_rights.move,
// CLAB-408): стенд в режиме header отдаёт move: true, а «наблюдатель», бот и
// сервер прежней версии — ответ карточки, переписанный в браузере (флаг
// e2e.rights). Отказы 400/403/409 и обрыв сети — подмена ответа одной ручки
// (e2e.moveFail): настоящий 409 stage_disabled на экране недостижим, радио
// выключенного этапа отключено. 401 уводит оболочку на вход и здесь не
// разыгрывается (общее правило клиента, не перевода).
//
// Сценарий заводит свой проект с циклом, где есть необязательный этап,
// выключенный по умолчанию; демонстрационный SDLC не трогает, повторяется на
// той же базе и убирает проект в конце.
//
// SDLC_E2E_SHOTS=<каталог> — снимки состояний диалога (светлая и тёмная
// темы, 390 px).
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
const PK = `MVE${Math.floor(Math.random() * 900 + 100)}`;
must(await json('POST', '/v1/projects', {key: PK, name: `Перевод в статус ${PK}`}), 'проект');
const st = (key, category, extra = {}) => ({key, name: key[0].toUpperCase() + key.slice(1), category, ...extra});
const tr = (key, from, to, kind) => ({key, name: key, to, kind, ...(from ? {from} : {})});
const bundle = {
  version: 1,
  workflows: [{
    name: 'Move',
    task_types: ['task'],
    statuses: [
      st('new', 'backlog', {is_initial: true}),
      st('work', 'active'),
      st('extra', 'active', {is_optional: true, enabled_by_default: false}),
      st('review', 'active'),
      st('done', 'done', {is_terminal: true}),
      st('cancelled', 'cancelled', {is_terminal: true}),
    ],
    transitions: [
      tr('start', 'new', 'work', 'advance'),
      tr('to_extra', 'work', 'extra', 'advance'),
      tr('extra_done', 'extra', 'review', 'advance'),
      tr('to_review', 'work', 'review', 'advance'),
      tr('finish', 'review', 'done', 'advance'),
      tr('cancel', 'work', 'cancelled', 'cancel'),
    ],
  }],
};
const imported = must(await json('POST', `/v1/projects/${PK}/import`, bundle), 'импорт цикла');
for (const w of imported.workflows) must(await json('POST', `/v1/workflows/${w.id}/activate`, {}), 'активация');
console.log(`проект сценария ${PK}`);

const newTask = async (title) => must(await json('POST', `/v1/projects/${PK}/tasks`, {title}), 'задача').key;
const go = async (key, transition) => must(await json('POST', `/v1/tasks/${key}/transitions/${transition}`, {}), `${key}: ${transition}`);
const serverTask = async (key) => (await json('GET', `/v1/tasks/${key}`)).body;
const KEY = await newTask('Перевод: задача сценария');
await go(KEY, 'start');
console.log(`задача сценария ${KEY}`);

// ── браузер: подмены ответов ────────────────────────────────────────────────
//  e2e.rights   — ответ карточки: viewer | legacy | nomove; нет — настоящий;
//  e2e.moveFail — ответ на POST …/move: «статус|код|текст» или «net»;
//  e2e.moveDelay — задержка настоящего запроса перевода, мс;
//  e2e.wfFail / e2e.wfSlow — ответ на GET /v1/workflows/<id>: 500 / задержка, мс.
// Запросы записи пишутся в window.__writes, ошибки страницы — в window.__errors.
const MSG_VIEWER = 'Наблюдатель только читает задачи (e2e-текст сервера)';
const STUB = `
  const realFetch = window.fetch;
  window.__writes = [];
  window.__errors = [];
  window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason)));
  const ss = (k) => sessionStorage.getItem(k);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jsonResponse = (body, status = 200) =>
    new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = ((init && init.method) || (typeof input !== 'string' && input.method) || 'GET').toUpperCase();
    if (method !== 'GET') {
      if (/\\/v1\\/tasks\\/[^/]+\\/move$/.test(url)) {
        window.__writes.push({method, url, body: init && init.body});
        const fail = ss('e2e.moveFail');
        if (fail === 'net') throw new TypeError('Failed to fetch');
        if (fail) {
          const [status, code, ...message] = fail.split('|');
          return jsonResponse({error: {code, message: message.join('|')}}, Number(status));
        }
        const delay = Number(ss('e2e.moveDelay') || 0);
        if (delay) await sleep(delay);
      }
      return realFetch(input, init);
    }
    if (/\\/v1\\/workflows\\/[^/?]+$/.test(url)) {
      if (ss('e2e.wfFail')) return jsonResponse({error: {code: 'internal', message: 'Цикл не отдался (e2e-текст сервера)'}}, 500);
      const slow = Number(ss('e2e.wfSlow') || 0);
      if (slow) await sleep(slow);
    }
    const res = await realFetch(input, init);
    const mode = ss('e2e.rights');
    if (mode && /\\/v1\\/tasks\\/[^/?]+$/.test(url)) {
      const body = await res.json();
      if (mode === 'legacy') delete body.actor_rights;
      else if (mode === 'nomove') delete body.actor_rights.move;
      else if (mode === 'viewer') {
        body.actor_rights = {
          edit: false, stage_choice: false, create_child: false, assign: false, link: false, scope: false, move: false,
          actor_deny: {move: {code: 'forbidden', reason: 'viewer', message: ${JSON.stringify(MSG_VIEWER)}}},
        };
      }
      return jsonResponse(body);
    }
    return res;
  };
`;

const s = await session(BASE + '/projects');
await s.addInitScript(STUB);
await s.resize(1400, 1000);
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
const open = async (path, ready = '[data-overview]') => {
  await s.goto(BASE + path);
  for (let i = 0; i < 30; i++) {
    if (await run(`return Boolean(document.querySelector(${JSON.stringify(ready)}));`)) break;
    await wait(400);
  }
  await wait(600);
};
const card = () => open(`/p/${PK}/tasks/${KEY}`);

// Что видно в диалоге.
const DIALOG = `
  const d = document.querySelector('[data-move-dialog]');
  if (!d) return null;
  const submit = d.querySelector('[data-move-submit]');
  const row = (k) => d.querySelector('[data-move-status="' + k + '"]');
  const reason = Array.from(d.querySelectorAll('label')).find((l) => l.innerText.trim().startsWith('Причина'));
  const rows = Array.from(d.querySelectorAll('[data-move-status]')).map((r) => ({
    key: r.getAttribute('data-move-status'),
    text: r.innerText.replace(/\\s+/g, ' ').trim(),
    disabled: r.querySelector('input').disabled,
    checked: r.querySelector('input').checked,
    link: Boolean(r.querySelector('[data-move-stages-link]')),
  }));
  return {
    text: d.innerText.replace(/\\s+/g, ' ').trim(),
    rows,
    submitDisabled: submit ? submit.disabled : null,
    submitText: submit ? submit.innerText.trim() : null,
    busy: submit ? submit.getAttribute('aria-busy') === 'true' : null,
    missing: (d.querySelector('[data-move-missing]')?.innerText || '').trim(),
    effect: (d.querySelector('[data-move-effect]')?.innerText || '').trim(),
    error: d.querySelector('[data-move-error]') ? d.querySelector('[data-move-error]').innerText.replace(/\\s+/g, ' ').trim() : null,
    mismatch: Boolean(d.querySelector('[data-move-mismatch]')),
    warning: (d.querySelector('[data-move-warning]')?.innerText || '').replace(/\\s+/g, ' ').trim(),
    loading: Boolean(d.querySelector('[data-move-loading]')),
    loadError: d.querySelector('[data-move-load-error]') ? d.querySelector('[data-move-load-error]').innerText.replace(/\\s+/g, ' ').trim() : null,
    reasonValue: reason ? document.getElementById(reason.getAttribute('for')).value : null,
    cancelDisabled: d.querySelector('[data-move-cancel]')?.disabled,
    scrolls: d.scrollHeight > d.clientHeight,
    width: d.getBoundingClientRect().width,
  };
`;
const dlg = () => run(DIALOG);
const openDialog = async () => {
  await run(`document.querySelector('[data-move-open]').click(); await sleep(600); return true;`);
};
const pick = (key) => run(`document.querySelector('[data-move-status="${key}"] input').click(); await sleep(300); return true;`);
const closeDialog = async () => {
  await run(`document.querySelector('[data-move-cancel]')?.click(); await sleep(500); return true;`);
};
const entry = () => run(`return Boolean(document.querySelector('[data-move-entry]'));`);
const actionsText = () => run(`
  const h = all('h2').find((e) => e.innerText.trim() === 'Действия');
  const section = h ? h.closest('section') : null;
  return section ? section.innerText.replace(/\\s+/g, ' ').trim() : '';
`);

// ── сервер: право ────────────────────────────────────────────────────────────
console.log('сервер: право на перевод');
const rights = (await serverTask(KEY)).actor_rights;
check('стенд отдаёт actor_rights.move: true', rights?.move === true, JSON.stringify(rights));

// ── вход и состав диалога ────────────────────────────────────────────────────
console.log('вход: строка «Вне цикла» в «Действиях»');
await card();
check('блок «Вне цикла» есть, кнопка «Перевести в статус»', await entry());
let a = await actionsText();
check('под переходами цикла: «Вне цикла», «Гейты не проверяются»', a.includes('Вне цикла') && a.includes('Гейты не проверяются') && a.includes('Перевести в статус'), a);
check('кнопка входа активна', await run(`return !document.querySelector('[data-move-open]').disabled;`));
check('переходы цикла остались (to_review, cancel)', (await serverTask(KEY)).transitions.length >= 2 && a.includes('to_review'), a);

console.log('диалог: пустое состояние');
await openDialog();
let d = await dlg();
check('диалог открыт, заголовок и «Сейчас: Work»', d && d.text.includes('Перевести в статус') && d.text.includes(`${KEY} · Перевод: задача сценария`) && d.text.includes('Сейчас: Work'), d?.text.slice(0, 200));
check('статусы версии цикла задачи по порядку, названия и ключи',
  d.rows.map((r) => r.key).join() === 'new,work,extra,review,done,cancelled' && d.rows[1].text.startsWith('Work work'), JSON.stringify(d.rows.map((r) => r.key)));
check('текущий статус отмечен «сейчас» и выбирается', d.rows[1].text.includes('сейчас') && !d.rows[1].disabled);
check('завершающие помечены, необязательный помечен', d.rows[4].text.includes('завершающий') && d.rows[5].text.includes('завершающий') && d.rows[2].text.includes('необязательный'), d.rows[2].text);
check('выключенный этап: радио отключено, «этап выключен у задачи» и ссылка «Выбор этапов»', d.rows[2].disabled && d.rows[2].text.includes('этап выключен у задачи') && d.rows[2].link, JSON.stringify(d.rows[2]));
check('ничего не выбрано, кнопка «Перевести» неактивна', d.rows.every((r) => !r.checked) && d.submitDisabled === true && d.submitText === 'Перевести');
check('«Осталось: выбрать статус, указать причину, ввести ключ»', d.missing === 'Осталось: выбрать статус, указать причину, ввести ключ', d.missing);
check('предупреждение до отправки: гейты не проверяются, исполнитель потеряет аренду',
  d.warning.includes('Это не обычный переход') && d.warning.includes('Гейты не проверяются, текущий исполнитель потеряет аренду'), d.warning);
check('подпись ключа «Введите KEY, чтобы подтвердить»', d.text.includes(`Введите ${KEY}, чтобы подтвердить`));
await shot('B1-пусто-светлая');

console.log('диалог: заполнение');
await pick('review');
d = await dlg();
check('выбран статус: пояснение по названиям версии', d.effect === 'Текущая попытка Work закроется как «переведена вручную», в Review откроется новая.', d.effect);
await run(`await fill('Причина', '   '); return true;`);
await run(`await fill('Введите', '${KEY}'); return true;`);
d = await dlg();
check('причина из пробелов — кнопка неактивна, «Осталось: указать причину»', d.submitDisabled === true && d.missing === 'Осталось: указать причину', d.missing);
await run(`await fill('Причина', '  требования неверны  '); await fill('Введите', 'mve'); return true;`);
d = await dlg();
check('ключ не совпал: подсказка под полем, кнопка неактивна', d.mismatch && d.text.includes(`Ключ не совпадает с ${KEY}`) && d.submitDisabled === true && d.missing === 'Осталось: ввести ключ', d.missing);
await run(`await fill('Введите', '${KEY.toLowerCase()}'); return true;`);
d = await dlg();
check('регистр ключа важен', d.submitDisabled === true && d.mismatch);
await run(`await fill('Введите', ' ${KEY} '); return true;`);
d = await dlg();
check('ключ совпал (пробелы по краям допускаются): кнопка активна, «Осталось» нет', d.submitDisabled === false && d.missing === '' && !d.mismatch, JSON.stringify([d.submitDisabled, d.missing]));
check('в «Осталось» нет лишнего: писать некуда, блока отказа нет', d.error === null);
await shot('B2-готово-светлая');

// ── отказы сервера ───────────────────────────────────────────────────────────
console.log('отказ сервера: диалог остаётся, текст сервера дословно');
const REFUSALS = [
  ['400|invalid_input|Нет такого статуса: ghost (e2e-текст 400)', 'Нет такого статуса: ghost (e2e-текст 400)'],
  ['403|forbidden|Перевод разрешён сопровождающему (e2e-текст 403)', 'Перевод разрешён сопровождающему (e2e-текст 403)'],
  ['409|stage_disabled|Этап extra выключен у задачи: включите его командой clab edit (e2e-текст 409)', 'Этап extra выключен у задачи: включите его командой clab edit (e2e-текст 409)'],
  ['net', 'сервис недоступен'],
];
for (const [flag, text] of REFUSALS) {
  await setFlag('e2e.moveFail', flag);
  const sentBefore = (await writes()).length;
  await run(`document.querySelector('[data-move-submit]').click(); await sleep(900); return true;`);
  d = await dlg();
  check(`${flag.split('|')[0]}: диалог открыт, блок «Перевод не выполнен» с текстом сервера`, d && d.error && d.error.includes('Перевод не выполнен') && d.error.includes(text), d?.error);
  check(`${flag.split('|')[0]}: код отказа на экран не выводится`, !/stage_disabled|invalid_input|forbidden/.test(d.error ?? ''), d?.error);
  check(`${flag.split('|')[0]}: причина сохранена, кнопка снова активна`, d.reasonValue === '  требования неверны  ' && d.submitDisabled === false && d.rows.find((r) => r.key === 'review').checked, JSON.stringify([d.reasonValue, d.submitDisabled]));
  check(`${flag.split('|')[0]}: ушёл ровно один запрос`, (await writes()).length === sentBefore + 1);
}
await shot('B4-отказ-светлая');
await setFlag('e2e.moveFail', undefined);

// ── отправка ─────────────────────────────────────────────────────────────────
console.log('отправка: блокировка и настоящий перевод');
await setFlag('e2e.moveDelay', '2000');
const wBefore = (await writes()).length;
await run(`document.querySelector('[data-move-submit]').click(); await sleep(300); return true;`);
d = await dlg();
check('во время отправки: «Переводим…», кнопка неактивна, блок отказа исчез', d.busy === true && d.submitText.includes('Переводим…') && d.submitDisabled === true && d.error === null, JSON.stringify([d.busy, d.submitText, d.submitDisabled]));
check('во время отправки: «Отмена» и список неактивны', d.cancelDisabled === true && d.rows.every((r) => r.disabled));
await shot('B3-отправка-светлая');
await run(`document.querySelector('[data-move-submit]').click(); await sleep(100); return true;`);
await run(`document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); await sleep(300); return true;`);
check('Esc во время отправки диалог не закрывает', (await dlg()) !== null);
await wait(2600);
await setFlag('e2e.moveDelay', undefined);
const sent = (await writes()).slice(wBefore);
check('повторного запроса нет: один POST /move', sent.length === 1, JSON.stringify(sent));
check('тело: {to: ключ статуса, reason без пробелов по краям}', sent[0] && sent[0].body === '{"to":"review","reason":"требования неверны"}', sent[0]?.body);
check('успех: диалог закрыт', (await dlg()) === null);
const toastTexts = await run('return toasts();');
check('тост «Задача переведена в «Review»»', toastTexts.some((t) => t.includes('Задача переведена в «Review»')), JSON.stringify(toastTexts));
await wait(800);
const t1 = await serverTask(KEY);
check('сервер: задача в review', t1.task.status_key === 'review', t1.task.status_key);
check('карточка перечитана без перезагрузки: статус и новая попытка', (await run(`return texts();`)).includes('Review'));
check('нет ошибок страницы', (await run('return window.__errors;')).length === 0, JSON.stringify(await run('return window.__errors;')));

// ── лента и попытки ──────────────────────────────────────────────────────────
console.log('лента и попытка этапа');
await card();
await run(`await openSection('timeline'); return true;`);
const ev = await run(`
  const row = document.querySelector('[data-event="task.moved"]');
  return row ? row.innerText.replace(/\\s+/g, ' ').trim() : null;
`);
check('событие task.moved подписано «перевёл вручную»', ev && ev.includes('перевёл вручную'), ev);
check('строка «из Work в Review: причина · уровень … · токен …» по названиям версии', ev && /из Work в Review: требования неверны · уровень \w+/.test(ev), ev);
const evOther = await run(`return all('[data-event]').filter((e) => e.getAttribute('data-event') !== 'task.moved').map((e) => e.innerText).join(' ');`);
check('уровень и вид токена — только у task.moved', !/ · уровень /.test(evOther), evOther.slice(0, 200));
check('stage.entered остался как был', evOther.includes('этап начат'));
await open(`/p/${PK}/tasks/${KEY}?stage=work`, '[data-stage-panel]');
const att = await run(`
  const p = document.querySelector('[data-stage-panel]');
  const exits = all('[data-attempt-exit]').map((e) => ({kind: e.getAttribute('data-attempt-exit'), text: e.innerText.replace(/\\s+/g, ' ').trim()}));
  return {text: p ? p.innerText.replace(/\\s+/g, ' ') : '', exits};
`);
check('попытка Work: «переведена вручную в «Review»» и причина', att.exits.some((x) => x.kind === 'moved' && x.text.includes('переведена вручную в «Review»') && x.text.includes('требования неверны')), JSON.stringify(att.exits));
check('в заголовке попытки — «переведена вручную», сырого «moved» на экране нет', att.text.includes('переведена вручную') && !/\bmoved\b/.test(att.text), att.text.slice(0, 300));
await shot('D-попытка-светлая');

// ── закрытая задача ──────────────────────────────────────────────────────────
console.log('закрытая задача: терминальный статус');
must(await json('POST', `/v1/tasks/${KEY}/move`, {to: 'cancelled', reason: 'снимаем (e2e)'}), 'перевод в cancelled');
await setFlag('e2e.rights', 'viewer');
await card();
a = await actionsText();
check('наблюдатель: блока «Вне цикла» нет, прежнее «Дальше некуда»', !(await entry()) && a.includes('Дальше некуда'), a);
check('наблюдатель: текст отказа сервера нигде не выведен (Q2)', !(await run('return texts();')).includes(MSG_VIEWER));
for (const mode of ['legacy', 'nomove']) {
  await setFlag('e2e.rights', mode);
  await card();
  a = await actionsText();
  check(`${mode === 'legacy' ? 'сервер без actor_rights' : 'actor_rights без поля move'}: кнопки нет, «Дальше некуда», ошибок нет`,
    !(await entry()) && a.includes('Дальше некуда') && (await run('return window.__errors;')).length === 0, a);
}
await setFlag('e2e.rights', undefined);
await card();
a = await actionsText();
check('право есть: вместо «Дальше некуда» — «Из этого статуса переходов цикла нет» и блок «Вне цикла»', (await entry()) && a.includes('Из этого статуса переходов цикла нет') && !a.includes('Дальше некуда'), a);
await openDialog();
d = await dlg();
check('текущий статус Cancelled отмечен «сейчас»', d.rows.find((r) => r.key === 'cancelled').text.includes('сейчас'));
check('выключенный этап у закрытой задачи: текст вместо ссылки', d.rows[2].disabled && !d.rows[2].link && d.rows[2].text.includes('пока задача закрыта, включить его нельзя'), d.rows[2].text);
await pick('work');
d = await dlg();
check('пояснение: «Задача снова станет открытой.»', d.effect === 'Задача снова станет открытой.', d.effect);
await pick('done');
d = await dlg();
check('завершающий статус закрытой задачи: пояснения нет', d.effect === '', d.effect);
await pick('cancelled');
d = await dlg();
check('текущий статус: «Текущая попытка закроется как «переведена вручную», начнётся новая.»', d.effect === 'Текущая попытка закроется как «переведена вручную», начнётся новая.', d.effect);
await pick('work');
await run(`await fill('Причина', 'вернули в работу'); await fill('Введите', '${KEY}'); return true;`);
await shot('B8-закрытая-светлая');
await run(`document.querySelector('[data-move-submit]').click(); await sleep(1800); return true;`);
const t2 = await serverTask(KEY);
check('сервер: задача снова открыта в work', t2.task.status_key === 'work' && !t2.task.closed_at, JSON.stringify([t2.task.status_key, t2.task.closed_at]));
await open(`/p/${PK}/tasks/${KEY}?stage=work`, '[data-stage-panel]');
const att2 = await run(`return document.querySelector('[data-stage-panel]').innerText.replace(/\\s+/g, ' ');`);
check('возврат из закрытой задачи — новая попытка Work', /попытка 2/.test(att2), att2.slice(0, 300));

// ── версия цикла: загрузка и ошибка ──────────────────────────────────────────
console.log('версия цикла: загрузка и ошибка загрузки');
await setFlag('e2e.wfSlow', '4000');
await card();
check('вход не блокируется, пока цикл грузится', await run(`const b = document.querySelector('[data-move-open]'); return Boolean(b) && !b.disabled;`));
await openDialog();
d = await dlg();
check('загрузка: скелетон и «Загружаем статусы цикла задачи…», кнопка неактивна, «Отмена» работает',
  d && d.loading && d.text.includes('Загружаем статусы цикла задачи…') && d.submitDisabled === true && d.cancelDisabled === false, d?.text);
await shot('B5-загрузка-светлая');
await closeDialog();
check('«Отмена» закрывает диалог', (await dlg()) === null);
await setFlag('e2e.wfSlow', undefined);
await setFlag('e2e.wfFail', '1');
await card();
await openDialog();
d = await dlg();
check('ошибка загрузки: «Не получилось загрузить статусы» с текстом сервера и «Повторить»',
  d && d.loadError && d.loadError.includes('Не получилось загрузить статусы') && d.loadError.includes('Цикл не отдался (e2e-текст сервера)') && d.loadError.includes('Повторить'), d?.loadError);
check('при ошибке полей и списка нет, кнопка неактивна', d.rows.length === 0 && d.submitDisabled === true);
await shot('B6-ошибка-загрузки-светлая');
await setFlag('e2e.wfFail', undefined);
await run(`Array.from(document.querySelectorAll('[data-move-load-error] button')).find((b) => b.innerText.trim() === 'Повторить').click(); await sleep(1500); return true;`);
d = await dlg();
check('«Повторить» загрузило список', d && d.rows.length === 6 && !d.loadError, JSON.stringify(d?.rows.length));
await closeDialog();

// ── ссылка «Выбор этапов» ────────────────────────────────────────────────────
console.log('ссылка «Выбор этапов»');
await card();
await openDialog();
await run(`document.querySelector('[data-move-stages-link]').click(); await sleep(900); return true;`);
check('ссылка закрывает диалог и ставит фокус на переключатели «Выбор этапов»',
  (await dlg()) === null && (await run(`const a = document.activeElement; return Boolean(a && a.closest('[data-task-stages]'));`)));

// ── метрики ──────────────────────────────────────────────────────────────────
console.log('метрики: колонка «Переводов»');
const metrics = (await json('GET', `/v1/projects/${PK}/metrics?period=30d`)).body;
const mv = metrics.statuses.find((x) => x.status === 'work');
check('сервер считает переводы из work (один, из интерфейса)', mv && mv.moves === 1, JSON.stringify(mv));
await open(`/p/${PK}/metrics`, 'table');
const table = await run(`
  const t = all('table').find((x) => x.innerText.includes('Откатов'));
  if (!t) return null;
  const heads = Array.from(t.querySelectorAll('thead th')).map((h) => h.innerText.trim());
  const rows = Array.from(t.querySelectorAll('tbody tr')).map((r) => Array.from(r.children).map((c) => c.innerText.trim()));
  return {heads, rows};
`);
const ci = table?.heads.indexOf('Переводов');
check('колонка «Переводов» сразу после «Откатов»', table && ci === table.heads.indexOf('Откатов') + 1 && table.heads[ci + 1] === 'Повторных', JSON.stringify(table?.heads));
const wr = table?.rows.find((r) => r[0] === 'Work' || r[0] === 'work');
check('значение из ответа сервера, ноль — «0»', wr && wr[ci] === String(mv.moves) && table.rows.some((r) => r[ci] === '0'), JSON.stringify(table?.rows));
await shot('E-метрики-светлая');

// ── тёмная тема и 390 px ─────────────────────────────────────────────────────
if (SHOTS) {
  await s.emulate([{name: 'prefers-color-scheme', value: 'dark'}]);
  await card();
  await run(`document.documentElement.classList.add('dark'); return true;`);
  await openDialog();
  await pick('review');
  await run(`await fill('Причина', 'проверка тёмной темы'); return true;`);
  await shot('B2-тёмная');
  await closeDialog();
  await s.resize(390, 800);
  await card();
  await openDialog();
  await pick('review');
  await run(`await fill('Причина', 'длинная причина для узкого экрана '.repeat(3)); await fill('Введите', 'x'); return true;`);
  d = await dlg();
  check('390 px: диалог в ширину экрана минус поля', d && d.width <= 390 - 16 + 1 && d.width > 340, String(d?.width));
  await shot('B7-390');
}

// ── уборка ───────────────────────────────────────────────────────────────────
for (const k of ['e2e.rights', 'e2e.moveFail', 'e2e.moveDelay', 'e2e.wfFail', 'e2e.wfSlow']) await setFlag(k, undefined);
await json('DELETE', `/v1/projects/${PK}`);
console.log(`\n${ok} ok, ${fail} fail`);
s.close();
process.exit(fail ? 1 : 0);
