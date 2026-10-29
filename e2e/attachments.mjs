import {createHash} from 'node:crypto';
import {session, helpers} from './driver.mjs';

// Вложения в карточке задачи (CLAB-299, AC-24–AC-28) и плитки файлов
// (CLAB-308): артефакты этапа и вложения — одни плитки, всё, что можно сделать
// с файлом, — в модалке. Сценарий заводит свои
// задачи и всё делает ручками API стенда, демонстрационные SDLC-1 и SDLC-2 не
// трогает. Экран — настоящий, поверх живого бэкенда: файлы выбираются и
// перетаскиваются в настоящий input и зону, сервер принимает и отдаёт их
// по-настоящему. Подменяется только то, чего стенд дать не может: уровень
// участника (стенд в режиме header ничего не отказывает), сервер без пределов,
// сервер без вложений и сбой списка, обрыв отправки; скачивание браузером
// перехватывается на ссылке с атрибутом download.
//
// Правила без браузера — attachments-rules.mjs.
const BASE = process.env.SDLC_UI_URL ?? 'http://localhost:5173';
const API = process.env.SDLC_API_URL ?? 'http://localhost:8088';
const api = (method, path, body, actor = 'e2e') =>
  fetch(API + path, {
    method,
    headers: {'Content-Type': 'application/json', 'X-SDLC-Actor': actor},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const get = (path) => api('GET', path).then((r) => r.json());
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const MIB = 1024 * 1024;

// ── файлы для проверок ──────────────────────────────────────────────────────
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PNG2 = Buffer.concat([PNG, Buffer.from('v2')]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const MD = Buffer.from('# Заголовок вложения\n\nПривет, мир — кириллица читается.\n');
const CSV = Buffer.from('имя;цвет\nЁжик;серый\n');
const HTML = Buffer.from('<h1>x</h1><script>window.__pwned = 1</script>');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>window.__pwned = 1</script></svg>');
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 0, 0]);
const WIN1251 = Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x0a]);
const file = (name, type, buf) => ({name, type, b64: buf.toString('base64'), sha: sha(buf), size: buf.length});
const big = (name, type, size) => ({name, type, size});

// ── задачи сценария ─────────────────────────────────────────────────────────
const made = {};
for (const type of ['task', 'epic']) {
  const r = await (await api('POST', '/v1/projects/SDLC/tasks', {
    title: `Вложения: задача сценария (${type})`,
    properties: {type},
    ...(type === 'task' ? {repositories: ['cadence-lab-tech/sdlc-pipeline-backend']} : {}),
  })).json();
  if (!r.key) throw new Error('задача не заведена: ' + JSON.stringify(r));
  made[type] = r.key;
}
// Терминальные статусы — по данным версии цикла: отмена есть у каждого цикла.
const cancelled = {};
for (const type of ['task', 'epic']) {
  const r = await (await api('POST', '/v1/projects/SDLC/tasks', {
    title: `Вложения: отменённая (${type})`,
    properties: {type},
    ...(type === 'task' ? {repositories: ['cadence-lab-tech/sdlc-pipeline-backend']} : {}),
  })).json();
  const done = await api('POST', `/v1/tasks/${r.key}/transitions/cancel`, {});
  if (!done.ok) throw new Error('не отменилась: ' + (await done.text()));
  const detail = await get(`/v1/tasks/${r.key}`);
  cancelled[type] = {key: r.key, status: detail.task.status_key};
}
const KEY = made.task;
console.log(`задача сценария ${KEY}, эпик ${made.epic}, отменённые ${cancelled.task.key} и ${cancelled.epic.key}`);

// ── страница ────────────────────────────────────────────────────────────────
const s = await session(BASE + `/p/SDLC/tasks/${KEY}`);
const run = (body) => s.evaluate(helpers + PAGE + body);

// Перехват: журнал запросов страницы (fetch и XHR, у multipart — имена частей
// по порядку), ссылки скачивания (имя, содержимое по sha256) и флаги
// подмен из sessionStorage.
const INIT = `
  (() => {
    window.__net = [];
    window.__downloads = [];
    const flag = (k) => sessionStorage.getItem('e2e.' + k);
    const json = (status, body) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});

    const prevFetch = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = (init && init.method) || 'GET';
      window.__net.push({kind: 'fetch', method, url});
      if (flag('noattach') && /\\/v1\\/tasks\\/[^/]+\\/attachments/.test(url)) {
        return json(404, {error: {code: 'not_found', message: 'не найдено (e2e)'}});
      }
      if (flag('brokenlist') && /\\/v1\\/tasks\\/[^/]+\\/attachments/.test(url)) {
        return json(500, {error: {code: 'internal', message: 'сбой списка (e2e)'}});
      }
      if (flag('who') && /\\/v1\\/auth\\/me$/.test(url)) {
        const me = await (await prevFetch(input, init)).json();
        me.mode = 'token';
        me.authenticated = true;
        me.memberships = [{project_key: 'SDLC', project_id: '', principal_id: me.principal.id, handle: me.principal.handle, kind: 'user', display_name: '', role: flag('who'), role_keys: null, created_at: ''}];
        me.teams = [];
        return json(200, me);
      }
      const res = await prevFetch(input, init);
      if (flag('nolimits') && /\\/v1\\/instance$/.test(url)) {
        const body = await res.json();
        delete body.limits;
        return json(200, body);
      }
      if (flag('roleExtra') && /\\/v1\\/projects\\/[^/]+\\/roles\\/[^/]+$/.test(url)) {
        const body = await res.json();
        for (const v of body.versions || []) {
          v.output_contract = [...v.output_contract, {kind: 'x.schema', schema: {type: 'object'}}, {kind: 'zz.file'}];
        }
        return json(200, body);
      }
      return res;
    };

    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) { this.__m = method; this.__u = url; return open.apply(this, arguments); };
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (body) {
      const rec = {kind: 'xhr', method: this.__m, url: this.__u};
      if (body instanceof FormData) {
        rec.keys = [...body.keys()];
        rec.fields = Object.fromEntries([...body.entries()].filter(([, v]) => typeof v === 'string'));
      }
      window.__net.push(rec);
      // Обрыв: соединение рвётся посреди отправки, ответа нет.
      if (flag('abort')) setTimeout(() => this.abort(), 4);
      return send.apply(this, arguments);
    };

    // Скачивание браузером уходит на диск; сценарию нужно имя и содержимое
    // ссылки, на которую оно указывает.
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (!this.hasAttribute('download')) return click.apply(this, arguments);
      const rec = {name: this.download, href: this.href};
      window.__downloads.push(rec);
      fetch(this.href).then((r) => r.arrayBuffer()).then(async (b) => {
        const d = await crypto.subtle.digest('SHA-256', b);
        rec.sha = Array.from(new Uint8Array(d)).map((x) => x.toString(16).padStart(2, '0')).join('');
        rec.size = b.byteLength;
      });
    };
  })();
`;

const PAGE = `
  const mk = (f) => new File(
    [f.b64 ? Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0)) : new Uint8Array(f.size)], f.name, {type: f.type});
  const setFiles = (input, specs) => {
    const dt = new DataTransfer();
    for (const f of specs) dt.items.add(mk(f));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', {bubbles: true}));
  };
  const inputFor = (root, labelText) => {
    const l = Array.from(root.querySelectorAll('label')).find((x) => (x.innerText || '').trim().startsWith(labelText));
    const i = l && document.getElementById(l.getAttribute('for'));
    if (!i) throw new Error('нет поля: ' + labelText);
    return i;
  };
  const section = () => document.querySelector('[data-attachments]');
  const card = (name) => document.querySelector('[data-attachment-name="' + name + '"]');
  const waitFor = async (fn, ms = 20000) => {
    for (let t = 0; t < ms; t += 200) { const v = fn(); if (v) return v; await sleep(200); }
    return null;
  };
  const net = () => window.__net;
  const contentCalls = (id) => net().filter((n) => n.url && n.url.includes('/artifacts/' + id + '/content')).length;
  const buttons = (root) => Array.from(root.querySelectorAll('button')).map((b) => (b.innerText || '').trim());
  // Модалка файла (CLAB-308): открывает клик по плитке, закрывает Esc.
  const dlg = () => document.querySelector('[role=dialog][data-file-dialog]');
  const dlgText = () => (dlg() ? dlg().innerText.replace(/\\s+/g, ' ') : '');
  const openTile = async (tile) => {
    if (!tile) throw new Error('нет плитки');
    tile.click();
    const d = await waitFor(() => dlg());
    await sleep(700);
    return d;
  };
  const closeDlg = async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    await waitFor(() => !dlg(), 5000);
    await sleep(300);
  };
  const dlgClick = async (label, ms = 700) => {
    const b = Array.from(dlg().querySelectorAll('button')).find((x) => (x.innerText || '').trim() === label);
    if (!b) throw new Error('в модалке нет кнопки: ' + label);
    b.click();
    await sleep(ms);
  };
`;

const initId = await s.addInitScript(INIT);
const flags = (obj) => run(`
  sessionStorage.clear();
  for (const [k, v] of Object.entries(${JSON.stringify(obj)})) sessionStorage.setItem('e2e.' + k, v);
  return true;
`);
const open = async (key = KEY, query = '', obj = {}) => {
  await flags(obj);
  await s.goto(BASE + `/p/SDLC/tasks/${key}${query}`);
  await wait(1500);
  await run(`await waitFor(() => section()); return true;`);
};
const attach = async (spec, via = 'pick') => {
  const r = await run(`
    const sec = section();
    const spec = ${JSON.stringify(spec)};
    if (${JSON.stringify(via)} === 'pick') {
      setFiles(inputFor(sec, 'Выбрать файл'), [spec]);
    } else {
      const dt = new DataTransfer();
      dt.items.add(mk(spec));
      sec.querySelector('[data-attachments-drop]').dispatchEvent(new DragEvent('drop', {bubbles: true, cancelable: true, dataTransfer: dt}));
    }
    return true;
  `);
  return r;
};
const listed = (taskKey = KEY, all = false) => get(`/v1/tasks/${taskKey}/attachments${all ? '?include_superseded=true' : ''}`).then((r) => r.attachments ?? []);

// ── AC-24.1: раздел в карточке любого типа и статуса ───────────────────────
console.log('раздел «Вложения» в карточке');
const detail = await get(`/v1/tasks/${KEY}`);
const workflow = await get(`/v1/workflows/${detail.task.workflow_id}`);
const anyStage = [...workflow.statuses].sort((a, b) => a.position - b.position)[0].key;
for (const [label, key, query] of [
  [`задача (${detail.task.status_key})`, KEY, ''],
  [`эпик (${made.epic})`, made.epic, ''],
  [`отменённая задача (${cancelled.task.status})`, cancelled.task.key, ''],
  [`отменённый эпик (${cancelled.epic.status})`, cancelled.epic.key, ''],
  ['в панели этапа (?stage=)', KEY, `?stage=${anyStage}`],
]) {
  await open(key, query);
  const st = await run(`
    const h = Array.from(document.querySelectorAll('h2')).find((e) => e.innerText.trim() === 'Вложения');
    const sec = section();
    return {heading: Boolean(h), drop: Boolean(sec && sec.querySelector('[data-attachments-drop]')),
      pick: Boolean(sec && Array.from(sec.querySelectorAll('label')).some((l) => l.innerText.trim() === 'Выбрать файл')),
      empty: Boolean(sec && sec.querySelector('[data-attachments-empty]')), stage: location.search};
  `);
  check(`${label}: раздел, зона и выбор файла, пустое состояние`, st.heading && st.drop && st.pick && st.empty, JSON.stringify(st));
}

// ── AC-24.4, AC-24.5: прикрепление выбором ──────────────────────────────────
console.log('прикрепление выбором файла');
await open();
const png = file('Скриншот ошибки.png', 'image/png', PNG);
const input = await run(`
  const i = inputFor(section(), 'Выбрать файл');
  const l = Array.from(section().querySelectorAll('label')).find((x) => x.innerText.trim() === 'Выбрать файл');
  i.focus();
  return {type: i.type, focused: document.activeElement === i, tab: i.tabIndex, disabled: i.disabled, same: l.getAttribute('for') === i.id};
`);
check('выбор файла — input type=file, связанный label[for], берёт фокус с клавиатуры',
  input.type === 'file' && input.focused && input.tab >= 0 && !input.disabled && input.same, JSON.stringify(input));
await attach(png);
let c = await run(`
  const el = await waitFor(() => card(${JSON.stringify(png.name)}));
  return el ? el.innerText.replace(/\\s+/g, ' ') : null;
`);
check('вложение появилось плиткой без перезагрузки', c !== null, String(c));
const tileBtns = await run(`const t = card(${JSON.stringify(png.name)}); return {tag: t.tagName, inner: t.querySelectorAll('button, a, input').length, tile: t.hasAttribute('data-file-tile')};`);
check('плитка вложения — одна кнопка без действий внутри', tileBtns.tag === 'BUTTON' && tileBtns.inner === 0 && tileBtns.tile, JSON.stringify(tileBtns));
check('на плитке — имя, версия 1, тип, размер, автор', c && c.includes(png.name) && c.includes('v1') && c.includes('image/png') && c.includes(`${png.size} Б`) && c.includes('web'), String(c));
let a = (await listed())[0];
check('на сервере — то же вложение, sha256 совпадает', a && a.file_name === png.name && a.sha256 === png.sha && a.version === 1, JSON.stringify(a));
let post = await run(`return net().filter((n) => n.kind === 'xhr' && /\\/attachments$/.test(n.url));`);
check('один запрос multipart, поля до file', post.length === 1 && JSON.stringify(post[0].keys) === JSON.stringify(['title', 'file']) && post[0].fields.title === png.name, JSON.stringify(post));
c = await run(`return section().innerText;`);
check('«Принять» у вложения нет', !/Принять/.test(c));
check('списки не заявлены ошибкой', !/не отправлен|не загрузились/.test(c));

// ── прогресс отправки ───────────────────────────────────────────────────────
console.log('прогресс отправки');
const bigOk = big('крупный.bin', 'application/octet-stream', 24 * MIB);
await run(`
  window.__seen = [];
  const obs = new MutationObserver(() => {
    const p = document.querySelector('[data-attachments] [role=progressbar]');
    if (p) window.__seen.push(Number(p.getAttribute('aria-valuenow')));
  });
  obs.observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['aria-valuenow']});
  return true;
`);
await attach(bigOk);
const prog = await run(`
  await waitFor(() => card(${JSON.stringify(bigOk.name)}), 60000);
  const seen = window.__seen;
  return {seen: seen.length, min: Math.min(...seen), max: Math.max(...seen), text: card(${JSON.stringify(bigOk.name)}) ? 'в списке' : 'нет'};
`);
check('во время отправки виден прогресс (полоса с процентами)', prog.seen > 0 && prog.max <= 100, JSON.stringify(prog));
check('после ответа вложение в списке', prog.text === 'в списке');
const progGone = await run(`return !document.querySelector('[data-attachments] [role=progressbar]');`);
check('полоса прогресса исчезла', progGone);

// ── перетаскивание ──────────────────────────────────────────────────────────
console.log('перетаскивание');
const md = file('Заметка.md', 'text/markdown', MD);
await attach(md, 'drop');
c = await run(`const el = await waitFor(() => card(${JSON.stringify(md.name)})); return el ? el.innerText.replace(/\\s+/g, ' ') : null;`);
check('файл, брошенный в зону, принят и в списке', c !== null && c.includes('text/markdown'), String(c));

// ── под уровнем viewer ──────────────────────────────────────────────────────
console.log('участник с уровнем viewer');
await open(KEY, '', {who: 'viewer'});
const me = await run(`const r = await fetch('/v1/auth/me', {headers: {'X-SDLC-Actor': 'web'}}); const m = await r.json(); return m.memberships.map((x) => x.role);`);
check('интерфейс видит viewer', me.includes('viewer'), JSON.stringify(me));
const viewerPick = await run(`
  const sec = section();
  const input = inputFor(sec, 'Выбрать файл');
  await openTile(card(${JSON.stringify(png.name)}));
  const nv = Array.from(dlg().querySelectorAll('label')).filter((l) => l.innerText.trim() === 'Новая версия').length;
  await closeDlg();
  return {pick: !input.disabled, newVersion: nv};
`);
check('кнопки прикрепления и «Новая версия» (в модалке) у viewer не спрятаны', viewerPick.pick && viewerPick.newVersion === 1, JSON.stringify(viewerPick));
const viewerFile = file('от-заказчика.csv', 'text/csv', CSV);
await attach(viewerFile);
c = await run(`const el = await waitFor(() => card(${JSON.stringify(viewerFile.name)})); return el ? el.innerText.replace(/\\s+/g, ' ') : null;`);
check('viewer прикрепил файл: 201 и запись в списке', c !== null && c.includes('v1'), String(c));
const base = (await listed()).find((x) => x.file_name === png.name);
await run(`await openTile(card(${JSON.stringify(png.name)})); setFiles(inputFor(dlg(), 'Новая версия'), [${JSON.stringify(file(png.name, 'image/png', PNG2))}]); return true;`);
c = await run(`const el = await waitFor(() => card(${JSON.stringify(png.name)}) && card(${JSON.stringify(png.name)}).innerText.includes('v2')); return Boolean(el);`);
check('viewer выпустил новую версию: на плитке v2', c === true);
c = await run(`await sleep(800); return {open: Boolean(dlg()), text: dlgText().slice(0, 200)};`);
check('новая версия не закрыла модалку: в ней уже v2', c.open && c.text.includes('v2'), JSON.stringify(c));
await run(`await closeDlg(); return true;`);
post = await run(`return net().filter((n) => n.kind === 'xhr' && /\\/attachments$/.test(n.url)).at(-1);`);
check('запрос новой версии несёт supersedes_id прежней, поля до file',
  post && post.fields.supersedes_id === base.id && JSON.stringify(post.keys) === JSON.stringify(['title', 'supersedes_id', 'file']), JSON.stringify(post));

// ── версии (AC-26.1, AC-26.3) ───────────────────────────────────────────────
console.log('версии');
await open();
check('прежняя версия отдельной плиткой не показана', (await run(`return document.querySelectorAll('[data-attachment-name=' + JSON.stringify(${JSON.stringify(png.name)}) + ']').length;`)) === 1);
const hist = await run(`
  await openTile(card(${JSON.stringify(png.name)}));
  const root = dlg();
  const b = Array.from(root.querySelectorAll('[data-file-history] button')).find((x) => (x.innerText || '').trim().startsWith('История версий'));
  const before = b ? b.innerText.trim() : null;
  if (b) { b.click(); await sleep(700); }
  return {before, text: root.innerText.replace(/\\s+/g, ' '), prev: root.querySelectorAll('[data-file-version]').length};
`);
check('текущая версия — вторая, история версий раскрывается по действию', hist.before === 'История версий (1)' && hist.prev === 1 && hist.text.includes('v2') && hist.text.includes('v1'), JSON.stringify(hist));
const oldVer = await run(`
  dlg().querySelector('[data-file-version]').click();
  await sleep(1000);
  const t = dlgText();
  return {t: t.slice(0, 300), newVersion: Array.from(dlg().querySelectorAll('label')).some((l) => l.innerText.trim() === 'Новая версия'), back: Boolean(dlg().querySelector('[data-file-old]')), img: Boolean(dlg().querySelector('img[data-file-preview=image]'))};
`);
check('прежняя версия открывается: превью, «К текущей», «Новой версии» для неё нет', oldVer.img && oldVer.back && !oldVer.newVersion && oldVer.t.includes('v1'), JSON.stringify(oldVer));
await run(`await closeDlg(); return true;`);
const all2 = await listed(KEY, true);
check('на сервере прежняя версия осталась (superseded), удаления нет',
  all2.filter((x) => x.file_name === png.name).map((x) => `${x.version}:${x.status}`).sort().join() === '1:superseded,2:submitted', JSON.stringify(all2.map((x) => [x.file_name, x.version, x.status])));
// Отказ сервера на устаревшую запись: страница держит прежний список, пока
// версию выпускают в другом окне.
const stale = file('устареет.txt', 'text/plain', Buffer.from('первая'));
await attach(stale);
await run(`await waitFor(() => card(${JSON.stringify(stale.name)})); return true;`);
const staleRef = (await listed()).find((x) => x.file_name === stale.name);
const form = new FormData();
form.append('title', stale.name);
form.append('supersedes_id', staleRef.id);
form.append('file', new Blob(['вторая'], {type: 'text/plain'}), stale.name);
const rival = await fetch(`${API}/v1/tasks/${KEY}/attachments`, {method: 'POST', headers: {'X-SDLC-Actor': 'rival'}, body: form});
check('параллельная версия принята сервером', rival.status === 201, String(rival.status));
const before409 = (await listed(KEY, true)).length;
await run(`await openTile(card(${JSON.stringify(stale.name)})); setFiles(inputFor(dlg(), 'Новая версия'), [${JSON.stringify(file(stale.name, 'text/plain', Buffer.from('третья')))}]); return true;`);
c = await run(`
  await waitFor(() => dlgText().includes('Новая версия не отправлена'));
  return dlgText();
`);
check('отказ 409 показан в модалке текстом сервера', c.includes('Новая версия не отправлена') && c.length > 120, c);
c = await run(`const t = card(${JSON.stringify(stale.name)}).innerText; await closeDlg(); return t.replace(/\\s+/g, ' ');`);
check('плитка после отказа не изменилась (v1)', c.includes('v1') && !c.includes('v2'), c);
check('отказ не добавил версий на сервере', (await listed(KEY, true)).length === before409);

// ── AC-25: превью и скачивание ──────────────────────────────────────────────
console.log('превью и скачивание');
const pdf = file('Спецификация.pdf', 'application/pdf', PDF);
const quote = file('a"b.png', 'image/png', PNG);
for (const f of [pdf, quote, file('данные.csv', 'text/csv', CSV)]) {
  await attach(f);
  await run(`await waitFor(() => card(${JSON.stringify(f.name.replace('"', '%22'))})); return true;`);
}
await open();
const idOf = async (name) => (await listed()).find((x) => x.file_name === name)?.id;

const pngId = (await listed()).find((x) => x.file_name === png.name).id;
check('превью не грузится при показе списка (нет запросов содержимого)', (await run(`return net().filter((n) => n.url && n.url.includes('/content')).length;`)) === 0);
const pngView = await run(`
  const root = await openTile(card(${JSON.stringify(png.name)}));
  const img = root.querySelector('img[data-file-preview=image]');
  const src = img ? img.getAttribute('src') : null;
  const calls = contentCalls(${JSON.stringify(pngId)});
  await closeDlg();
  await openTile(card(${JSON.stringify(png.name)}));
  const again = contentCalls(${JSON.stringify(pngId)});
  await closeDlg();
  return {src, calls, again};
`);
check('PNG — картинка из blob-ссылки в модалке, один запрос содержимого', pngView.src && pngView.src.startsWith('blob:') && pngView.calls === 1, JSON.stringify(pngView));
check('повторное открытие модалки запроса не добавляет', pngView.again === 1, JSON.stringify(pngView));
const pdfId = await idOf(pdf.name);
const pdfView = await run(`
  const root = await openTile(card(${JSON.stringify(pdf.name)}));
  const f = root.querySelector('iframe[data-file-preview=pdf]');
  const r = {src: f ? f.getAttribute('src') : null, calls: contentCalls(${JSON.stringify(pdfId)})};
  await closeDlg();
  return r;
`);
check('PDF — встроенный просмотр из blob-ссылки', pdfView.src && pdfView.src.startsWith('blob:') && pdfView.calls === 1, JSON.stringify(pdfView));
const mdView = await run(`
  const root = await openTile(card(${JSON.stringify(md.name)}));
  const t = root.querySelector('[data-file-preview=text]');
  const r = {h1: t ? Boolean(t.querySelector('h1')) : null, text: t ? t.innerText : null};
  await closeDlg();
  return r;
`);
check('markdown — разметкой, кириллица читается', mdView.h1 === true && mdView.text.includes('Привет, мир — кириллица читается'), JSON.stringify(mdView));
const csvView = await run(`
  const root = await openTile(card('данные.csv'));
  const t = root.querySelector('[data-file-preview=text]');
  const r = {text: t ? t.innerText : null, pre: t ? Boolean(t.querySelector('pre, h1')) : null};
  await closeDlg();
  return r;
`);
check('csv — текстом, кириллица читается', csvView.text && csvView.text.includes('Ёжик') && csvView.text.includes('имя;цвет') && csvView.pre === false, JSON.stringify(csvView));

// Прочие типы — только «Скачать»; blob для превью не создаётся (AC-25.3, AC-28.1)
console.log('прочие типы и безопасность отдачи');
const others = [
  file('архив.zip', 'application/zip', ZIP),
  file('отчёт.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ZIP),
  file('странный.bin', 'application/x-thing', ZIP),
  file('страница.html', 'text/html', HTML),
  file('рисунок.svg', 'image/svg+xml', SVG),
];
for (const f of others) {
  await attach(f);
  await run(`await waitFor(() => card(${JSON.stringify(f.name)})); return true;`);
}
await open();
for (const f of others) {
  const id = await idOf(f.name);
  const st = await run(`
    const root = await openTile(card(${JSON.stringify(f.name)}));
    const r = {btns: buttons(root), embeds: root.querySelectorAll('iframe, object, embed, img, [data-file-preview]:not([data-file-preview=none])').length,
      note: Boolean(root.querySelector('[data-file-preview=none]')),
      calls: contentCalls(${JSON.stringify(id)}), pwned: window.__pwned ?? null};
    await closeDlg();
    return r;
  `);
  check(`${f.name}: в модалке только «Скачать», превью и blob нет, содержимое не запрашивалось`,
    st.btns.includes('Скачать') && st.note && st.embeds === 0 && st.calls === 0 && st.pwned === null, JSON.stringify(st));
}
// Скачивание: запрос с токеном, имя и содержимое (AC-25.4, AC-28.2)
const dl = async (name, expected) => {
  const id = await idOf(name.replace('"', '%22'));
  // Модалка открыта до замера: превью (если оно есть у типа) уже запросило
  // содержимое, и считается только запрос самого скачивания.
  await run(`await openTile(card(${JSON.stringify(name.replace('"', '%22'))})); return true;`);
  const before = await run(`return {calls: contentCalls(${JSON.stringify(id)}), url: location.href, n: window.__downloads.length};`);
  await run(`
    await dlgClick('Скачать', 100);
    await waitFor(() => window.__downloads.length > ${before.n} && window.__downloads.at(-1).sha, 15000);
    return true;
  `);
  const got = await run(`const r = {d: window.__downloads.at(-1), calls: contentCalls(${JSON.stringify(id)}), url: location.href, pwned: window.__pwned ?? null}; await closeDlg(); return r;`);
  return {before, got, expected};
};
for (const f of [others[3], others[4], quote, pdf]) {
  const {before, got} = await dl(f.name);
  const stored = f.name.replace('"', '%22');
  check(`${f.name}: скачивание — один запрос, имя «${stored}», sha256 совпадает`,
    got.calls === before.calls + 1 && got.d && got.d.name === stored && got.d.sha === f.sha && got.d.href.startsWith('blob:'), JSON.stringify(got));
  check(`${f.name}: страница не ушла на содержимое`, got.url === before.url && got.pwned === null, JSON.stringify(got));
}
c = await run(`return card('a%22b.png').querySelector('[data-file-title]').innerText.trim();`);
check('имя с %22 показано как хранит сервер (не раскодировано)', c === 'a%22b.png', c);

// AC-28.3: PNG с HTML внутри — превью нет, остаётся «Скачать»
console.log('тип не сошёлся с содержимым');
const fake = file('evil.png', 'image/png', HTML);
await attach(fake);
await run(`await waitFor(() => card('evil.png')); return true;`);
const fakeView = await run(`
  const root = await openTile(card('evil.png'));
  const r = {img: root.querySelectorAll('img').length, blocked: Boolean(root.querySelector('[data-file-preview=blocked]')),
    text: root.innerText.replace(/\\s+/g, ' '), btns: buttons(root), pwned: window.__pwned ?? null};
  await closeDlg();
  return r;
`);
check('PNG с HTML внутри: картинки нет, сообщение и «Скачать»',
  fakeView.img === 0 && fakeView.blocked && fakeView.btns.includes('Скачать') && fakeView.pwned === null, JSON.stringify(fakeView));

// Текст не в UTF-8 и текст крупнее 1 МиБ — только «Скачать»
const win = file('win1251.txt', 'text/plain', WIN1251);
await attach(win);
await run(`await waitFor(() => card('win1251.txt')); return true;`);
const winView = await run(`
  const root = await openTile(card('win1251.txt'));
  const r = {blocked: root.querySelector('[data-file-preview=blocked]')?.innerText ?? null, text: root.querySelector('[data-file-preview=text]')};
  await closeDlg();
  return r;
`);
check('текст не в UTF-8: просмотра нет, объяснение и «Скачать»', winView.blocked && /UTF-8/.test(winView.blocked) && winView.text === null, JSON.stringify(winView));
const bigText = big('длинный.txt', 'text/plain', MIB + 1);
await attach(bigText);
await run(`await waitFor(() => card('длинный.txt'), 40000); return true;`);
const bigId = await idOf('длинный.txt');
const bigView = await run(`
  const root = await openTile(card('длинный.txt'));
  const r = {btns: buttons(root), note: dlgText(), calls: contentCalls(${JSON.stringify(bigId)})};
  await closeDlg();
  return r;
`);
check('текст крупнее 1 МиБ: сказано про предел, есть «Скачать», содержимое не запрашивалось',
  bigView.btns.includes('Скачать') && /Крупнее 1 МиБ/.test(bigView.note) && bigView.calls === 0, JSON.stringify(bigView));

// ── AC-24.2, AC-24.3, AC-24.7: предел файла ────────────────────────────────
console.log('предел файла');
const limit = (await get('/v1/instance')).limits?.max_file_bytes;
check('стенд отдаёт предел файла', limit > 0, String(limit));
await open();
const over = big('больше-предела.bin', 'application/octet-stream', limit + 1);
const sent0 = await run(`return net().filter((n) => n.kind === 'xhr').length;`);
await attach(over);
await wait(1200);
const overView = await run(`return {text: section().innerText.replace(/\\s+/g, ' '), xhr: net().filter((n) => n.kind === 'xhr').length, card: Boolean(card('больше-предела.bin'))};`);
check('файл больше предела: сообщение с пределом в МиБ', overView.text.includes('64 МиБ') && overView.text.includes('не отправлен'), overView.text.slice(0, 300));
check('файл больше предела: запроса на загрузку не было', overView.xhr === sent0 && !overView.card, JSON.stringify(overView));
const exact = big('ровно-в-предел.bin', 'application/octet-stream', limit);
await attach(exact);
await wait(500);
const exactView = await run(`return {xhr: net().filter((n) => n.kind === 'xhr').length};`);
check('файл ровно в предел уходит', exactView.xhr === sent0 + 1, JSON.stringify(exactView));
await run(`await waitFor(() => card('ровно-в-предел.bin'), 120000); return true;`);

// Сервер без пределов: запрос уходит, отказ — текст сервера как есть.
await open(KEY, '', {nolimits: '1'});
await attach(over);
const refused = await run(`
  await waitFor(() => section().innerText.includes('Файл не отправлен'), 60000);
  return {text: section().innerText.replace(/\\s+/g, ' '), xhr: net().filter((n) => n.kind === 'xhr').length};
`);
const direct = await fetch(`${API}/v1/tasks/${KEY}/attachments`, {method: 'POST', headers: {'X-SDLC-Actor': 'e2e'}, body: (() => {
  const f = new FormData();
  f.append('title', 'x');
  f.append('file', new Blob([new Uint8Array(limit + 1)]), 'x.bin');
  return f;
})()}).then(async (r) => ({status: r.status, body: await r.json().catch(() => null)})).catch((e) => ({status: 0, body: String(e)}));
console.log('  · ответ сервера напрямую:', direct.status, JSON.stringify(direct.body)?.slice(0, 200));
check('без пределов в /v1/instance запрос уходит', refused.xhr >= 1, JSON.stringify(refused));
if (direct.status === 413) {
  check('413 показан текстом сервера (payload_too_large)', direct.body?.error?.code === 'payload_too_large' && refused.text.includes(direct.body.error.message), refused.text.slice(0, 400));
} else {
  check('сервер отказал иначе, чем 413 — показан отказ', refused.text.includes('Файл не отправлен'), refused.text.slice(0, 400));
}

// ── AC-24.6: обрыв отправки ─────────────────────────────────────────────────
console.log('обрыв отправки');
const beforeAbort = (await listed()).length;
await open(KEY, '', {abort: '1'});
const cut = big('оборвётся.bin', 'application/octet-stream', 20 * MIB);
await attach(cut);
const cutView = await run(`
  await waitFor(() => section().innerText.includes('Файл не отправлен'), 20000);
  return {text: section().innerText.replace(/\\s+/g, ' '), card: Boolean(card('оборвётся.bin')), bars: document.querySelectorAll('[data-attachments] [role=progressbar]').length};
`);
check('обрыв: сообщение — файл не сохранён, можно повторить', /Файл не сохранён/.test(cutView.text) && /ещё раз/.test(cutView.text), cutView.text.slice(0, 300));
check('обрыв: записи в списке нет, полосы прогресса нет', !cutView.card && cutView.bars === 0, JSON.stringify(cutView));
await wait(1500);
check('обрыв: на сервере вложения не прибавилось', (await listed()).length === beforeAbort, `${beforeAbort} → ${(await listed()).length}`);

// ── R-13, R-15: ошибка списка и сервер без вложений ────────────────────────
console.log('ошибка списка и сервер без вложений');
await open(KEY, '', {brokenlist: '1'});
c = await run(`return section().innerText.replace(/\\s+/g, ' ');`);
check('сбой списка: ошибка с текстом сервера и «Повторить»', c.includes('сбой списка (e2e)') && c.includes('Повторить'), c);
await run(`sessionStorage.removeItem('e2e.brokenlist'); const b = Array.from(section().querySelectorAll('button')).find((x) => x.innerText.trim() === 'Повторить'); b.click(); await sleep(1500); return true;`);
c = await run(`return {text: section().innerText.replace(/\\s+/g, ' '), cards: document.querySelectorAll('[data-attachment]').length};`);
check('«Повторить» загрузил список', c.cards > 5 && !c.text.includes('сбой списка'), JSON.stringify(c).slice(0, 300));
await open(KEY, '', {noattach: '1'});
c = await run(`return {text: section().innerText.replace(/\\s+/g, ' '), mode: section().getAttribute('data-attachments'), drop: Boolean(section().querySelector('[data-attachments-drop]'))};`);
check('404 на список: «Вложения недоступны на этом сервере», раздел не падает', c.mode === 'unavailable' && c.text.includes('Вложения недоступны на этом сервере') && !c.drop, JSON.stringify(c));
const alive = await run(`return document.body.innerText.includes(${JSON.stringify(detail.task.title)});`);
check('карточка при этом работает', alive);

// ── AC-27: файл по контракту и «Скачать» у артефактов этапа ────────────────
console.log('сдача файла по контракту');
const flow = await (await api('POST', '/v1/projects/SDLC/tasks', {title: 'Вложения: сдача файла', repositories: ['cadence-lab-tech/sdlc-pipeline-backend']})).json();
await api('POST', `/v1/tasks/${flow.key}/transitions/start`, {});
const claim = await api('POST', `/v1/tasks/${flow.key}/claim`, {role: 'analyst'}, 'agent:analyst-bot');
const claimed = await claim.json();
const runId = claimed.stage_run?.id ?? claimed.run?.id ?? (await get(`/v1/tasks/${flow.key}`)).stage_runs.find((r) => !r.finished_at)?.id;
check('этап забран агентом, есть прогон', Boolean(runId), JSON.stringify(claimed).slice(0, 200));
const stageNow = (await get(`/v1/tasks/${flow.key}`)).task.status_key;
// Текстовый артефакт сдаёт агент — «Скачать» должен быть и у него.
await api('POST', `/v1/tasks/${flow.key}/artifacts`, {kind: 'analysis.open_questions', title: 'Вопросы', format: 'markdown', content: '# Вопросы\n\nКак дела?'}, 'agent:analyst-bot');

await open(flow.key, '', {roleExtra: '1'});
await run(`
  const b = Array.from(document.querySelectorAll('button')).find((x) => x.innerText.trim() === 'Сдать артефакт');
  b.click();
  await sleep(700);
  return true;
`);
await run(`await press('Файл', '[role=tab]'); return true;`);
const kinds = await run(`
  const lbl = all('label').find((l) => l.innerText.trim().startsWith('Вид'));
  document.getElementById(lbl.getAttribute('for')).click();
  await sleep(500);
  return all('[role=option]').map((o) => o.innerText.trim());
`);
check('виды файла — из контракта роли этапа', ['analysis.brief', 'analysis.acceptance_criteria', 'analysis.open_questions'].every((k) => kinds.includes(k)), JSON.stringify(kinds));
check('вид со схемой в списке не показан, вид без схемы показан', !kinds.includes('x.schema') && kinds.includes('zz.file'), JSON.stringify(kinds));
await run(`all('[role=option]').find((o) => o.innerText.trim() === 'analysis.brief').click(); await sleep(300); return true;`);
await run(`await fill('Название', 'Макет экрана'); return true;`);
const shot = file('макет.png', 'image/png', PNG);
await run(`setFiles(inputFor(document.querySelector('[role=dialog]'), 'Файл'), [${JSON.stringify(shot)}]); await sleep(300); return true;`);
await run(`await clickExact('Сдать'); await sleep(2000); return true;`);
post = await run(`return net().filter((n) => n.kind === 'xhr' && /\\/artifacts$/.test(n.url));`);
check('сдача файла: multipart на /artifacts, поля kind, title, stage_run_id до file',
  post.length === 1 && JSON.stringify(post[0].keys) === JSON.stringify(['kind', 'title', 'stage_run_id', 'file']) && post[0].fields.kind === 'analysis.brief' && post[0].fields.stage_run_id === runId, JSON.stringify(post));
const arts = (await get(`/v1/tasks/${flow.key}/artifacts`)).artifacts;
const sub = arts.find((x) => x.kind === 'analysis.brief');
check('на сервере — артефакт format binary в прогоне этапа, имя и тип как выбраны',
  sub && sub.format === 'binary' && sub.file_name === 'макет.png' && sub.stage_run_id === runId && sub.is_attachment !== true, JSON.stringify(sub));
const dlg = await run(`return Boolean(document.querySelector('[role=dialog]'));`);
check('диалог закрылся', dlg === false);

await open(flow.key, `?stage=${stageNow}`);
await run(`await waitFor(() => document.querySelector('[data-artifact="${sub.id}"]')); return true;`);
const txt = arts.find((x) => x.kind === 'analysis.open_questions');
const panel = await run(`
  const el = document.querySelector('[data-artifact="${sub.id}"]');
  return {text: el.innerText.replace(/\\s+/g, ' '), tag: el.tagName, tile: el.hasAttribute('data-file-tile'), inner: el.querySelectorAll('button, a, input').length,
    inRun: Boolean(el.closest('[data-run-id]')), calls: net().filter((n) => n.url && n.url.includes('/content')).length, anchor: el.id};
`);
check('файл этапа — плитка внутри своей попытки: заголовок, имя, тип, размер, версия',
  panel.tile && panel.inRun && panel.text.includes('Макет экрана') && panel.text.includes('макет.png') && panel.text.includes('image/png') && panel.text.includes(`${PNG.length} Б`) && panel.text.includes('v1'), JSON.stringify(panel));
check('в тексте плитки роль прогона с версией', /analyst\S* v\d+|\w+ v\d+/.test(panel.text), JSON.stringify(panel.text));
check('плитка — одна кнопка, вложенных действий нет, якорь artifact-<id>', panel.tag === 'BUTTON' && panel.inner === 0 && panel.anchor === 'artifact-' + sub.id, JSON.stringify(panel));
check('показ плиток не запрашивает содержимое (AC-5)', panel.calls === 0, JSON.stringify(panel));
check('«Принять», «Копировать», «Содержимое» на плитке нет', !/Принять|Копировать|Содержимое|Открыть целиком|Скачать/.test(panel.text), panel.text);

// Файл этапа в модалке: превью, «Скачать», «Принять» (он участвует в гейтах).
const fileDlg = await run(`
  await openTile(document.querySelector('[data-artifact="${sub.id}"]'));
  return {btns: buttons(dlg()), img: Boolean(dlg().querySelector('img[data-file-preview=image]')), text: dlgText()};
`);
check('модалка файла этапа: превью, «Скачать», «Принять»', fileDlg.img && fileDlg.btns.includes('Скачать') && fileDlg.btns.includes('Принять') && !fileDlg.btns.includes('Копировать'), JSON.stringify(fileDlg));
const dl2 = await run(`
  const n = window.__downloads.length;
  await dlgClick('Скачать', 100);
  await waitFor(() => window.__downloads.length > n && window.__downloads.at(-1).sha, 15000);
  const r = window.__downloads.at(-1);
  await closeDlg();
  return r;
`);
check('скачивание файла этапа: имя и sha256', dl2.name === 'макет.png' && dl2.sha === shot.sha, JSON.stringify(dl2));

// Текстовый артефакт: чтение, копирование, скачивание — в модалке.
const before5 = await run(`return contentCalls(${JSON.stringify(txt.id)});`);
const txtDlg = await run(`
  await openTile(document.querySelector('[data-artifact="${txt.id}"]'));
  return {btns: buttons(dlg()), text: dlgText(), calls: contentCalls(${JSON.stringify(txt.id)})};
`);
check('модалка текста: «Копировать», «Скачать», «Принять», тело разметкой', txtDlg.btns.includes('Копировать') && txtDlg.btns.includes('Скачать') && txtDlg.btns.includes('Принять') && txtDlg.text.includes('Как дела?'), JSON.stringify(txtDlg));
check('открытие модалки — ровно один запрос содержимого', before5 === 0 && txtDlg.calls === 1, JSON.stringify([before5, txtDlg]));
const dl3 = await run(`
  const n = window.__downloads.length;
  await dlgClick('Скачать', 100);
  await waitFor(() => window.__downloads.length > n && window.__downloads.at(-1).sha, 15000);
  return window.__downloads.at(-1);
`);
check('скачивание текста: имя из вида и версии, содержимое то, что сдано',
  dl3.name === 'analysis.open_questions-v1.md' && dl3.sha === sha('# Вопросы\n\nКак дела?'), JSON.stringify(dl3));
// Буфер обмена: разрешение выдаёт драйвер, копия — байт в байт.
await s.grant(['clipboardReadWrite', 'clipboardSanitizedWrite'], BASE);
const copied = await run(`
  await dlgClick('Копировать', 400);
  try { return await navigator.clipboard.readText(); } catch (e) { return 'ERR ' + e; }
`);
check('«Копировать» кладёт в буфер исходный текст', copied === '# Вопросы\n\nКак дела?', JSON.stringify(copied));
const copiedFrom = await (await fetch(`${API}/v1/artifacts/${txt.id}/content`, {headers: {'X-SDLC-Actor': 'e2e'}})).text();
check('буфер совпадает с содержимым с сервера', copied === copiedFrom);

// Принять в модалке (AC-9)
await run(`await dlgClick('Принять', 1500); return true;`);
const acc = await run(`return {btns: buttons(dlg()), tile: document.querySelector('[data-artifact="${txt.id}"]').innerText};`);
check('после «Принять» кнопки в модалке нет, на плитке «принят»', !acc.btns.includes('Принять') && /принят/.test(acc.tile), JSON.stringify(acc));
const approvedNow = (await get(`/v1/tasks/${flow.key}`)).artifacts.find((x) => x.id === txt.id);
check('на сервере у артефакта заполнен approved_by', Boolean(approvedNow?.approved_by), JSON.stringify(approvedNow));
await run(`await closeDlg(); return true;`);
const focusBack = await run(`return document.activeElement && document.activeElement.getAttribute('data-artifact');`);
check('Esc закрыл модалку, фокус вернулся на плитку', focusBack === txt.id, String(focusBack));
// Enter на плитке в фокусе открывает модалку так же, как клик.
await run(`document.querySelector('[data-artifact="${txt.id}"]').focus(); return true;`);
await s.key('Enter', 'Enter', 13, '\r');
await wait(900);
check('Enter на плитке в фокусе открывает модалку', (await run(`return Boolean(dlg());`)) === true);
await run(`await closeDlg(); return true;`);

// ── история версий артефакта этапа (AC-3, AC-10) ────────────────────────────
console.log('история версий артефакта этапа');
const v2 = await (await api('POST', `/v1/tasks/${flow.key}/artifacts`, {kind: 'analysis.open_questions', title: 'Вопросы', format: 'markdown', content: '# Вопросы\n\nВторая версия.', supersedes_id: txt.id}, 'agent:analyst-bot')).json();
check('вторая версия сдана через supersedes_id', v2.version === 2 && v2.supersedes_id === txt.id, JSON.stringify(v2));
await open(flow.key, `?stage=${stageNow}`);
await run(`await waitFor(() => document.querySelector('[data-artifact="${v2.id}"]')); return true;`);
const chain = await run(`
  return {cur: document.querySelectorAll('[data-artifact="${v2.id}"]').length, old: document.querySelectorAll('[data-artifact="${txt.id}"]').length,
    superseded: net().filter((n) => n.url && /\\/artifacts\\?include_superseded/.test(n.url)).length};
`);
check('на цепочку одна плитка — текущая версия; прежней плитки нет', chain.cur === 1 && chain.old === 0, JSON.stringify(chain));
check('история не запрашивается, пока модалка закрыта', chain.superseded === 0, JSON.stringify(chain));
const histDlg = await run(`
  await openTile(document.querySelector('[data-artifact="${v2.id}"]'));
  const h = dlg().querySelector('[data-file-history]');
  const trigger = h && h.querySelector('button');
  const label = trigger ? trigger.innerText.trim() : null;
  if (trigger) { trigger.click(); await sleep(600); }
  return {label, versions: dlg().querySelectorAll('[data-file-version]').length, net: net().filter((n) => n.url && /\\/artifacts\\?include_superseded=true/.test(n.url)).length, text: dlgText().slice(0, 300)};
`);
check('при открытии модалки — один запрос с include_superseded, блок «История версий (1)»', histDlg.label === 'История версий (1)' && histDlg.versions === 1 && histDlg.net === 1, JSON.stringify(histDlg));
const oldArt = await run(`
  dlg().querySelector('[data-file-version="${txt.id}"]').click();
  await sleep(1000);
  const btns = buttons(dlg());
  const r = {text: dlgText(), btns, old: Boolean(dlg().querySelector('[data-file-old]'))};
  const n = window.__downloads.length;
  await dlgClick('Скачать', 100);
  await waitFor(() => window.__downloads.length > n && window.__downloads.at(-1).sha, 15000);
  r.dl = window.__downloads.at(-1);
  return r;
`);
check('прежняя версия: содержимое v1, «Копировать» и «Скачать» есть, «Принять» нет',
  oldArt.text.includes('Как дела?') && oldArt.btns.includes('Копировать') && oldArt.btns.includes('Скачать') && !oldArt.btns.includes('Принять') && oldArt.old, JSON.stringify(oldArt).slice(0, 400));
check('скачивание прежней версии: analysis.open_questions-v1.md, содержимое первой версии', oldArt.dl.name === 'analysis.open_questions-v1.md' && oldArt.dl.sha === sha('# Вопросы\n\nКак дела?'), JSON.stringify(oldArt.dl));
await run(`await closeDlg(); return true;`);

// ── вёрстка: узкий экран, тёмная тема, живой опрос (AC-14–AC-17) ────────────
console.log('вёрстка и живой опрос');
await s.resize(1440, 900);
await open(flow.key, `?stage=${stageNow}`);
await run(`await waitFor(() => document.querySelector('[data-artifact="${v2.id}"]')); return true;`);
const wide = await run(`
  const tiles = Array.from(document.querySelectorAll('[data-run-id] [data-file-tile]'));
  const tops = new Set(tiles.map((t) => Math.round(t.getBoundingClientRect().top)));
  return {tiles: tiles.length, rows: tops.size};
`);
check('1440×900: в ряду больше одной плитки', wide.tiles >= 2 && wide.rows < wide.tiles, JSON.stringify(wide));
await s.resize(375, 800);
await open(flow.key, `?stage=${stageNow}`);
await run(`await waitFor(() => document.querySelector('[data-artifact="${v2.id}"]')); return true;`);
const narrow = await run(`
  const tiles = Array.from(document.querySelectorAll('[data-run-id] [data-file-tile]'));
  const lefts = new Set(tiles.map((t) => Math.round(t.getBoundingClientRect().left)));
  const de = document.documentElement;
  return {tiles: tiles.length, cols: lefts.size, page: de.scrollWidth <= de.clientWidth, over: tiles.filter((t) => t.getBoundingClientRect().right > de.clientWidth).length};
`);
check('375×800: плитки этапа в одну колонку и не выходят за край', narrow.tiles >= 2 && narrow.cols === 1 && narrow.page && narrow.over === 0, JSON.stringify(narrow));
const narrowAtt = await run(`
  const de = document.documentElement;
  const tiles = Array.from(document.querySelectorAll('[data-attachments] [data-file-tile]'));
  const lefts = new Set(tiles.map((t) => Math.round(t.getBoundingClientRect().left)));
  return {tiles: tiles.length, cols: lefts.size, page: de.scrollWidth <= de.clientWidth};
`);
check('375×800: плитки вложений в одну колонку', narrowAtt.cols <= 1 && narrowAtt.page, JSON.stringify(narrowAtt));
const narrowDlg = await run(`
  await openTile(document.querySelector('[data-artifact="${sub.id}"]'));
  const d = dlg();
  const de = document.documentElement;
  const acts = d.querySelector('[data-file-actions]');
  const body = d.querySelector('[data-file-body]');
  const r = {dlgFits: d.scrollWidth <= d.clientWidth && d.getBoundingClientRect().right <= de.clientWidth, page: de.scrollWidth <= de.clientWidth,
    actions: acts.scrollWidth <= acts.clientWidth, bodyScroll: getComputedStyle(body).overflowY, w: d.getBoundingClientRect().width};
  await closeDlg();
  await openTile(document.querySelector('[data-artifact="${v2.id}"]'));
  const t = dlg().querySelector('[data-file-body]');
  r.textBody = getComputedStyle(t).overflowY;
  r.dlgFits2 = dlg().scrollWidth <= dlg().clientWidth;
  await closeDlg();
  return r;
`);
check('375×800: модалка не шире окна, действия видны, тело прокручивается внутри', narrowDlg.dlgFits && narrowDlg.dlgFits2 && narrowDlg.page && narrowDlg.actions && narrowDlg.bodyScroll === 'auto' && narrowDlg.textBody === 'auto', JSON.stringify(narrowDlg));

// Тёмная тема: цвета различимы, фон плитки не белый.
await s.resize(1440, 900);
await run(`document.documentElement.classList.add('dark'); await sleep(400); return true;`);
const dark = await run(`
  const tile = document.querySelector('[data-artifact="${v2.id}"]');
  const cs = getComputedStyle(tile);
  const r = {tileColor: cs.color, tileBg: cs.backgroundColor};
  await openTile(tile);
  const d = getComputedStyle(dlg());
  r.dlgColor = d.color; r.dlgBg = d.backgroundColor;
  await closeDlg();
  return r;
`);
check('тёмная тема: цвет и фон плитки и модалки различимы, фон плитки не белый',
  dark.tileColor !== dark.tileBg && dark.dlgColor !== dark.dlgBg && dark.tileBg !== 'rgb(255, 255, 255)', JSON.stringify(dark));
await run(`document.documentElement.classList.remove('dark'); return true;`);

// Живой опрос (аренда жива): открытая модалка переживает циклы опроса и не
// перезапрашивает содержимое (AC-17, R10).
const poll = await run(`
  await openTile(document.querySelector('[data-artifact="${v2.id}"]'));
  const before = {calls: contentCalls(${JSON.stringify(v2.id)}), cards: net().filter((n) => /\\/v1\\/tasks\\/[^/?]+$/.test(n.url || '')).length};
  await sleep(23000);
  const after = {calls: contentCalls(${JSON.stringify(v2.id)}), cards: net().filter((n) => /\\/v1\\/tasks\\/[^/?]+$/.test(n.url || '')).length, open: Boolean(dlg())};
  await closeDlg();
  return {before, after};
`);
check('живой опрос: карточка перезапрошена минимум дважды, модалка открыта, содержимое не перезапрошено',
  poll.after.cards - poll.before.cards >= 2 && poll.after.open && poll.after.calls === poll.before.calls && poll.before.calls === 1, JSON.stringify(poll));

await s.removeInitScript(initId);
s.close();
console.log(`\nвложения: ${ok} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
