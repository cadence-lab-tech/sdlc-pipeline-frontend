// Интерфейс на выделенном инстансе компании (SDLC_TENANCY=single, CLAB-88 и
// CLAB-89): ни личных аккаунтов, ни организаций по кнопке, ни тарифов.
//
// В общий прогон (run.sh) сценарий не входит: тот идёт в shared и в режиме
// header, а этому нужен свой стенд — профиль single и режим токенов, иначе
// права не проверяются и «человека без команды» не бывает:
//
//   SDLC_TENANCY=single SDLC_AUTH_MODE=token SDLC_ADMIN_TOKEN=<секрет> — api
//   SDLC_ADMIN_TOKEN=<тот же секрет> node e2e/single.mjs
//
// База — свежая: сценарий заводит команду e2e-crew и проект E2ES. Человека
// заранее не завести (решение 0033), а входа через провайдера у стенда нет,
// поэтому «пришедший без команды» и «лид команды» — агенты с токенами от
// администратора: интерфейс ветвится по профилю и составу, а не по виду
// принципала.
import {session, helpers} from './driver.mjs';

const BASE = process.env.SDLC_UI_URL ?? 'http://localhost:5173';
const API = process.env.SDLC_API_URL ?? 'http://localhost:8088';
const ADMIN = process.env.SDLC_ADMIN_TOKEN;
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

const instance = await (await fetch(API + '/v1/instance')).json();
if (instance.tenancy !== 'single') {
  console.error(`стенд в профиле ${instance.tenancy}, а сценарию нужен single`);
  process.exit(2);
}
const issue = async (who) => (await api('POST', '/auth/tokens', ADMIN, {principal: who, name: 'e2e-single'})).token;
const newbie = await issue('agent:e2e-newbie');
const lead = await issue('agent:e2e-lead');

const s = await session(BASE + '/login');
// Ошибки страницы собираются с самого начала документа: карточка команды
// раньше падала на отсутствующем plan, и это видно только в консоли.
await s.addInitScript(`(() => {
  window.__errors = [];
  addEventListener('error', (e) => window.__errors.push(String(e.message)));
  addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason)));
  const orig = console.error.bind(console);
  console.error = (...args) => { window.__errors.push(args.map(String).join(' ')); orig(...args); };
})();`);
const run = (body) => s.evaluate(helpers + body);
await s.resize(1360, 900);

const as = async (token, path) => {
  await s.goto(BASE + '/login');
  await run(`localStorage.setItem('sdlc.token', ${JSON.stringify(token)}); return 1;`);
  await s.goto(BASE + path);
  await sleep(1500);
};
const text = () => run('return texts();');
const buttons = () => run(`return all('button').map((b) => (b.innerText || '').trim()).filter(Boolean);`);
const errors = () => run('return window.__errors || [];');
const hint = (t) => /приглашени/i.test(t) && /администратор/i.test(t);

console.log('К3, К7, К8: пришедший без команды');
await as(newbie, '/projects');
let t = await text();
check('К8: «Проектов пока нет» с подсказкой про приглашение и администратора', t.includes('Проектов пока нет') && hint(t), t.slice(0, 500));
check('К8: кнопки «Новый проект» нет', !(await buttons()).includes('Новый проект'));
await s.goto(BASE + '/teams');
await sleep(1500);
t = await text();
let b = await buttons();
check('К3: нет «Завести организацию» и «Завести команду»', !b.includes('Завести организацию') && !b.includes('Завести команду'), JSON.stringify(b));
check('К7: «Команд нет» с подсказкой про приглашение и администратора', t.includes('Команд нет') && hint(t), t.slice(0, 500));

console.log('К10: администратор без команды заводит проект');
await as(ADMIN, '/projects');
await run('await clickExact("Новый проект"); return 1;');
await run('await fill("Ключ", "E2EX"); await fill("Название", "Без команды"); return 1;');
t = await text();
check('форма говорит, что проект заводится в команде и где её завести', t.includes('Нужна команда') && t.includes('Проект заводится в команде') && t.includes('«Команды»'), t.slice(0, 800));
let disabled = await run(`return all('button').find((x) => x.innerText.trim() === 'Создать проект')?.disabled;`);
check('«Создать проект» выключена', disabled === true, String(disabled));
check('«Личного аккаунта» в форме нет', !t.includes('Личный аккаунт'));

console.log('К4–К6: администратор заводит команду');
await s.goto(BASE + '/teams');
await sleep(1500);
b = await buttons();
check('К4: «Завести команду» есть, «Завести организацию» нет', b.includes('Завести команду') && !b.includes('Завести организацию'), JSON.stringify(b));
t = await text();
check('К5: в списке нет групп «Личный аккаунт / Организации»', !/Личный аккаунт|Личные аккаунты|Организации/.test(t), t.slice(0, 600));
await run('await clickExact("Завести команду"); return 1;');
t = await text();
check('К4: форма «Новая команда»', t.includes('Новая команда'), t.slice(0, 400));
check('К4: в форме нет «тариф», «бесплатн», «Личный аккаунт»', !/тариф|бесплатн|Личный аккаунт/i.test(t), t.slice(0, 600));
const hasSwitch = await run(`return Boolean(all('label').find((l) => l.innerText.trim() === 'Может заводить проекты'));`);
check('К4: переключатель «Может заводить проекты» есть', hasSwitch);
await run(`
  await fill("Ключ", "e2e-crew");
  await fill("Название", "E2E Crew");
  const lbl = all('label').find((l) => l.innerText.trim() === 'Может заводить проекты');
  document.getElementById(lbl.getAttribute('for')).click();
  await sleep(300);
  await clickExact("Завести");
  await sleep(1500);
  return 1;
`);
const crew = await api('GET', '/teams/e2e-crew', ADMIN);
check('К4: команда заведена с правом на проекты', crew.team.key === 'e2e-crew' && crew.team.can_create_projects === true, JSON.stringify(crew.team));
t = await text();
check('К4: карточка открыта справа', t.includes('E2E Crew') && t.includes('Состав'), t.slice(0, 400));

const card = await run(`
  const h1 = all('h1').find((h) => h.innerText.trim() === 'E2E Crew');
  const head = h1 && h1.parentElement;
  return {
    labels: head ? head.innerText.replace(/\\s+/g, ' ') : '',
    sections: all('section').map((x) => x.getAttribute('aria-label') || '').filter(Boolean),
    headings: all('h2, h3').map((h) => h.innerText.trim()),
  };
`);
check('К6: нет метки «личный аккаунт» или «организация»', !/личный аккаунт|организация/i.test(card.labels), card.labels);
t = await text();
check('К6: нет раздела «Тариф» и «Превратить в организацию»', !card.headings.includes('Тариф') && !t.includes('Превратить в организацию'), JSON.stringify(card.headings));
for (const name of ['Состав', 'Доступ в проекты', 'GitHub', 'Группы провайдера', 'Бюджет', 'Опасная зона']) {
  check(`К6: раздел «${name}» на месте`, card.headings.includes(name) || card.sections.includes(name), JSON.stringify(card.headings));
}
// Команда, оставшаяся без plan в ответе, — та же карточка: открывается
// демонстрационная команда сида.
await run(`
  const row = all('aside li button').find((x) => x.innerText.split('\\n').map((l) => l.trim()).includes('sdlc'));
  if (!row) throw new Error('команды сида sdlc в списке нет');
  row.click();
  await sleep(1500);
  return 1;
`);
t = await text();
check('К6: карточка команды сида открылась', t.includes('Опасная зона') && !t.includes('Тариф'), t.slice(0, 400));
const errs = await errors();
check('К6: ошибок в консоли нет', errs.length === 0, JSON.stringify(errs).slice(0, 400));

console.log('К9: лид команды заводит проект');
await api('PUT', '/teams/e2e-crew/members', ADMIN, {principal: 'agent:e2e-lead', role: 'lead'});
await as(lead, '/projects');
await run('await clickExact("Новый проект"); return 1;');
const field = await run(`
  const lbl = all('label').find((l) => l.innerText.trim().startsWith('Команда'));
  const trigger = lbl && document.getElementById(lbl.getAttribute('for'));
  return {label: lbl ? lbl.innerText.replace(/\\s+/g, ' ').trim() : '', value: trigger ? trigger.innerText.trim() : ''};
`);
check('поле «Команда» обязательное', field.label === 'Команда *', JSON.stringify(field));
check('единственная команда выбрана сразу', field.value === 'e2e-crew', JSON.stringify(field));
t = await text();
check('ни варианта, ни плейсхолдера «Личный аккаунт»', !t.includes('Личный аккаунт'), t.slice(0, 600));
await run('await fill("Ключ", "E2ES"); await fill("Название", "Single E2E"); await clickExact("Создать проект"); await sleep(1500); return 1;');
t = await text();
check('проект заведён без отказа', t.includes('Single E2E') && !t.includes('без команды') && !t.includes('укажите команду'), t.slice(0, 600));
const created = (await api('GET', '/projects', ADMIN)).projects.find((p) => p.key === 'E2ES');
check('владелец проекта — e2e-crew', created?.owner_team_key === 'e2e-crew', JSON.stringify(created));

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
