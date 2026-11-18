// Страница согласия на подключение клиента и раздел «Подключённые клиенты»
// (CLAB-482, эпик CLAB-480): поток «разрешить» и «отклонить» целиком, вход и
// возврат, отзыв, «Токены» проекта, состояния экрана, мобильная ширина и
// тёмная тема.
//
// В общий прогон (run.sh) сценарий не входит: в режиме header подключение
// клиентов отвечает 404 целиком (решение 0079, п. 9). Ему нужен стенд в режиме
// токенов и свой Chrome с отладочным портом:
//
//   SDLC_AUTH_MODE=token SDLC_ADMIN_TOKEN=<секрет> — api (backend/dev/stack.sh up)
//   <Chrome> --headless --remote-debugging-port=$SDLC_CDP_PORT --user-data-dir=<каталог> about:blank &
//   SDLC_ADMIN_TOKEN=<тот же секрет> SDLC_API_URL=<api> SDLC_UI_URL=<интерфейс> \
//     SDLC_CDP_PORT=<порт> node e2e/oauth-consent.mjs
//
// Клиента OAuth играет сам сценарий: регистрация POST /v1/oauth/register,
// PKCE, обмен кода. Браузер входит в поток через origin интерфейса
// (<UI>/v1/oauth/authorize, прокси dev-сервера): Location у authorize
// относительный, и на адресе api страницы согласия нет. Адрес возврата —
// петля на порту сценария, поэтому у каждого запроса есть предупреждение
// «код получит программа на этом устройстве»; клиента на https сценарий
// только показывает и не решает.
//
// Ответы сервера, которых стенд дать не может (просроченный запрос, сбой
// сети, незнакомая причина отказа, длинные недоверенные значения),
// подменяются в браузере через localStorage.__mock (см. initScript), а не
// заглушкой всего бэкенда. SDLC_E2E_SHOTS — каталог для скриншотов.
import {createHash, randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdirSync, writeFileSync} from 'node:fs';

import {session, helpers} from './driver.mjs';

const UI = process.env.SDLC_UI_URL ?? 'http://localhost:5173';
const API = process.env.SDLC_API_URL ?? 'http://localhost:8088';
const ADMIN = process.env.SDLC_ADMIN_TOKEN;
const SHOTS = process.env.SDLC_E2E_SHOTS;
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!ADMIN) {
  console.error('нужен SDLC_ADMIN_TOKEN стенда: сценарий входит администратором');
  process.exit(2);
}

// ── api и клиент OAuth ──────────────────────────────────────────────────────

const api = async (method, path, token, body) => {
  const res = await fetch(API + '/v1' + path, {
    method,
    headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : undefined;
};

const meta = await (await fetch(API + '/.well-known/oauth-authorization-server')).json();
const ISSUER = meta.issuer;
const instance = await (await fetch(API + '/v1/instance')).json();
if (!instance.oauth?.enabled) {
  console.error('на стенде подключение клиентов не действует: нужен режим токенов (SDLC_AUTH_MODE=token)');
  process.exit(2);
}

const hits = [];
const callback = createServer((req, res) => {
  hits.push(req.url);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html><title>клиент</title><p>клиент получил ответ</p>');
});
await new Promise((ok2) => callback.listen(0, '127.0.0.1', ok2));
const REDIRECT = `http://127.0.0.1:${callback.address().port}/cb`;

const b64 = (buf) => buf.toString('base64url');
const pkce = () => {
  const verifier = b64(randomBytes(32));
  return {verifier, challenge: b64(createHash('sha256').update(verifier).digest())};
};
const register = async (name, redirect = REDIRECT) => {
  const res = await fetch(API + '/v1/oauth/register', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      client_name: name, redirect_uris: [redirect], token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
    }),
  });
  const body = await res.json();
  if (res.status !== 201) throw new Error(`register: ${res.status} ${JSON.stringify(body)}`);
  return body.client_id;
};
// Один запрос подключения: клиент, PKCE и адрес авторизации через origin
// интерфейса — по нему браузер уйдёт на страницу согласия.
const begin = async ({name = 'Example Assistant', redirect = REDIRECT, project = 'SDLC'} = {}) => {
  const clientId = await register(name, redirect);
  const {verifier, challenge} = pkce();
  const state = b64(randomBytes(8));
  const resource = `${ISSUER}/mcp/projects/${project}`;
  const q = new URLSearchParams({
    client_id: clientId, redirect_uri: redirect, response_type: 'code', code_challenge: challenge,
    code_challenge_method: 'S256', state, scope: 'cadence offline_access', resource,
  });
  return {clientId, verifier, state, resource, redirect, url: `${UI}/v1/oauth/authorize?${q}`};
};
const exchange = async (c, code, extra = {}) => {
  const res = await fetch(API + '/v1/oauth/token', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, code_verifier: c.verifier, client_id: c.clientId,
      redirect_uri: c.redirect, resource: c.resource, ...extra,
    }),
  });
  return {status: res.status, body: await res.json()};
};
const refresh = async (c, token) => {
  const res = await fetch(API + '/v1/oauth/token', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({grant_type: 'refresh_token', refresh_token: token, client_id: c.clientId, resource: c.resource}),
  });
  return {status: res.status, body: await res.json()};
};
// Согласие без браузера: сразу выдаёт доступ человеку-администратору. Нужен
// там, где проверяется не страница согласия, а то, что после неё.
const grantViaApi = async (c) => {
  const id = (await fetch(c.url, {redirect: 'manual', headers: {}})).headers.get('location')?.split('/').pop();
  const res = await api('POST', `/oauth/requests/${id}`, ADMIN, {decision: 'allow'});
  const code = new URL(res.redirect_uri).searchParams.get('code');
  const t = await exchange(c, code);
  if (t.status !== 200) throw new Error('обмен кода: ' + JSON.stringify(t));
  return t.body;
};
const grants = async () => (await api('GET', '/oauth/grants', ADMIN)).grants ?? [];

// ── браузер ─────────────────────────────────────────────────────────────────

const s = await session(UI + '/login');
// Скрипт в каждом новом документе: ошибки страницы, счётчики запросов и
// подмена ответов по localStorage.__mock ({'GET req': {status, body, once?}}).
await s.addInitScript(`(() => {
  window.__errors = [];
  addEventListener('error', (e) => window.__errors.push(String(e.message)));
  addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason)));
  const orig = console.error.bind(console);
  console.error = (...args) => { window.__errors.push(args.map(String).join(' ')); orig(...args); };
  const real = window.fetch.bind(window);
  const bump = (k) => localStorage.setItem(k, String(Number(localStorage.getItem(k) || 0) + 1));
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = String((init && init.method) || (typeof input !== 'string' && input.method) || 'GET').toUpperCase();
    const isReq = /\\/v1\\/oauth\\/requests\\//.test(url);
    const isGrants = /\\/v1\\/oauth\\/grants/.test(url);
    if (isReq && method === 'POST') bump('__posts');
    if (isGrants) bump('__grants_calls');
    let mock = null;
    try { mock = JSON.parse(localStorage.getItem('__mock') || 'null'); } catch (e) { mock = null; }
    const key = isReq ? method + ' req' : isGrants ? method + ' grants' : /\\/v1\\/instance$/.test(url) ? 'GET instance' : '';
    const m = mock && key && mock[key];
    if (m) {
      if (m.once) { delete mock[key]; localStorage.setItem('__mock', JSON.stringify(mock)); }
      return new Promise((res) => setTimeout(() => res(new Response(
        m.body === undefined ? null : JSON.stringify(m.body),
        {status: m.status, headers: {'Content-Type': 'application/json'}},
      )), m.delay || 0));
    }
    return real(input, init);
  };
})();`);
const run = (body) => s.evaluate(helpers + body);
const text = () => run('return texts();');
const errors = () => run('return window.__errors || [];');
const setMock = (m) => run(`localStorage.setItem('__mock', ${JSON.stringify(JSON.stringify(m))}); return 1;`);
const counter = (k) => run(`return Number(localStorage.getItem(${JSON.stringify(k)}) || 0);`);
const reset = () => run(`localStorage.removeItem('__mock'); localStorage.removeItem('__posts'); localStorage.removeItem('__grants_calls'); return 1;`);
const settle = (ms = 1500) => sleep(ms);
const asToken = async (token) => {
  await s.goto(UI + '/login');
  await run(token
    ? `localStorage.setItem('sdlc.token', ${JSON.stringify(token)}); return 1;`
    : `localStorage.removeItem('sdlc.token'); return 1;`);
};
const where = () => run('return location.pathname + location.search;');
const open = async (path) => { await s.goto(UI + path); await settle(); };
const shot = async (name) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, {recursive: true});
  writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(await s.screenshot(), 'base64'));
};
// Ответ клиента — запрос к /cb (favicon и прочее не в счёт).
const lastHit = () => hits.filter((h) => h.startsWith('/cb')).at(-1);
const waitHit = async () => {
  for (let i = 0; i < 60 && !lastHit(); i++) await sleep(100);
  return lastHit();
};
const consentPath = async (c) => {
  const res = await fetch(c.url, {redirect: 'manual'});
  return res.headers.get('location');
};
const fontPx = (sel) => run(`const e = document.querySelector(${JSON.stringify(sel)}); return e ? parseFloat(getComputedStyle(e).fontSize) : 0;`);
// Цвет любого формата (oklch в Chrome) — в sRGB через холст.
const CONTRAST = `
  const rgb = (css) => {
    const c = document.createElement('canvas'); c.width = c.height = 1;
    const g = c.getContext('2d', {willReadFrequently: true}); g.fillStyle = css; g.fillRect(0, 0, 1, 1);
    return Array.from(g.getImageData(0, 0, 1, 1).data).slice(0, 3);
  };
  const lum = (c) => { const f = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; };
  const ratio = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c && !/rgba?\\(0, 0, 0, 0\\)|transparent/.test(c)) return c; } return 'white'; };
  const contrastOf = (el) => ratio(rgb(getComputedStyle(el).color), rgb(bgOf(el)));
`;

await s.resize(1360, 900);

// ── 1. вход и возврат, карточка живого запроса ──────────────────────────────

console.log('AC-1: без входа — на вход, после входа тот же запрос');
await asToken(null);
await reset();
const allow = await begin({name: 'Example Assistant'});
const allowPath = await consentPath(allow);
check('authorize ведёт на страницу согласия', /^\/login\/oauth\/[0-9a-f-]{36}$/.test(allowPath ?? ''), String(allowPath));
await s.goto(UI + allowPath);
await settle(2000);
check('без токена — переход на /login', (await where()).startsWith('/login') && !(await where()).startsWith('/login/oauth'), await where());
await run(`await clickExact('Другие способы входа'); return 1;`);
await run(`await fill('Токен', ${JSON.stringify(ADMIN)}); return 1;`);
await run(`await clickExact('Войти'); return 1;`);
await settle(2500);
check('после входа токеном — тот же адрес согласия', (await where()) === allowPath, await where());
let t = await text();
check('на экране карточка запроса', t.includes('Подключение клиента') && t.includes('Клиент называет себя:') && t.includes('Example Assistant'), t.slice(0, 300));

console.log('AC-2, AC-5: что показано, loopback');
check('подзаголовок называет адрес инстанса', t.includes('доступ к ' + new URL(UI).host));
check('«Код доступа получит:» и хост адреса возврата', t.includes('Код доступа получит:') && t.includes('127.0.0.1'), t.slice(0, 400));
check('подсказка: хост без порта и пути', t.includes('Показан только хост — без порта и пути.'));
check('«Вы вошли как» user:admin', /Вы вошли как\s*user:admin/.test(t), t.slice(0, 500));
check('фраза о правах', t.includes('клиент сможет делать всё, что можете вы'));
check('проект: имя и ключ', /Проект\s*SDLC Pipeline · SDLC/.test(t), t.slice(0, 600));
check('срок: «Запрос действует до ЧЧ:ММ»', /Запрос действует до \d{1,2}:\d{2}\./.test(t));
check('для DCR нет «Описание клиента загружено с»', !t.includes('Описание клиента загружено с'));
check('loopback: предупреждение', t.includes('Код получит программа на этом устройстве'));
const sizes = {h1: await fontPx('h1'), host: await fontPx('[data-oauth-host]'), name: await fontPx('[data-oauth-client-name]')};
check('хост крупнее имени и не мельче заголовка (>=24 px на ≥640)', sizes.host > sizes.name && sizes.host >= sizes.h1 && sizes.host >= 24, JSON.stringify(sizes));
check('обе кнопки решения', await run(`return Boolean(byText('Разрешить') && byText('Отклонить') && byText('Войти другой учётной записью'));`));
check('шрифт хоста моноширинный', await run(`return /mono|Mono|Menlo|Consolas|Courier/.test(getComputedStyle(document.querySelector('[data-oauth-host]')).fontFamily);`));
await shot('consent-desktop-light');

console.log('AC-9: порядок обхода с клавиатуры и размер целей');
await run(`document.activeElement && document.activeElement.blur(); return 1;`);
const order = [];
for (let i = 0; i < 3; i++) {
  await s.key('Tab', 'Tab', 9);
  order.push(await run(`return (document.activeElement.innerText || '').trim();`));
}
check('фокус: Разрешить → Отклонить → Войти другой учётной записью', order.join('|') === 'Разрешить|Отклонить|Войти другой учётной записью', order.join('|'));
const heights = await run(`return ['Разрешить','Отклонить','Войти другой учётной записью'].map((x) => Math.round(byText(x).getBoundingClientRect().height));`);
check('кнопки не ниже 44 px', heights.every((h) => h >= 44), JSON.stringify(heights));

// ── 2. «Разрешить» ──────────────────────────────────────────────────────────

console.log('AC-3: «Разрешить» — один POST, возврат клиенту, обмен кода');
const lenBefore = await run('return history.length;');
await run(`const b = byText('Разрешить'); b.click(); await sleep(50); b.click(); return 1;`);
const hit = await waitHit();
check('браузер ушёл на redirect_uri клиента', Boolean(hit) && hit.startsWith('/cb?'), String(hit));
const q = new URL('http://x' + (hit ?? '/')).searchParams;
check('в адресе code, state и iss', Boolean(q.get('code')) && q.get('state') === allow.state && q.get('iss') === ISSUER, hit);
check('запись истории заменена, а не добавлена', (await run('return history.length;')) === lenBefore, `${lenBefore} → ${await run('return history.length;')}`);
const tok = await exchange(allow, q.get('code'));
check('обмен кода: 200, access_token и refresh_token', tok.status === 200 && tok.body.access_token && tok.body.refresh_token, JSON.stringify(tok.body).slice(0, 200));
// Повтор кода гасит выдачу (code_reuse), поэтому проверяется на отдельной
// выдаче, а не на той, что нужна дальше.
const reuse = await begin({name: 'Reuse Client'});
{
  const id = (await consentPath(reuse)).split('/').pop();
  const res = await api('POST', `/oauth/requests/${id}`, ADMIN, {decision: 'allow'});
  const code = new URL(res.redirect_uri).searchParams.get('code');
  const first = await exchange(reuse, code);
  const again = await exchange(reuse, code);
  check('тот же код повторно — invalid_grant', first.status === 200 && again.status === 400 && again.body.error === 'invalid_grant', JSON.stringify(again.body));
}

console.log('AC-3: двойной клик — один POST (ответ задержан, счётчик в браузере)');
{
  await asToken(ADMIN);
  await reset();
  await setMock({'GET req': {status: 200, body: {
    id: 'b7a4a3c2-5d11-4c43-9a1e-0f9d2f1c0001', client_id: 'cid', client_kind: 'dcr', client_name: 'Example Assistant', redirect_host: 'claude.ai',
    loopback: false, principal: {kind: 'user', handle: 'admin'}, resource: 'r', scope: 'cadence',
    expires_at: new Date(Date.now() + 600000).toISOString(), can_grant: true,
  }}, 'POST req': {status: 500, delay: 600, body: {error: {code: 'internal', message: 'внутренняя ошибка'}}}});
  await open('/login/oauth/b7a4a3c2-5d11-4c43-9a1e-0f9d2f1c0001');
  await run(`const b = byText('Разрешить'); b.click(); b.click(); await sleep(50); b.click(); return 1;`);
  await sleep(1200);
  check('три клика подряд — ровно один POST', (await counter('__posts')) === 1, String(await counter('__posts')));
  check('после ответа с ошибкой кнопки снова доступны', await run(`return !byText('Разрешить').disabled;`));
  await reset();
}

console.log('AC-7: решённый запрос — «уже обработан», без кнопок');
await asToken(ADMIN);
await open(allowPath);
t = await text();
check('«Запрос уже обработан»', t.includes('Запрос уже обработан'), t.slice(0, 300));
check('кнопок решения нет, перехода нет', !(await run(`return Boolean(byText('Разрешить') || byText('Отклонить'));`)));

console.log('AC-10: подключённый клиент в списке');
await open('/clients');
t = await text();
check('пункт «Подключённые клиенты» в меню после «Подключение»', await run(`
  const labels = all('[data-sidebar=menu-button]').map((e) => (e.innerText || '').trim());
  return labels.indexOf('Подключённые клиенты') === labels.indexOf('Подключение') + 1 && labels.indexOf('Подключение') >= 0;`));
check('заголовок страницы «Подключённые клиенты»', await run(`return all('h1').some((h) => h.innerText.trim() === 'Подключённые клиенты');`));
check('строка: имя, хост, проект-метка, «действует»', t.includes('Example Assistant') && t.includes('127.0.0.1') && t.includes('SDLC') && t.includes('действует'), t.slice(0, 500));
check('«запросов не было» до первого вызова', t.includes('запросов не было'), t.slice(0, 600));
const me1 = await fetch(API + '/v1/auth/me', {headers: {Authorization: 'Bearer ' + tok.body.access_token}});
check('access-токен клиента работает', me1.status === 200, String(me1.status));
await open('/clients');
t = await text();
check('после вызова «последний запрос» заполнен', !t.includes('запросов не было'), t.slice(0, 600));
await run(`const b = byText('Показать отозванные'); if (b) { b.click(); await sleep(700); } return 1;`);
check('отозванная повтором кода: причина словами, живая выше', (await text()).includes('Reuse Client') && (await text()).includes('Отозван автоматически: код подключения использован повторно.'));

// ── 3. «Токены» проекта и отзыв ─────────────────────────────────────────────

console.log('AC-13: «Токены» проекта');
await open('/p/SDLC/settings?tab=tokens');
t = await text();
check('строка токена помечена «подключённый клиент» с именем и хостом', t.includes('подключённый клиент') && t.includes('Example Assistant · 127.0.0.1'), t.slice(0, 700));
check('под таблицей — ссылка на «Подключённые клиенты»', await run(`return all('a').some((a) => a.innerText.trim() === 'Подключённые клиенты' && a.getAttribute('href') === '/clients');`));
check('прочие строки токенов не помечены', await run(`return all('table tbody tr').filter((r) => !r.innerText.includes('подключённый клиент')).every((r) => !r.innerText.includes('Example Assistant'));`));
await run(`await clickIn('Example Assistant', 'Отозвать'); return 1;`);
t = await run(`return (document.querySelector('[role=alertdialog]') || {}).innerText || '';`);
check('диалог отзыва: тот же смысл, что у «Отключить»', t.includes('Отозвать токен подключённого клиента?') && t.includes('«Example Assistant» (127.0.0.1)') && t.includes('вместе с токеном обновления'), t);
await run(`await confirm('Отозвать'); return 1;`);
await settle();
check('токен отозван (тост «Токен … отозван»)', (await run('return toasts();')).some((x) => /Токен .* отозван/.test(x)));
const ref1 = await refresh(allow, tok.body.refresh_token);
check('refresh_token после отзыва из «Токенов» — invalid_grant', ref1.status === 400 && ref1.body.error === 'invalid_grant', JSON.stringify(ref1.body));
await open('/clients');
check('в списке клиентов та же выдача «отозван» без кнопки «Отключить»', await run(`
  const c = document.querySelector('[data-oauth-grant-state=revoked]') || (() => { const b = byText('Показать отозванные'); if (b) b.click(); return null; })();
  await sleep(700);
  const r = document.querySelector('[data-oauth-grant-state=revoked]');
  return Boolean(r) && r.innerText.includes('Example Assistant') && r.innerText.includes('отозван') && !Array.from(r.querySelectorAll('button')).length;`));

console.log('AC-11, AC-13: отключить в списке, затем «Токены»');
const second = await begin({name: 'Desk Assistant'});
const secondTokens = await grantViaApi(second);
await open('/clients');
check('новая выдача выше отозванных', await run(`
  const cards = all('[data-oauth-grant]');
  return cards.length >= 2 && cards[0].getAttribute('data-oauth-grant-state') === 'live';`));
// Отмена ничего не шлёт.
await run(`await clickIn('Desk Assistant', 'Отключить'); return 1;`);
t = await run(`return (document.querySelector('[role=alertdialog]') || {}).innerText || '';`);
check('диалог «Отключить клиент?» с именем и хостом', t.includes('Отключить клиент?') && t.includes('«Desk Assistant» (127.0.0.1)') && t.includes('токен обновления'), t);
await run(`await confirm('Отмена'); return 1;`);
check('«Отмена»: выдача жива', (await grants()).find((g) => g.client_name === 'Desk Assistant' && !g.revoked_at) !== undefined);
await run(`await clickIn('Desk Assistant', 'Отключить'); await confirm('Отключить'); return 1;`);
await settle();
check('тост «Клиент «Desk Assistant» отключён»', (await run('return toasts();')).some((x) => x.includes('Клиент «Desk Assistant» отключён')), JSON.stringify(await run('return toasts();')));
check('строка стала «отозван» без кнопки', await run(`
  const b = byText('Показать отозванные'); if (b) { b.click(); await sleep(700); }
  const r = all('[data-oauth-grant]').find((e) => e.innerText.includes('Desk Assistant'));
  return Boolean(r) && r.getAttribute('data-oauth-grant-state') === 'revoked' && r.querySelectorAll('button').length === 0 && r.innerText.includes('Вы отключили этот клиент.');`));
const me2 = await fetch(API + '/v1/auth/me', {headers: {Authorization: 'Bearer ' + secondTokens.access_token}});
check('access-токен клиента — 401', me2.status === 401, String(me2.status));
const ref2 = await refresh(second, secondTokens.refresh_token);
check('refresh_token — invalid_grant', ref2.status === 400 && ref2.body.error === 'invalid_grant', JSON.stringify(ref2.body));
const audit = JSON.stringify(await api('GET', '/projects/SDLC/audit', ADMIN).catch(() => ({})))
  + JSON.stringify(await api('GET', '/audit', ADMIN).catch(() => ({})));
check('в журнале oauth.revoke с причиной user', audit.includes('oauth.revoke') && /"reason":"user"/.test(audit.replace(/\s/g, '')), audit.slice(0, 200));
await open('/p/SDLC/settings?tab=tokens');
check('«Токены»: токен того клиента — «отозван»', await run(`
  const r = all('table tbody tr').find((e) => e.innerText.includes('Desk Assistant'));
  return Boolean(r) && r.innerText.includes('отозван');`));

// ── 4. «Отклонить» ──────────────────────────────────────────────────────────

console.log('AC-4: «Отклонить»');
const deny = await begin({name: 'Denied Assistant'});
const grantsBefore = (await grants()).length;
await s.goto(deny.url);
await settle(2000);
hits.length = 0;
await run(`await clickExact('Отклонить'); return 1;`);
const dh = await waitHit();
const dq = new URL('http://x' + (dh ?? '/')).searchParams;
check('уход на redirect_uri с error=access_denied, state и iss, без code', dq.get('error') === 'access_denied' && dq.get('state') === deny.state && dq.get('iss') === ISSUER && !dq.get('code'), dh);
check('выдачи нет', (await grants()).length === grantsBefore);

// ── 5. «выдать нельзя» ──────────────────────────────────────────────────────

console.log('AC-6: «выдать нельзя»');
const noProject = await begin({name: 'Ghost Client', project: 'NOPE'});
await s.goto(noProject.url);
await settle(2000);
t = await text();
check('карточка запроса остаётся, текст сервера выведен', t.includes('Подключить с этой учётной записью нельзя') && t.includes('NOPE') && t.includes('Ghost Client'), t.slice(0, 500));
check('«Запрос действует до» не показан', !t.includes('Запрос действует до'));
check('«Разрешить» выключена', await run(`return byText('Разрешить').disabled === true;`));
await reset();
await run(`byText('Разрешить').click(); return 1;`);
await sleep(500);
check('нажатие «Разрешить» не шлёт POST', (await counter('__posts')) === 0);
await shot('consent-blocked-desktop');
console.log('  вход токеном агента (not_a_person), «Войти другой учётной записью»');
const agent = (await api('POST', '/auth/tokens', ADMIN, {principal: 'agent:e2e-consent', name: 'e2e-consent'})).token;
const asAgent = await begin({name: 'Agent Side'});
await asToken(agent);
await s.goto(asAgent.url);
await settle(2000);
t = await text();
check('токен агента: «выдать нельзя» с текстом сервера', t.includes('Подключить с этой учётной записью нельзя') && t.includes('доступ клиенту выдаёт только человек'), t.slice(0, 500));
const agentPath = await where();
await run(`await clickExact('Войти другой учётной записью'); return 1;`);
await settle(2000);
check('выход ведёт на /login', (await where()).startsWith('/login') && !(await where()).startsWith('/login/oauth'), await where());
check('токен браузера забыт', await run(`return localStorage.getItem('sdlc.token') === null;`));
await run(`await clickExact('Другие способы входа'); return 1;`);
await run(`await fill('Токен', ${JSON.stringify(ADMIN)}); return 1;`);
await run(`await clickExact('Войти'); return 1;`);
await settle(2500);
check('после входа человеком — возврат на тот же запрос', (await where()) === agentPath, `${await where()} vs ${agentPath}`);
check('теперь «Разрешить» доступна', await run(`return byText('Разрешить') && !byText('Разрешить').disabled;`));

console.log('AC-5: клиент на https — без предупреждения (запрос не решается)');
const https = await begin({name: 'Hosted Assistant', redirect: 'https://hosted.example/cb'});
await s.goto(https.url);
await settle(2000);
t = await text();
check('хост hosted.example показан, предупреждения нет', t.includes('hosted.example') && !t.includes('Код получит программа на этом устройстве'), t.slice(0, 300));

// ── 6. состояния ответов (подмена в браузере) ───────────────────────────────

const consentBody = (extra = {}) => ({
  id: 'b7a4a3c2-5d11-4c43-9a1e-0f9d2f1c0001', client_id: 'cid', client_kind: 'dcr', client_name: 'Example Assistant',
  redirect_host: 'claude.ai', loopback: false, principal: {kind: 'user', handle: 'ivan'}, resource: 'r',
  project_key: 'PLAT', project_name: 'Платформа', scope: 'cadence', expires_at: new Date(Date.now() + 600000).toISOString(),
  can_grant: true, ...extra,
});
const ID = 'b7a4a3c2-5d11-4c43-9a1e-0f9d2f1c0001';
const err = (status, code, message, details) => ({status, body: {error: {code, message, ...(details ? {details} : {})}}});
await asToken(ADMIN);

console.log('AC-7: запрос не годится');
for (const [name, mock, title] of [
  ['устарел', {'GET req': err(409, 'conflict', 'запрос авторизации устарел', {reason: 'expired'})}, 'Запрос устарел'],
  ['обработан', {'GET req': err(409, 'conflict', 'запрос уже решён', {reason: 'decided'})}, 'Запрос уже обработан'],
  ['не найден', {'GET req': err(404, 'not_found', 'запрос авторизации не найден')}, 'Запрос не найден'],
]) {
  await setMock(mock);
  await open('/login/oauth/' + ID);
  t = await text();
  check(`${name}: «${title}», без кнопок`, t.includes(title) && !(await run(`return Boolean(byText('Разрешить') || byText('Отклонить') || byText('Войти другой'));`)), t.slice(0, 300));
}
await reset();
await open('/login/oauth/not-a-uuid');
check('адрес не uuid — «Запрос не найден»', (await text()).includes('Запрос не найден'));
await open('/login/oauth/' + ID);
check('неизвестный uuid — «Запрос не найден»', (await text()).includes('Запрос не найден'));

console.log('состояния 5, 9, 10, 14: 403 на GET, сбой GET, сбой и отказ POST');
await setMock({'GET req': err(403, 'forbidden', 'токеном задачи доступ клиенту не выдаётся')});
await open('/login/oauth/' + ID);
t = await text();
check('403 на GET: сообщение сервера и только «Войти другой»', t.includes('Подключить с этой учётной записью нельзя') && t.includes('токеном задачи доступ клиенту не выдаётся') && await run(`return Boolean(byText('Войти другой')) && !byText('Разрешить') && !byText('Отклонить');`), t.slice(0, 300));
await setMock({'GET req': {status: 500, body: {error: {code: 'internal', message: 'внутренняя ошибка'}}}});
await open('/login/oauth/' + ID);
t = await text();
check('сбой GET: «Не получилось загрузить запрос» и «Повторить»', t.includes('Не получилось загрузить запрос') && Boolean(await run(`return byText('Повторить') ? 1 : 0;`)), t.slice(0, 300));
await setMock({'GET req': {status: 200, body: consentBody()}});
await run(`await clickExact('Повторить'); return 1;`);
await settle(800);
check('«Повторить» перечитывает: карточка', (await text()).includes('claude.ai'));
await setMock({'GET req': {status: 200, body: consentBody()}, 'POST req': {status: 500, body: {error: {code: 'internal', message: 'внутренняя ошибка'}}, once: true}});
await open('/login/oauth/' + ID);
await run(`await clickExact('Разрешить'); return 1;`);
await settle(800);
t = await text();
check('сбой POST: «Решение не отправлено», запрос остался нерешённым', t.includes('Решение не отправлено') && t.includes('Запрос остался нерешённым: нажмите кнопку ещё раз.'), t.slice(0, 400));
check('кнопки снова доступны, карточка на месте', await run(`return !byText('Разрешить').disabled && !byText('Отклонить').disabled;`) && t.includes('claude.ai'));
await setMock({'GET req': {status: 200, body: consentBody()}, 'POST req': err(403, 'forbidden', 'вы вошли токеном другого проекта', {reason: 'token_bound_elsewhere'})});
await run(`await clickExact('Разрешить'); return 1;`);
await settle(800);
t = await text();
check('403 на POST: «выдать нельзя» с текстом сервера, «Разрешить» выключена', t.includes('Подключить с этой учётной записью нельзя') && t.includes('вы вошли токеном другого проекта') && await run(`return byText('Разрешить').disabled;`), t.slice(0, 400));

console.log('состояние 8: недопустимый адрес возврата');
await reset();
for (const bad of ['javascript:alert(1)', 'data:text/html,<p>x</p>', '//evil.example/cb', 'evil.example/cb', 'http://evil.example/cb', 'https://user:pw@evil.example/cb']) {
  await setMock({'GET req': {status: 200, body: consentBody()}, 'POST req': {status: 200, body: {redirect_uri: bad}}});
  await open('/login/oauth/' + ID);
  await run(`await clickExact('Разрешить'); return 1;`);
  await settle(500);
  t = await text();
  check(`«${bad}» — без перехода, «Адрес возврата недопустим»`, (await where()).startsWith('/login/oauth/') && t.includes('Адрес возврата недопустим') && !t.includes('evil.example'), t.slice(0, 200));
}
await setMock({'GET req': {status: 200, body: consentBody()}, 'POST req': {status: 200, body: {redirect_uri: REDIRECT + '?code=SECRETCODE&state=x'}}});
await open('/login/oauth/' + ID);
await run(`await clickExact('Разрешить'); return 1;`);
await waitHit();
check('допустимый адрес (петля) — переход', lastHit()?.includes('SECRETCODE'));

console.log('AC-8, AC-9: недоверенные значения, 375 px, тёмная тема');
const XSS = '<img src=x onerror=alert(1)> Очень-длинное-название-клиента-без-пробелов-для-проверки-переноса-строки-1234567890-1234567890';
const LONGHOST = 'xn--very-long-subdomain-name-for-wrapping-check.example-host-name-with-more-than-sixty-chars.example.org';
await asToken(ADMIN);
await s.resize(375, 800);
await s.emulate([{name: 'prefers-color-scheme', value: 'dark'}]);
await setMock({'GET req': {status: 200, body: consentBody({
  client_name: XSS, redirect_host: LONGHOST, document_host: 'client.example.org', loopback: true, project_key: undefined, project_name: undefined,
})}});
await open('/login/oauth/' + ID);
t = await text();
check('имя выведено текстом, без разметки', t.includes('<img src=x onerror=alert(1)>') && await run(`return document.querySelectorAll('img').length === 0 && !document.querySelector('[onerror]');`));
check('в имени нет ссылок', await run(`return document.querySelector('[data-oauth-client-name]').querySelectorAll('a').length === 0;`));
check('хост как пришёл (punycode не декодируется)', await run(`return document.querySelector('[data-oauth-host]').innerText === ${JSON.stringify(LONGHOST)};`));
check('хост документа клиента (CIMD)', t.includes('Описание клиента загружено с: client.example.org'));
check('без проекта: «все ваши проекты»', /Проект\s*все ваши проекты/.test(t));
check('нет горизонтальной прокрутки на 375 px', await run(`return document.documentElement.scrollWidth <= document.documentElement.clientWidth;`), await run(`return document.documentElement.scrollWidth + ' > ' + document.documentElement.clientWidth;`));
check('кнопки на всю ширину и не ниже 44 px', await run(`return ['Разрешить','Отклонить','Войти другой учётной записью'].every((x) => { const r = byText(x).getBoundingClientRect(); return r.height >= 44 && r.width > 250; });`));
check('предупреждение loopback видно без прокрутки вправо', await run(`const r = document.querySelector('[data-oauth-loopback]').getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth;`));
const hostSize = await fontPx('[data-oauth-host]');
check('хост 20 px на узком экране, не мельче заголовка', hostSize >= 20 && hostSize >= (await fontPx('h1')), String(hostSize));
check('тёмная тема: класс dark', await run(`return document.documentElement.classList.contains('dark');`));
const ratios = await run(CONTRAST + `return {
  host: contrastOf(document.querySelector('[data-oauth-host]')),
  hint: contrastOf(Array.from(document.querySelectorAll('p')).find((p) => p.innerText.startsWith('Сверьте адрес'))),
  name: contrastOf(document.querySelector('[data-oauth-client-name]')),
};`);
check('контраст хоста, подсказки и имени не ниже 4,5:1 (тёмная)', Object.values(ratios).every((r) => r >= 4.5), JSON.stringify(ratios));
await shot('consent-375-dark');
await s.emulate([{name: 'prefers-color-scheme', value: 'light'}]);
await setMock({'GET req': {status: 200, body: consentBody()}});
await open('/login/oauth/' + ID);
const lightRatios = await run(CONTRAST + `return {
  host: contrastOf(document.querySelector('[data-oauth-host]')),
  hint: contrastOf(Array.from(document.querySelectorAll('p')).find((p) => p.innerText.startsWith('Сверьте адрес'))),
};`);
check('контраст не ниже 4,5:1 (светлая)', Object.values(lightRatios).every((r) => r >= 4.5), JSON.stringify(lightRatios));
check('светлая тема: класс dark снят', await run(`return !document.documentElement.classList.contains('dark');`));
await shot('consent-375-light');
await setMock({'GET req': {status: 200, body: consentBody({client_name: '   '})}});
await open('/login/oauth/' + ID);
check('пустое имя — «клиент без имени»', (await text()).includes('клиент без имени'));
await setMock({'GET req': {status: 200, body: consentBody({can_grant: false, reason: 'a_new_reason', reason_message: ''})}});
await open('/login/oauth/' + ID);
t = await text();
check('незнакомая причина без текста — то же состояние и запасной текст', t.includes('Выдать доступ с этой учётной записью нельзя.') && await run(`return byText('Разрешить').disabled;`), t.slice(0, 400));
await s.resize(1360, 900);
await s.emulate([{name: 'prefers-color-scheme', value: 'dark'}]);
await setMock({'GET req': {status: 200, body: consentBody()}});
await open('/login/oauth/' + ID);
check('десктоп, тёмная тема: карточка запроса', (await text()).includes('claude.ai') && await run(`return document.documentElement.classList.contains('dark');`));
await shot('consent-desktop-dark');

// ── 7. список клиентов: состояния ───────────────────────────────────────────

console.log('AC-10, AC-12: состояния списка');
const iso = (d) => new Date(Date.now() - d * 86400000).toISOString();
const g = (o) => ({id: crypto.randomUUID(), token_id: crypto.randomUUID(), client_id: 'c', client_kind: 'dcr', redirect_host: 'claude.ai', resource: 'r', scope: 'cadence', created_at: iso(5), ...o});
await setMock({'GET grants': {status: 200, body: {grants: [
  g({client_name: 'Live One', last_used_at: iso(0)}),
  g({client_name: 'Rev User', revoked_at: iso(1), revoke_reason: 'user'}),
  g({client_name: 'Rev Refresh', revoked_at: iso(1), revoke_reason: 'refresh_reuse'}),
  g({client_name: 'Rev Code', revoked_at: iso(1), revoke_reason: 'code_reuse'}),
  g({client_name: 'Rev Expired', revoked_at: iso(1), revoke_reason: 'expired'}),
  g({client_name: 'Rev Unknown', revoked_at: iso(1), revoke_reason: 'admin_wipe'}),
  g({client_name: 'Rev None', revoked_at: iso(1)}),
]}}});
await open('/clients');
t = await text();
check('действующие выше; отозванные свёрнуты, пока есть действующие', t.includes('Live One') && t.includes('Показать отозванные (6)') && !t.includes('Rev User'), t.slice(0, 400));
await run(`await clickExact('Показать отозванные (6)'); return 1;`);
t = await text();
for (const phrase of ['Вы отключили этот клиент.', 'Отозван автоматически: токен обновления использован повторно.',
  'Отозван автоматически: код подключения использован повторно.', 'Отозван: истёк срок без использования.', 'admin_wipe']) {
  check(`причина: «${phrase}»`, t.includes(phrase));
}
check('«Скрыть отозванные (6)»', t.includes('Скрыть отозванные (6)'));
await setMock({'GET grants': {status: 200, body: {grants: [g({client_name: 'Only Revoked', revoked_at: iso(1), revoke_reason: 'user'})]}}});
await open('/clients');
check('нет действующих — отозванные раскрыты', (await text()).includes('Only Revoked'));
await setMock({'GET grants': {status: 200, body: {grants: [
  g({client_name: XSS, redirect_host: LONGHOST}),
]}}});
await s.resize(375, 800);
await s.emulate([{name: 'prefers-color-scheme', value: 'dark'}]);
await open('/clients');
check('375 px, длинные значения: без горизонтальной прокрутки', await run(`return document.documentElement.scrollWidth <= document.documentElement.clientWidth;`), await run(`return document.documentElement.scrollWidth + ' > ' + document.documentElement.clientWidth;`));
check('«Отключить» на 375 px — отдельная кнопка во всю ширину, с доступным именем', await run(`const b = all('button').find((x) => (x.getAttribute('aria-label') || '').startsWith('Отключить: ')); const r = b.getBoundingClientRect(); return r.height >= 44 && r.width > 250 && b.getAttribute('aria-label').includes('<img');`));
await shot('clients-375-dark');
await s.resize(1360, 900);
await open('/clients');
await shot('clients-desktop-dark');
await s.emulate([{name: 'prefers-color-scheme', value: 'light'}]);
await setMock({'GET grants': {status: 200, body: {grants: []}}});
await open('/clients');
t = await text();
check('нет подключений — пустое состояние с «Как подключить клиент»', t.includes('Подключённых клиентов нет') && Boolean(await run(`return byText('Как подключить клиент') ? 1 : 0;`)), t.slice(0, 300));
await setMock({'GET grants': {status: 500, body: {error: {code: 'internal', message: 'внутренняя ошибка'}}}});
await open('/clients');
t = await text();
check('ошибка списка — «Повторить» в разделе, меню на месте', t.includes('внутренняя ошибка') && Boolean(await run(`return byText('Повторить') ? 1 : 0;`)) && t.includes('Проекты'), t.slice(0, 300));
await setMock({'GET grants': {status: 204}, 'GET instance': {status: 200, body: {...instance, oauth: {enabled: true}}}});

console.log('AC-12: видимость по инстансу');
for (const [name, body] of [
  ['нет поля oauth', (() => { const {oauth, ...rest} = instance; void oauth; return {status: 200, body: rest}; })()],
  ['enabled: false', {status: 200, body: {...instance, oauth: {enabled: false}}}],
  ['сбой запроса', {status: 500, body: {error: {code: 'internal', message: 'сбой'}}}],
]) {
  await setMock({'GET instance': body});
  await reset();
  await setMock({'GET instance': body});
  await open('/clients');
  t = await text();
  const menu = await run(`return all('[data-sidebar=menu-button]').map((e) => (e.innerText || '').trim());`);
  check(`${name}: пункта нет, на странице «выключено на этом инстансе»`, !menu.includes('Подключённые клиенты') && t.includes('Подключение клиентов выключено на этом инстансе'), JSON.stringify(menu));
  check(`${name}: запросов к /v1/oauth/grants нет, ошибок в консоли нет`, (await counter('__grants_calls')) === 0 && (await errors()).length === 0, JSON.stringify(await errors()));
}
await reset();
await open('/clients');
check('включено: страница не зависит от проектов (администратор без участия)', (await run(`return Boolean(document.querySelector('h1'));`)) && !(await text()).includes('выключено на этом инстансе'));

console.log('AC-15: /login/cli без изменений');
await open('/login/cli');
t = await text();
check('/login/cli: «Вход clab» и поле кода', t.includes('Вход clab') && t.includes('Код'), t.slice(0, 200));
await reset();

console.log('ошибки страниц');
check('ошибок в консоли на последней странице нет', (await errors()).length === 0, JSON.stringify(await errors()));

s.close();
callback.close();
console.log(`\n${ok} из ${ok + fail} проверок прошли`);
process.exit(fail ? 1 : 0);
