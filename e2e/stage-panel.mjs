// Правила панели выбранного этапа (CLAB-285) — без браузера: попытки и
// перепроверки, роль с версией, возвраты с обеих сторон, стоимость прогона и
// итог этапа, этап, который ещё не начинался, уровень этапа в запросе. Модуль
// правил — чистые функции (src/components/task/stagePanel.ts), поэтому
// проверяется прямо в исходниках, как раскладка схемы в cycle-layout.mjs.
// Здесь же — поиск ключей статусов и ролей в модулях панели (C-11).
//
// Ключи статусов в данных ниже нарочно не похожи на ключи наших циклов:
// правила не должны о них знать.
import {readFileSync, readdirSync} from 'node:fs';
import {registerHooks} from 'node:module';

// Модули интерфейса импортируют друг друга без расширения (так требует
// сборка); node без расширения файл не найдёт — подставляем .ts.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(specifier + '.ts', context);
      throw err;
    }
  },
});

const P = await import('../src/components/task/stagePanel.ts');

let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};

// ── данные ──────────────────────────────────────────────────────────────────
const statuses = [
  {id: 's-a', key: 'Alpha', name: 'Сбор', position: 10, roles: [{role_id: 'r1', role_key: 'scribe', role_name: 'Писарь', is_primary: true, position: 1}]},
  {id: 's-b', key: 'beta-2', name: 'Сборка', position: 20, roles: [
    {role_id: 'r3', role_key: 'helper', role_name: 'Помощник', is_primary: false, position: 2},
    {role_id: 'r2', role_key: 'smith', role_name: 'Кузнец', is_primary: true, position: 1},
  ]},
  {id: 's-c', key: 'gamma', name: 'Проба', position: 30, roles: []},
  {id: 's-d', key: 'omega', name: 'Готово', position: 40, is_terminal: true},
];
const workflow = {
  statuses,
  transitions: [
    {id: 't1', key: 'go', name: 'Дальше', from_status_id: 's-a', to_status_id: 's-b', kind: 'advance', position: 1, gates: [
      {id: 'g2', key: 'ok', name: 'Апрув', type: 'human_approval', position: 2},
      {id: 'g1', key: 'docs', name: 'Артефакты', type: 'artifacts_required', position: 1},
    ]},
    {id: 't2', key: 'back', name: 'Назад', from_status_id: 's-b', to_status_id: 's-a', kind: 'reject', position: 3},
    {id: 't3', key: 'fwd', name: 'Проверка', from_status_id: 's-b', to_status_id: 's-c', kind: 'advance', position: 2},
    {id: 't4', key: 'drop', name: 'Отмена', from_status_id: null, to_status_id: 's-d', kind: 'cancel', position: 9},
  ],
};
// Учёт прогона (CLAB-219, решение 0062): деньги и условная стоимость
// раздельно, состояние учёта — от сервера. cost — деньги по API, sub —
// условная стоимость; null — строк такого вида нет.
const usage = (cost, input, output, {sub = null, unspecified = null, models = ['m-1'], state = 'reported'} = {}) => ({
  reported: true, state, reports: 1, models, input_tokens: input, output_tokens: output,
  cache_read_tokens: null, cache_write_tokens: null,
  cost_usd: cost === null && sub === null ? null : (cost ?? 0) + (sub ?? 0), duration_ms: null,
  api_cost_usd: cost, unspecified_cost_usd: unspecified, subscription_cost_usd: sub,
});
const noUsage = (state) => ({reported: false, state, reports: 0, models: [], input_tokens: null, output_tokens: null,
  cache_read_tokens: null, cache_write_tokens: null, cost_usd: null, duration_ms: null,
  api_cost_usd: null, unspecified_cost_usd: null, subscription_cost_usd: null});
const silent = noUsage('missing');
const run = (id, status_key, entered_at, extra = {}) => ({
  id, status_key, entered_at, attempt: 1, state: 'passed', gate_results: [], exit: null, ...extra,
});
const runs = [
  run('a1', 'Alpha', '2026-10-01T10:00:00Z', {role_key: 'scribe', role_version: 3, usage: usage(0.5, 100, 50),
    exit: {kind: 'advanced', transition: 'go', to_status: 'beta-2', comment: null, by_handle: 'ann', at: '2026-10-01T11:00:00Z'}}),
  run('b1', 'beta-2', '2026-10-01T11:00:00Z', {role_key: 'smith', role_version: 7, usage: usage(1.25, 1000, 200),
    exit: {kind: 'rejected', transition: 'back', to_status: 'Alpha', comment: 'нет схемы', by_handle: 'bob', at: '2026-10-01T12:00:00Z'}}),
  run('b1-r', 'beta-2', '2026-10-01T11:30:00Z', {parent_run_id: 'b1', kind: 'review', role_key: 'judge', role_version: 1, usage: silent}),
  run('b1-r0', 'beta-2', '2026-10-01T11:10:00Z', {parent_run_id: 'b1', kind: 'review', role_key: 'judge', role_version: null, usage: noUsage('not_applicable')}),
  run('a2', 'Alpha', '2026-10-01T12:00:00Z', {role_key: 'scribe', role_version: 4, rejected_from_run_id: 'b1', state: 'in_progress', usage: silent}),
  run('b0', 'beta-2', '2026-09-30T09:00:00Z', {role_key: 'smith', exit: {kind: 'rejected', transition: 'back', to_status: 'Alpha', comment: null, by_handle: null, at: '2026-09-30T10:00:00Z'}}),
  run('a0', 'Alpha', '2026-09-30T10:00:00Z', {rejected_from_run_id: 'нет-такого'}),
];
const art = (id, stage_run_id, kind, extra = {}) => ({id, stage_run_id, kind, title: `т-${id}`, created_at: '2026-10-01T11:50:00Z', version: 1, ...extra});
const artifacts = [
  art('x1', 'b1', 'problem.report', {version: 1, created_at: '2026-10-01T11:40:00Z'}),
  art('x2', 'b1', 'problem.report', {version: 2, supersedes_id: 'x1', created_at: '2026-10-01T11:55:00Z'}),
  art('x3', 'b1', 'dev.change_summary'),
  art('x4', 'b1-r', 'review.verdict'),
];

// ── попытки ─────────────────────────────────────────────────────────────────
console.log('попытки статуса');
const beta = P.stageAttempts(runs, 'beta-2');
check('только верхний уровень статуса', beta.map((a) => a.run.id).join() === 'b1,b0', beta.map((a) => a.run.id).join());
check('новые сверху', P.stageAttempts(runs, 'Alpha').map((a) => a.run.id).join() === 'a2,a1,a0');
check('перепроверки — внутри своей попытки, по времени входа', beta[0].reviews.map((r) => r.id).join() === 'b1-r0,b1-r', beta[0].reviews.map((r) => r.id).join());
check('у попытки без перепроверок — пусто', beta[1].reviews.length === 0);
check('перепроверка попыткой не считается', !P.stageAttempts(runs, 'beta-2').some((a) => a.run.parent_run_id));
check('ключ сравнивается с учётом регистра', P.stageAttempts(runs, 'alpha').length === 0);
check('статус без прогонов — пусто', P.stageAttempts(runs, 'gamma').length === 0);

console.log('роль с версией');
check('«smith v7»', P.roleWithVersion(runs[1]) === 'smith v7', P.roleWithVersion(runs[1]));
check('версии нет — только ключ', P.roleWithVersion({role_key: 'smith', role_version: null}) === 'smith');
check('бэкенд без поля — только ключ', P.roleWithVersion({role_key: 'smith'}) === 'smith');
check('роли нет — пусто', P.roleWithVersion({}) === '');

// ── стоимость ───────────────────────────────────────────────────────────────
console.log('стоимость прогона');
check('с отчётом — деньги и токены', P.runCostLine(runs[1]) === `Деньги (API) 1.25 $ · токенов ${(1200).toLocaleString('ru')} · оплата: API`, P.runCostLine(runs[1]));
check('без учёта — «без учёта», не ноль и не «нет данных»', P.runCostLine({usage: silent}) === 'без учёта', P.runCostLine({usage: silent}));
check('агент не работал — «учёт не ведётся»', P.runCostLine({usage: noUsage('not_applicable')}).startsWith('учёт не ведётся'), P.runCostLine({usage: noUsage('not_applicable')}));
check('без объекта usage — как без отчёта', P.runCostLine({}) === 'без учёта', P.runCostLine({}));
check('сервер без state: отчёт есть — учтён, нет — без учёта',
  P.runCostLine({usage: {...usage(0.1, 1, 1), state: undefined}}).startsWith('Деньги (API) 0.100 $')
  && P.runCostLine({usage: {...silent, state: undefined}}) === 'без учёта');
check('отчёт без суммы — «стоимость: нет данных», типа оплаты нет',
  P.runCostLine({usage: usage(null, 1, 1)}) === `стоимость: нет данных · токенов 2`, P.runCostLine({usage: usage(null, 1, 1)}));
check('отчёт без токенов — «токенов: нет данных»',
  P.runCostLine({usage: usage(0.1, null, null)}).includes('токенов: нет данных'), P.runCostLine({usage: usage(0.1, null, null)}));
check('подписка — условная стоимость, денег нет',
  P.runCostLine({usage: usage(null, 1, 1, {sub: 2})}) === 'Условно (подписка) 2.00 $ · токенов 2 · оплата: подписка', P.runCostLine({usage: usage(null, 1, 1, {sub: 2})}));
check('API и подписка — обе суммы раздельно',
  P.runCostLine({usage: usage(0.5, 1, 1, {sub: 2})}) === 'Деньги (API) 0.500 $ · Условно (подписка) 2.00 $ · токенов 2 · оплата: API и подписка',
  P.runCostLine({usage: usage(0.5, 1, 1, {sub: 2})}));
check('часть без признака — «API и без признака»',
  P.runCostLine({usage: usage(1, 1, 1, {unspecified: 0.4})}).endsWith('оплата: API и без признака'), P.runCostLine({usage: usage(1, 1, 1, {unspecified: 0.4})}));
check('деньги целиком без признака — только «без признака»',
  P.runCostLine({usage: usage(1, 1, 1, {unspecified: 1})}).endsWith('оплата: без признака'), P.runCostLine({usage: usage(1, 1, 1, {unspecified: 1})}));
check('сообщённый ноль — «0.00 $», не «нет данных»',
  P.runCostLine({usage: usage(0, 1, 1)}).startsWith('Деньги (API) 0.00 $'), P.runCostLine({usage: usage(0, 1, 1)}));

console.log('итог этапа');
let total = P.stageTotal(beta);
check('сумма отчитавшихся: попытки и перепроверки', Math.abs(total.api_usd - 1.25) < 1e-9 && total.subscription_usd === null && total.tokens === 1200, JSON.stringify(total));
check('прогоны без учёта посчитаны отдельно', total.reported === 1 && total.silent === 2 && total.not_applicable === 1, JSON.stringify(total));
check('строка итога', P.stageTotalLine(total) === `стоимость этапа Деньги (API) 1.25 $ · токенов ${(1200).toLocaleString('ru')}`, P.stageTotalLine(total));
total = P.stageTotal(P.stageAttempts(runs, 'Alpha'));
check('Alpha: 0.500 $, без учёта два (прогон без usage — как без отчёта)', Math.abs(total.api_usd - 0.5) < 1e-9 && total.silent === 2, JSON.stringify(total));
const none = P.stageTotal([{run: {usage: silent}, reviews: []}]);
check('никто не отчитался — «без учёта», а не 0.00 $', P.stageTotalLine(none) === 'стоимость этапа: без учёта', P.stageTotalLine(none));
const idle = P.stageTotal([{run: {usage: noUsage('not_applicable')}, reviews: []}]);
check('этап из одного not_applicable: без учёта нет, «учёт не ведётся»',
  idle.silent === 0 && idle.not_applicable === 1 && P.stageTotalLine(idle).startsWith('стоимость этапа: учёт не ведётся'), JSON.stringify(idle));
const unknown = P.stageTotal([{run: {usage: usage(null, null, null)}, reviews: []}]);
check('отчёт без суммы — «нет данных», счётчик без учёта не растёт',
  unknown.silent === 0 && unknown.reported === 1 && P.stageTotalLine(unknown).startsWith('стоимость этапа нет данных'), P.stageTotalLine(unknown));
const mixed = P.stageTotal([
  {run: {usage: usage(1, 10, 5, {unspecified: 0.25})}, reviews: [{usage: usage(0.5, 1, 1, {sub: 3})}, {usage: usage(null, 1, 1, {sub: 4})}]},
  {run: {usage: silent}, reviews: []},
]);
check('деньги и условная — раздельно, без признака отдельно',
  Math.abs(mixed.api_usd - 1.5) < 1e-9 && Math.abs(mixed.subscription_usd - 7) < 1e-9 && mixed.unspecified_usd === 0.25 && mixed.silent === 1 && mixed.reported === 3, JSON.stringify(mixed));
check('строка итога с обеими суммами',
  P.stageTotalLine(mixed).startsWith('стоимость этапа Деньги (API) 1.50 $ · Условно (подписка) 7.00 $ · токенов'), P.stageTotalLine(mixed));

// ── возвраты ────────────────────────────────────────────────────────────────
console.log('возвраты с обеих сторон');
let note = P.returnedTo(runs[1], artifacts, statuses);
check('«вернула в» с именем статуса из версии', note?.text === 'вернула в «Сбор»', JSON.stringify(note));
check('комментарий перехода', note?.comment === 'нет схемы');
check('описание проблемы — последняя версия, заменённая не берётся', note?.problemReport?.id === 'x2', JSON.stringify(note?.problemReport));
check('ссылка на статус, куда вернули', note?.statusKey === 'Alpha' && note?.statusName === 'Сбор');
note = P.returnedTo(runs[5], artifacts, statuses);
check('без комментария — строка без текста', note?.text === 'вернула в «Сбор»' && note.comment === null, JSON.stringify(note));
check('без problem.report — без ссылки', note && note.problemReport === undefined);
check('ушедшая вперёд попытка — не возврат', P.returnedTo(runs[0], artifacts, statuses) === null);
check('идущая попытка — не возврат', P.returnedTo(runs[4], artifacts, statuses) === null);

note = P.returnedFrom(runs[4], runs, artifacts, statuses);
check('«вернулась с» с именем статуса', note?.text === 'вернулась с «Сборка»', JSON.stringify(note));
check('тот же комментарий', note?.comment === 'нет схемы');
check('описание проблемы того прогона', note?.problemReport?.id === 'x2');
check('ссылка на статус, откуда вернули', note?.statusKey === 'beta-2');
note = P.returnedFrom(runs[6], runs, artifacts, statuses);
check('прогон, из которого вернули, не найден — без имени и без ошибки',
  note?.text === 'вернулась с предыдущего этапа' && note.comment === null && !note.statusKey, JSON.stringify(note));
check('попытка не после возврата — без строки', P.returnedFrom(runs[0], runs, artifacts, statuses) === null);
check('незнакомый статус — ключом', P.returnedTo({...runs[1], exit: {...runs[1].exit, to_status: 'zeta'}}, [], statuses)?.text === 'вернула в «zeta»');

console.log('исход попытки');
check('вперёд', P.exitLabel(runs[0].exit, statuses) === 'ушла в «Сборка» переходом go', P.exitLabel(runs[0].exit, statuses));
check('отмена', P.exitLabel({kind: 'cancelled', transition: 'drop', to_status: 'omega'}, statuses) === 'отменена переходом drop');
check('незнакомый вид — как есть', P.exitLabel({kind: 'parked', transition: 'p', to_status: 'Alpha'}, statuses).startsWith('parked'));

console.log('артефакты попытки');
check('заменённые версии не показываются', P.runArtifacts(artifacts, 'b1').map((a) => a.id).join() === 'x2,x3');
check('у перепроверки — свои', P.runArtifacts(artifacts, 'b1-r').map((a) => a.id).join() === 'x4');
check('problem. — префикс, как у движка', P.isProblemReport('problem.report') && P.isProblemReport('problem.blocker') && !P.isProblemReport('dev.problem'));

// ── этап, который ещё не начинался ──────────────────────────────────────────
console.log('этап без прогонов');
check('роли статуса: основная первой', P.stageRoles(statuses[1]).map((r) => r.role_key).join() === 'smith,helper');
check('есть роль — есть исполнитель', P.hasExecutor(statuses[1]));
check('без ролей — нет исполнителя (ползунка нет)', !P.hasExecutor(statuses[2]) && !P.hasExecutor(statuses[3]) && !P.hasExecutor(undefined));
let exits = P.stageExits(workflow, 'beta-2');
check('выход — переходы из статуса по position', exits.map((e) => e.transition.key).join() === 'fwd,back', exits.map((e) => e.transition.key).join());
check('целевой статус из версии', exits[0].to?.name === 'Проба');
check('переход «из любого статуса» не входит', !exits.some((e) => e.transition.key === 'drop'));
exits = P.stageExits(workflow, 'Alpha');
check('гейты выхода по position', exits[0].gates.map((g) => g.key).join() === 'docs,ok', exits[0].gates.map((g) => g.key).join());
check('конечный статус — выхода нет', P.stageExits(workflow, 'omega').length === 0);
check('незнакомый статус и нет версии — пусто', P.stageExits(workflow, 'zeta').length === 0 && P.stageExits(undefined, 'Alpha').length === 0);

console.log('уровень этапа в запросе');
check('уровень — по ключу статуса', JSON.stringify(P.stageLevelPatch('beta-2', 'high')) === '{"stage_settings":{"beta-2":{"model_level":"high"}}}');
check('«авто» — пустая строка', JSON.stringify(P.stageLevelPatch('Alpha', null)) === '{"stage_settings":{"Alpha":{"model_level":""}}}');

// ── без хардкода ────────────────────────────────────────────────────────────
console.log('ключи статусов и ролей не зашиты в модулях панели');
const KEYS = ['new', 'analysis', 'development', 'testing', 'merge', 'release', 'done', 'cancelled',
  'planning', 'in_progress', 'prepare', 'publish', 'verify', 'analytics', 'developer', 'test', 'analyst', 'reviewer'];
const quoted = new RegExp(`(['"\`])(${KEYS.join('|')})\\1`);
const comparison = new RegExp(`(status_key|role_key|statusKey|stage)\\s*[!=]==?\\s*['"\`]`);
const dir = 'src/components/task';
const files = [...readdirSync(new URL(`../${dir}/`, import.meta.url)).map((f) => `${dir}/${f}`), 'src/hooks/useTaskLevelEditable.ts'];
for (const file of files) {
  const lines = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\{\/\*)/.test(line));
  const hit = lines.find((line) => quoted.test(line) || comparison.test(line));
  check(`${file}: ключей статусов и ролей нет`, !hit, hit);
}
const rules = readFileSync(new URL('../src/components/task/stagePanel.ts', import.meta.url), 'utf8');
check('модуль правил без React', !/from ['"]react/.test(rules));

console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
