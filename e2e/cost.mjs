import {session, helpers} from './driver.mjs';

// Экраны стоимости (CLAB-223, решение 0062): метрики, карточка эпика, панель
// этапа и бюджет команды. Деньги (API) и условная стоимость (подписка) —
// раздельно, «без учёта» — не ноль, пометка «без признака» — по данным.
//
// Сценарий заводит себе всё своё: команду, проект в ней (связка
// демонстрационного проекта переносится экспортом и активируется), эпик с
// двумя дочерними задачами и отчёты агентов с оплатой `api`, `subscription`
// и без признака. Прогон `missing` — агент забрал этап и отпустил без отчёта;
// `not_applicable` — этап, который никто не забирал. Демонстрационные данные
// не меняются, и сценарий повторяется на той же базе (ключи с отметкой
// времени). Каждое число на экране сверяется с ответом API стенда.
//
// Ответ метрик без `closed_cost` (бэкенд старше CLAB-220) и с пустым
// `closed_cost` стенд дать не может — они подменяются в браузере ответом
// одной ручки (addInitScript), как в audit.mjs. Идёт до workflow.mjs: тот
// активирует новую версию цикла демонстрационного проекта.
//
// SDLC_E2E_SHOTS=<каталог> — снимки экранов в обеих темах и на 390 px в PNG.
import {writeFileSync} from 'node:fs';

const C = await import('../src/components/cost.ts');

const BASE = process.env.SDLC_UI_URL ?? 'http://localhost:5173';
const API = process.env.SDLC_API_URL ?? 'http://localhost:8088';
const SHOTS = process.env.SDLC_E2E_SHOTS;
const api = async (method, path, body, actor = 'e2e') => {
  const res = await fetch(API + path, {
    method,
    headers: {'Content-Type': 'application/json', 'X-SDLC-Actor': actor},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return {ok: res.ok, status: res.status, body: text ? JSON.parse(text) : null};
};
const get = async (path) => (await api('GET', path)).body;
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};
const must = (res, what) => {
  if (!res.ok) throw new Error(`${what}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── данные ──────────────────────────────────────────────────────────────────
const stamp = Date.now().toString(36);
const TEAM = `cost-${stamp}`;
const TEAM_NAME = `Команда стоимости ${stamp}`;
const PK = `C${Date.now().toString().slice(-6)}`;
console.log(`команда ${TEAM}, проект ${PK}`);
must(await api('POST', '/v1/teams', {key: TEAM, name: TEAM_NAME}), 'команда');
must(await api('POST', '/v1/projects', {key: PK, name: `Стоимость ${stamp}`, team: TEAM}), 'проект');
// Связка демонстрационного проекта — роли и циклы; циклы приходят черновиками.
const bundle = must(await api('GET', '/v1/projects/SDLC/export'), 'экспорт связки');
must(await api('POST', `/v1/projects/${PK}/import`, bundle), 'импорт связки');
for (const w of must(await api('GET', `/v1/projects/${PK}/workflows`), 'циклы').workflows) {
  if (w.state === 'draft') must(await api('POST', `/v1/workflows/${w.id}/activate`, {}), `активация ${w.name}`);
}

const agent = (role) => `agent:${role}-bot`;
const claim = async (key, role) => must(await api('POST', `/v1/tasks/${key}/claim`, {role}, agent(role)), `захват ${key}/${role}`);
const release = (key, role) => api('POST', `/v1/tasks/${key}/release`, {note: 'сценарий стоимости'}, agent(role));
const report = async (key, role, body) =>
  must(await api('POST', `/v1/tasks/${key}/usage`, body, agent(role)), `отчёт ${key}`);
// Переход вперёд: гейты снимаются решением, апрув человека — «passed».
const advance = async (key, step) => {
  const list = (await get(`/v1/tasks/${key}/transitions`)).transitions;
  const t = list.find((x) => x.key === step);
  if (!t) throw new Error(`у ${key} нет перехода ${step}: ${list.map((x) => x.key)}`);
  for (const g of t.gates ?? []) {
    must(await api('POST', `/v1/tasks/${key}/transitions/${step}/gates/${g.gate_key}/decision`,
      {status: g.type === 'human_approval' ? 'passed' : 'waived'}), `гейт ${g.gate_key}`);
  }
  must(await api('POST', `/v1/tasks/${key}/transitions/${step}`, {}), `переход ${step}`);
};

const epic = must(await api('POST', `/v1/projects/${PK}/tasks`, {title: 'Стоимость: эпик сценария', type: 'epic'}), 'эпик');
const mk = async (title) =>
  must(await api('POST', `/v1/projects/${PK}/tasks`, {title, type: 'task', parent_key: epic.key}), title).key;
const C1 = await mk('Стоимость: учтённая задача');
const C2 = await mk('Стоимость: задача без учёта');
console.log(`эпик ${epic.key}, задачи ${C1}, ${C2}`);

// C1: аналитика — три вида оплаты, архитектура — отчёт без стоимости,
// разработка — подписка; ревью и тестирование никто не забирал.
await advance(C1, 'start');
await claim(C1, 'analyst');
await report(C1, 'analyst', {model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 200, cost_usd: 1.25, billing: 'api'});
await report(C1, 'analyst', {model: 'claude-sonnet-5-5', input_tokens: 500, output_tokens: 100, cost_usd: 0.4, billing: 'subscription'});
await report(C1, 'analyst', {model: 'claude-haiku-4-5', input_tokens: 300, output_tokens: 50, cost_usd: 0.5});
await release(C1, 'analyst');
await advance(C1, 'analysis_done');
await claim(C1, 'architect');
await report(C1, 'architect', {model: 'claude-opus-5-5', input_tokens: 40, output_tokens: 10});
await release(C1, 'architect');
await advance(C1, 'architecture_done');
await claim(C1, 'developer');
await report(C1, 'developer', {model: 'claude-sonnet-5-5', input_tokens: 9000, output_tokens: 2000, cost_usd: 3, billing: 'subscription'});
await release(C1, 'developer');
for (const step of ['dev_done', 'review_passed', 'qa_passed']) await advance(C1, step);
// C2: этап забран и отпущен без отчёта — прогон без учёта; задача закрыта.
await advance(C2, 'start');
await claim(C2, 'analyst');
await release(C2, 'analyst');
for (const step of ['analysis_done', 'architecture_done', 'dev_done', 'review_passed', 'qa_passed']) await advance(C2, step);
// Эпик: нарезку ведёт оркестратор — один отчёт деньгами; дети закрыты.
await advance(epic.key, 'start');
await claim(epic.key, 'orchestrator');
await report(epic.key, 'orchestrator', {model: 'claude-opus-5-5', input_tokens: 100, output_tokens: 20, cost_usd: 0.1, billing: 'api'});
await release(epic.key, 'orchestrator');
await advance(epic.key, 'breakdown_done');
await advance(epic.key, 'children_done');

const s = await session('about:blank');
const run = (body) => s.evaluate(helpers + body);
await s.resize(1280, 900);

// Подмена ответа метрик: closed_cost убирается или пустеет. Включается флагом
// в sessionStorage — один скрипт на все случаи.
const stub = await s.addInitScript(`
  const realFetch = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const mode = sessionStorage.getItem('e2e.closedCost');
    if (mode && /\\/metrics\\?/.test(url)) {
      const res = await realFetch(input, init);
      const body = await res.json();
      if (mode === 'absent') delete body.closed_cost; else body.closed_cost = [];
      return new Response(JSON.stringify(body), {status: 200, headers: {'Content-Type': 'application/json'}});
    }
    return realFetch(input, init);
  };
`);
const open = async (path) => {
  await s.goto(BASE + path);
  await wait(2200);
};
const norm = (t) => t.replace(/\s+/g, ' ').trim();

// ── метрики: разрезы по статусу, роли и модели ──────────────────────────────
console.log('метрики: стоимость по разрезам');
const metrics = await get(`/v1/projects/${PK}/metrics?period=30d`);
await open(`/p/${PK}/metrics`);
const tableRows = (title) => run(`
  const sec = all('section').find((x) => (x.querySelector('h2')?.innerText || '').trim() === ${JSON.stringify(title)});
  if (!sec) return null;
  return {
    description: (sec.querySelector('p')?.innerText || '').replace(/\\s+/g, ' ').trim(),
    text: sec.innerText.replace(/\\s+/g, ' ').trim(),
    rows: all('tr').filter((tr) => sec.contains(tr) && tr.closest('tbody')).map((tr) =>
      Array.from(tr.children).map((td) => (td.innerText || '').replace(/\\s+/g, ' ').trim())),
    headers: Array.from(sec.querySelectorAll('thead th')).map((th) => th.innerText.trim()),
  };
`);
const cost = await tableRows('Стоимость');
check('таблица стоимости на экране', cost && cost.rows.length === metrics.cost.length, `${cost?.rows.length} ≠ ${metrics.cost.length}`);
check('колонки: деньги и условно раздельно, без общей суммы',
  cost.headers.includes('Деньги (API)') && cost.headers.includes('Условно (подписка)') && cost.headers.includes('Без учёта')
  && !cost.headers.includes('Стоимость') && !cost.headers.includes('Без отчёта'), cost.headers.join('|'));
check('разрезы подписаны по-русски, не сырым dimension',
  cost.rows.every((r) => ['Статус', 'Роль', 'Модель'].includes(r[0])), JSON.stringify(cost.rows.map((r) => r[0])));
let mismatches = [];
for (const m of metrics.cost) {
  const row = cost.rows.find((r) => r[0] === C.dimensionLabel(m.dimension) && r[1] === (m.name || m.key));
  if (!row) { mismatches.push(`нет строки ${m.dimension}/${m.key}`); continue; }
  const [, , runs, silent, api$, sub$, avg$, tokens] = row;
  const known = m.reported_runs > 0;
  if (runs !== String(m.runs)) mismatches.push(`${m.key}: прогонов ${runs} ≠ ${m.runs}`);
  if (silent !== (m.dimension === 'model' ? '—' : `${m.silent_runs} из ${m.reported_runs + m.silent_runs}${m.silent_runs > 0 ? ' учёт неполный' : ''}`)) mismatches.push(`${m.key}: без учёта «${silent}»`);
  if (!api$.startsWith(known ? C.money(m.api_cost_usd) : '—')) mismatches.push(`${m.key}: деньги «${api$}» ≠ ${m.api_cost_usd}`);
  if (sub$ !== (known ? C.money(m.subscription_cost_usd) : '—')) mismatches.push(`${m.key}: условно «${sub$}» ≠ ${m.subscription_cost_usd}`);
  if (avg$ !== (known ? C.money(m.avg_cost_usd) : '—')) mismatches.push(`${m.key}: средняя «${avg$}» ≠ ${m.avg_cost_usd}`);
  if (tokens !== norm(m.tokens.toLocaleString('ru'))) mismatches.push(`${m.key}: токенов «${tokens}» ≠ ${m.tokens}`);
  const note = C.unspecifiedNote(m.unspecified_cost_usd);
  if (note ? !api$.includes(note) : api$.includes('без признака')) mismatches.push(`${m.key}: пометка «без признака» «${api$}»`);
}
check('каждая строка совпадает с GET /metrics (cost)', mismatches.length === 0, mismatches.join('; '));
const role = (key) => metrics.cost.find((m) => m.dimension === 'role' && m.key === key);
// Известные числа сценария: аналитик — 1.25 по API и 0.50 без признака,
// 0.40 подписки; разработчик — 3.00 подписки и ни копейки денег.
check('роль analyst: деньги 1.75, из них без признака 0.50, условно 0.40',
  role('analyst') && Math.abs(role('analyst').api_cost_usd - 1.75) < 1e-9 && Math.abs(role('analyst').unspecified_cost_usd - 0.5) < 1e-9
  && Math.abs(role('analyst').subscription_cost_usd - 0.4) < 1e-9, JSON.stringify(role('analyst')));
check('роль developer: деньги 0, условно 3.00 — разные величины',
  role('developer') && role('developer').api_cost_usd === 0 && Math.abs(role('developer').subscription_cost_usd - 3) < 1e-9, JSON.stringify(role('developer')));
const analystRow = cost.rows.find((r) => r[0] === 'Роль' && r[1] === (role('analyst')?.name || 'analyst'));
check('пометка «без признака» у строки с такой частью, подсказка в атрибуте',
  analystRow && analystRow[4].includes('из них без признака оплаты: 0.500 $'), JSON.stringify(analystRow));
const tooltip = await run(`const el = document.querySelector('[data-unspecified]'); return el ? el.getAttribute('title') : null;`);
check('подсказка: тип оплаты не указан, считается как API', tooltip === C.UNSPECIFIED_HINT, String(tooltip));
const models = cost.rows.filter((r) => r[0] === 'Модель');
check('разрез «Модель»: «без учёта» — «—», не ноль', models.length > 0 && models.every((r) => r[3] === '—'), JSON.stringify(models));
const modelHint = await run(`return all('[data-silent-cell]').some((el) => el.getAttribute('title') === ${JSON.stringify(C.MODEL_SILENT_HINT)});`);
check('у «—» подсказка: модель известна только из отчёта', modelHint);
const silentRole = metrics.cost.find((m) => m.dimension === 'role' && m.silent_runs > 0);
check('в сценарии есть прогон без учёта, и строка помечена «учёт неполный»',
  silentRole && cost.rows.some((r) => r[3].includes('учёт неполный')), JSON.stringify(silentRole));
check('подпись раздела: подписка не платится, учёт неполный — нижняя граница',
  cost.description.includes('Условно (подписка)') && cost.description.includes('нижняя граница'), cost.description);

// ── метрики: стоимость закрытой задачи ──────────────────────────────────────
console.log('метрики: стоимость закрытой задачи');
const closed = await tableRows('Стоимость закрытой задачи');
check('секция есть, подпись объясняет правила: done без отменённых, вся жизнь, поддерево, без итога',
  closed && closed.description.includes('без отменённых') && closed.description.includes('поддереву') && closed.description.includes('итого'), closed?.description);
check('в ответе API закрытые типы task и epic',
  metrics.closed_cost.map((x) => x.task_type).sort().join() === 'epic,task', JSON.stringify(metrics.closed_cost.map((x) => x.task_type)));
check('строка на тип', closed.rows.length === metrics.closed_cost.length, `${closed.rows.length}`);
mismatches = [];
for (const x of metrics.closed_cost) {
  const row = closed.rows.find((r) => r[0].startsWith(x.task_type));
  if (!row) { mismatches.push(`нет строки ${x.task_type}`); continue; }
  const [, closedTasks, api$, avgApi, medApi, sub$, avgSub, medSub, silent] = row;
  if (closedTasks !== String(x.closed_tasks)) mismatches.push(`${x.task_type}: закрыто ${closedTasks} ≠ ${x.closed_tasks}`);
  if (!api$.startsWith(C.money(x.api_cost_usd))) mismatches.push(`${x.task_type}: деньги «${api$}» ≠ ${x.api_cost_usd}`);
  if (avgApi !== C.money(x.avg_api_cost_usd)) mismatches.push(`${x.task_type}: среднее ${avgApi} ≠ ${x.avg_api_cost_usd}`);
  if (medApi !== C.money(x.median_api_cost_usd)) mismatches.push(`${x.task_type}: медиана ${medApi} ≠ ${x.median_api_cost_usd}`);
  if (sub$ !== C.money(x.subscription_cost_usd)) mismatches.push(`${x.task_type}: условно ${sub$} ≠ ${x.subscription_cost_usd}`);
  if (avgSub !== C.money(x.avg_subscription_cost_usd)) mismatches.push(`${x.task_type}: среднее условно ${avgSub}`);
  if (medSub !== C.money(x.median_subscription_cost_usd)) mismatches.push(`${x.task_type}: медиана условно ${medSub}`);
  if (silent !== C.closedSilentLine(x)) mismatches.push(`${x.task_type}: без учёта «${silent}» ≠ «${C.closedSilentLine(x)}»`);
  const note = C.incompleteNote(x);
  if (note ? !row[0].includes(note) : row[0].includes('неполных')) mismatches.push(`${x.task_type}: пометка неполных «${row[0]}»`);
  const part = C.unspecifiedNote(x.unspecified_cost_usd);
  if (part ? !api$.includes(part) : api$.includes('без признака')) mismatches.push(`${x.task_type}: без признака «${api$}»`);
}
check('каждая строка совпадает с GET /metrics (closed_cost)', mismatches.length === 0, mismatches.join('; '));
check('задачи с прогоном без учёта помечены: «неполных: N из M — стоимость занижена»',
  metrics.closed_cost.some((x) => x.incomplete_tasks > 0) && closed.rows.some((r) => /неполных: \d+ из \d+ — стоимость занижена/.test(r[0])), JSON.stringify(closed.rows.map((r) => r[0])));
check('ключей неполных задач на экране нет', !closed.text.includes(C1) && !closed.text.includes(C2));
check('строки «итого» нет', !closed.rows.some((r) => /итого/i.test(r[0])));

console.log('метрики: закрытых нет и поля нет');
await s.evaluate(`sessionStorage.setItem('e2e.closedCost', 'empty'); return true;`);
await open(`/p/${PK}/metrics`);
let t = await run('return texts();');
check('closed_cost: [] — «За период ни одна задача не закрыта»', t.includes('За период ни одна задача не закрыта'), t.slice(0, 300));
await s.evaluate(`sessionStorage.setItem('e2e.closedCost', 'absent'); return true;`);
await open(`/p/${PK}/metrics`);
t = await run('return texts();');
check('поля closed_cost нет — «раздел недоступен», страница на месте',
  t.includes('Раздел недоступен') && !t.includes('За период ни одна задача не закрыта') && t.includes('Стоимость') && t.includes('Дрейф') && t.includes('Деньги (API)'), t.slice(0, 400));
await s.evaluate(`sessionStorage.removeItem('e2e.closedCost'); return true;`);

// ── карточка эпика ──────────────────────────────────────────────────────────
console.log('карточка эпика: стоимость вместе с дочерними');
const usage = await get(`/v1/tasks/${epic.key}/usage`);
await open(`/p/${PK}/tasks/${epic.key}`);
const groups = () => run(`
  const where = (root) => Array.from(root.querySelectorAll('[data-usage-group]')).map((g) => ({
    name: g.getAttribute('data-usage-group'),
    lines: Array.from(g.querySelectorAll('[data-usage-line]')).map((l) => l.innerText.replace(/\\s+/g, ' ').trim()),
    note: (g.querySelector('[data-usage-unspecified]')?.innerText || '').replace(/\\s+/g, ' ').trim(),
  }));
  const overview = document.querySelector('[data-overview-block=usage]');
  const aside = Array.from(document.querySelectorAll('[data-usage-lines]')).find((el) => !overview.contains(el));
  return {
    overview: where(overview), aside: aside ? where(aside) : null,
    overviewText: overview.innerText.replace(/\\s+/g, ' ').trim(),
    asideText: aside ? aside.innerText.replace(/\\s+/g, ' ').trim() : null,
  };
`);
let g = await groups();
check('в обзоре «Своя» и «Вместе с дочерними»', g.overview.map((x) => x.name).join() === 'own,subtree', JSON.stringify(g.overview));
check('своя: деньги и условно — api_cost_usd и subscription_cost_usd',
  g.overview[0].lines.join('|') === `Деньги (API) ${C.money(usage.api_cost_usd)}|Условно (подписка) ${C.money(usage.subscription_cost_usd)}`, JSON.stringify(g.overview[0]));
check('поддерево: деньги и условно — subtree_api_cost_usd и subtree_subscription_cost_usd',
  g.overview[1].lines.join('|') === `Деньги (API) ${C.money(usage.subtree_api_cost_usd)}|Условно (подписка) ${C.money(usage.subtree_subscription_cost_usd)}`, JSON.stringify(g.overview[1]));
check('числа поддерева: деньги 1.85 (1.75 + 0.10), условно 3.40',
  Math.abs(usage.subtree_api_cost_usd - 1.85) < 1e-9 && Math.abs(usage.subtree_subscription_cost_usd - 3.4) < 1e-9, JSON.stringify(usage));
check('пометка «без признака» у поддерева',
  usage.subtree_unspecified_cost_usd > 0 && g.overview[1].note === C.unspecifiedNote(usage.subtree_unspecified_cost_usd), JSON.stringify(g.overview[1]));
check('у своей суммы без признака пометки нет', usage.unspecified_cost_usd === 0 && g.overview[0].note === '', JSON.stringify(g.overview[0]));
check('в правой панели те же числа', g.aside && JSON.stringify(g.aside) === JSON.stringify(g.overview), JSON.stringify(g.aside));
check('«Учёт неполный»: число прогонов без учёта (вместе с дочерними)',
  usage.silent_runs > 0 && g.overviewText.includes(`Учёт неполный: прогонов без учёта ${usage.silent_runs} (вместе с дочерними) — стоимость не меньше показанной`), g.overviewText);
check('общей суммы cost_usd как главной цифры нет',
  !g.overviewText.includes(C.money(usage.subtree_cost_usd)) || g.overview.some((x) => x.lines.some((l) => l.endsWith(C.money(usage.subtree_cost_usd)))), g.overviewText);
await open(`/p/${PK}/tasks/${C1}`);
g = await groups();
const u1 = await get(`/v1/tasks/${C1}/usage`);
check('у задачи без детей — только «Своя», и без строки неполного учёта',
  g.overview.map((x) => x.name).join() === 'own' && u1.silent_runs === 0 && !g.overviewText.includes('Учёт неполный'), g.overviewText);
check('деньги и условно задачи — из GET /tasks/{key}/usage',
  g.overview[0].lines.join('|') === `Деньги (API) ${C.money(u1.api_cost_usd)}|Условно (подписка) ${C.money(u1.subscription_cost_usd)}`, JSON.stringify(g.overview[0]));
check('пометка «без признака» у своей суммы', g.overview[0].note === C.unspecifiedNote(u1.unspecified_cost_usd) && g.overview[0].note !== '', JSON.stringify(g.overview[0]));

// ── панель этапа ────────────────────────────────────────────────────────────
console.log('панель этапа: прогоны по состоянию учёта');
const panel = async (key, stage) => {
  await open(`/p/${PK}/tasks/${key}?stage=${encodeURIComponent(stage)}`);
  return run(`
    const total = document.querySelector('[data-stage-total]');
    return {
      runs: all('[data-run-cost]').map((el) => ({state: el.getAttribute('data-run-cost'), text: el.innerText.replace(/\\s+/g, ' ').trim()})),
      silent: total ? total.getAttribute('data-stage-silent') : null,
      total: total ? total.innerText.replace(/\\s+/g, ' ').trim() : null,
    };
  `);
};
const runOf = async (key, status) => (await get(`/v1/tasks/${key}`)).stage_runs.find((r) => r.status_key === status);
const ru = await runOf(C1, 'analysis');
let p = await panel(C1, 'analysis');
check('прогон reported: деньги и условно по usage, тип оплаты',
  ru.usage.state === 'reported' && p.runs.length === 1 && p.runs[0].state === 'reported'
  && p.runs[0].text.includes(`Деньги (API) ${C.money(ru.usage.api_cost_usd)}`) && p.runs[0].text.includes(`Условно (подписка) ${C.money(ru.usage.subscription_cost_usd)}`)
  && p.runs[0].text.includes('оплата: API, подписка и без признака'), JSON.stringify([ru.usage, p]));
check('итог этапа — деньги и условно раздельно, пометка «без признака»',
  p.total.includes(`Деньги (API) ${C.money(ru.usage.api_cost_usd)}`) && p.total.includes('Условно (подписка)') && p.total.includes('из них без признака оплаты: 0.500 $') && p.silent === '0', JSON.stringify(p));
p = await panel(C1, 'architecture');
const ra = await runOf(C1, 'architecture');
check('отчёт без стоимости: «стоимость: нет данных», тип оплаты не показан, счётчик без учёта 0',
  ra.usage.state === 'reported' && ra.usage.cost_usd === null && p.runs[0].text.includes('стоимость: нет данных') && !p.runs[0].text.includes('оплата:') && p.silent === '0', JSON.stringify([ra.usage, p]));
check('значение null не выводится как 0.00 $', !p.runs[0].text.includes('0.00 $'), p.runs[0].text);
p = await panel(C1, 'code_review');
check('прогон не забирали: «учёт не ведётся», не «без учёта»; этап без счётчика без учёта',
  (await runOf(C1, 'code_review')).usage.state === 'not_applicable' && p.runs[0].state === 'not_applicable'
  && p.runs[0].text.includes('учёт не ведётся') && !p.runs[0].text.includes('без учёта') && p.silent === '0' && p.total.includes('учёт не ведётся'), JSON.stringify(p));
p = await panel(C2, 'analysis');
check('забран и отпущен без отчёта — «без учёта», счётчик 1',
  (await runOf(C2, 'analysis')).usage.state === 'missing' && p.runs[0].state === 'missing' && p.runs[0].text.includes('без учёта') && p.silent === '1'
  && p.total.includes('прогонов без учёта: 1'), JSON.stringify(p));
check('«без учёта» — не «нет данных» и не ноль', !p.runs[0].text.includes('нет данных') && !p.runs[0].text.includes('0.00 $'), p.runs[0].text);

// ── бюджет команды ──────────────────────────────────────────────────────────
console.log('бюджет команды');
await open('/teams');
await run(`await clickExact(${JSON.stringify(TEAM_NAME)}, 'p'); await sleep(900);`);
await run(`
  await fill("Предел, $", "2.5");
  await sleep(200);
  await clickIn("Поставить предел", "Сохранить");
  await sleep(1500);
`);
const budgets = (await get(`/v1/teams/${TEAM}/budgets`)).budgets;
const month = budgets.find((b) => b.period === 'month');
check('API: предел 2.5 в месяц, деньги 1.85, подписка 3.40',
  month && month.limit_usd === 2.5 && Math.abs(month.spent_usd - 1.85) < 1e-9 && Math.abs(month.subscription_usd - 3.4) < 1e-9, JSON.stringify(budgets));
const budget = await run(`
  const sec = all('section').find((x) => (x.querySelector('h2')?.innerText || '').trim() === 'Бюджет');
  const tr = sec && all('tr').find((r) => sec.contains(r) && r.closest('tbody'));
  return sec ? {
    description: (sec.querySelector('p')?.innerText || '').replace(/\\s+/g, ' ').trim(),
    headers: Array.from(sec.querySelectorAll('thead th')).map((th) => th.innerText.trim()),
    cells: tr ? Array.from(tr.children).map((td) => td.innerText.replace(/\\s+/g, ' ').trim()) : [],
    switches: sec.querySelectorAll('[role=switch], input[type=checkbox]').length,
  } : null;
`);
check('колонки: «Потрачено (деньги)» и «Условно (подписка)»',
  budget && budget.headers.includes('Потрачено (деньги)') && budget.headers.includes('Условно (подписка)') && !budget.headers.includes('Потрачено'), JSON.stringify(budget?.headers));
check('«Потрачено (деньги)» = spent_usd', budget.cells[2] === C.money(month.spent_usd), JSON.stringify(budget.cells));
check('«Условно (подписка)» = subscription_usd, подпись «информативно, в бюджет не входит»',
  budget.cells[3] === `${C.money(month.subscription_usd)} ${C.BUDGET_INFO_NOTE}`, JSON.stringify(budget.cells));
check('предел показан в том же формате', budget.cells[1] === C.money(2.5), JSON.stringify(budget.cells));
check('подписка больше предела, деньги меньше — «в пределах»', month.subscription_usd > month.limit_usd && month.spent_usd < month.limit_usd && budget.cells[4] === 'в пределах', JSON.stringify(budget.cells));
check('описание: расход — только деньги, подписка в предел не входит никогда',
  budget.description.includes('Расход — только деньги') && budget.description.includes('не входит никогда'), budget.description);
check('переключателя «считать подписку» нет', budget.switches === 0);

// ── темы и узкий экран ──────────────────────────────────────────────────────
console.log('темы и узкий экран');
const targets = [
  ['metrics', `/p/${PK}/metrics`, `all('section').find((x) => (x.querySelector('h2')?.innerText || '').trim() === 'Стоимость')`],
  ['epic', `/p/${PK}/tasks/${epic.key}`, `document.querySelector('[data-overview-block=usage]')`],
  ['stage', `/p/${PK}/tasks/${C1}?stage=analysis`, `document.querySelector('[data-stage-total]')`],
  ['budget', '/teams', `all('section').find((x) => (x.querySelector('h2')?.innerText || '').trim() === 'Бюджет')`],
];
const paint = (find) => `
  const el = ${find};
  const note = el.querySelector('[data-unspecified], .text-muted-foreground') || el;
  return {dark: document.documentElement.classList.contains('dark'), text: getComputedStyle(el).color,
    note: getComputedStyle(note).color, bg: getComputedStyle(document.body).backgroundColor};
`;
const visit = async (path) => {
  await open(path);
  if (path === '/teams') await run(`await clickExact(${JSON.stringify(TEAM_NAME)}, 'p'); await sleep(900);`);
};
for (const [name, path, find] of targets) {
  const themes = {};
  for (const theme of ['light', 'dark']) {
    await s.evaluate(`localStorage.setItem('sdlc.theme', '${theme}'); return true;`);
    await visit(path);
    themes[theme] = await run(paint(find));
    if (SHOTS) writeFileSync(`${SHOTS}/cost-${name}-${theme}.png`, Buffer.from(await s.screenshot(), 'base64'));
  }
  check(`${name}: тёмная тема включается, текст, пометка и фон меняются`,
    themes.dark.dark && !themes.light.dark && themes.light.text !== themes.dark.text && themes.light.note !== themes.dark.note && themes.light.bg !== themes.dark.bg, JSON.stringify(themes));
}
await s.evaluate(`localStorage.removeItem('sdlc.theme'); return true;`);
await s.resize(390, 800);
for (const [name, path] of targets) {
  await visit(path);
  const m = await run(`return {
    page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    tables: all('table').map((t) => ({scrolls: t.parentElement.scrollWidth > t.parentElement.clientWidth, wrapped: getComputedStyle(t.parentElement).overflowX})),
    clipped: all('[data-usage-lines] *, [data-stage-total] *').filter((e) => e.scrollWidth > e.clientWidth + 1).length,
  };`);
  check(`${name} на 390 px: страница по горизонтали не прокручивается`, m.page <= 0, JSON.stringify(m));
  check(`${name} на 390 px: таблицы прокручиваются сами, строки не обрезаны`,
    m.tables.every((x) => x.wrapped === 'auto') && m.clipped === 0, JSON.stringify(m));
  if (SHOTS) writeFileSync(`${SHOTS}/cost-${name}-390.png`, Buffer.from(await s.screenshot(), 'base64'));
}
await s.resize(1280, 900);
await s.removeInitScript(stub);

console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
