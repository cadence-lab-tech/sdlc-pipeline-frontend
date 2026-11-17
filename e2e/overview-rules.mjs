// Правила «Обзора» (CLAB-365, переработка CLAB-488) — без браузера: запросы
// блоков, правило «одна задача — один блок» на синтетике по всем причинам,
// признакам in_work и категориям статуса, склейка записей /approvals со
// строками, «Можно брать сейчас» по правилу clab backlog --next, группы «Что
// делается сейчас» по статусам циклов, строка «кто и что», «Сводка» (план
// запросов, суммы, прежние версии, категории, адрес списка, притормаживание),
// страница «Задачи», адрес фильтров, состояния, ключи свёрнутости. Модули
// components/overview/*.ts — чистые функции, проверяются прямо в исходниках.
// Здесь же — поиск ключей и слов чужой настройки и сырых цветов в коде.
//
// Циклы в данных — свои, не копия нашего: «Короткий» (todo → doing → closed,
// без ролей) и «Длинный» (12 статусов, необязательный этап, статус без роли
// категории waiting с длинным именем, свои роли).
import {readFileSync, readdirSync} from 'node:fs';
import {registerHooks} from 'node:module';

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

const Z = await import('../src/components/overview/zones.ts');
const S = await import('../src/components/overview/summary.ts');
const A = await import('../src/components/overview/actions.ts');
const L = await import('../src/components/overview/taskList.ts');

let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};

const NOW = Date.parse('2026-11-18T12:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();
const MIN = 60_000;

const row = (over = {}) => ({
  id: over.key ?? 't', key: 'X-1', title: 'Заголовок', priority: 'normal',
  status_key: 'todo', status_name: 'Новая', status_category: 'backlog', workflow_id: 'wf-short',
  properties: {type: 'item'}, labels: [], repositories: [],
  attention: [], blocked_by: [], current_run: null, cost: null, child_counts: {},
  last_moved_at: null, awaiting_approval: false, subtree_last_moved_at: null, subtree_cost_usd: null, in_work: false,
  ...over,
});
const run = (over = {}) => ({
  id: 'r', kind: 'stage', state: 'in_progress', attempt: 1, status_key: 'build',
  role_key: 'engineer', role_name: 'Engineer', claimed_by_handle: null, lease_alive: false,
  entered_at: ago(10 * MIN), claimable: true, ...over,
});

// ── два своих цикла ─────────────────────────────────────────────────────────
const st = (key, name, category, position, over = {}) => ({
  id: `s-${key}`, workflow_id: 'wf', key, name, category, position, is_initial: position === 0,
  is_terminal: category === 'done' || category === 'cancelled', is_optional: false, enabled_by_default: true, roles: [], ...over,
});
const role = (key, name, primary, position = 0) => ({role_id: key, role_key: key, role_name: name, is_primary: primary, position});
const SHORT = {
  id: 'wf-short', project_id: 'p', name: 'Короткий', version: 2, state: 'active', task_types: ['item'],
  statuses: [st('todo', 'Новая', 'backlog', 0), st('doing', 'Делаем', 'active', 1), st('closed', 'Закрыта', 'done', 2)],
  transitions: [],
};
const LONG = {
  id: 'wf-long', project_id: 'p', name: 'Delivery', version: 7, state: 'active', task_types: ['feature', 'defect'],
  statuses: [
    st('intake', 'Intake', 'backlog', 0),
    st('discovery', 'Discovery & sizing', 'active', 1, {roles: [role('po', 'Product owner', true)]}),
    st('ux', 'UX exploration', 'active', 2, {is_optional: true, roles: [role('designer_x', 'Designer', true)], color: '#a855f7'}),
    st('signoff', 'Waiting for customer sign-off on scope and budget', 'waiting', 3),
    st('build', 'Build', 'active', 4, {roles: [role('eng', 'Engineer', true)], color: '#3b82f6'}),
    st('peer', 'Peer review', 'active', 5, {roles: [role('eng', 'Engineer', true, 0), role('senior', 'Senior engineer', false, 1)]}),
    st('security', 'Security assessment', 'active', 6, {is_optional: true, roles: [role('sec', 'Security', true)]}),
    st('staging', 'Staging verification', 'active', 7, {roles: [role('qa', 'QA', true)]}),
    st('ready', 'Ready to ship', 'waiting', 8),
    st('rollout', 'Rollout', 'active', 9, {roles: [role('rm', 'Release manager', true)]}),
    st('shipped', 'Shipped', 'done', 10),
    st('wontdo', "Won't do", 'cancelled', 11),
  ],
  transitions: [
    {key: 'ship', name: 'Ship', gates: [{key: 'release_ok', name: 'Release approval', type: 'human_approval'}]},
    {key: 'sec_pass', name: 'Security passed', gates: [{key: 'sec_list', name: 'Security checklist', type: 'checklist'}]},
    {key: 'escalate', name: 'Escalate', gates: [{key: 'stage_time', name: 'Stage time limit', type: 'external_check'}]},
  ],
};
const INIT = {id: 'wf-init', project_id: 'p', name: 'Initiatives', version: 3, state: 'active', task_types: ['initiative'],
  statuses: [st('proposed', 'Proposed', 'backlog', 0), st('active', 'Active', 'active', 1), st('closed', 'Closed', 'done', 2)], transitions: []};
const head = (w) => ({id: w.id, project_id: 'p', name: w.name, version: w.version, state: 'active', task_types: w.task_types});
const projShort = {project: {key: 'OPS', name: 'Ops'}, repositories: [], task_property_defs: [], active_workflows: [head(SHORT)]};
const projLong = {
  project: {key: 'PLAT', name: 'Data Platform'}, repositories: [],
  task_property_defs: [{key: 'type', enum_values: ['feature', 'defect', 'initiative', 'spike']}],
  active_workflows: [head(LONG), head(INIT)],
};

// ── запросы блоков ──────────────────────────────────────────────────────────
console.log('запросы блоков');
const none = {type: '', parent: '', q: ''};
const f = {type: 'feature', parent: 'PLAT-31', q: 'обзор'};
const queries = [
  ['решения', Z.decisionsQuery(none), Z.decisionsQuery(f)],
  ['заблокировано/роль', Z.blockedQueries(none)[0], Z.blockedQueries(f)[0]],
  ['заблокировано/без роли', Z.blockedQueries(none)[1], Z.blockedQueries(f)[1]],
  ['делается/роль', Z.workQueries(none)[0], Z.workQueries(f)[0]],
  ['делается/без роли', Z.workQueries(none)[1], Z.workQueries(f)[1]],
  ['этапы', Z.stagesQuery(none), Z.stagesQuery(f)],
  ['этапы/запасной', Z.stagesFallbackQuery(none), Z.stagesFallbackQuery(f)],
  ['свободные', Z.freeCountQuery(none), Z.freeCountQuery(f)],
  ['завершено', Z.doneQuery(none, null), Z.doneQuery(f, null)],
];
for (const [name, q0, qf] of queries) {
  check(`${name}: limit всегда задан`, typeof q0.limit === 'number' && q0.limit > 0, JSON.stringify(q0));
  check(`${name}: общие фильтры type/parent/q`, qf.type === 'feature' && qf.parent === 'PLAT-31' && qf.q === 'обзор');
  check(`${name}: без фильтров параметров нет`, q0.type === undefined && q0.parent === undefined && q0.q === undefined);
}
let q = Z.blockedQueries(none);
check('заблокировано: две части — in_work и «начатые без роли» по категории, причины кроме возврата и «можно забрать»',
  q[0].in_work === true && q[1].in_work === false && q[1].terminal === false && q[1].category === 'active,waiting,done,cancelled' &&
  q.every((x) => x.attention_except === 'awaits_human,returned,unclaimed' && x.attention_not === 'awaits_human' && x.limit === 4));
check('заблокировано развёрнуто — предел 200', Z.blockedQueries(none, true).every((x) => x.limit === 200));
q = Z.workQueries(none);
check('делается: те же две части, из причин только возврат, потолок 12', q.every((x) => x.attention_within === 'returned' && x.limit === 12) &&
  q[0].in_work === true && q[1].in_work === false && q[1].category === 'active,waiting,done,cancelled');
q = Z.stagesQuery(none);
check('этапы: unclaimed, только unclaimed/returned, одним запросом', q.attention === 'unclaimed' && q.attention_within === 'unclaimed,returned' && q.limit === 200);
q = Z.stagesFallbackQuery(none);
check('этапы, запасной путь: без фильтра причин', q.in_work === true && q.attention === undefined && q.attention_within === undefined);
q = Z.readyTopQuery(none);
check('неначатые: выборка бэклога верхнего уровня в порядке сервера, без фильтра причин',
  q.backlog === true && q.top_level === true && q.order === 'backlog' && q.limit === Z.READY_SCAN && q.attention_not === undefined);
q = Z.readyTopQuery({type: '', parent: 'PLAT-31', q: ''});
check('неначатые внутри родителя: дети, неначатые, категория backlog, без top_level', q.parent === 'PLAT-31' && q.in_work === false &&
  q.category === 'backlog' && q.terminal === false && q.top_level === undefined && q.order === 'backlog');
q = Z.readyKidsQuery(none, ['PLAT-31', 'PLAT-40']);
check('дети родителей «в работе» — одним запросом по списку ключей', q.parent === 'PLAT-31,PLAT-40' && q.in_work === false && q.category === 'backlog' && q.order === 'backlog');
q = Z.freeCountQuery(none);
check('счётчик свободных: любого уровня, без блокирующих, limit=1', q.top_level === undefined && q.attention_not === 'blocked' && q.category === 'backlog' && q.limit === 1);
q = Z.doneQuery(none, 2);
check('завершено: листание по 20', q.terminal === true && q.order === 'updated' && q.limit === 20 && q.offset === 40);
check('родители для фильтра: ≤ 200, открытые верхнего уровня', Z.PARENTS_QUERY.limit === 200 && Z.PARENTS_QUERY.top_level === true && Z.PARENTS_QUERY.terminal === false);
check('отказ 400 — запасной путь; 500 — нет', Z.isRejected({httpStatus: 400}) && !Z.isRejected({httpStatus: 500}));

// ── одна задача — один блок (AC-17) ────────────────────────────────────────
// Синтетика: коды причин × in_work × категория статуса. match повторяет
// правила сервера (AttentionFilter.Match, listTasksWhere): category, in_work,
// terminal, attention*.
console.log('одна задача — один блок');
const KNOWN = ['awaits_human', 'lease_expired', 'over_stage_limit', 'gate_rejected', 'blocked', 'returned', 'unclaimed'];
const list = (s) => (s ? s.split(',') : null);
function match(t, qq) {
  if (qq.terminal !== undefined && t.terminal !== qq.terminal) return false;
  if (qq.in_work !== undefined && t.in_work !== qq.in_work) return false;
  if (qq.category && !qq.category.split(',').includes(t.category)) return false;
  const codes = t.codes;
  const anyOf = list(qq.attention), noneOf = list(qq.attention_not), except = list(qq.attention_except), within = list(qq.attention_within);
  if (anyOf && !codes.some((c) => anyOf.includes(c))) return false;
  if (noneOf && codes.some((c) => noneOf.includes(c))) return false;
  if (except && !codes.some((c) => !except.includes(c))) return false;
  if (within && codes.some((c) => !within.includes(c))) return false;
  return true;
}
// Неначатые идут не запросом с фильтром, а отбором unstartedModel по строкам
// выборки бэклога: свободная — «неначатые», с блокирующими — «ждут».
const pool = [...KNOWN, 'awaits_vendor'];
const tasks = [];
for (let mask = 0; mask < 1 << pool.length; mask++) {
  const codes = pool.filter((_, i) => mask & (1 << i));
  for (const inWork of [false, true]) {
    for (const category of ['backlog', 'active', 'waiting', 'done', 'cancelled']) {
      // Причины прогона этапа (ждёт человека, отклонён гейт, аренда, «можно
      // забрать») бывают только у этапа с ролью — а он in_work. Предел этапа
      // бывает и у этапа без роли.
      if (!inWork && codes.some((c) => ['awaits_human', 'lease_expired', 'gate_rejected', 'unclaimed'].includes(c))) continue;
      tasks.push({codes, in_work: inWork, category, terminal: false});
    }
  }
}
const blocksOf = (t) => {
  const out = [];
  if (t.codes.includes('awaits_human')) out.push('decisions');
  if (Z.blockedQueries(none).some((x) => match(t, x))) out.push('blocked');
  if (Z.workQueries(none).some((x) => match(t, x))) out.push('work');
  if (match(t, Z.stagesQuery(none))) out.push('ready-stage');
  const r = row({in_work: t.in_work, status_category: t.category, attention: t.codes.map((code) => ({code, since: null})),
    blocked_by: t.codes.includes('blocked') ? ['X-0'] : []});
  if (match(t, {terminal: false, in_work: false}) || t.in_work === false) {
    const m = Z.unstartedModel([r], [], false);
    if (m.free.length) out.push('ready-unstarted');
    if (m.waiting.length) out.push('ready-waiting');
  }
  return out;
};
let dup = 0, lost = 0, mismatch = 0;
const samples = [];
for (const t of tasks) {
  const bs = blocksOf(t);
  if (bs.length > 1) { dup++; samples.push('dup ' + JSON.stringify(t) + bs); }
  if (bs.length === 0) { lost++; samples.push('lost ' + JSON.stringify(t)); }
  if (bs.length === 1 && bs[0] !== Z.blockOf(t)) { mismatch++; samples.push('rule ' + JSON.stringify(t) + bs + '≠' + Z.blockOf(t)); }
}
check(`ни одна из ${tasks.length} задач не в двух блоках`, dup === 0, samples.slice(0, 3).join(' '));
check('ни одна задача не пропала', lost === 0, samples.slice(0, 3).join(' '));
check('запросы совпадают с таблицей §3 (blockOf)', mismatch === 0, samples.slice(0, 3).join(' '));
check('незнакомый код у начатой — «Заблокировано»', Z.blockOf({codes: ['awaits_vendor'], in_work: true, category: 'active'}) === 'blocked');
check('этап без роли (active, не in_work) — «Что делается сейчас», не «Можно брать» (AC-6)', Z.blockOf({codes: [], in_work: false, category: 'active'}) === 'work');
check('статус категории waiting без роли — «Что делается»', Z.blockOf({codes: [], in_work: false, category: 'waiting'}) === 'work');
check('неначатая с блокирующей — «Ждут блокирующих» (AC-4)', Z.blockOf({codes: ['blocked'], in_work: false, category: 'backlog'}) === 'ready-waiting');
check('начатая на этапе без роли с блокирующей — «Заблокировано»', Z.blockOf({codes: ['blocked'], in_work: false, category: 'active'}) === 'blocked');
check('ждёт человека и над пределом — «Требуют решения»', Z.blockOf({codes: ['awaits_human', 'over_stage_limit'], in_work: true, category: 'active'}) === 'decisions');
check('можно забрать и блок — «Заблокировано»', Z.blockOf({codes: ['unclaimed', 'blocked'], in_work: true, category: 'active'}) === 'blocked');
check('можно забрать — «Этапы ждут исполнителя»', Z.blockOf({codes: ['unclaimed', 'returned'], in_work: true, category: 'active'}) === 'ready-stage');
check('незавершённый статус категории done — не теряется', Z.blockOf({codes: [], in_work: false, category: 'done'}) === 'work');
check('сервер без категорий — только in_work', Z.isStarted({in_work: false, category: undefined}) === false && Z.isStarted({in_work: true, category: undefined}));

// ── «Требуют решения» ───────────────────────────────────────────────────────
console.log('требуют решения');
const appr = (key, transition, gate, over = {}, gateType = 'human_approval') => ({
  task: {key, title: `Задача ${key}`, type: 'feature', priority: 'high', workflow_id: 'wf-long', status_key: 'ready', status_name: 'Ready to ship', ...over},
  transition: {key: transition, name: 'Ship', to_status: 'rollout', lands_in: 'rollout', lands_in_name: 'Rollout'},
  gate: {gate_key: gate, gate_name: 'Release approval', type: gateType, blocking: true, status: 'pending'},
  stage_run: {id: 'r', attempt: 1, lease_held: false, latest_artifact_id: null},
});
const records = [appr('P-1', 'ship', 'release_ok'), appr('P-1', 'ship', 'list', {}, 'checklist'), appr('P-2', 'ship', 'release_ok', {parent_key: 'P-9'})];
const listed = [row({key: 'P-1', title: 'Из списка', attention: [{code: 'awaits_human', since: ago(MIN)}]})];
const dr = Z.decisionRows(records, listed);
check('одна строка на задачу, порядок записей', dr.map((r) => r.task.key).join() === 'P-1,P-2');
check('строка — элемент списка той же задачи', dr[0].task.title === 'Из списка');
check('подсказки записи: переход, гейт, тип, «→ куда»', dr[0].approvals[0].lands_in_name === 'Rollout' && dr[0].approvals[0].gate_type === 'human_approval' &&
  dr[0].approvals[0].gate_name === 'Release approval' && dr[0].approvals[0].transition_name === 'Ship');
const fb = dr[1].task;
check('нет в списке — строка из approval.task', fb.key === 'P-2' && fb.parent_key === 'P-9' && fb.properties.type === 'feature' && fb.attention[0].code === 'awaits_human');
check('фильтры на клиенте: тип, родитель, поиск', Z.filterApprovals(records, {type: 'defect', parent: '', q: ''}).length === 0 &&
  Z.filterApprovals(records, {type: '', parent: 'P-9', q: ''}).map((a) => a.task.key).join() === 'P-2' &&
  Z.filterApprovals(records, {type: '', parent: '', q: 'p-2'}).length === 1);

// ── «кто и что» (AC-15, AC-16) ──────────────────────────────────────────────
console.log('кто и что');
const T = A.actionText;
check('решаете вы — апрув', T(A.decisionAction([{transition_key: 'ship', gate_type: 'human_approval', can_decide: true}], true)) === 'Решаете вы — откройте задачу, чтобы утвердить или вернуть');
check('решаете вы — чек-лист', T(A.decisionAction([{transition_key: 'x', gate_type: 'checklist', can_decide: true}], true)) === 'Решаете вы — отметьте пункты чек-листа в карточке задачи');
check('решаете вы — другой тип гейта', T(A.decisionAction([{transition_key: 'x', gate_type: 'external_check'}], true)) === 'Решаете вы — откройте задачу и примите решение по гейту');
check('запись can_decide: false при праве — решение сопровождающего', T(A.decisionAction([{transition_key: 'x', can_decide: false}], true)).startsWith('Решение сопровождающего — по этой записи вы не решаете'));
check('наблюдатель — решает уровень сопровождающего', T(A.decisionAction([], false)) === 'Решает уровень сопровождающего и выше — вы видите, но не решаете');
check('кто действует — жирным', A.decisionAction([], true).parts[0].strong === true);
const blk = (attention, over = {}) => A.blockedAction(row({attention, ...over}), LONG);
let a = blk([{code: 'blocked', since: null}], {blocked_by: ['PLAT-190', 'PLAT-191']});
check('blocked: доведите KEY ссылками или снимите связь', T(a) === 'Сначала доведите PLAT-190, PLAT-191 или снимите связь в карточке задачи' && a.parts.some((p) => p.keys?.length === 2));
a = blk([{code: 'gate_rejected', since: null}], {current_run: run({role_name: 'Engineer'})});
check('gate_rejected с ролью — переделывает роль', T(a) === 'Переделывает Engineer: исправить по причине отклонения и снова запросить переход');
a = blk([{code: 'gate_rejected', since: null}], {current_run: run({role_key: null, role_name: null})});
check('gate_rejected без роли — люди этапа', T(a) === 'Переделывают люди этапа: исправить по причине отклонения и снова запросить переход');
check('lease_expired — исполнитель пропал, проверьте holder', T(blk([{code: 'lease_expired', since: ago(MIN), holder: 'runner@build-02'}])) === 'Исполнитель пропал: этап можно забрать заново — или проверьте runner@build-02' &&
  T(blk([{code: 'lease_expired', since: null}])) === 'Исполнитель пропал: этап можно забрать заново');
check('over_stage_limit — имя гейта из версии', T(blk([{code: 'over_stage_limit', since: null, gate: 'stage_time'}])) === 'Сопровождающий снимает предел (гейт «Stage time limit») или вмешивается' &&
  T(blk([{code: 'over_stage_limit', since: null}])) === 'Сопровождающий снимает предел в карточке задачи или вмешивается');
check('незнакомый код — подробности в карточке (AC-16)', T(blk([{code: 'foo_bar', since: null}])) === 'Откройте задачу — подробности причины в карточке');
check('главная причина — первая не возврат', blk([{code: 'returned', since: null}, {code: 'lease_expired', since: null}]).code === 'lease_expired');

// ── «Что делается сейчас» (AC-13, AC-14) ────────────────────────────────────
console.log('что делается сейчас');
let groups = Z.workGroups([row({key: 'O-1', status_key: 'doing', status_name: 'Делаем', status_category: 'active'}), row({key: 'O-2', status_key: 'doing', status_name: 'Делаем', status_category: 'active'})],
  {types: ['item'], versionOf: () => SHORT, showType: false});
check('«Короткий»: одна группа «Делаем» без роли, без хвоста «Без роли»', groups.length === 1 && groups[0].name === 'Делаем' && groups[0].roles === null && groups[0].rows.length === 2 && groups[0].id === 'item:doing');
const lrow = (key, type, status, extra = {}) => row({key, properties: {type}, workflow_id: 'wf-long', status_key: status, status_name: status, status_category: 'active', ...extra});
groups = Z.workGroups([
  lrow('L-1', 'feature', 'build'), lrow('L-2', 'defect', 'build'), lrow('L-3', 'feature', 'signoff'),
  lrow('L-4', 'feature', 'peer'), lrow('L-5', 'feature', 'legacy_qa', {status_name: 'Legacy QA'}), lrow('L-6', 'feature', 'discovery'),
  lrow('L-7', 'initiative', 'active', {workflow_id: 'wf-init'}),
], {types: ['feature', 'defect', 'initiative'], versionOf: (t) => (t === 'initiative' ? INIT : LONG), showType: true});
check('порядок: типы проекта, внутри — position статуса, прежние в конце типа', groups.map((g) => g.id).join() ===
  'feature:discovery,feature:signoff,feature:build,feature:peer,feature:legacy_qa,defect:build,initiative:active', groups.map((g) => g.id).join());
check('одинаковые имена разных типов не сливаются', groups.filter((g) => g.name === 'Build').length === 2 && groups.every((g) => g.showType));
check('статус без роли категории waiting — обычная группа, подпись «без роли»', groups[1].roles === null && groups[1].category === 'waiting' && groups[1].name.length > 40);
check('роль — подпись: «Engineer · проверяет Senior engineer»', groups[3].roles === 'Engineer · проверяет Senior engineer' && groups[0].roles === 'Product owner');
check('прежняя версия: имя из строки, пометка', groups[4].old === true && groups[4].name === 'Legacy QA');
check('цвет — из версии, нет — категория', groups[2].color === '#3b82f6' && groups[0].color === undefined && groups[0].category === 'active');
check('версии нет — подписи из строки, не «прежняя»', Z.workGroups([lrow('L-1', 'feature', 'build', {current_run: run({role_name: 'Engineer'})})], {types: ['feature'], versionOf: () => undefined, showType: false})[0].old === false);
check('необязательный этап — признак группы', Z.workGroups([lrow('L-9', 'feature', 'ux')], {types: ['feature'], versionOf: () => LONG, showType: false})[0].optional === true);

// ── «Можно брать сейчас» (AC-3…AC-7) ────────────────────────────────────────
console.log('можно брать сейчас');
const qrows = [
  row({key: 'Q1', current_run: run({role_key: 'qa', entered_at: ago(5 * MIN)})}),
  row({key: 'Q2', current_run: run({role_key: 'eng', entered_at: ago(50 * MIN)})}),
  row({key: 'Q3', current_run: run({role_key: 'eng', entered_at: ago(20 * MIN), claimable: false})}),
  row({key: 'Q4', current_run: run({role_key: 'qa', entered_at: ago(90 * MIN)})}),
];
let sm = Z.stagesModel(qrows, 4, ['eng']);
check('свои роли первыми', sm.grouped && sm.own.map((t) => t.key).join() === 'Q2' && sm.other.map((t) => t.key).join() === 'Q4,Q1');
check('назначена другому — отдельно, не в счётчике', sm.assigned.map((t) => t.key).join() === 'Q3' && sm.claimable === 3);
check('роли любые — без деления', !Z.stagesModel(qrows, 4, null).grouped && !Z.stagesModel(qrows, 4, []).grouped);
check('запасной путь — счётчик «N+»', Z.stagesModel(qrows, 4, null, true).partial === true && Z.stagesModel(qrows, 4, null).partial === false);
const many = Array.from({length: 12}, (_, i) => row({key: `M${i}`, current_run: run({role_key: i < 8 ? 'eng' : 'qa', entered_at: ago((100 - i) * MIN)})}));
let vs = Z.visibleStages(Z.stagesModel(many, 12, ['eng']), false);
check('потолок 5 своих + 2 остальных, «Ещё N»', vs.own.length === 5 && vs.other.length === 2 && vs.hidden === 5);
check('без деления — 7 подряд', Z.visibleStages(Z.stagesModel(many, 12, null), false).own.length === 7);
check('этапы, отбор запасного пути: только unclaimed (+ возврат)', Z.stageWaits(row({attention: [{code: 'unclaimed'}, {code: 'returned'}]})) &&
  !Z.stageWaits(row({attention: [{code: 'unclaimed'}, {code: 'blocked'}]})) && !Z.stageWaits(row({attention: []})));

// Бэклог «Длинного»: верхний уровень в порядке сервера.
const top = [
  row({key: 'P-241', in_work: false}),
  row({key: 'P-245', blocked_by: ['P-241'], attention: [{code: 'blocked'}]}),
  row({key: 'P-31', in_work: true, status_category: 'active', child_counts: {active: 4, backlog: 6, done: 12}}),
  row({key: 'P-77', in_work: false, status_category: 'active'}), // этап без роли — начатая
  row({key: 'P-52', in_work: false, child_counts: {backlog: 4}}), // неначатый родитель — одной строкой
  row({key: 'P-99', in_work: true, status_category: 'active', child_counts: {backlog: 2}, blocked_by: ['P-1'], attention: [{code: 'blocked'}]}),
];
const kids = [
  row({key: 'P-63', parent_key: 'P-31'}),
  row({key: 'P-64', parent_key: 'P-31'}),
  row({key: 'P-65', parent_key: 'P-31', blocked_by: ['P-63'], attention: [{code: 'blocked'}]}),
  row({key: 'P-66', parent_key: 'P-31', status_category: 'waiting'}),
];
let um = Z.unstartedModel(top, kids, false);
check('--next: свободные по порядку, родитель «в работе» отдаёт место детям', um.free.map((e) => e.task.key).join() === 'P-241,P-63,P-64,P-52', um.free.map((e) => e.task.key).join());
check('↳ внутри KEY — у детей родителя в работе', um.free.find((e) => e.task.key === 'P-63').via === 'P-31' && um.free[0].via === null && Z.viaText('P-31') === 'внутри P-31 — она уже в работе');
check('ждущие блокирующих — отдельно, не в свободных', um.waiting.map((t) => t.key).join() === 'P-245,P-65');
check('начатая на этапе без роли — не здесь; заблокированный родитель в работе пропущен с детьми', !um.free.some((e) => ['P-77', 'P-99'].includes(e.task.key)));
check('дети нужны только незаблокированным родителям в работе', Z.inWorkParents(top, false).join() === 'P-31' && Z.inWorkParents(top, true).length === 0);
um = Z.unstartedModel([row({key: 'K-1', parent_key: 'P-31'}), row({key: 'K-2', parent_key: 'P-31', blocked_by: ['K-1'], attention: [{code: 'blocked'}]})], [], true);
check('внутри родителя: дети подряд, без ↳', um.free.map((e) => e.task.key).join() === 'K-1' && um.free[0].via === null && um.waiting.length === 1);
let rc = Z.readyCount(Z.stagesModel(qrows, 4, null), 35, 5);
check('счётчик: claimable + все свободные (total)', rc.n === 3 + 35 && rc.partial === false);
rc = Z.readyCount(Z.stagesModel(qrows, 4, null), null, 5);
check('отказ фильтра причин — показанные и «+» (AC-7)', rc.n === 3 + 5 && rc.partial === true && Z.counterText(rc.n, rc.partial) === '8+');
check('этапы ещё не пришли — «—»', Z.readyCount(null, 3, 1) === null && Z.counterText(null) === '—');

// ── «Сводка» (AC-8…AC-12) ───────────────────────────────────────────────────
console.log('сводка');
const versions = new Map([['wf-short', SHORT], ['wf-long', LONG], ['wf-init', INIT]]);
let plan = S.summaryPlan(projShort, none, versions);
const statuses = (p) => p.active_workflows.reduce((n, w) => n + versions.get(w.id).statuses.length * w.task_types.length, 0);
check('«Короткий»: Σ статусов + 2·типов + 1 запросов', plan.length === 3 + 2 + 1, String(plan.length));
plan = S.summaryPlan(projLong, none, versions);
const typesLong = S.summaryTypes(projLong, none);
check('типы — из данных проекта (циклы и перечень type)', typesLong.join() === 'feature,defect,initiative,spike', typesLong.join());
check('«Длинный»: запросов не больше Σ статусов + 2·типов + 1 (AC-12)', plan.length <= statuses(projLong) + 2 * typesLong.length + 1 && plan.length === 12 * 2 + 3 + 2 * 4 + 1, String(plan.length));
check('с ?type= — только он, без счётчика проекта', S.summaryPlan(projLong, {type: 'defect', parent: '', q: ''}, versions).every((k) => k.kind !== 'project' && k.type === 'defect'));
const cq = S.countQuery({kind: 'status', type: 'feature', status: 'build'}, f);
check('счётчик статуса: type + status + parent + q, limit=1', cq.type === 'feature' && cq.status === 'build' && cq.parent === 'PLAT-31' && cq.q === 'обзор' && cq.limit === 1);
check('счётчик завершённых — terminal=true', S.countQuery({kind: 'terminal', type: 'feature'}, none).terminal === true);
check('версия не прочиталась — у типа только итоги', S.summaryPlan(projLong, none, new Map([['wf-long', null], ['wf-init', INIT]])).filter((k) => k.kind === 'status' && k.type === 'feature').length === 0);

// Числа «Длинного» (feature): статусы активной версии + одна задача на
// статусе прежней версии (Legacy QA).
const counts = new Map();
const put = (k, n) => counts.set(S.countId(k), n);
const byStatus = {intake: 20, discovery: 2, ux: 0, signoff: 3, build: 5, peer: 1, security: 1, staging: 2, ready: 1, rollout: 1, shipped: 48, wontdo: 6};
for (const [k, n] of Object.entries(byStatus)) put({kind: 'status', type: 'feature', status: k}, n);
const openSum = Object.entries(byStatus).filter(([k]) => !['shipped', 'wontdo'].includes(k)).reduce((s, [, n]) => s + n, 0);
put({kind: 'type', type: 'feature'}, openSum + 1 + 54);
put({kind: 'terminal', type: 'feature'}, 54);
for (const k of Object.keys(byStatus)) put({kind: 'status', type: 'defect', status: k}, 1);
put({kind: 'type', type: 'defect'}, 12); put({kind: 'terminal', type: 'defect'}, 2);
put({kind: 'type', type: 'initiative'}, 8); put({kind: 'terminal', type: 'initiative'}, 4);
for (const [k, n] of Object.entries({proposed: 2, active: 2, closed: 4})) put({kind: 'status', type: 'initiative', status: k}, n);
put({kind: 'type', type: 'spike'}, 13); put({kind: 'terminal', type: 'spike'}, 9);
put({kind: 'project'}, 91 + 12 + 8 + 13 + 7);
let sm2 = S.summaryModel(projLong, none, versions, counts);
const feat = sm2.types.find((t) => t.type === 'feature');
check('все статусы версии в порядке position, имена и цвет из данных (AC-8)', feat.statuses.map((s) => s.key).join() === LONG.statuses.map((s) => s.key).join() &&
  feat.statuses.find((s) => s.key === 'build').color === '#3b82f6' && feat.statuses.find((s) => s.key === 'ux').count === 0);
check('незавершённые и завершённые', feat.open === openSum + 1 && feat.closed === 54 && feat.statuses.filter((s) => s.terminal).map((s) => s.key).join() === 'shipped,wontdo');
check('задача на статусе прежней версии — «на статусах прежних версий» (AC-9)', feat.oldOpen === 1 && feat.oldClosed === 0);
const sumType = feat.statuses.reduce((n, s) => n + s.count, 0) + feat.oldOpen + feat.oldClosed;
check('сумма счётчиков типа = total типа (AC-9)', sumType === feat.total, `${sumType} ≠ ${feat.total}`);
const cat = Object.fromEntries(feat.categories.map((c) => [c.category, c.count]));
check('разрез по категориям = сумма статусов категории', cat.backlog === 20 && cat.active === 2 + 0 + 5 + 1 + 1 + 2 + 1 && cat.waiting === 4 && cat.done === 48 && cat.cancelled === 6 &&
  feat.categories.map((c) => c.category).join() === 'backlog,active,waiting,done,cancelled');
check('разрез виден: в категории больше одного статуса', feat.showCategories === true);
check('тип без действующего цикла — строка с итогами', sm2.types.find((t) => t.type === 'spike').cycle === null && sm2.types.find((t) => t.type === 'spike').statuses.length === 0);
check('«Остальные» — проект больше суммы по типам', sm2.others === 7 && sm2.total === 131);
check('всё прочиталось — без пометки', sm2.failed === 0);
counts.set(S.countId({kind: 'status', type: 'feature', status: 'build'}), null);
sm2 = S.summaryModel(projLong, none, versions, counts);
check('часть чисел не прочиталась — «—», остаток не считается, пометка', sm2.failed === 1 && sm2.types[0].statuses.find((s) => s.key === 'build').count === null && sm2.types[0].oldOpen === null);
const shortCounts = new Map([[S.countId({kind: 'project'}), 9], [S.countId({kind: 'type', type: 'item'}), 9], [S.countId({kind: 'terminal', type: 'item'}), 3]]);
for (const [k, n] of Object.entries({todo: 1, doing: 5, closed: 3})) shortCounts.set(S.countId({kind: 'status', type: 'item', status: k}), n);
const sms = S.summaryModel(projShort, none, versions, shortCounts);
check('«Короткий»: без пустых разрезов (категория — один статус)', sms.types[0].showCategories === false && sms.others === null && sms.types[0].oldOpen === 0);
const emptyCounts = new Map([...shortCounts].map(([k]) => [k, 0]));
check('parent/q: типы без задач — «Нет задач по отбору»', S.summaryModel(projShort, {type: '', parent: '', q: 'zz'}, versions, emptyCounts).emptyTypes.join() === 'item');
check('?type= — одна строка (AC-11)', S.summaryModel(projLong, {type: 'defect', parent: '', q: ''}, versions, counts).types.map((t) => t.type).join() === 'defect');
check('адрес списка: тип + статус + фильтры (AC-10)', S.summaryHref('PLAT', {type: 'feature', status: 'build'}, {parent: 'PLAT-31', q: 'x'}) === '/p/PLAT/tasks?type=feature&status=build&parent=PLAT-31&q=x');
check('адрес: категория и завершённость', S.summaryHref('P', {type: 't', category: 'active'}, {parent: '', q: ''}) === '/p/P/tasks?type=t&category=active' &&
  S.summaryHref('P', {type: 't', terminal: false}, {parent: '', q: ''}) === '/p/P/tasks?type=t&terminal=false');
check('разделитель тысяч и «—»', S.countText(4600).replace(/\s/g, ' ') === '4 600' && S.countText(null) === '—');
check('склонение «задача/задачи/задач»', S.tasksWord(1) === 'задача' && S.tasksWord(3) === 'задачи' && S.tasksWord(11) === 'задач' && S.tasksWord(91) === 'задача');
// Притормаживание (AC-12).
check('первое событие после тишины — сразу', S.throttleStep(null, NOW).run === true && S.throttleStep(NOW - 31_000, NOW).run === true);
const th = S.throttleStep(NOW - 10_000, NOW);
check('в окне — одно чтение по концу окна', th.run === false && th.wait === 20_000 && S.SUMMARY_WINDOW_MS === 30_000);
// Загрузка: часть упала — модель; упало всё — ошибка.
const okList = async (qq) => ({tasks: [], total: qq.status ? 1 : 3});
let model = await S.fetchSummary(okList, async (id) => versions.get(id), projShort, none);
check('загрузка: числа по запросам', model.types[0].statuses.every((s) => s.count === 1) && model.types[0].total === 3 && model.failed === 0);
let calls = 0;
model = await S.fetchSummary(async (qq) => { calls++; if (qq.status === 'doing') throw Object.assign(new Error('сбой'), {httpStatus: 500}); return {tasks: [], total: 1}; },
  async (id) => versions.get(id), projShort, none);
check('один счётчик упал — остальные на месте', model.failed === 1 && model.types[0].statuses.find((s) => s.key === 'doing').count === null && calls === 6);
let thrown = null;
try { await S.fetchSummary(async () => { throw Object.assign(new Error('нет связи'), {httpStatus: 0}); }, async (id) => versions.get(id), projShort, none); } catch (e) { thrown = e; }
check('упали все — ошибка блока «Сводка»', thrown?.message === 'нет связи');
model = await S.fetchSummary(okList, async () => { throw new Error('версия'); }, projShort, none);
check('версия не прочиталась — тип с пометкой, итоги есть', model.types[0].versionFailed === true && model.types[0].total === 3);

// ── страница «Задачи» (AC-10) ───────────────────────────────────────────────
console.log('страница «Задачи»');
let sel = L.readSelection(new URLSearchParams('type=feature&status=build&parent=PLAT-31&q=x'));
check('отбор из адреса', sel.by === 'status' && sel.status === 'build' && sel.parent === 'PLAT-31' && sel.q === 'x');
let lq = L.selectionQuery(sel, 50);
check('запрос: тот же отбор, по движению, порции по 50', lq.type === 'feature' && lq.status === 'build' && lq.parent === 'PLAT-31' && lq.order === 'updated' && lq.limit === 50 && lq.offset === 50);
const cnt = S.countQuery({kind: 'status', type: 'feature', status: 'build'}, {parent: 'PLAT-31', q: 'x'});
const pick = (o) => JSON.stringify(['type', 'status', 'category', 'terminal', 'parent', 'q'].map((k) => o[k]));
check('отбор списка = запрос счётчика: total равен числу (AC-10)', pick(L.selectionQuery(sel)) === pick(cnt));
check('без типа или с двумя отборами — «Отбор не задан»', L.readSelection(new URLSearchParams('status=x')) === null && L.readSelection(new URLSearchParams('type=t&status=a&category=active')) === null &&
  L.readSelection(new URLSearchParams('type=t&terminal=yes')) === null);
check('только тип — все задачи типа', L.readSelection(new URLSearchParams('type=t')).by === 'type');
check('terminal и category', L.selectionQuery(L.readSelection(new URLSearchParams('type=t&terminal=false'))).terminal === false &&
  L.selectionQuery(L.readSelection(new URLSearchParams('type=t&category=waiting'))).category === 'waiting');
check('«← Обзор» — с типом и фильтрами', L.overviewHref('PLAT', sel) === '/p/PLAT/overview?type=feature&parent=PLAT-31&q=x' && L.overviewHref('PLAT', null) === '/p/PLAT/overview');
check('токены отбора: имя статуса из версии', L.selectionTokens(sel, 'Build').join('|') === 'Тип: feature|Статус: Build|Родитель: PLAT-31|Поиск: «x»' &&
  L.selectionTokens(L.readSelection(new URLSearchParams('type=t&category=active'))).join('|') === 'Тип: t|Категория: в работе');
check('исполнитель: аренда, назначена, без роли, ждёт', L.executorText(row({current_run: run({claimed_by_handle: 'anna', lease_alive: true})})) === 'anna' &&
  L.executorText(row({assignee_handle: 'kate'})) === 'назначена: kate' && L.executorText(row({current_run: run({role_key: null, claimable: false})})) === 'этап без роли' &&
  L.executorText(row({current_run: run({claimable: true})})) === 'ждёт исполнителя');

// ── фильтры, состояния, свёрнутость ─────────────────────────────────────────
console.log('фильтры, состояния, свёрнутость');
let sp = new URLSearchParams('type=feature&parent=P-9&q=%20обзор%20&foo=1');
const rf = Z.readFilters(sp);
check('разбор: type, parent, q (обрезан)', rf.type === 'feature' && rf.parent === 'P-9' && rf.q === 'обзор');
sp = Z.withFilter(sp, 'q', '');
check('пустое значение убирает параметр, чужие остаются', !sp.has('q') && sp.get('foo') === '1');
sp = Z.withoutFilters(sp);
check('«Сбросить» убирает только фильтры', !sp.has('type') && !sp.has('parent') && sp.get('foo') === '1');
check('сводка фильтров: «Родитель», не «эпик»', Z.filterSummary({type: 'item', parent: 'P-9', q: 'zz'}) === 'Тип: item · Родитель: P-9 · Поиск: «zz»');
check('тип новой задачи — фильтр, иначе первый тип проекта', Z.defaultNewTaskType('defect', ['feature', 'defect']) === 'defect' && Z.defaultNewTaskType('', ['item']) === 'item');
check('типы фильтра — с действующим циклом; объявленный без цикла — только из адреса', Z.cycleTypes(['item', 'task'], ['item'], '').join() === 'item' &&
  Z.cycleTypes(['item', 'task'], ['item'], 'task').join() === 'item,task');
check('сводка: тип без цикла и без задач не рисуется, с задачами — строка', (() => {
  const p = {...projShort, task_property_defs: [{key: 'type', enum_values: ['task', 'item']}]};
  const c = new Map(shortCounts);
  c.set(S.countId({kind: 'type', type: 'task'}), 0); c.set(S.countId({kind: 'terminal', type: 'task'}), 0);
  const hidden = S.summaryModel(p, none, versions, c).types.map((t) => t.type).join() === 'item';
  c.set(S.countId({kind: 'type', type: 'task'}), 2);
  return hidden && S.summaryModel(p, none, versions, c).types.some((t) => t.type === 'task' && t.cycle === null);
})());
check('порог 1100 px области', Z.nextContainer(1100) === 'column' && Z.nextContainer(1099) === 'sheet');
const po = Z.parentOptions([row({key: 'E1', child_counts: {done: 1}}), row({key: 'E2'})], 250);
check('родители — задачи с детьми, отбор на клиенте; усечение помечено', po.parents.map((t) => t.key).join() === 'E1' && po.truncated);
check('фильтр родителя: нет задач с детьми — поля нет (AC-2), в адресе есть — поле есть', !Z.showParentFilter([], '') && Z.showParentFilter([], 'P-9') && Z.showParentFilter(po.parents, ''));
check('блок ещё грузится или упал — блоки', Z.pageState(false, [0, null, 0], 0) === 'zones');
check('фильтры и пусто — «ничего не найдено»', Z.pageState(true, [0, 0, 0, 0, 0]) === 'no-results');
check('в проекте ни одной задачи — пустой проект', Z.pageState(false, [0, 0, 0, 0, 0], 0) === 'empty-project');
check('задачи только в «Можно брать» — блоки', Z.pageState(true, [0, 0, 0, 7, 0]) === 'zones');
const keys = Object.values(Z.COLLAPSE_KEYS).map((k) => k.key);
check('шесть блоков, свои ключи; прежние stuck/queue/backlog не читаются', keys.length === 6 && new Set(keys).size === 6 &&
  keys.join() === 'overview.summary,overview.decisions,overview.blocked,overview.work,overview.ready,overview.done.open');
check('по умолчанию свёрнута только «Завершено недавно»', Object.keys(Z.COLLAPSE_KEYS).filter((z) => Z.isCollapsed(z, false)).join() === 'done');
check('потолки design.spec', Z.CAPS.decisions === 4 && Z.CAPS.blocked === 4 && Z.CAPS.work === 12 && Z.CAPS.readyOwn === 5 && Z.CAPS.readyOther === 2 && Z.CAPS.readyWaiting === 2);
check('заголовки блоков', Object.values(Z.ZONE_TITLES).join('|') === 'Сводка|Требуют решения|Заблокировано|Что делается сейчас|Можно брать сейчас|Завершено недавно');
const mem = (init = {}) => { const m = {...init}; return {getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, m}; };
const store = mem();
Z.writeBacklogSize(() => store, 'OPS', 10);
check('число неначатых — прежний ключ sdlc.backlog.size.<проект>', store.m['sdlc.backlog.size.OPS'] === '10' && Z.readBacklogSize(() => store, 'OPS') === 10 && Z.readBacklogSize(() => mem(), 'OPS') === 5);

// ── код страницы (AC-1) ─────────────────────────────────────────────────────
console.log('код страницы');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').split('\n')
  .filter((l) => !l.trim().startsWith('//')).join('\n').replace(/\/\/.*$/gm, '');
const dirs = ['../src/components/overview/', '../src/components/taskrow/'];
const sources = [
  ...dirs.flatMap((d) => {
    const dir = new URL(d, import.meta.url);
    return readdirSync(dir).filter((n) => /\.tsx?$/.test(n)).map((n) => [n, code(readFileSync(new URL(n, dir), 'utf8'))]);
  }),
  ['Overview.tsx', code(readFileSync(new URL('../src/pages/Overview.tsx', import.meta.url), 'utf8'))],
  ['TaskList.tsx', code(readFileSync(new URL('../src/pages/TaskList.tsx', import.meta.url), 'utf8'))],
];
const KEYWORDS = /['"`](analysis|development|testing|merge|release|design|epic|planning|in_progress|analytics|designer|developer|test|integrator|Simple|Epic|Release|bug)['"`]/;
const hits = sources.filter(([, s]) => KEYWORDS.test(s)).map(([n]) => n);
check('ключей статусов, ролей, циклов и типов нашей настройки нет', hits.length === 0, hits.join());
check('нет сравнений со status_key/role_key/type', !sources.some(([, s]) => /(status_key|role_key|\.type)\s*[!=]==\s*['"`]/.test(s)));
const words = sources.filter(([, s]) => /эпик|аналитик|нарезк|агент возьм/i.test(s) || /Без роли/.test(s)).map(([n]) => n);
check('в текстах нет «эпик», «аналитик», «нарезка», «агент возьмёт», «Без роли»', words.length === 0, words.join());
const raw = sources.filter(([, s]) => /\b(bg|text)-(blue|red|amber|emerald|green)-\d00(?!\/)/.test(s.replace(/text-(blue|red|amber)-700 dark:text-\1-300/g, ''))).map(([n]) => n);
check('сырых цветов без пары для тёмной темы нет', raw.length === 0, raw.join());
const page = sources.find(([n]) => n === 'Overview.tsx')[1];
check('страница не тянет список без limit', (page.match(/listTasks\(/g) ?? []).length === (page.match(/listTasks\(projectKey, \{limit: 1\}\)/g) ?? []).length);
const hook = sources.find(([n]) => n === 'useOverview.ts')[1];
check('данные блоков — запросами zones.ts или с limit', !/listTasks\(projectKey\)/.test(hook) && !/listTasks\(projectKey, \{\s*\}\)/.test(hook));
check('страница обёрнута в WorkflowVersionsProvider', /<WorkflowVersionsProvider>/.test(page));
check('блоки на месте: сводка, решения, заблокировано, делается, можно брать, завершено',
  /<SummaryZone/.test(page) && /<DecisionsZone/.test(page) && /<BlockedZone/.test(page) && /<WorkZone/.test(page) && /<ReadyZone/.test(page) && /<DoneZone/.test(page));
const ready = sources.find(([n]) => n === 'ReadyZone.tsx')[1];
check('«Можно брать» только читает — без PATCH/POST и перетаскивания', !/\b(PATCH|POST|PUT|DELETE)\b|onDrag|onDrop|draggable|dnd/i.test(ready) && !/api\./.test(ready));
check('«Весь бэклог» — ссылка на страницу бэклога', /to=\{`\/p\/\$\{rowProps\.projectKey\}\/backlog`\}/.test(ready));
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
check('маршрут /p/:projectKey/tasks в оболочке «Обзора»', /path="\/p\/:projectKey\/tasks"[\s\S]{0,80}<Shell page="overview">\s*<TaskList/.test(app));
check('опоры переименованы: data-filter-parent, data-parent-strip, data-work-group, data-ready-group',
  /data-filter-parent/.test(page) && /data-parent-strip/.test(page) && /data-work-group/.test(page) && /data-ready-group/.test(ready) &&
  !/data-filter-epic|data-epic-strip|data-lane|data-queue-group/.test(page + ready));

console.log(`\n${ok} ✓, ${fail} ✗`);
if (fail > 0) process.exit(1);
