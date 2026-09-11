import {session, helpers} from './driver.mjs';

// Приём приглашения ссылкой (решение 0035). Бэкенд поднят в режиме header:
// второй человек — актор заголовка, его бэкенд заводит сам. Приглашения
// выдаются запросами к API от e2e — выдачу в интерфейсе проверяет её сценарий,
// здесь страница приёма: карточка, приём, отказы, квота и то, что токен не
// попадает в адреса запросов.
//
// Хэндлы и ключи организаций с суффиксом запуска: сценарий можно повторить на
// той же базе, не пересобирая её.
const BASE = process.env.SDLC_UI_URL ?? 'http://localhost:5173';
const API = process.env.SDLC_API_URL ?? 'http://localhost:8088';
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sfx = Date.now().toString(36).slice(-6);
const ISSUER = 'e2e';
const INVITEE = `e2e-invitee-${sfx}`;
const OTHER = `e2e-other-${sfx}`;

async function call(actor, method, path, body) {
  const res = await fetch(`${API}/v1${path}`, {
    method,
    headers: {'Content-Type': 'application/json', 'X-SDLC-Actor': actor},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return {status: res.status, body: text ? JSON.parse(text) : undefined};
}

async function issueProject(body) {
  const r = await call(ISSUER, 'POST', '/projects/SDLC/invites', body);
  if (r.status !== 201) throw new Error('выдача в проект: ' + JSON.stringify(r));
  return r.body;
}

async function issueTeam(actor, key, role) {
  const r = await call(actor, 'POST', `/teams/${key}/invites`, {role});
  if (r.status !== 201) throw new Error('выдача в организацию: ' + JSON.stringify(r));
  return r.body;
}

const lookup = async (actor, token) =>
  (await call(actor, 'POST', '/invites/lookup', {token})).body;

const memberOf = async (handle) => {
  const r = await call(ISSUER, 'GET', '/projects/SDLC/members');
  return (r.body.members ?? []).find((m) => m.handle === handle);
};

// Приглашения живут в базе, а люди — актор заголовка: он заводится первым
// запросом от своего имени.
for (const h of [INVITEE, OTHER]) await call(h, 'GET', '/auth/me');

const s = await session(BASE + '/projects');
const run = (body) => s.evaluate(helpers + body);
await sleep(1500);
const prevActor = await run(`return localStorage.getItem('sdlc.actor');`);

const as = (handle) => run(`
  localStorage.setItem('sdlc.actor', ${JSON.stringify(handle)});
  localStorage.removeItem('sdlc.token');
  return 1;
`);
const open = async (token) => {
  await s.goto(BASE + '/invite/' + encodeURIComponent(token));
  await sleep(1500);
};
const text = () => run('return texts().toLowerCase();');
const hasAccept = () => run(`return Boolean(all('button').find((b) => b.innerText.trim() === 'Принять'));`);
const path = () => run('return location.pathname + location.search;');
const noSidebar = () => run(`return document.querySelectorAll('[data-sidebar]').length === 0;`);

console.log('карточка приглашения в проект');
const project = await issueProject({level: 'agent', role_keys: ['developer'], days: 7});
const anyRoles = await issueProject({level: 'viewer'});
await as(INVITEE);
await open(project.token);
const seen = await lookup(INVITEE, project.token);
let t = await text();
check('вид «проект», название и ключ', t.includes('проект') && t.includes(seen.target_name.toLowerCase()) && t.includes('sdlc'), t.slice(0, 500));
check('выдавший, уровень, роли', t.includes(seen.created_by_handle) && t.includes(seen.level) && t.includes('developer'), t.slice(0, 500));
const expires = await run(`return document.querySelector('time')?.getAttribute('datetime');`);
check('срок совпадает с lookup', expires === seen.expires_at, `${expires} / ${seen.expires_at}`);
check('кнопка «Принять» есть', await hasAccept());
check('бокового меню нет (человек без проектов)', await noSidebar());

await open(anyRoles.token);
t = await text();
const anyLookup = await lookup(INVITEE, anyRoles.token);
check('role_keys: null — «любые»', anyLookup.role_keys === null && t.includes('любые'), JSON.stringify(anyLookup.role_keys) + ' ' + t.slice(0, 400));

console.log('приём в проект');
await open(project.token);
await run(`await clickExact('Принять'); await sleep(1500);`);
check('после приёма — доска проекта', (await path()) === '/p/SDLC/board', await path());
let member = await memberOf(INVITEE);
check('принявший в участниках с уровнем и ролями инвайта',
  member && member.role === 'agent' && JSON.stringify(member.role_keys) === '["developer"]', JSON.stringify(member));
const after = await lookup(INVITEE, project.token);
check('lookup: accepted и принявший', after.status === 'accepted' && after.accepted_by_handle === INVITEE, JSON.stringify(after));

// Документ тот же (переход внутри приложения), поэтому в журнале ресурсов
// лежат и просмотр, и приём.
const leaks = await run(`
  const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((u) => u.includes('/v1/'));
  const stored = [...Object.values(localStorage), ...Object.values(sessionStorage)].join(' ');
  return {
    calls: urls.filter((u) => u.includes('/invites/')).length,
    inUrl: urls.filter((u) => u.includes(${JSON.stringify(project.token)}) || u.includes('clab_inv_')),
    inStorage: stored.includes('clab_inv_'),
  };
`);
check('токена нет в адресах запросов к /v1/', leaks.calls >= 2 && leaks.inUrl.length === 0, JSON.stringify(leaks));
check('токена нет в localStorage и sessionStorage', !leaks.inStorage);

console.log('уже участник');
await open(anyRoles.token);
await run(`await clickExact('Принять'); await sleep(1500);`);
t = await text();
check('страница говорит «уже участник» и не уводит', t.includes('уже участник') && (await path()).startsWith('/invite/'), t.slice(0, 500));
member = await memberOf(INVITEE);
check('уровень и роли не изменились', member.role === 'agent' && JSON.stringify(member.role_keys) === '["developer"]', JSON.stringify(member));
check('приглашение принято', (await lookup(INVITEE, anyRoles.token)).status === 'accepted');
await run(`await clickExact('Открыть'); await sleep(1500);`);
check('«Открыть» ведёт в проект', (await path()) === '/p/SDLC/board', await path());

console.log('отказы');
await as(OTHER);
await open(project.token);
t = await text();
check('чужая принятая ссылка: «принято», кнопки нет', t.includes('уже принято') && !(await hasAccept()), t.slice(0, 500));
await as(INVITEE);
await open(project.token);
t = await text();
const link = await run(`return Boolean(document.querySelector('a[href="/p/SDLC"]'));`);
check('свою: «вы уже приняли» и ссылка на цель', t.includes('вы уже приняли') && link && !(await hasAccept()), t.slice(0, 500));
check('бокового меню нет и у участника проекта', await noSidebar());

const revoked = await issueProject({level: 'viewer'});
await call(ISSUER, 'DELETE', `/invites/${revoked.invite.id}`);
await as(OTHER);
await open(revoked.token);
t = await text();
check('отозванная: «отозвано», кнопки нет', t.includes('отозвано') && !(await hasAccept()), t.slice(0, 500));

for (const bad of ['clab_inv_nope', 'garbage']) {
  await open(bad);
  t = await text();
  check(`${bad}: «приглашение не найдено», кнопки нет`, t.includes('приглашение не найдено') && !(await hasAccept()), t.slice(0, 400));
}

const racing = await issueProject({level: 'viewer'});
await open(racing.token);
check('открытая карточка с кнопкой', await hasAccept());
await call(ISSUER, 'DELETE', `/invites/${racing.invite.id}`);
await run(`await clickExact('Принять'); await sleep(1500);`);
t = await text();
check('отзыв при открытой карточке: сообщение 409, кнопки нет', t.includes('приглашение отозвано') && t.includes('не получилось принять') && !(await hasAccept()), t.slice(0, 600));

console.log('приём в организацию');
const orgKey = `e2e-inv-${sfx}`;
await call(ISSUER, 'POST', '/teams', {key: orgKey, name: `Приглашающая ${sfx}`});
const teamInvite = await issueTeam(ISSUER, orgKey, 'member');
await as(INVITEE);
await open(teamInvite.token);
t = await text();
check('вид «организация», название и роль', t.includes('организация') && t.includes(`приглашающая ${sfx}`) && t.includes('участник'), t.slice(0, 500));
await run(`await clickExact('Принять'); await sleep(2500);`);
check('после приёма — /teams?team=<key>', (await path()) === `/teams?team=${orgKey}`, await path());
const pane = await run(`return (document.querySelector('aside + div')?.innerText || '').replace(/\\s+/g, ' ');`);
check('выбрана эта организация, принявший в составе', pane.includes(`Приглашающая ${sfx}`) && pane.includes(INVITEE), pane.slice(0, 600));
const team = await call(ISSUER, 'GET', `/teams/${orgKey}`);
check('в составе по API есть принявший', (team.body.members ?? []).some((m) => m.handle === INVITEE), JSON.stringify(team.body.members));

console.log('квота организации');
const LEAD = `e2e-org-${sfx}`, Q1 = `e2e-q1-${sfx}`, Q2 = `e2e-q2-${sfx}`, Q3 = `e2e-q3-${sfx}`;
for (const h of [LEAD, Q1, Q2, Q3]) await call(h, 'GET', '/auth/me');
const quotaKey = `e2e-quota-${sfx}`;
await call(LEAD, 'POST', '/teams', {key: quotaKey, name: `Квота ${sfx}`});
for (const h of [Q1, Q2]) await call(LEAD, 'PUT', `/teams/${quotaKey}/members`, {principal: h, role: 'member'});
const quotaInvite = await issueTeam(LEAD, quotaKey, 'member');
await as(Q3);
await open(quotaInvite.token);
check('бокового меню нет у человека без проектов', await noSidebar());
await run(`await clickExact('Принять'); await sleep(1500);`);
t = await text();
const retry = await run(`return Boolean(all('button').find((b) => b.innerText.trim() === 'Повторить'));`);
check('четвёртый: текст бэкенда с тарифом, пределом и числом, «Повторить»',
  t.includes('тариф') && t.includes('не больше 3') && t.includes('сейчас 3') && retry, t.slice(0, 600));
check('приглашение по-прежнему pending', (await lookup(Q3, quotaInvite.token)).status === 'pending');
await call(LEAD, 'DELETE', `/teams/${quotaKey}/members/${Q2}`);
await run(`await clickExact('Повторить'); await sleep(2500);`);
check('после освобождения места «Повторить» принимает', (await path()) === `/teams?team=${quotaKey}`, await path());

if (prevActor === null) await run(`localStorage.removeItem('sdlc.actor'); return 1;`);
else await as(prevActor);

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
