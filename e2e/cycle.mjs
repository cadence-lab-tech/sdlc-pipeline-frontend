import {session, helpers} from './driver.mjs';

// Схема цикла в карточке задачи и выбор этапа в адресе (CLAB-284). Сценарий
// заводит себе свою задачу и двигает её ручками API — старт, снятие гейтов,
// апрув, переход, возврат: так демонстрационные задачи остаются нетронутыми,
// а схема показывает то, что записал бэкенд стенда. Раскладка и правила
// состояния без браузера — в cycle-layout.mjs; здесь — экран: узлы и рёбра
// по версии задачи, состояния, выбор кликом и клавиатурой, адрес и «Назад»,
// панель выбранного этапа вместо списка прогонов, узкий экран и тёмная тема.
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

// ── данные ──────────────────────────────────────────────────────────────────
const created = await (await api('POST', '/v1/projects/SDLC/tasks', {
  title: 'Схема цикла: задача сценария',
  repositories: ['cadence-lab-tech/sdlc-pipeline-backend'],
})).json();
const KEY = created.key;
if (!KEY) throw new Error('задача не заведена: ' + JSON.stringify(created));
console.log(`задача сценария ${KEY}`);
let detail = await get(`/v1/tasks/${KEY}`);
const version = await get(`/v1/workflows/${detail.task.workflow_id}`);
const ordered = [...version.statuses].sort((a, b) => a.position - b.position);
const statusById = new Map(version.statuses.map((s) => [s.id, s]));
const initial = ordered.find((s) => s.is_initial) ?? ordered[0];
// Переходы вперёд из начального и следующего статусов — по данным версии,
// а не по ключам из головы.
const forwardFrom = (statusId) => version.transitions.find((t) => t.from_status_id === statusId && t.kind === 'advance');
const start = forwardFrom(initial.id);
const second = statusById.get(start.to_status_id);
const next = forwardFrom(second.id);
const third = statusById.get(next.to_status_id);
const back = version.transitions.find((t) => t.from_status_id === third.id && t.to_status_id === second.id && t.kind === 'reject');
const untouched = ordered.find((s) => ![initial.id, second.id, third.id].includes(s.id) && !s.is_terminal) ?? ordered.at(-1);
if (!back) throw new Error(`в версии нет возврата ${third.key} → ${second.key}`);

const transitionsOf = async () => (await get(`/v1/tasks/${KEY}/transitions`)).transitions;
const decide = (transition, gate, status) =>
  api('POST', `/v1/tasks/${KEY}/transitions/${transition}/gates/${gate}/decision`, {status});

const s = await session(BASE + `/p/SDLC/tasks/${KEY}`);
const run = (body) => s.evaluate(helpers + body);
const open = async (query = '') => {
  await s.goto(BASE + `/p/SDLC/tasks/${KEY}${query}`);
  await wait(1800);
};
await s.resize(1280, 900);
await open();

const NODES = `
  const nodes = () => all('[data-cycle-status]');
  const node = (key) => document.querySelector('[data-cycle-status="' + key + '"]');
  const describe = () => nodes().map((n) => ({
    key: n.getAttribute('data-cycle-status'),
    state: n.getAttribute('data-cycle-state'),
    attempts: n.getAttribute('data-cycle-attempts'),
    approval: n.getAttribute('data-cycle-approval'),
    label: n.getAttribute('aria-label'),
    current: n.getAttribute('aria-current'),
    role: n.getAttribute('role') || n.tagName.toLowerCase(),
    tabindex: n.getAttribute('tabindex'),
  }));
`;
const nodes = () => run(NODES + 'return describe();');
const runsShown = () => run(`return all('[data-stage-run]').map((el) => el.getAttribute('data-stage-run'));`);
const search = () => run('return location.search;');

// ── схема по версии задачи ──────────────────────────────────────────────────
console.log('схема по версии цикла задачи');
let shown = await nodes();
const root = await run(`
  const d = document.querySelector('[data-cycle-diagram]');
  return d ? {view: d.getAttribute('data-cycle-diagram'), version: d.getAttribute('data-cycle-version')} : null;
`);
check('схема над вкладками, кругом на широком экране', root?.view === 'ring', JSON.stringify(root));
check('версия схемы — версия задачи', root?.version === String(version.version), JSON.stringify(root));
check('все статусы версии в порядке position',
  shown.map((n) => n.key).join() === ordered.map((x) => x.key).join(), JSON.stringify(shown.map((n) => n.key)));
const above = await run(`
  const d = document.querySelector('[data-cycle-diagram]');
  const tabs = document.querySelector('[role=tablist]');
  return Boolean(d && tabs && d.getBoundingClientRect().bottom <= tabs.getBoundingClientRect().top);
`);
check('схема стоит над вкладками', above);
const edges = await run(`return {
  edges: all('[data-cycle-transition]').map((e) => ({key: e.getAttribute('data-cycle-transition'), kind: e.getAttribute('data-cycle-kind'), dash: e.querySelector('path').getAttribute('stroke-dasharray'), arrow: Boolean(e.querySelector('polygon'))})),
  entries: all('[data-cycle-entry]').map((e) => e.getAttribute('data-cycle-entry')),
};`);
const fromSome = version.transitions.filter((t) => t.from_status_id !== null);
const fromAny = version.transitions.filter((t) => t.from_status_id === null);
check('у каждого перехода ребро со стрелкой',
  edges.edges.length === fromSome.length && edges.edges.every((e) => e.arrow), JSON.stringify(edges.edges.map((e) => e.key)));
check('переход «из любого статуса» — одно обозначение, не ребро из каждого узла',
  edges.entries.length === fromAny.length && fromAny.every((t) => edges.entries.includes(t.key)), JSON.stringify(edges.entries));
check('возвраты пунктиром, движение вперёд — сплошной линией',
  edges.edges.every((e) => (e.kind === 'reject') === Boolean(e.dash)), JSON.stringify(edges.edges));

// Цвет статуса — данные проекта: он идёт в style узла, остальное — токены темы.
const colored = version.statuses.filter((x) => x.color);
if (colored.length) {
  const painted = await run(`return ${JSON.stringify(colored.map((x) => x.key))}.map((key) => {
    const rects = document.querySelector('[data-cycle-status="' + key + '"]').querySelectorAll('rect');
    return rects[rects.length - 1].style.stroke;
  });`);
  check('цвет статуса из данных — в style узла', painted.every(Boolean), JSON.stringify(painted));
} else {
  console.log('  - у статусов стенда нет цвета: style проверяет только раскладка');
}

console.log('опоры сквозных сценариев');
const props = await run(`return {
  stageRun: all('[data-cycle-diagram] [data-stage-run], [data-cycle-status][data-stage-run]').length,
  trigger: all('[data-cycle-status][data-slot=collapsible-trigger], [data-cycle-diagram] [data-slot=collapsible-trigger]').length,
};`);
check('у узлов нет data-stage-run и триггеров Collapsible', props.stageRun === 0 && props.trigger === 0, JSON.stringify(props));
check('узлы — кнопки, достижимые Tab', shown.every((n) => n.role === 'button' && n.tabindex === '0'), JSON.stringify(shown));

console.log('состояния: задача в начальном статусе');
check('текущий — начальный статус', shown.find((n) => n.key === initial.key)?.state === 'current', JSON.stringify(shown));
check('остальные впереди', shown.filter((n) => n.key !== initial.key).every((n) => n.state === 'future'));
check('у узла подпись: имя и состояние',
  shown.find((n) => n.key === initial.key)?.label === `${initial.name}, текущий статус`, shown[0]?.label);

console.log('состояния: этап сдаётся, держат гейты');
await api('POST', `/v1/tasks/${KEY}/transitions/${start.key}`, {});
await open();
shown = await nodes();
check('начальный пройден, второй текущий',
  shown.find((n) => n.key === initial.key)?.state === 'passed' && shown.find((n) => n.key === second.key)?.state === 'current',
  JSON.stringify(shown));
check('пока держит не только апрув — значка апрува нет', shown.every((n) => !n.approval), JSON.stringify(shown));

const gates = (await transitionsOf()).find((t) => t.key === next.key).gates;
const approvals = gates.filter((g) => g.type === 'human_approval');
for (const g of gates.filter((g) => g.type !== 'human_approval')) await decide(next.key, g.gate_key, 'waived');
await open();
shown = await nodes();
let cur = shown.find((n) => n.key === second.key);
if (approvals.length) {
  check('остался один апрув — «ждёт апрува» на текущем', cur?.approval === 'true' && cur.label.includes('ждёт апрува'), JSON.stringify(cur));
  check('в легенде сказано «ждёт апрува»', (await run('return texts();')).includes('ждёт апрува'));
  for (const g of approvals) await decide(next.key, g.gate_key, 'passed');
  await open();
  cur = (await nodes()).find((n) => n.key === second.key);
  check('апрув поставлен — значок ушёл', !cur?.approval, JSON.stringify(cur));
} else {
  console.log(`  - на переходе ${next.key} нет апрува: значок не проверяется`);
}

console.log('состояния: переход и возврат');
await api('POST', `/v1/tasks/${KEY}/transitions/${next.key}`, {});
for (const g of (await transitionsOf()).find((t) => t.key === back.key).gates) await decide(back.key, g.gate_key, 'waived');
await api('POST', `/v1/tasks/${KEY}/transitions/${back.key}`, {comment: 'возврат ради второй попытки'});
await open();
shown = await nodes();
cur = shown.find((n) => n.key === second.key);
check('после возврата текущий — снова второй', cur?.state === 'current', JSON.stringify(shown));
check('число попыток верхнего уровня', cur?.attempts === '2' && cur.label.includes('попыток: 2'), JSON.stringify(cur));
check('статус, с которого вернули, пройден', shown.find((n) => n.key === third.key)?.state === 'passed', JSON.stringify(shown));
detail = await get(`/v1/tasks/${KEY}`);
const topRuns = detail.stage_runs.filter((r) => !r.parent_run_id);

// ── выбор этапа ─────────────────────────────────────────────────────────────
console.log('выбор этапа: клик, Enter, Space');
// Лента выбранного этапа (CLAB-285, `timeline?status=`) запрашивается на
// каждый выбор — это её работа; карточка при этом не перезапрашивается.
const taskRequests = `return performance.getEntriesByType('resource').filter((e) => e.name.includes('/v1/tasks/${KEY}') && !e.name.includes('/audit') && !e.name.includes('/timeline?status=')).length;`;
const stageTimelineRequests = (key) => run(`return performance.getEntriesByType('resource').filter((e) => e.name.endsWith('/v1/tasks/${KEY}/timeline?status=' + encodeURIComponent(${JSON.stringify(key)}))).length;`);
const before = await run(taskRequests);
await run(NODES + `node(${JSON.stringify(third.key)}).dispatchEvent(new MouseEvent('click', {bubbles: true})); await sleep(500); return true;`);
check('клик ставит ?stage=', (await search()) === `?stage=${third.key}`, await search());
let picked = (await nodes()).filter((n) => n.current === 'true').map((n) => n.key);
check('выбранный узел помечен aria-current', picked.join() === third.key, JSON.stringify(picked));
let listed = await runsShown();
check('список показывает только прогоны статуса',
  listed.length === topRuns.filter((r) => r.status_key === third.key).length && listed.every((k) => k === third.key), JSON.stringify(listed));
check('панель этапа названа выбранным статусом',
  (await run(`return document.querySelector('[data-stage-panel] h2')?.innerText.trim() ?? '';`)) === third.name);
check('выбор не перезапрашивает карточку', (await run(taskRequests)) === before, `${before} → ${await run(taskRequests)}`);
check('выбор запрашивает ленту этого статуса', (await stageTimelineRequests(third.key)) === 1, String(await stageTimelineRequests(third.key)));

await run(NODES + `const n = node(${JSON.stringify(second.key)}); n.focus(); n.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true})); await sleep(500); return true;`);
check('Enter выбирает узел', (await search()) === `?stage=${second.key}`, await search());
listed = await runsShown();
check('у статуса с двумя попытками — обе', listed.length === 2 && listed.every((k) => k === second.key), JSON.stringify(listed));

await run(NODES + `const n = node(${JSON.stringify(untouched.key)}); n.focus(); n.dispatchEvent(new KeyboardEvent('keydown', {key: ' ', bubbles: true})); await sleep(500); return true;`);
check('Space выбирает узел', (await search()) === `?stage=${untouched.key}`, await search());
check('у статуса без прогонов — «этап ещё не начинался» вместо списка',
  (await runsShown()).length === 0 && (await run('return texts();')).includes('Этап ещё не начинался'));

await run(NODES + `node(${JSON.stringify(untouched.key)}).dispatchEvent(new MouseEvent('click', {bubbles: true})); await sleep(500); return true;`);
check('повторный выбор снимает параметр', (await search()) === '', await search());
check('без выбора список полный', (await runsShown()).length === topRuns.length, JSON.stringify(await runsShown()));
check('без выбора aria-current нет', (await nodes()).every((n) => !n.current));

console.log('«Назад» браузера');
await run('history.back(); await sleep(700); return true;');
check('«Назад» возвращает прежний выбор', (await search()) === `?stage=${untouched.key}`, await search());
await run('history.back(); await sleep(700); return true;');
check('ещё раз «Назад» — выбор до него', (await search()) === `?stage=${second.key}`, await search());
check('список следует за адресом', (await runsShown()).every((k) => k === second.key), JSON.stringify(await runsShown()));

console.log('ссылка с выбранным этапом');
await open(`?stage=${third.key}`);
picked = (await nodes()).filter((n) => n.current === 'true').map((n) => n.key);
check('по ссылке узел выбран сразу', picked.join() === third.key, JSON.stringify(picked));
check('и список отфильтрован', (await runsShown()).every((k) => k === third.key) && (await runsShown()).length > 0);
await open('?stage=нет-такого-статуса');
check('незнакомый ключ — список полный, без ошибки',
  (await runsShown()).length === topRuns.length && (await nodes()).every((n) => !n.current) &&
  !(await run('return texts();')).includes('Не получилось'), JSON.stringify(await runsShown()));

console.log('вкладки при выбранном статусе');
await open(`?stage=${second.key}`);
await run('await press("Лента"); return true;');
let t = await run('return texts();');
check('лента работает при выбранном статусе', t.includes('этап начат'), t.slice(0, 300));
await run('await press("Журнал"); await sleep(800); return true;');
t = await run('return texts();');
check('журнал работает при выбранном статусе', !t.includes('Не получилось'), t.slice(0, 300));
await run(NODES + `node(${JSON.stringify(third.key)}).dispatchEvent(new MouseEvent('click', {bubbles: true})); await sleep(600); return true;`);
check('выбор на другой вкладке открывает «Этапы и артефакты»',
  (await runsShown()).length > 0 && (await runsShown()).every((k) => k === third.key), JSON.stringify(await runsShown()));
const aside = await run(`
  const a = all('aside')[0];
  return a ? {first: a.querySelector('h2')?.innerText.trim(), text: a.innerText} : null;
`);
check('правая панель на месте при выборе', aside?.first === 'Действия' && aside.text.includes('Детали'), JSON.stringify(aside?.first));

console.log('фокус с клавиатуры');
// Tab настоящей клавишей: только так фокус становится :focus-visible и
// кольцо фокуса появляется. Проверяется в обеих темах.
const tabToNode = async () => {
  await run('document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); return true;');
  for (let i = 0; i < 40; i++) {
    await s.key('Tab', 'Tab', 9);
    const hit = await run(`
      const n = document.activeElement;
      if (!n || !n.hasAttribute('data-cycle-status')) return null;
      const ring = [...n.querySelectorAll('rect')].find((r) => r.getAttribute('stroke-width') === '3');
      return {key: n.getAttribute('data-cycle-status'), visible: n.matches(':focus-visible'), ring: ring ? getComputedStyle(ring).opacity : 'нет кольца'};
    `);
    if (hit) return hit;
  }
  return null;
};
// Тема задаётся явно: «системная» в headless-Chrome следует за системой машины.
await run(`localStorage.setItem('sdlc.theme', 'light'); return true;`);
await open();
const focusLight = await tabToNode();
check('узел достижим клавишей Tab', Boolean(focusLight), JSON.stringify(focusLight));
check('фокус виден в светлой теме', focusLight?.visible && focusLight.ring === '1', JSON.stringify(focusLight));
await s.key('Enter', 'Enter', 13);
check('Enter на узле в фокусе выбирает его', (await search()) === `?stage=${focusLight?.key}`, await search());
await run(`localStorage.setItem('sdlc.theme', 'dark'); return true;`);
await open();
const focusDark = await tabToNode();
await run(`localStorage.removeItem('sdlc.theme'); return true;`);
check('фокус виден в тёмной теме', focusDark?.visible && focusDark.ring === '1', JSON.stringify(focusDark));

// ── опрос живой аренды ──────────────────────────────────────────────────────
console.log('схема обновляется опросом карточки');
await api('POST', `/v1/tasks/${KEY}/claim`, {role: second.roles?.[0]?.role_key ?? 'analyst'}, 'agent:analyst-bot');
await open();
const leased = (await get(`/v1/tasks/${KEY}`)).stage_runs.some((r) => r.claimed_by_handle && !r.finished_at);
if (leased) {
  for (const g of (await transitionsOf()).find((x) => x.key === next.key).gates) await decide(next.key, g.gate_key, g.type === 'human_approval' ? 'passed' : 'waived');
  await api('POST', `/v1/tasks/${KEY}/transitions/${next.key}`, {});
  await wait(11500);
  shown = await nodes();
  check('без перезагрузки текущим стал следующий статус',
    shown.find((n) => n.key === third.key)?.state === 'current', JSON.stringify(shown));
} else {
  console.log('  - аренду взять не удалось: опрос не проверяется');
}

// ── узкий экран ─────────────────────────────────────────────────────────────
console.log('узкий экран: степпер');
await s.resize(390, 800);
await open();
const narrow = await run(NODES + `
  const d = document.querySelector('[data-cycle-diagram]');
  return {
    view: d && d.getAttribute('data-cycle-diagram'),
    keys: nodes().map((n) => n.getAttribute('data-cycle-status')),
    tags: [...new Set(nodes().map((n) => n.tagName.toLowerCase()))],
    scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
`);
check('на 390 px — линейный степпер', narrow.view === 'stepper', JSON.stringify(narrow));
check('в степпере те же узлы в том же порядке', narrow.keys.join() === ordered.map((x) => x.key).join(), JSON.stringify(narrow.keys));
check('узлы степпера — кнопки', narrow.tags.join() === 'button', JSON.stringify(narrow.tags));
check('горизонтальной прокрутки нет', narrow.scroll <= 0, JSON.stringify(narrow));
shown = await nodes();
check('в степпере те же состояния', shown.find((n) => n.key === third.key)?.state === 'current', JSON.stringify(shown));
await run(NODES + `node(${JSON.stringify(second.key)}).click(); await sleep(500); return true;`);
check('выбор в степпере ставит ?stage=', (await search()) === `?stage=${second.key}`, await search());
check('и помечает выбранный', (await nodes()).find((n) => n.key === second.key)?.current === 'true');
await s.resize(1280, 900);
await wait(500);
check('окно расширили — снова круг, выбор сохранён',
  (await run(`return document.querySelector('[data-cycle-diagram]').getAttribute('data-cycle-diagram');`)) === 'ring' &&
  (await nodes()).find((n) => n.key === second.key)?.current === 'true');

// ── тема ────────────────────────────────────────────────────────────────────
console.log('светлая и тёмная тема');
const paint = `
  const n = document.querySelector('[data-cycle-status][data-cycle-state=future]') || document.querySelector('[data-cycle-status]');
  const rects = n.querySelectorAll('rect');
  const body = rects[rects.length - 1];
  const text = n.querySelector('text');
  return {dark: document.documentElement.classList.contains('dark'), stroke: getComputedStyle(body).stroke, text: getComputedStyle(text).fill};
`;
await run(`localStorage.setItem('sdlc.theme', 'light'); return true;`);
await open();
const light = await run(paint);
await run(`localStorage.setItem('sdlc.theme', 'dark'); return true;`);
await open();
const dark = await run(paint);
await run(`localStorage.removeItem('sdlc.theme'); return true;`);
check('тёмная тема включилась', dark.dark && !light.dark, JSON.stringify({light, dark}));
check('рамки и подписи узлов меняются с темой', light.stroke !== dark.stroke && light.text !== dark.text, JSON.stringify({light, dark}));

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
