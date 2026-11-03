// Правила «Обзора» (CLAB-365) — без браузера: запросы зон, инвариант «одна
// задача — одна зона» на синтетике по всем причинам и состояниям, склейка
// записей /approvals со строками списка, дорожки «В работе», очередь по ролям
// смотрящего и «назначена другому», потолки, адрес фильтров, тип новой
// задачи, порог панели «Дальше», состояния страницы, ключи свёрнутости.
// Модуль components/overview/zones.ts — чистые функции, проверяются прямо в
// исходниках, как task-row-rules.mjs. Здесь же — поиск ключей статусов, ролей
// и типов проекта и сырых цветов в коде страницы и её модулей (К-1, К-16).
//
// Ключи статусов, ролей и типов в данных нарочно не похожи на ключи наших
// циклов (inbox/build/shipped, builder, bug): правила о них знать не должны.
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

let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};

const NOW = Date.parse('2026-11-03T12:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();
const MIN = 60_000;

const row = (over = {}) => ({
  id: over.key ?? 't', key: 'X-1', title: 'Заголовок', priority: 'normal',
  status_key: 'inbox', status_name: 'Входящие', workflow_id: 'wf-1',
  properties: {type: 'bug'}, labels: [], repositories: [],
  attention: [], blocked_by: [], current_run: null, cost: null, child_counts: {},
  last_moved_at: null, awaiting_approval: false, subtree_last_moved_at: null, subtree_cost_usd: null,
  ...over,
});
const run = (over = {}) => ({
  id: 'r', kind: 'stage', state: 'in_progress', attempt: 1, status_key: 'build',
  role_key: 'builder', role_name: 'Сборщик', claimed_by_handle: null, lease_alive: false,
  entered_at: ago(10 * MIN), claimable: true, ...over,
});

// ── запросы зон ─────────────────────────────────────────────────────────────
console.log('запросы зон');
const none = {type: '', parent: '', q: ''};
const f = {type: 'bug', parent: 'X-9', q: 'обзор'};
for (const zone of ['decisions', 'stuck', 'work', 'queue', 'done']) {
  const q = Z.zoneQuery(zone, none);
  check(`${zone}: limit всегда задан`, typeof q.limit === 'number' && q.limit > 0, JSON.stringify(q));
  const qf = Z.zoneQuery(zone, f);
  check(`${zone}: общие фильтры type/parent/q`, qf.type === 'bug' && qf.parent === 'X-9' && qf.q === 'обзор');
  check(`${zone}: без фильтров параметров нет`, q.type === undefined && q.parent === undefined && q.q === undefined);
}
let q = Z.zoneQuery('stuck', none);
check('застряло: except и not по словарю движка', q.attention_except === 'awaits_human,returned,unclaimed' && q.attention_not === 'awaits_human' && q.limit === 4);
check('застряло развёрнуто — предел 200', Z.zoneQuery('stuck', none, {expanded: true}).limit === 200);
q = Z.zoneQuery('work', none);
check('в работе: in_work и только возврат, 9', q.in_work === true && q.attention_within === 'returned' && q.limit === 9);
q = Z.zoneQuery('queue', none);
check('очередь: unclaimed и только unclaimed/returned, одним запросом', q.attention === 'unclaimed' && q.attention_within === 'unclaimed,returned' && q.limit === 200);
q = Z.zoneQuery('done', none);
check('завершено: terminal, по обновлению, окно 5', q.terminal === true && q.order === 'updated' && q.limit === 5 && q.offset === undefined);
q = Z.zoneQuery('done', none, {donePage: 2});
check('листание по 20: offset страницы', q.limit === 20 && q.offset === 40);
q = Z.backlogQuery({type: 'bug', parent: '', q: ''}, 5);
check('бэклог (CLAB-366): верхний уровень, не в работе, порядок бэклога', q.terminal === false && q.in_work === false && q.top_level === true && q.order === 'backlog' && q.limit === 5 && q.type === 'bug');
q = Z.backlogQuery({type: 'bug', parent: 'X-9', q: 'обзор'}, 10);
check('бэклог в нарезке эпика (AC-8.7): parent и тип есть, top_level не передаётся', q.parent === 'X-9' && q.type === 'bug' && q.q === 'обзор' && !('top_level' in q) && q.in_work === false && q.terminal === false && q.order === 'backlog' && q.limit === 10, JSON.stringify(q));
check('бэклог: limit всегда задан, только 5 или 10 от переключателя', [5, 10].every((n) => Z.backlogQuery(none, n).limit === n) && Z.BACKLOG_SIZES.join() === '5,10');
check('эпики для фильтра: ≤ 200, открытые верхнего уровня', Z.EPICS_QUERY.limit === 200 && Z.EPICS_QUERY.top_level === true && Z.EPICS_QUERY.terminal === false);

// ── инвариант «одна задача — одна зона» (К-21) ──────────────────────────────
// Синтетическая задача: коды причин и признаки выборки списка. match повторяет
// правила сервера (workflow.AttentionFilter.Match, условия listTasksWhere).
console.log('одна задача — одна зона');
const KNOWN = ['awaits_human', 'lease_expired', 'over_stage_limit', 'gate_rejected', 'blocked', 'returned', 'unclaimed'];
const list = (s) => (s ? s.split(',') : null);
function match(t, qq) {
  if (qq.terminal !== undefined && t.terminal !== qq.terminal) return false;
  if (qq.in_work !== undefined && t.in_work !== qq.in_work) return false;
  if (qq.top_level && !t.top_level) return false;
  const codes = t.codes;
  const anyOf = list(qq.attention), noneOf = list(qq.attention_not), except = list(qq.attention_except), within = list(qq.attention_within);
  if (anyOf && !codes.some((c) => anyOf.includes(c))) return false;
  if (noneOf && codes.some((c) => noneOf.includes(c))) return false;
  if (except && !codes.some((c) => !except.includes(c))) return false;
  if (within && codes.some((c) => !within.includes(c))) return false;
  return true;
}
// Все сочетания причин (включая незнакомый код) × in_work, нетерминальные.
const pool = [...KNOWN, 'from_the_future'];
const tasks = [];
for (let mask = 0; mask < 1 << pool.length; mask++) {
  const codes = pool.filter((_, i) => mask & (1 << i));
  for (const inWork of [false, true]) {
    // «Можно забрать» бывает только у этапа с ролью, а этап с ролью — в работе
    // по правилу in_work: без него сочетание невозможно.
    if (codes.includes('unclaimed') && !inWork) continue;
    for (const topLevel of [false, true]) tasks.push({codes, in_work: inWork, terminal: false, top_level: topLevel});
  }
}
// «Ждут решения» у maintainer — записи /approvals; их задачи несут awaits_human.
const zonesOf = (t) => {
  const out = [];
  if (t.codes.includes('awaits_human')) out.push('decisions');
  if (match(t, Z.zoneQuery('stuck', none))) out.push('stuck');
  if (match(t, Z.zoneQuery('work', none))) out.push('work');
  if (match(t, Z.zoneQuery('queue', none))) out.push('queue');
  return out;
};
let dup = 0, lost = 0;
const lostSamples = [];
for (const t of tasks) {
  const zs = zonesOf(t);
  if (zs.length > 1) dup++;
  // Без зоны остаётся только задача не в работе без причин или с одним
  // возвратом (статус без роли, куда задачу вернули) — она в бэклоге
  // (CLAB-366, backlogQuery) или в нарезке эпика.
  const backlog = !t.in_work && t.codes.every((c) => c === 'returned');
  if (zs.length === 0 && !backlog) { lost++; lostSamples.push(JSON.stringify(t)); }
}
check(`ни одна из ${tasks.length} задач не в двух зонах`, dup === 0, String(dup));
check('ни одна задача с причиной или в работе не пропала', lost === 0, lostSamples.slice(0, 3).join(' '));
check('незнакомый код — «Застряло»', zonesOf({codes: ['from_the_future'], in_work: true, terminal: false, top_level: true}).join() === 'stuck');
check('возврат с живой арендой — «В работе»', zonesOf({codes: ['returned'], in_work: true, terminal: false, top_level: true}).join() === 'work');
check('возврат и предел этапа — «Застряло»', zonesOf({codes: ['returned', 'over_stage_limit'], in_work: true, terminal: false, top_level: true}).join() === 'stuck');
check('ждёт решения и над пределом — только «Ждут решения»', zonesOf({codes: ['awaits_human', 'over_stage_limit'], in_work: true, terminal: false, top_level: true}).join() === 'decisions');
check('можно забрать и блок — «Застряло»', zonesOf({codes: ['unclaimed', 'blocked'], in_work: true, terminal: false, top_level: true}).join() === 'stuck');
check('бэклог: неначатая задача видна только запросом CLAB-366', match({codes: [], in_work: false, terminal: false, top_level: true}, Z.backlogQuery(none, 5)));
check('бэклог: эпик в работе и ребёнок эпика вне нарезки блоком не берутся', !match({codes: [], in_work: true, terminal: false, top_level: true}, Z.backlogQuery(none, 5)) &&
  !match({codes: [], in_work: false, terminal: false, top_level: false}, Z.backlogQuery(none, 5)));
check('завершённая — только «Завершено»', match({codes: [], in_work: false, terminal: true, top_level: true}, Z.zoneQuery('done', none)) &&
  zonesOf({codes: [], in_work: false, terminal: true, top_level: true}).length === 0);

// ── «Ждут решения» ──────────────────────────────────────────────────────────
console.log('ждут решения');
const appr = (key, transition, gate, over = {}) => ({
  task: {key, title: `Задача ${key}`, type: 'bug', priority: 'high', workflow_id: 'wf-2', status_key: 'review', status_name: 'Ревью', ...over},
  transition: {key: transition, name: 'Выпустить', to_status: 'shipped', lands_in: 'shipped', lands_in_name: 'Выпущено'},
  gate: {gate_key: gate, gate_name: 'Апрув', type: 'human_approval', blocking: true, status: 'pending'},
  stage_run: {id: 'r', attempt: 1, lease_held: false, latest_artifact_id: null},
});
const records = [appr('X-1', 'ship', 'ok'), appr('X-1', 'ship', 'list'), appr('X-2', 'ship', 'ok', {parent_key: 'X-9'})];
const listed = [row({key: 'X-1', title: 'Из списка', attention: [{code: 'awaits_human', since: ago(MIN)}]})];
const dr = Z.decisionRows(records, listed);
check('одна строка на задачу, порядок записей', dr.map((r) => r.task.key).join() === 'X-1,X-2');
check('строка — элемент списка той же задачи', dr[0].task.title === 'Из списка');
check('подписи «→ куда» — из записей', dr[0].approvals.length === 2 && dr[0].approvals[0].lands_in_name === 'Выпущено' && dr[0].approvals[0].transition_key === 'ship');
const fb = dr[1].task;
check('нет в списке — строка из approval.task', fb.key === 'X-2' && fb.title === 'Задача X-2' && fb.priority === 'high' && fb.parent_key === 'X-9' && fb.properties.type === 'bug' && fb.workflow_id === 'wf-2');
check('у строки из записи — ожидание человека с гейтами записей', fb.attention.length === 1 && fb.attention[0].code === 'awaits_human' &&
  fb.attention[0].gates[0].transition === 'ship' && fb.attention[0].gates[0].gate === 'ok' && fb.awaiting_approval === true);
check('остальные поля строки — умолчания', fb.current_run === null && fb.cost === null && JSON.stringify(fb.child_counts) === '{}' && Array.isArray(fb.blocked_by));
check('фильтр типа на клиенте', Z.filterApprovals(records, {type: 'feature', parent: '', q: ''}).length === 0 && Z.filterApprovals(records, {type: 'bug', parent: '', q: ''}).length === 3);
check('фильтр эпика на клиенте', Z.filterApprovals(records, {type: '', parent: 'X-9', q: ''}).map((a) => a.task.key).join() === 'X-2');
check('поиск подстрокой без регистра по ключу', Z.filterApprovals(records, {type: '', parent: '', q: 'x-2'}).length === 1);
check('поиск подстрокой по заголовку', Z.filterApprovals(records, {type: '', parent: '', q: 'ЗАДАЧА X-1'}).length === 2);

// ── «В работе» ──────────────────────────────────────────────────────────────
console.log('в работе');
const lanes = Z.workLanes([
  row({key: 'A', current_run: run({role_key: 'builder', role_name: 'Сборщик'})}),
  row({key: 'B', current_run: run({role_key: 'checker', role_name: 'Проверяющий'})}),
  row({key: 'C', current_run: run({role_key: 'checker', role_name: 'Проверяющий'})}),
  row({key: 'E', child_counts: {active: 2, done: 1}, current_run: null}),
  row({key: 'N', current_run: null}),
  row({key: 'D', current_run: run({role_key: 'author', role_name: 'Автор'})}),
]);
check('эпики первыми, по числу, при равенстве по имени, «Без роли» последней',
  lanes.map((l) => l.label).join('|') === 'Эпики в работе|Проверяющий|Автор|Сборщик|Без роли', lanes.map((l) => l.label).join('|'));
check('эпик — по детям, не по типу', lanes[0].rows[0].key === 'E' && lanes[0].kind === 'epics');
check('подпись дорожки — имя роли из прогона', lanes[1].label === 'Проверяющий' && lanes[1].rows.length === 2);
check('роль без имени — её ключ как пришёл', Z.workLanes([row({current_run: run({role_key: 'qa_x', role_name: null})})])[0].label === 'qa_x');
check('нет строк — нет дорожек', Z.workLanes([]).length === 0);

// ── «Очередь» ───────────────────────────────────────────────────────────────
console.log('очередь');
const qrows = [
  row({key: 'Q1', current_run: run({role_key: 'checker', entered_at: ago(5 * MIN)})}),
  row({key: 'Q2', current_run: run({role_key: 'builder', entered_at: ago(50 * MIN)})}),
  row({key: 'Q3', current_run: run({role_key: 'builder', entered_at: ago(20 * MIN), claimable: false})}),
  row({key: 'Q4', current_run: run({role_key: 'checker', entered_at: ago(90 * MIN)})}),
];
let qm = Z.queueModel(qrows, 4, ['builder']);
check('свои роли первыми', qm.grouped && qm.own.map((t) => t.key).join() === 'Q2' && qm.other.map((t) => t.key).join() === 'Q4,Q1');
check('назначена другому — отдельно, не в счётчике', qm.assigned.map((t) => t.key).join() === 'Q3' && qm.claimable === 3);
check('полный список — без «+»', qm.partial === false);
qm = Z.queueModel(qrows, 4, null);
check('роли любые — без групп, по ожиданию', !qm.grouped && qm.own.map((t) => t.key).join() === 'Q4,Q2,Q1' && qm.other.length === 0);
check('ролей нет (пустой список) — без групп', !Z.queueModel(qrows, 4, []).grouped);
check('ответ длиннее загруженного — «N+»', Z.queueModel(qrows, 9, null).partial === true && Z.counterText(3, true) === '3+');
const many = Array.from({length: 12}, (_, i) => row({key: `M${i}`, current_run: run({role_key: i < 8 ? 'builder' : 'checker', entered_at: ago((100 - i) * MIN)})}));
qm = Z.queueModel(many, 12, ['builder']);
let vq = Z.visibleQueue(qm, false);
check('потолок 5 своих + 2 остальных, «Ещё N»', vq.own.length === 5 && vq.other.length === 2 && vq.hidden === 5, JSON.stringify([vq.own.length, vq.other.length, vq.hidden]));
vq = Z.visibleQueue(Z.queueModel(many, 12, null), false);
check('без групп — 7 подряд', vq.own.length === 7 && vq.hidden === 5);
vq = Z.visibleQueue(qm, true);
check('развёрнуто — всё', vq.hidden === 0 && vq.own.length === 8 && vq.other.length === 4);
qm = Z.queueModel([row({current_run: run({claimable: false})})], 1, null);
check('все назначены другому — счётчик 0, строки на месте', qm.claimable === 0 && qm.assigned.length === 1);

// ── фильтры в адресе (К-10) ─────────────────────────────────────────────────
console.log('фильтры в адресе');
let sp = new URLSearchParams('type=bug&parent=X-9&q=%20обзор%20&foo=1');
const rf = Z.readFilters(sp);
check('разбор: type, parent, q (обрезан)', rf.type === 'bug' && rf.parent === 'X-9' && rf.q === 'обзор');
check('пустой адрес — без фильтров', !Z.isFiltered(Z.readFilters(new URLSearchParams(''))));
sp = Z.withFilter(sp, 'q', '');
check('пустое значение убирает параметр, чужие остаются', !sp.has('q') && sp.get('foo') === '1' && sp.get('type') === 'bug');
sp = Z.withFilter(sp, 'parent', 'X-1');
check('значение заменяет', sp.get('parent') === 'X-1');
sp = Z.withoutFilters(sp);
check('«Сбросить» убирает только фильтры', !sp.has('type') && !sp.has('parent') && sp.get('foo') === '1');
check('сводка — только включённые', Z.filterSummary({type: 'bug', parent: '', q: 'zzz'}) === 'Тип: bug · Поиск: «zzz»');

// ── новая задача, порог панели, счётчики, состояния ─────────────────────────
console.log('новая задача, панель, состояния');
check('тип новой задачи — фильтр', Z.defaultNewTaskType('bug', ['story', 'bug']) === 'bug');
check('без фильтра — первый тип данных проекта', Z.defaultNewTaskType('', ['story', 'bug']) === 'story');
check('фильтр типа, которого нет, — первый тип проекта', Z.defaultNewTaskType('incident', ['story']) === 'story');
check('порог 1100 px области: колонка', Z.nextContainer(1100) === 'column' && Z.nextContainer(1184) === 'column');
check('уже порога — панель', Z.nextContainer(1099) === 'sheet' && Z.nextContainer(358) === 'sheet');
check('счётчик ошибки — «—»', Z.counterText(null) === '—' && Z.counterText(0) === '0');
check('зона ещё грузится или упала — зоны', Z.pageState(false, [0, null, 0], 0) === 'zones');
check('есть задачи в зонах — зоны', Z.pageState(true, [0, 1, 0]) === 'zones');
check('фильтры и пусто — «ничего не найдено»', Z.pageState(true, [0, 0, 0]) === 'no-results');
check('без фильтров пусто — ждём числа задач проекта', Z.pageState(false, [0, 0, 0]) === 'pending');
check('в проекте ни одной задачи — пустой проект', Z.pageState(false, [0, 0, 0], 0) === 'empty-project');
check('задачи есть (бэклог) — зоны, а не пустой проект', Z.pageState(false, [0, 0, 0], 12) === 'zones');
// Дефект из проверки CLAB-365 (AC-8.8): сумма блока бэклога входит в решение.
check('AC-8.8: фильтр, зоны пусты, в блоке бэклога есть строки — зоны, не «ничего не найдено»', Z.pageState(true, [0, 0, 0, 0, 0, 7, 0]) === 'zones');
check('AC-8.8: фильтр, пусты и зоны, и блок — «ничего не найдено»', Z.pageState(true, [0, 0, 0, 0, 0, 0, 0]) === 'no-results');
check('AC-8.8: запрос блока упал — зоны (в блоке Failure), не «ничего не найдено»', Z.pageState(true, [0, 0, 0, 0, 0, null, 0]) === 'zones');
check('без фильтров: пусто в зонах, блок с задачами — зоны, а не ожидание числа задач проекта', Z.pageState(false, [0, 0, 0, 0, 0, 3, 0]) === 'zones');
const eo = Z.epicOptions([row({key: 'E1', child_counts: {done: 1}}), row({key: 'E2'}), row({key: 'E3', child_counts: {cancelled: 2}})], 250);
check('эпики — с детьми, отбор на клиенте; усечение помечено', eo.epics.map((t) => t.key).join() === 'E1,E3' && eo.truncated === true);
check('список полный — без пометки', Z.epicOptions([], 0).truncated === false);

// ── свёрнутость (К-7) ───────────────────────────────────────────────────────
console.log('свёрнутость');
const keys = Object.values(Z.COLLAPSE_KEYS).map((k) => k.key);
check('шесть зон, свои ключи overview.*', keys.length === 6 && new Set(keys).size === 6 && keys.every((k) => k.startsWith('overview.')));
check('по умолчанию свёрнута только «Завершено недавно»',
  Object.keys(Z.COLLAPSE_KEYS).filter((z) => Z.isCollapsed(z, false)).join() === 'done');
check('«Завершено»: сохранённое «развёрнуто» разворачивает', Z.isCollapsed('done', true) === false && Z.isCollapsed('stuck', true) === true);
check('потолки варианта B', Z.CAPS.decisions === 4 && Z.CAPS.stuck === 4 && Z.CAPS.work === 9 && Z.CAPS.queueOwn === 5 && Z.CAPS.queueOther === 2 && Z.CAPS.done === 5 && Z.CAPS.donePage === 20);

// ── код страницы ────────────────────────────────────────────────────────────
console.log('код страницы');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').split('\n')
  .filter((l) => !l.trim().startsWith('//')).join('\n').replace(/\/\/.*$/gm, '');
const dir = new URL('../src/components/overview/', import.meta.url);
const sources = [
  ...readdirSync(dir).filter((n) => /\.tsx?$/.test(n)).map((n) => [n, code(readFileSync(new URL(n, dir), 'utf8'))]),
  ['Overview.tsx', code(readFileSync(new URL('../src/pages/Overview.tsx', import.meta.url), 'utf8'))],
];
const KEYWORDS = /['"`](analysis|development|testing|merge|release|design|epic|planning|in_progress|cancelled|task|bug|developer|analytics|integrator|test)['"`]/;
const hits = sources.filter(([, s]) => KEYWORDS.test(s)).map(([n]) => n);
check('ключей статусов, ролей и типов проекта нет', hits.length === 0, hits.join());
check('нет сравнений со status_key/role_key/type', !sources.some(([, s]) => /(status_key|role_key|\.type)\s*[!=]==\s*['"`]/.test(s)));
const raw = sources.filter(([, s]) => /\b(bg|text)-(blue|red|amber|emerald|green)-\d00(?!\/)/.test(s.replace(/text-(blue|red|amber)-700 dark:text-\1-300/g, ''))).map(([n]) => n);
check('сырых цветов без пары для тёмной темы нет', raw.length === 0, raw.join());
const page = sources.find(([n]) => n === 'Overview.tsx')[1];
check('страница не тянет список без limit: каждый listTasks — с запросом зоны или limit',
  (page.match(/listTasks\(/g) ?? []).length === (page.match(/listTasks\(projectKey, \{limit: 1\}\)/g) ?? []).length);
const hook = sources.find(([n]) => n === 'useOverview.ts')[1];
check('данные зон — запросами zoneQuery/EPICS_QUERY или с limit', (hook.match(/listTasks\(/g) ?? []).every(() => true) &&
  !/listTasks\(projectKey\)/.test(hook) && !/listTasks\(projectKey, \{\s*\}\)/.test(hook));
check('зона — <section> с <h2> и aria-expanded', /<section/.test(sources.find(([n]) => n === 'Zone.tsx')[1]) &&
  /<h2/.test(sources.find(([n]) => n === 'Zone.tsx')[1]) && /aria-expanded/.test(sources.find(([n]) => n === 'Zone.tsx')[1]));
check('страница обёрнута в WorkflowVersionsProvider', /<WorkflowVersionsProvider>/.test(page));
check('блок «Приоритетные из бэклога» стоит в слоте «Дальше»', /<BacklogZone/.test(page) && /zone="backlog"/.test(sources.find(([n]) => n === 'BacklogZone.tsx')[1]));
const block = sources.find(([n]) => n === 'BacklogZone.tsx')[1];
check('AC-8.5: блок только читает — ни PATCH/POST/PUT, ни перетаскивания', !/\b(PATCH|POST|PUT|DELETE)\b|onDrag|onDrop|draggable|dnd/i.test(block) && !/api\./.test(block));
check('AC-8.5: ссылки «Весь бэклог» нет', !/Весь бэклог/.test(block + page));
check('AC-8.11: блок не делает запросов сам — данные из общего useOverview (refresh)', /backlog = useZoneData/.test(hook) && /\btick\b/.test(hook.slice(hook.indexOf('backlog = useZoneData'), hook.indexOf('const epics'))));
check('N хранится не под префиксом свёрнутости', !Z.BACKLOG_SIZE_PREFIX.startsWith('sdlc.collapsed.') && Z.backlogSizeKey('A') !== Z.backlogSizeKey('B'));

// ── блок «Приоритетные из бэклога» (CLAB-366) ───────────────────────────────
console.log('блок бэклога: N, 400 на order');
const mem = (init = {}) => { const m = {...init}; return {getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, m}; };
check('AC-8.3: по умолчанию 5', Z.readBacklogSize(() => mem(), 'CLAB') === 5);
const st = mem();
Z.writeBacklogSize(() => st, 'CLAB', 10);
check('AC-8.3: выбор записан под ключом проекта и читается после «перезагрузки»', st.m['sdlc.backlog.size.CLAB'] === '10' && Z.readBacklogSize(() => st, 'CLAB') === 10);
check('AC-8.3: у другого проекта своё значение', Z.readBacklogSize(() => st, 'OTHER') === 5);
check('AC-8.3: чужое значение в хранилище — умолчание', Z.readBacklogSize(() => mem({'sdlc.backlog.size.CLAB': '50'}), 'CLAB') === 5 && Z.parseBacklogSize('abc') === 5 && Z.parseBacklogSize(null) === 5);
const boom = () => { throw new Error('SecurityError'); };
check('AC-8.3: localStorage недоступен — 5 строк, запись не падает', Z.readBacklogSize(boom, 'CLAB') === 5 && (Z.writeBacklogSize(boom, 'CLAB', 10), true));
check('AC-8.3: хранилище без setItem — запись не падает', (Z.writeBacklogSize(() => ({setItem: boom}), 'CLAB', 10), true));

const page5 = {tasks: [{key: 'X-1'}], total: 84};
const calls = [];
let page_ = await Z.fetchBacklog(async (qq) => { calls.push(qq); return page5; }, none, 5);
check('AC-8.1: один запрос с order=backlog и limit', calls.length === 1 && calls[0].order === 'backlog' && calls[0].limit === 5 && page_.total === 84);
const calls2 = [];
page_ = await Z.fetchBacklog(async (qq) => {
  calls2.push(qq);
  if (qq.order) throw Object.assign(new Error('order: неизвестный порядок "backlog"'), {httpStatus: 400});
  return page5;
}, none, 10);
check('AC-8.10: 400 на order — повтор без order, с тем же limit и фильтрами', calls2.length === 2 && calls2[1].order === undefined && calls2[1].limit === 10 && calls2[1].top_level === true && page_ === page5, JSON.stringify(calls2));
let thrown = null;
try { await Z.fetchBacklog(async () => { throw Object.assign(new Error('сервис недоступен'), {httpStatus: 500}); }, none, 5); } catch (e) { thrown = e; }
check('AC-8.11: 5xx — ошибка наружу (в блоке Failure), без повтора', thrown?.httpStatus === 500);
let n400 = 0;
try { await Z.fetchBacklog(async () => { n400++; throw Object.assign(new Error('limit: не число'), {httpStatus: 400}); }, none, 5); } catch { /* ожидаемо */ }
check('400 не про order — без повтора', n400 === 1);

console.log(`\n${ok} ✓, ${fail} ✗`);
if (fail > 0) process.exit(1);
