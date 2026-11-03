// Предложения версий роли в панели «Пайплайна» (CLAB-384, AC-12): участник
// уровня agent предлагает и отзывает, сопровождающий утверждает, отклоняет с
// заметкой и видит «устарело»; наблюдатель только читает; «Новая версия»
// сопровождающего не меняется; отказы и сбои.
//
// Своя роль `e2e-prop-*` с двумя документами, заведённая ручками API, —
// сценарий повторяется на той же базе. Стенд в режиме header: кто я
// (`/auth/me`) подменяется в браузере ответом одной ручки — режим token и
// участие нужного уровня; запросы по-прежнему идут от актора заголовка
// (`agent:…` — агент, `e2e` — человек), и сервер решает по-настоящему.
// Отказы 403 и 500, которых header не даёт, подменяются ответом одной ручки.
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

const stamp = Date.now().toString(36);
const KEY = `e2e-prop-${stamp}`;
const OTHER = `e2e-prop-other-${stamp}`;
const AGENT = `agent:e2e-ui-${stamp}`;
const AUTHOR = `agent:e2e-author-${stamp}`;
const HANDLE = AUTHOR.replace('agent:', '');
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const roleUrl = (key = KEY) => `${BASE}/p/SDLC/pipeline?role=${key}`;

const s = await session(roleUrl());
const waitFor = `
  const waitFor = async (sel, ms = 5000) => {
    for (let i = 0; i < ms / 100 && !document.querySelector(sel); i++) await sleep(100);
    const el = document.querySelector(sel);
    if (!el) throw new Error('нет на странице: ' + sel);
    return el;
  };
  const gone = async (sel, ms = 5000) => {
    for (let i = 0; i < ms / 100 && document.querySelector(sel); i++) await sleep(100);
    return !document.querySelector(sel);
  };
  const row = (id) => document.querySelector('[data-proposal="' + id + '"]');
  const rowBtn = (id) => document.querySelector('[data-proposal="' + id + '"] > button');
  const act = (name) => document.querySelector('[data-proposal-card] [data-proposal-action="' + name + '"]');
  const section = () => (document.querySelector('[data-role-proposals]')?.innerText || '').replace(/\\s+/g, ' ');
  const rows = () => all('[data-role-proposals] [data-proposal]').map((el) => ({
    id: el.getAttribute('data-proposal'), n: el.getAttribute('data-proposal-number'),
    state: el.getAttribute('data-proposal-state'), label: el.getAttribute('data-proposal-label'),
    text: (el.querySelector('button')?.innerText || '').replace(/\\s+/g, ' '),
  }));
  const expand = async (id) => {
    if (rowBtn(id).getAttribute('aria-expanded') !== 'true') { rowBtn(id).click(); await sleep(900); }
  };
  const dialogText = () => (document.querySelector('[role=dialog]')?.innerText || '').replace(/\\s+/g, ' ');
  const submitDialog = async () => { document.querySelector('[data-proposal-dialog-submit]').click(); await sleep(1200); };
`;
const run = (body) => s.evaluate(helpers + waitFor + body);
// Снимок целиком проходит через окно 1×1: на широком экране панель на миг
// становится Sheet и открытая карточка закрывается. Поэтому снимаем только на
// узком экране, где панель — Sheet всегда.
const shot = async (name) => {
  if (SHOTS) writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(await s.screenshot(), 'base64'));
};

// Подмены одной ручки по сессии вкладки: кто я, 403 на версию, сбои очереди.
const STUB = `
  const prevFetch = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = ((init && init.method) || (typeof input !== 'string' && input.method) || 'GET').toUpperCase();
    const cfg = JSON.parse(sessionStorage.getItem('e2e.prop') || '{}');
    const json = (status, body) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
    if (cfg.me && /\\/v1\\/auth\\/me$/.test(url)) {
      const me = await (await prevFetch(input, init)).json();
      me.mode = 'token';
      me.authenticated = true;
      me.teams = [];
      me.memberships = [{project_key: 'SDLC', project_id: '', principal_id: me.principal.id, handle: me.principal.handle,
        kind: me.principal.kind, display_name: '', role: cfg.me, role_keys: cfg.keys === undefined ? null : cfg.keys, created_at: ''}];
      return json(200, me);
    }
    if (cfg.forbidVersion && method === 'POST' && /\\/roles\\/[^/]+\\/versions$/.test(url)) {
      return json(403, {error: {code: 'forbidden', message: 'участник уровня agent версию роли не заводит; clab role propose <роль>'}});
    }
    if (cfg.listFails && method === 'GET' && /\\/roles\\/[^/]+\\/proposals$/.test(url)) {
      return json(500, {error: {code: 'internal', message: 'очередь недоступна: сбой хранилища'}});
    }
    if (cfg.detailFails && method === 'GET' && /\\/roles\\/[^/]+\\/proposals\\/[0-9a-f-]+$/.test(url)) {
      return json(500, {error: {code: 'internal', message: 'предложение не прочиталось: сбой хранилища'}});
    }
    return prevFetch(input, init);
  };
`;
await s.addInitScript(STUB);
// Режим вкладки и актор: me — уровень участия, keys — набор ролей.
const setup = async ({me, keys, actor = 'e2e', ...flags} = {}) => {
  const cfg = JSON.stringify({me, keys, ...flags});
  await s.evaluate(`
    sessionStorage.setItem('e2e.prop', ${JSON.stringify(cfg)});
    localStorage.setItem('sdlc.actor', ${JSON.stringify(actor)});
    localStorage.setItem('sdlc.theme', 'light');
    return true;
  `);
};
const open = async (key = KEY, query = '') => {
  await s.goto(`${roleUrl(key)}${query}`);
  await pause(1500);
  await s.evaluate(helpers + waitFor + `await waitFor('[data-role-panel]'); await waitFor('[data-role-proposals]'); await sleep(500); return true;`);
};

// ── данные ──────────────────────────────────────────────────────────────────
const docsV1 = [
  {name: 'a-rules.md', kind: 'instructions', content: '# Правила\n\n- первое правило\n- второе правило\n'},
  {name: 'b-check.md', kind: 'checklist', content: '- [ ] проверить\n'},
];
const contract = [{kind: 'e2e.prop_report', required: true}];
const proposalBody = (rule, changelog, extra = {}) => ({
  documents: [{name: 'a-rules.md', kind: 'instructions', content: `# Правила\n\n- первое правило\n- ${rule}\n`}, docsV1[1]],
  input_kinds: ['e2e.input'],
  output_contract: contract,
  changelog,
  ...extra,
});
const made = await call('POST', '/projects/SDLC/roles', {
  key: KEY, name: `Предложения ${stamp}`,
  version: {documents: docsV1, output_contract: contract, input_kinds: ['e2e.input']},
});
const madeOther = await call('POST', '/projects/SDLC/roles', {
  key: OTHER, name: `Чужая ${stamp}`,
  version: {documents: docsV1, output_contract: contract, input_kinds: ['e2e.input']},
});
check('свои роли заведены (API)', made.status === 201 && madeOther.status === 201, JSON.stringify([made.status, madeOther.status]).slice(0, 200));
const versionsCount = async (key = KEY) => (await call('GET', `/projects/SDLC/roles/${key}`)).body.versions.length;
const listApi = async (key = KEY) => (await call('GET', `/projects/SDLC/roles/${key}/proposals`)).body.proposals;
await s.resize(1440, 900);

// ── agent: предложить (AC-1, AC-2) ──────────────────────────────────────────
console.log('agent: «Предложить версию» (AC-1, AC-2)');
await setup({me: 'agent', keys: null, actor: AGENT});
await open();
const header = await run(`
  const h = document.querySelector('[data-role-panel]');
  return {propose: Boolean(h.querySelector('[data-role-action="propose"]')), create: Boolean(h.querySelector('[data-role-action="create"]')), text: section()};
`);
check('у agent с любым набором — «Предложить версию», «Новая версия» нет', header.propose && !header.create, JSON.stringify(header));
check('очередь пуста: «Предложений нет»', header.text.includes('Предложений нет') && header.text.includes('Участник уровня agent предлагает версию своей роли'), header.text);
const emptyTitle = await run(`return document.querySelector('[data-role-proposals] h3').innerText;`);
check('заголовок «Предложения (0)»', emptyTitle === 'Предложения (0)', emptyTitle);
await run(`document.querySelector('[data-role-action="propose"]').click(); await sleep(600); return true;`);
const form = await run(`
  await waitFor('[data-new-proposal] [data-doc-editor]');
  const f = document.querySelector('[data-new-proposal]');
  const btn = all('button').find((b) => (b.innerText || '').trim() === 'Отправить предложение');
  return {text: f.innerText.replace(/\\s+/g, ' '), disabled: btn.disabled, wide: document.querySelector('[data-pipeline-inspector]').getBoundingClientRect().width,
    invalidAtOpen: document.querySelector('[data-proposal-changelog] input').getAttribute('aria-invalid')};
`);
check('заголовок «Предложение новой версии после v1»', form.text.includes('Предложение новой версии после v1'), form.text.slice(0, 200));
check('пояснение: версию утвердит сопровождающий', form.text.includes('Версия не заведётся сразу: её утвердит сопровождающий') && form.text.includes('прогоны идут по v1'), form.text.slice(0, 300));
check('«Что изменилось» обязательно, подсказка «Нужно: что и зачем меняется»', form.text.includes('Что изменилось *') && form.text.includes('Нужно: что и зачем меняется'));
check('«Отправить предложение» выключена без changelog', form.disabled === true);
check('поле не подсвечено при открытии', form.invalidAtOpen === null, String(form.invalidAtOpen));
check('форма шире панели', form.wide > 600, String(form.wide));
const touched = await run(`
  const input = document.querySelector('[data-proposal-changelog] input');
  input.focus(); input.blur(); await sleep(300);
  return document.querySelector('[data-proposal-changelog] input').getAttribute('aria-invalid');
`);
check('после потери фокуса пустым — aria-invalid', touched === 'true', String(touched));
const beforeCount = await versionsCount();
await run(`
  await fill("Что изменилось", "   ");
  const btn = all('button').find((b) => (b.innerText || '').trim() === 'Отправить предложение');
  window.__spaces = btn.disabled;
  await fill("Содержимое", '# Правила\\n\\n- первое правило\\n- второе правило, точнее ${stamp}\\n');
  await fill("Что изменилось", "уточнили второе правило");
  return true;
`);
const spaces = await run(`return window.__spaces;`);
check('пробельный changelog — кнопка выключена', spaces === true);
await run(`
  window.__bodies = [];
  const orig = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if ((init?.method || '').toUpperCase() === 'POST') window.__bodies.push({url, body: JSON.parse(init.body || '{}')});
    return orig(input, init);
  };
  await clickExact('Отправить предложение');
  await sleep(1500);
  return true;
`);
const sent = await run(`return window.__bodies;`);
check('POST …/proposals с документами и changelog', sent.length === 1 && /\/roles\/e2e-prop-[^/]+\/proposals$/.test(sent[0].url) && sent[0].body.changelog === 'уточнили второе правило'
  && Array.isArray(sent[0].body.documents) && sent[0].body.documents.length === 2 && !('instructions' in sent[0].body), JSON.stringify(sent).slice(0, 300));
const afterSend = await run(`
  return {rows: rows(), toasts: toasts(), form: Boolean(document.querySelector('[data-new-proposal]')),
    focus: document.activeElement?.closest('[data-proposal]')?.getAttribute('data-proposal') ?? null,
    text: section(), wide: document.querySelector('[data-pipeline-inspector]').getBoundingClientRect().width};
`);
const mine = (await listApi())[0];
check('строка «ожидает · от v1», #1', afterSend.rows.length === 1 && afterSend.rows[0].label === 'ожидает' && afterSend.rows[0].text.includes('от v1') && afterSend.rows[0].n === '1', JSON.stringify(afterSend.rows));
check('автор своего предложения — «вы»', afterSend.rows[0]?.text.includes('вы · от v1'), afterSend.rows[0]?.text);
check('тост об отправке', afterSend.toasts.some((x) => x.includes('Предложение отправлено: версию заведёт сопровождающий после утверждения')), afterSend.toasts.join('|'));
check('форма закрыта, панель вернулась к 440 px', !afterSend.form && afterSend.wide < 500, String(afterSend.wide));
check('фокус на строке предложения', afterSend.focus === mine?.id, `${afterSend.focus} / ${mine?.id}`);
check('версий не прибавилось (GET …/versions до и после)', (await versionsCount()) === beforeCount, String(await versionsCount()));
check('в API pending от v1', mine?.state === 'pending' && mine?.base_version === 1 && mine?.changelog === 'уточнили второе правило');

// ── чужое предложение; agent не решает и не отзывает чужое (AC-6, AC-7) ──────
console.log('agent: чужое предложение (AC-6, AC-7)');
const foreign = (await call('POST', `/projects/SDLC/roles/${KEY}/proposals`, proposalBody('чужое правило', 'правка от другого агента'), AUTHOR)).body;
check('предложение другого агента подано (API)', foreign?.state === 'pending' && foreign?.created_by_handle === AUTHOR.replace('agent:', ''), JSON.stringify(foreign).slice(0, 200));
await open();
await run(`await expand("${foreign.id}"); return true;`);
const foreignView = await run(`
  return {approve: Boolean(act('approve')), reject: Boolean(act('reject')), withdraw: Boolean(act('withdraw')),
    text: row("${foreign.id}").innerText.replace(/\\s+/g, ' ')};
`);
check('у чужого pending у agent нет ни «Утвердить», ни «Отклонить…», ни «Отозвать…»', !foreignView.approve && !foreignView.reject && !foreignView.withdraw, JSON.stringify(foreignView));
check('в карточке автор чужого — его handle', foreignView.text.includes(`Автор: ${HANDLE}`), foreignView.text.slice(0, 200));

console.log('agent: «Отозвать…» своего (AC-6)');
await run(`await expand("${mine.id}"); return true;`);
const ownView = await run(`return {approve: Boolean(act('approve')), reject: Boolean(act('reject')), withdraw: Boolean(act('withdraw'))};`);
check('у своего pending — только «Отозвать…»', !ownView.approve && !ownView.reject && ownView.withdraw, JSON.stringify(ownView));
await run(`act('withdraw').click(); await sleep(600); return true;`);
const wd = await run(`
  return {dialog: dialogText(), submitDisabled: document.querySelector('[data-proposal-dialog-submit]').disabled};
`);
check('диалог «Отозвать предложение #1?» с пояснением и необязательной заметкой', wd.dialog.includes('Отозвать предложение #1?') && wd.dialog.includes('Предложение закроется без версии. Заново — только новым предложением.') && wd.dialog.includes('Необязательно'), wd.dialog);
check('«Отозвать» доступна и без заметки', wd.submitDisabled === false);
await run(`await submitDialog(); return true;`);
const afterWd = await run(`
  return {rows: rows().filter((r) => r.id === "${mine.id}"), toasts: toasts(), dialog: Boolean(document.querySelector('[role=dialog]')),
    focus: document.activeElement?.closest('[data-proposal]')?.getAttribute('data-proposal') ?? null,
    title: document.querySelector('[data-role-proposals] h3').innerText, filter: document.querySelector('[data-proposals-filter]').getAttribute('data-proposals-filter')};
`);
check('отозванное остаётся видно: фильтр переключился на «Все», строка «отозвано», фокус на ней', afterWd.filter === 'all' && afterWd.rows.length === 1 && afterWd.rows[0].label === 'отозвано' && afterWd.focus === mine.id, JSON.stringify(afterWd));
check('тост «Предложение #1 отозвано», диалог закрыт', afterWd.toasts.some((x) => x.includes('Предложение #1 отозвано')) && !afterWd.dialog, afterWd.toasts.join('|'));
check('заголовок «Все»: (2)', afterWd.title === 'Предложения (2)', afterWd.title);
check('версий не прибавилось', (await versionsCount()) === beforeCount);
const mineAfter = (await call('GET', `/projects/SDLC/roles/${KEY}/proposals/${mine.id}`)).body;
check('в API withdrawn', mineAfter.state === 'withdrawn');
const allView = await run(`return {rows: rows()};`);
check('«Все»: обе строки, новые сверху, у отозванного #1', allView.rows.length === 2 && allView.rows[0].n === '2' && allView.rows[1].n === '1' && allView.rows[1].label === 'отозвано', JSON.stringify(allView));
await run(`
  const b = Array.from(document.querySelectorAll('[data-proposals-filter] button')).find((x) => x.innerText.trim() === 'Ожидают');
  b.dispatchEvent(new MouseEvent('mousedown', {bubbles: true})); b.click(); await sleep(500);
  return true;
`);
const pendingView = await run(`return {rows: rows().map((r) => r.n), title: document.querySelector('[data-role-proposals] h3').innerText};`);
check('«Ожидают»: только чужое pending, заголовок (1)', eq(pendingView.rows, ['2']) && pendingView.title === 'Предложения (1)', JSON.stringify(pendingView));

// ── agent: роль вне набора и граничные наборы (AC-1) ─────────────────────────
console.log('agent: роль вне набора (AC-1)');
for (const [title, keys, expectPropose] of [['в наборе по ключу', [KEY], true], ['вне набора', ['other-role'], false], ['пустой набор', [], false]]) {
  await setup({me: 'agent', keys, actor: AGENT});
  await open();
  const v = await run(`
    const p = document.querySelector('[data-role-panel]');
    return {propose: Boolean(p.querySelector('[data-role-action="propose"]')), create: Boolean(p.querySelector('[data-role-action="create"]')),
      note: (p.querySelector('[data-role-action-note]')?.innerText || '').trim()};
  `);
  const want = expectPropose ? v.propose && !v.create && v.note === '' : !v.propose && !v.create && v.note === 'Версию этой роли вы не предлагаете: она не в вашем наборе ролей';
  check(`набор: ${title}`, want, JSON.stringify(v));
}

// ── viewer (AC-7) ────────────────────────────────────────────────────────────
console.log('viewer: очередь только читает (AC-7)');
await setup({me: 'viewer', keys: null, actor: AGENT});
await open();
await run(`await expand("${foreign.id}"); return true;`);
const viewer = await run(`
  const p = document.querySelector('[data-role-panel]');
  return {buttons: all('[data-role-action]').length, note: Boolean(p.querySelector('[data-role-action-note]')),
    approve: Boolean(act('approve')), reject: Boolean(act('reject')), withdraw: Boolean(act('withdraw')), rows: rows().length, doc: Boolean(document.querySelector('[data-proposal-card] [data-role-diff], [data-proposal-card] [data-proposal-documents]'))};
`);
check('viewer: ни кнопки шапки, ни строки, ни кнопок решения', viewer.buttons === 0 && !viewer.note && !viewer.approve && !viewer.reject && !viewer.withdraw, JSON.stringify(viewer));
check('viewer видит очередь и раскрытую карточку с диффом', viewer.rows === 1 && viewer.doc, JSON.stringify(viewer));

// ── maintainer: утвердить (AC-3) ─────────────────────────────────────────────
console.log('maintainer: «Утвердить» (AC-3, AC-7)');
// Три предложения от v1: утвердим первое, второе и третье устареют.
const pa = (await call('POST', `/projects/SDLC/roles/${KEY}/proposals`, proposalBody('утверждаемое правило', 'будет утверждено', {model_level: 'high'}), AUTHOR)).body;
const pb = (await call('POST', `/projects/SDLC/roles/${KEY}/proposals`, proposalBody('отклоняемое правило', 'будет отклонено'), AUTHOR)).body;
await setup({me: 'maintainer', keys: null, actor: 'e2e'});
await open();
const mHeader = await run(`
  return {create: Boolean(document.querySelector('[data-role-action="create"]')), propose: Boolean(document.querySelector('[data-role-action="propose"]')),
    rows: rows().map((r) => r.label).join()};
`);
check('сопровождающему — «Новая версия», не «Предложить версию»', mHeader.create && !mHeader.propose, JSON.stringify(mHeader));
await run(`await expand("${pa.id}"); return true;`);
const card = await run(`
  const c = document.querySelector('[data-proposal-card]');
  return {text: c.innerText.replace(/\\s+/g, ' '), diff: all('[data-proposal-card] [data-diff-doc]').map((el) => el.getAttribute('data-diff-doc') + ':' + el.getAttribute('data-diff-change')),
    approve: Boolean(act('approve')), approveDisabled: act('approve')?.disabled, reject: Boolean(act('reject')), withdraw: Boolean(act('withdraw')),
    other: (c.querySelector('[data-proposal-other]')?.innerText || '').replace(/\\s+/g, ' '), view: c.querySelector('[data-proposal-view]').getAttribute('data-proposal-view')};
`);
check('карточка: автор, «подано от v1 (последняя)», changelog', card.text.includes(`Автор: ${HANDLE}`) && card.text.includes('подано от v1 (последняя)') && card.text.includes('будет утверждено'), card.text.slice(0, 300));
check('по умолчанию «Изменения против v1», изменён a-rules.md', card.view === 'diff' && card.diff.includes('a-rules.md:changed') && card.diff.includes('b-check.md:same'), JSON.stringify(card.diff));
check('«Прочее»: уровень модели авто → high', card.other.includes('уровень модели: авто → high'), card.other);
check('у актуального pending — «Утвердить», «Отклонить…», «Отозвать…»', card.approve && !card.approveDisabled && card.reject && card.withdraw, JSON.stringify(card));
check('подпись про сравнение с базой не показана при актуальной базе', !card.text.includes('а не с базой предложения'));
await run(`act('approve').click(); await sleep(700); return true;`);
const confirmText = await run(`return (document.querySelector('[role=alertdialog]')?.innerText || '').replace(/\\s+/g, ' ');`);
check('подтверждение (#3): заголовок и текст про v2', confirmText.includes('Утвердить предложение #3?') && confirmText.includes(`Будет заведена версия v2 роли Предложения ${stamp} (${KEY})`) && confirmText.includes('начатые останутся на своих версиях'), confirmText);
const confirmClass = await run(`
  const b = Array.from(document.querySelector('[role=alertdialog]').querySelectorAll('button')).find((x) => x.innerText.trim() === 'Утвердить');
  return b.className;
`);
check('кнопка подтверждения — основная, не красная', /bg-primary/.test(confirmClass) && !/bg-destructive/.test(confirmClass), confirmClass.slice(0, 160));
await run(`return confirm("Утвердить");`);
const approved = await run(`
  await sleep(600);
  const r = rows().find((x) => x.id === "${pa.id}");
  return {row: r, toasts: toasts(), open: document.querySelector('[data-role-version]')?.getAttribute('data-role-version'),
    view: document.querySelector('[data-role-version-view]')?.getAttribute('data-role-version-view'), url: location.search,
    focus: document.activeElement?.closest('[data-role-version]')?.getAttribute('data-role-version') ?? null};
`);
// «Ожидают» после утверждения не показывает его — переключаем на «Все».
check('тост «Версия v2 заведена из предложения #3»', approved.toasts.some((x) => x.includes('Версия v2 заведена из предложения #3')), approved.toasts.join('|'));
check('раскрыта новая версия 2 в режиме «Изменения»', approved.open === '2' && approved.view === 'diff', JSON.stringify(approved));
check('фокус на заголовке новой версии', approved.focus === '2', String(approved.focus));
const v2 = (await call('GET', `/projects/SDLC/roles/${KEY}/versions/2`)).body;
const paFull = (await call('GET', `/projects/SDLC/roles/${KEY}/proposals/${pa.id}`)).body;
check('версия 2 с теми же документами, что в предложении', v2?.documents?.length === 2 && v2.documents.every((d, i) => d.name === paFull.documents[i].name && d.sha256 === paFull.documents[i].sha256), JSON.stringify(v2?.documents?.map((d) => d.name)));
check('в API approved · result_version 2', paFull.state === 'approved' && paFull.result_version === 2);
check('версий стало две', (await versionsCount()) === 2);
await run(`
  const b = Array.from(document.querySelectorAll('[data-proposals-filter] button')).find((x) => x.innerText.trim() === 'Все');
  b.dispatchEvent(new MouseEvent('mousedown', {bubbles: true})); b.click(); await sleep(500);
  return true;
`);
const afterApprove = await run(`return rows();`);
const approvedRow = afterApprove.find((r) => r.id === pa.id);
check('строка «утверждено · v2»', approvedRow?.label === 'утверждено · v2' && approvedRow.state === 'approved', JSON.stringify(approvedRow));
check('кнопок решения у утверждённого нет', await run(`await expand("${pa.id}"); return !act('approve') && !act('reject') && !act('withdraw');`));
const result = await run(`return {link: Boolean(document.querySelector('[data-proposal-result]')), text: document.querySelector('[data-proposal-card]').innerText.replace(/\\s+/g, ' ')};`);
check('«Заведена версия v2» и «Решил: e2e»', result.link && result.text.includes('Заведена версия v2') && result.text.includes('Решил: e2e'), result.text.slice(0, 300));

// ── maintainer: «устарело» и отклонение (AC-4, AC-5) ─────────────────────────
console.log('maintainer: «устарело» и «Отклонить…» с заметкой (AC-4, AC-5)');
const staleRow = afterApprove.find((r) => r.id === pb.id);
check('предложение от v1 при последней v2 — «устарело»', staleRow?.label === 'устарело' && staleRow.state === 'pending', JSON.stringify(staleRow));
check('в строке оба номера: «от v1»', staleRow?.text.includes('от v1'), staleRow?.text);
await run(`await expand("${pb.id}"); return true;`);
const stale = await run(`
  const c = document.querySelector('[data-proposal-card="${pb.id}"]');
  const approve = act('approve');
  const reject = act('reject');
  return {text: c.innerText.replace(/\\s+/g, ' '), approveDisabled: approve?.disabled, describedBy: approve?.getAttribute('aria-describedby'),
    blocked: approve ? (document.getElementById(approve.getAttribute('aria-describedby'))?.innerText || '') : null,
    rejectClass: reject?.className || '', note: Boolean(c.querySelector('[data-proposal-stale-note]')), base: (c.querySelector('p.text-muted-foreground.text-xs') || {}).innerText};
`);
check('«Утвердить» выключена, причина под рядом и связана aria-describedby', stale.approveDisabled === true && stale.blocked === 'Утвердить нельзя: база устарела', JSON.stringify(stale).slice(0, 300));
check('предупреждение: «Подано от v1, последняя v2; утвердить нельзя»', stale.text.includes('Подано от v1, последняя v2; утвердить нельзя') && stale.text.includes('Отклоните предложение или попросите автора подать заново от v2.'), stale.text.slice(0, 400));
check('подпись: сравнение с последней, а не с базой', stale.text.includes('Сравнение с последней версией (v2), а не с базой предложения'));
check('«Отклонить…» — основная кнопка при устаревшем', !/secondary/.test(stale.rejectClass.split(' ').filter((c) => c.startsWith('bg-secondary')).join(' ')) && /bg-primary/.test(stale.rejectClass), stale.rejectClass.slice(0, 200));
await run(`act('reject').click(); await sleep(600); return true;`);
const rj = await run(`
  const submit = document.querySelector('[data-proposal-dialog-submit]');
  return {dialog: dialogText(), disabled: submit.disabled};
`);
check('диалог «Отклонить предложение #4?», автор назван, заметка обязательна', rj.dialog.includes('Отклонить предложение #4?') && rj.dialog.includes(`Заметка уйдёт автору — ${HANDLE}`) && rj.dialog.includes('Обязательно: автор увидит заметку в предложении'), rj.dialog);
check('«Отклонить» выключена при пустой заметке', rj.disabled === true);
await run(`await fill("Заметка автору", "  \\n "); return true;`);
check('…и при пробельной', await run(`return document.querySelector('[data-proposal-dialog-submit]').disabled;`));
await run(`await fill("Заметка автору", "подайте заново от v2 с учётом нового правила"); return true;`);
check('…доступна при непустой', (await run(`return document.querySelector('[data-proposal-dialog-submit]').disabled;`)) === false);
await run(`await submitDialog(); return true;`);
const rejected = await run(`
  const r = rows().find((x) => x.id === "${pb.id}");
  return {row: r, toasts: toasts(), dialog: Boolean(document.querySelector('[role=dialog]')),
    focus: document.activeElement?.closest('[data-proposal]')?.getAttribute('data-proposal') ?? null};
`);
check('«отклонено», тост, диалог закрыт', rejected.row?.label === 'отклонено' && rejected.toasts.some((x) => x.includes('Предложение #4 отклонено')) && !rejected.dialog, JSON.stringify(rejected));
check('фокус на строке отклонённого предложения', rejected.focus === pb.id, String(rejected.focus));
await run(`await expand("${pb.id}"); return true;`);
const noteView = await run(`return document.querySelector('[data-proposal-card] [data-proposal-note]')?.innerText.replace(/\\s+/g, ' ');`);
check('заметка автору видна в карточке', noteView?.includes('Заметка автору') && noteView.includes('подайте заново от v2 с учётом нового правила'), noteView);
const pbApi = (await call('GET', `/projects/SDLC/roles/${KEY}/proposals/${pb.id}`)).body;
check('в API rejected с заметкой, версий по-прежнему две', pbApi.state === 'rejected' && pbApi.decision_note === 'подайте заново от v2 с учётом нового правила' && (await versionsCount()) === 2);

// ── гонка: 409 stale_role_base (AC-5) ────────────────────────────────────────
console.log('maintainer: гонка с новой версией — 409 stale_role_base (AC-5)');
const pd = (await call('POST', `/projects/SDLC/roles/${KEY}/proposals`, proposalBody('правило для гонки', 'подано от v2'), AUTHOR)).body;
await open();
await run(`await expand("${pd.id}"); return true;`);
const fresh = await run(`const r = rows().find((x) => x.id === "${pd.id}"); return {label: r.label, enabled: act('approve') && !act('approve').disabled};`);
check('перед гонкой: «ожидает», «Утвердить» доступна', fresh.label === 'ожидает' && fresh.enabled, JSON.stringify(fresh));
// Пока человек смотрит карточку, сопровождающий заводит версию напрямую.
const direct = await call('POST', `/projects/SDLC/roles/${KEY}/versions`, {
  documents: [{name: 'a-rules.md', kind: 'instructions', content: '# Правила\n\n- прямая правка\n'}, docsV1[1]],
  output_contract: contract, input_kinds: ['e2e.input'], changelog: 'прямая версия',
});
check('прямая версия 3 заведена (API)', direct.status === 201 && direct.body.version === 3);
await run(`act('approve').click(); await sleep(700); return true;`);
await run(`return confirm("Утвердить");`);
const race = await run(`
  await sleep(600);
  const f = document.querySelector('[data-proposal-action-failure]');
  const r = rows().find((x) => x.id === "${pd.id}");
  return {failure: (f?.innerText || '').replace(/\\s+/g, ' '), role: f?.getAttribute('role') ?? f?.parentElement?.getAttribute('role'), label: r?.label,
    approveDisabled: act('approve')?.disabled, versionRows: all('[data-role-version],[data-role-version-row]').length, toasts: toasts()};
`);
const serverText = (await call('POST', `/projects/SDLC/roles/${KEY}/proposals/${pd.id}/approve`)).body?.error;
check('сервер отвечает stale_role_base', serverText?.code === 'stale_role_base', JSON.stringify(serverText));
check('над кнопками «Предложение не утверждено» с текстом сервера дословно', race.failure.includes('Предложение не утверждено') && race.failure.includes(serverText.message), `${race.failure} / ${serverText?.message}`);
check('сообщение объявляется role="alert"', race.role === 'alert');
check('карточка перерисована как «устарело», «Утвердить» выключена', race.label === 'устарело' && race.approveDisabled === true, JSON.stringify(race));
check('успешного тоста нет', !race.toasts.some((x) => x.includes('заведена')), race.toasts.join('|'));
check('версий три (прямая) — предложение версии не завело', (await versionsCount()) === 3);

// ── «Новая версия» не изменилась (AC-8) ──────────────────────────────────────
console.log('«Новая версия» сопровождающего и отказ прямого пути (AC-8)');
await run(`document.querySelector('[data-role-action="create"]').click(); await sleep(600); return true;`);
const createForm = await run(`
  await waitFor('[data-new-version] [data-doc-editor]');
  const f = document.querySelector('[data-new-version]');
  return {text: f.innerText.replace(/\\s+/g, ' '), proposalForm: Boolean(document.querySelector('[data-new-proposal]')),
    btn: all('button').some((b) => (b.innerText || '').trim() === 'Сохранить версию'), changelogRequired: f.innerText.includes('Что изменилось *')};
`);
check('форма «Новая версия после v3»: «Сохранить версию», changelog не обязателен', createForm.text.includes('Новая версия после v3') && createForm.btn && !createForm.changelogRequired && !createForm.proposalForm, createForm.text.slice(0, 120));
await run(`await fill("Что изменилось", "обычная версия"); await clickExact("Сохранить версию"); await sleep(1500); return true;`);
check('POST …/versions: версия 4 заведена', (await versionsCount()) === 4);
// 403 прямого пути: без права header не отбивает, поэтому ответ подменён.
await setup({me: undefined, actor: 'e2e', forbidVersion: true});
await open();
await run(`
  document.querySelector('[data-role-action="create"]').click(); await sleep(600);
  await fill("Что изменилось", "не пройдёт");
  await clickExact("Сохранить версию"); await sleep(1000);
  return true;
`);
const forbidden = await run(`
  const f = document.querySelector('[data-form-failure]');
  return {text: (f?.innerText || '').replace(/\\s+/g, ' '), form: Boolean(document.querySelector('[data-new-version]'))};
`);
check('403: «Версия не создана» с текстом сервера и подсказкой, форма цела', forbidden.text.includes('Версия не создана') && forbidden.text.includes('clab role propose') && forbidden.form, forbidden.text);
check('версий по-прежнему четыре', (await versionsCount()) === 4);

// ── права не известны: режим header (AC-14) ──────────────────────────────────
console.log('режим header: прежняя «Новая версия», кнопки показаны (AC-14)');
await setup({actor: 'e2e'});
await open();
await run(`await expand("${pd.id}"); return true;`);
const hdr = await run(`
  return {create: Boolean(document.querySelector('[data-role-action="create"]')), propose: Boolean(document.querySelector('[data-role-action="propose"]')),
    approve: Boolean(act('approve')), reject: Boolean(act('reject')), withdraw: Boolean(act('withdraw'))};
`);
check('header: «Новая версия» и кнопки решения и отзыва', hdr.create && !hdr.propose && hdr.approve && hdr.reject && hdr.withdraw, JSON.stringify(hdr));

// ── сбои (AC-10) ─────────────────────────────────────────────────────────────
console.log('сбои: очередь и карточка (AC-10)');
await setup({actor: 'e2e', listFails: true});
await open();
const listFail = await run(`
  const f = document.querySelector('[data-role-proposals]');
  return {text: section(), versions: all('[data-role-version],[data-role-version-row]').length, retry: Array.from(f.querySelectorAll('button')).some((b) => b.innerText.trim() === 'Повторить')};
`);
check('сбой списка: «Предложения не загрузились», текст сервера, «Повторить»', listFail.text.includes('Предложения не загрузились') && listFail.text.includes('очередь недоступна: сбой хранилища') && listFail.retry, listFail.text);
check('версии роли при этом показаны', listFail.versions > 0, String(listFail.versions));
await setup({actor: 'e2e', detailFails: true});
await open();
await run(`await expand("${pd.id}"); return true;`);
const detailFail = await run(`return section();`);
check('сбой карточки: «Предложение не загрузилось» с «Повторить»', detailFail.includes('Предложение не загрузилось') && detailFail.includes('предложение не прочиталось') && detailFail.includes('Повторить'), detailFail);

// ── 390 px и тёмная тема (AC-13) ─────────────────────────────────────────────
console.log('узкий экран и тёмная тема (AC-13)');
await setup({me: 'maintainer', keys: null, actor: 'e2e'});
await s.resize(390, 844);
await run(`localStorage.setItem('sdlc.theme', 'dark'); return true;`);
await open();
await run(`await expand("${pd.id}"); await sleep(400); return true;`);
const narrow = await run(`
  const sheet = document.querySelector('[data-pipeline-inspector]');
  const btns = Array.from(document.querySelectorAll('[data-proposal-actions] button')).map((b) => ({t: b.innerText.trim(), clipped: b.scrollWidth > b.clientWidth + 1}));
  return {pageScroll: document.documentElement.scrollWidth - window.innerWidth, sheetScroll: sheet ? sheet.scrollWidth - sheet.clientWidth : 0,
    dark: document.documentElement.classList.contains('dark'), btns};
`);
check('на 390 px горизонтальной прокрутки нет', narrow.pageScroll <= 0 && narrow.sheetScroll <= 0, JSON.stringify(narrow));
check('кнопки действий не усечены', narrow.btns.length >= 2 && narrow.btns.every((b) => !b.clipped), JSON.stringify(narrow.btns));
check('тёмная тема включена', narrow.dark === true);
await shot('proposals-390-dark');
await run(`localStorage.setItem('sdlc.theme', 'light'); return true;`);
await open();
await run(`await expand("${pd.id}"); await sleep(400); return true;`);
await shot('proposals-390-light');
await run(`localStorage.setItem('sdlc.theme', 'dark'); return true;`);
await open();
await run(`await expand("${pd.id}"); await sleep(400); return true;`);
await run(`act('reject').click(); await sleep(600); return true;`);
const dlg = await run(`const d = document.querySelector('[role=dialog]').getBoundingClientRect(); return {w: d.width, left: d.left, right: window.innerWidth - d.right};`);
check('диалог заметки в пределах экрана', dlg.left >= 0 && dlg.right >= 0, JSON.stringify(dlg));
await shot('proposal-dialog-390-dark');
await run(`document.querySelector('[role=dialog]') && Array.from(document.querySelectorAll('[role=dialog] button')).find((b) => b.innerText.trim() === 'Отмена').click(); await sleep(400); return true;`);

// ── уборка вкладки ───────────────────────────────────────────────────────────
await s.evaluate(`sessionStorage.removeItem('e2e.prop'); localStorage.removeItem('sdlc.actor'); localStorage.removeItem('sdlc.theme'); return true;`);
await s.resize(1440, 900);
s.close();
console.log(`\n${ok} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
