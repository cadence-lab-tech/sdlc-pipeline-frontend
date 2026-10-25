// Правила блока «Что держит» в обзоре задачи (CLAB-286) — без браузера:
// держащие гейты переходов вперёд, исполнитель живой и истёкшей аренды,
// перепроверка, закрытая задача, доля закрытых дочерних. Модуль правил —
// чистые функции (src/components/task/holding.ts), поэтому проверяется прямо
// в исходниках, как панель этапа в stage-panel.mjs.
//
// Ключи статусов и ролей в данных ниже нарочно не похожи на ключи наших
// циклов: правила не должны о них знать.
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';

// Модули интерфейса импортируют друг друга без расширения; подставляем .ts.
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

const H = await import('../src/components/task/holding.ts');

let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};

const future = new Date(Date.now() + 5 * 60_000).toISOString();
const past = new Date(Date.now() - 5 * 60_000).toISOString();
const gate = (key, type, status, blocking = true) => ({gate_key: key, gate_name: `гейт ${key}`, type, blocking, status});
const advance = (key, gates) => ({key, name: `переход ${key}`, kind: 'advance', to_status: 'x', allowed: false, gates});
const reject = (key, gates) => ({key, name: `возврат ${key}`, kind: 'reject', to_status: 'y', allowed: false, gates});
const run = (id, extra = {}) => ({id, status_key: 'Alpha', kind: 'stage', attempt: 1, state: 'claimed', entered_at: '2026-01-01T10:00:00Z', ...extra});
const statuses = [
  {key: 'Alpha', name: 'Сбор', is_terminal: false},
  {key: 'omega', name: 'Готово', is_terminal: true},
];
const detail = (over = {}) => ({
  task: {status_key: 'Alpha', status_name: 'Сбор'},
  stage_runs: [],
  transitions: [],
  children: [],
  ...over,
});

console.log('держащие гейты');
const gates = [
  gate('docs', 'artifacts_required', 'pending'),
  gate('ok', 'human_approval', 'pending'),
  gate('drift', 'drift_clear', 'passed'),
  gate('scope', 'repo_scope', 'skipped'),
  gate('look', 'agent_review', 'waived'),
  gate('hint', 'artifacts_required', 'pending', false),
  gate('bad', 'custom_check', 'failed'),
];
const held = H.holdingGates([advance('go', gates), reject('back', [gate('why', 'problem_report', 'pending')])]);
check('держат непройденные блокирующие', held.map((g) => g.gateKey).join() === 'docs,ok,bad', held.map((g) => g.gateKey).join());
check('passed, waived, skipped и неблокирующие не держат', !held.some((g) => ['drift', 'scope', 'look', 'hint'].includes(g.gateKey)));
check('возвраты не в счёт', !held.some((g) => g.transitionKey === 'back'));
check('у гейта тип и переход', held[0].type === 'artifacts_required' && held[0].transitionKey === 'go' && held[0].transitionName === 'переход go');
check('провал отличим от ожидания', held.find((g) => g.gateKey === 'bad').status === 'failed' && held[0].status === 'pending');
check('нет переходов — нет гейтов', H.holdingGates([]).length === 0);

console.log('исполнитель и аренда');
let h = H.holding(detail({stage_runs: [run('r1', {claimed_by_handle: 'bot-1', lease_expires_at: future, role_key: 'scribe', role_version: 7})]}), statuses);
check('живая аренда: handle, роль с версией, срок', h.executor?.live === true && h.executor.handle === 'bot-1' && h.executor.roleKey === 'scribe' && h.executor.roleVersion === 7 && h.executor.leaseExpiresAt === future, JSON.stringify(h.executor));
h = H.holding(detail({stage_runs: [run('r1', {claimed_by_handle: 'bot-1', lease_expires_at: past})]}), statuses);
check('истёкшая аренда — не пустое поле', h.executor?.live === false && h.executor.handle === 'bot-1' && h.executor.leaseExpiresAt === past, JSON.stringify(h.executor));
h = H.holding(detail({stage_runs: [run('r1', {state: 'pending'})]}), statuses);
check('без аренды исполнителя нет', h.executor === undefined);
h = H.holding(detail({stage_runs: [run('r0', {finished_at: '2026-01-01T11:00:00Z', claimed_by_handle: 'old-bot', lease_expires_at: past})]}), statuses);
check('завершённый прогон не исполнитель', h.executor === undefined);
h = H.holding(detail({stage_runs: [run('r9', {status_key: 'beta-2', claimed_by_handle: 'other-bot', lease_expires_at: future})]}), statuses);
check('прогон другого статуса не исполнитель', h.executor === undefined);

console.log('перепроверка');
h = H.holding(detail({stage_runs: [
  run('p1', {state: 'gating', claimed_by_handle: 'bot-1', lease_expires_at: past}),
  run('c1', {kind: 'review', parent_run_id: 'p1', role_key: 'checker', role_version: 3, claimed_by_handle: 'bot-2', lease_expires_at: future}),
]}), statuses);
check('идёт перепроверка: роль названа', h.reviewRole === 'checker', JSON.stringify(h));
check('исполнитель — тот, кто перепроверяет', h.executor?.handle === 'bot-2' && h.executor.review === true && h.executor.live === true, JSON.stringify(h.executor));
h = H.holding(detail({stage_runs: [
  run('p1', {state: 'gating'}),
  run('c1', {kind: 'review', parent_run_id: 'p1', role_key: 'checker', finished_at: '2026-01-01T12:00:00Z'}),
]}), statuses);
check('завершённая перепроверка не показывается', h.reviewRole === undefined && h.executor === undefined, JSON.stringify(h));
h = H.holding(detail({stage_runs: [
  run('p1', {state: 'gating'}),
  run('c1', {kind: 'review', parent_run_id: 'old', role_key: 'checker', claimed_by_handle: 'bot-9', lease_expires_at: future}),
]}), statuses);
check('перепроверка чужого прогона не в счёт', h.reviewRole === undefined, JSON.stringify(h));

console.log('апрув и закрытая задача');
h = H.holding(detail({transitions: [advance('go', [gate('docs', 'artifacts_required', 'passed'), gate('ok', 'human_approval', 'pending')])]}), statuses);
check('все прошли, кроме апрува, — ждёт апрува', h.awaitsApproval === true && h.gates.length === 1, JSON.stringify(h));
h = H.holding(detail({transitions: [advance('go', [gate('docs', 'artifacts_required', 'pending'), gate('ok', 'human_approval', 'pending')])]}), statuses);
check('держат и другие — не «ждёт апрува»', h.awaitsApproval === false && h.gates.length === 2, JSON.stringify(h));
h = H.holding(detail({task: {status_key: 'omega', status_name: 'Готово'}}), statuses);
check('терминальный статус — задача закрыта', h.closed === true && h.gates.length === 0 && h.executor === undefined, JSON.stringify(h));
h = H.holding(detail({task: {status_key: 'Alpha', status_name: 'Сбор', closed_at: '2026-01-02T00:00:00Z'}}), undefined);
check('closed_at — закрыта и без версии цикла', h.closed === true);
h = H.holding(detail(), undefined);
check('версии цикла нет — обзор считается', h.closed === false && h.gates.length === 0);

console.log('доля закрытых дочерних');
check('без детей — ноль', JSON.stringify(H.closedChildren([])) === '{"closed":0,"total":0,"percent":0}');
const c = H.closedChildren([{closed_at: 'x'}, {}, {closed_at: 'y'}, {}]);
check('закрыто 2 из 4', c.closed === 2 && c.total === 4 && c.percent === 50, JSON.stringify(c));

console.log('модуль правил без React');
const src = readFileSync(new URL('../src/components/task/holding.ts', import.meta.url), 'utf8');
check('без React', !/from ['"]react/.test(src));

console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
