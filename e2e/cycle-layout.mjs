// Раскладка схемы цикла и правила состояния на ней (CLAB-284) — без
// браузера. Раскладка — чистая функция «версия цикла → узлы и рёбра»
// (src/components/cycle/layout.ts), поэтому проверяется прямо в исходниках,
// как словари подписей в labels.mjs.
//
// Циклы: все версии всех циклов стенда (GET /v1/workflows/:id), циклы нашего
// проекта (Simple трёх поколений, Epic, Release — записаны ниже по
// docs/PROCESS.md: в стенде их нет) и синтетические графы с тем, что в
// живых циклах встречается редко: ветвление, два терминальных статуса,
// возврат через несколько статусов, несколько переходов «из любого статуса»,
// петля, один статус, пустой цикл.
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

const {layoutCycle, orderStatuses} = await import('../src/components/cycle/layout.ts');
const {awaitsApproval, cycleProgress, nodeLabel, resolveStage, toggleStage} = await import(
  '../src/components/cycle/state.ts'
);
const {boxesOverlap, pointInBox} = await import('../src/components/graph/geometry.ts');

const API = process.env.SDLC_API_URL ?? 'http://localhost:8088';

let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};

// ── построитель циклов ──────────────────────────────────────────────────────
// statuses: ключи по порядку (position — место в списке, если не задано);
// transitions: [ключ, из (null — из любого), в, вид].
function cycle(name, statuses, transitions, {terminal = [], shuffle = false} = {}) {
  const ss = statuses.map((key, i) => ({
    id: `${name}:${key}`,
    workflow_id: name,
    key,
    name: key[0].toUpperCase() + key.slice(1).replace(/_/g, ' '),
    category: 'active',
    position: (i + 1) * 10,
    is_initial: i === 0,
    is_terminal: terminal.includes(key),
    color: i % 2 ? '#3b82f6' : undefined,
  }));
  const id = (key) => {
    const s = ss.find((x) => x.key === key);
    if (!s) throw new Error(`${name}: нет статуса ${key}`);
    return s.id;
  };
  const ts = transitions.map(([key, from, to, kind = 'advance'], i) => ({
    id: `${name}:${key}`,
    workflow_id: name,
    key,
    name: key,
    from_status_id: from === null ? null : id(from),
    to_status_id: id(to),
    kind,
    auto: false,
    position: i + 1,
  }));
  // Порядок в ответе не должен влиять на раскладку.
  return {name, statuses: shuffle ? [...ss].reverse() : ss, transitions: ts};
}

const simpleNow = cycle('Simple (текущая)',
  ['new', 'analysis', 'development', 'testing', 'merge', 'release', 'done', 'cancelled'],
  [
    ['start', 'new', 'analysis'],
    ['analysis_done', 'analysis', 'development'],
    ['dev_done', 'development', 'testing'],
    ['testing_passed', 'testing', 'merge'],
    ['merge_ready', 'merge', 'release'],
    ['released', 'release', 'done'],
    ['reject_to_analysis', 'development', 'analysis', 'reject'],
    ['testing_failed', 'testing', 'development', 'reject'],
    ['merge_conflict', 'merge', 'development', 'reject'],
    ['release_failed', 'release', 'development', 'reject'],
    ['cancel', null, 'cancelled', 'cancel'],
  ], {terminal: ['done', 'cancelled'], shuffle: true});

const simpleV2 = cycle('Simple v2',
  ['new', 'analysis', 'development', 'testing', 'merge', 'done', 'cancelled'],
  [
    ['start', 'new', 'analysis'],
    ['analysis_done', 'analysis', 'development'],
    ['dev_done', 'development', 'testing'],
    ['testing_passed', 'testing', 'merge'],
    ['merged', 'merge', 'done'],
    ['reject_to_analysis', 'development', 'analysis', 'reject'],
    ['testing_failed', 'testing', 'development', 'reject'],
    ['merge_conflict', 'merge', 'development', 'reject'],
    ['cancel', null, 'cancelled', 'cancel'],
  ], {terminal: ['done', 'cancelled']});

const simpleV1 = cycle('Simple v1',
  ['new', 'analysis', 'development', 'testing', 'done', 'cancelled'],
  [
    ['start', 'new', 'analysis'],
    ['analysis_done', 'analysis', 'development'],
    ['dev_done', 'development', 'testing'],
    ['testing_passed', 'testing', 'done'],
    ['reject_to_analysis', 'development', 'analysis', 'reject'],
    ['testing_failed', 'testing', 'development', 'reject'],
    ['cancel', null, 'cancelled', 'cancel'],
  ], {terminal: ['done', 'cancelled']});

const epic = cycle('Epic',
  ['planning', 'analysis', 'in_progress', 'done', 'cancelled'],
  [
    ['start', 'planning', 'analysis'],
    ['breakdown_done', 'analysis', 'in_progress'],
    ['children_done', 'in_progress', 'done'],
    ['replan', 'in_progress', 'analysis', 'reject'],
    ['cancel', null, 'cancelled', 'cancel'],
  ], {terminal: ['done', 'cancelled']});

const release = cycle('Release',
  ['new', 'prepare', 'publish', 'verify', 'done', 'cancelled'],
  [
    ['start', 'new', 'prepare'],
    ['prepared', 'prepare', 'publish'],
    ['published', 'publish', 'verify'],
    ['verified', 'verify', 'done'],
    ['publish_failed', 'publish', 'prepare', 'reject'],
    ['verify_failed', 'verify', 'prepare', 'reject'],
    ['cancel', null, 'cancelled', 'cancel'],
  ], {terminal: ['done', 'cancelled']});

const synthetic = [
  cycle('ветвление', ['s0', 'a', 'b1', 'b2', 'c', 'end'], [
    ['go', 's0', 'a'], ['left', 'a', 'b1'], ['right', 'a', 'b2'],
    ['join1', 'b1', 'c'], ['join2', 'b2', 'c'], ['finish', 'c', 'end'],
  ], {terminal: ['end']}),
  cycle('два терминальных', ['s0', 'work', 'ok', 'dropped'], [
    ['go', 's0', 'work'], ['accept', 'work', 'ok'], ['drop', 'work', 'dropped'],
  ], {terminal: ['ok', 'dropped']}),
  cycle('возврат через несколько статусов', ['s1', 's2', 's3', 's4', 's5', 's6'], [
    ['a', 's1', 's2'], ['b', 's2', 's3'], ['c', 's3', 's4'], ['d', 's4', 's5'], ['e', 's5', 's6'],
    ['back_far', 's5', 's1', 'reject'], ['back_mid', 's4', 's2', 'reject'], ['back_near', 's3', 's2', 'reject'],
  ], {terminal: ['s6']}),
  cycle('из любого статуса', ['s1', 's2', 's3', 'stop', 'pause'], [
    ['a', 's1', 's2'], ['b', 's2', 's3'],
    ['abort', null, 'stop', 'cancel'], ['halt', null, 'stop', 'cancel'], ['hold', null, 'pause'],
  ], {terminal: ['stop']}),
  cycle('один статус', ['only'], []),
  cycle('один статус и вход', ['only'], [['reset', null, 'only']]),
  cycle('два статуса туда и обратно', ['s1', 's2'], [
    ['there', 's1', 's2'], ['back', 's2', 's1'], ['undo', 's2', 's1', 'reject'],
  ]),
  cycle('петля и вперёд-назад', ['s1', 's2', 's3'], [
    ['again', 's2', 's2'], ['again_twice', 's2', 's2'], ['fwd', 's1', 's2'], ['rev', 's2', 's1'], ['on', 's2', 's3'],
  ]),
  cycle('длинный цикл через статус', Array.from({length: 14}, (_, i) => `s${i + 1}`), [
    ...Array.from({length: 13}, (_, i) => [`step${i + 1}`, `s${i + 1}`, `s${i + 2}`]),
    ['skip', 's3', 's7'], ['jump_back', 's12', 's2', 'reject'], ['across', 's1', 's8'],
  ]),
];

// ── циклы стенда ────────────────────────────────────────────────────────────
async function standCycles() {
  const get = (path) => fetch(API + path, {headers: {'X-SDLC-Actor': 'e2e'}}).then((r) => {
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  });
  const out = [];
  const {projects} = await get('/v1/projects');
  for (const p of projects) {
    const heads = await get(`/v1/projects/${p.key}/workflows`);
    for (const h of Array.isArray(heads) ? heads : heads.workflows ?? []) {
      const w = await get(`/v1/workflows/${h.id}`);
      out.push({name: `стенд ${p.key}: ${w.name} v${w.version} (${w.state})`, statuses: w.statuses ?? [], transitions: w.transitions ?? []});
    }
  }
  return out;
}

let stand = [];
try {
  stand = await standCycles();
} catch (err) {
  console.log(`  - циклы стенда не прочитаны (${err.message}): проверяются записанные`);
}

// ── проверки раскладки ──────────────────────────────────────────────────────
function verify(graph) {
  console.log(`раскладка: ${graph.name}`);
  const layout = layoutCycle(graph);
  const n = graph.statuses.length;
  const want = orderStatuses(graph.statuses).map((s) => s.key);
  check(`${graph.name}: все статусы — узлы, в порядке position`,
    layout.nodes.length === n && layout.nodes.map((x) => x.key).join() === want.join(),
    layout.nodes.map((x) => x.key).join());

  const overlaps = [];
  for (let i = 0; i < layout.nodes.length; i++) {
    for (let j = i + 1; j < layout.nodes.length; j++) {
      if (boxesOverlap(layout.nodes[i], layout.nodes[j], 8)) overlaps.push(`${layout.nodes[i].key}/${layout.nodes[j].key}`);
    }
  }
  check(`${graph.name}: узлы не пересекаются`, overlaps.length === 0, overlaps.join(' '));

  const inside = (p, m = 0) => p.x >= -m && p.y >= -m && p.x <= layout.width + m && p.y <= layout.height + m;
  const outsideNodes = layout.nodes.filter((b) =>
    !inside({x: b.x - b.width / 2, y: b.y - b.height / 2}) || !inside({x: b.x + b.width / 2, y: b.y + b.height / 2}));
  check(`${graph.name}: узлы в области схемы`, outsideNodes.length === 0, outsideNodes.map((b) => b.key).join());

  const byId = new Map(layout.nodes.map((x) => [x.id, x]));
  const problems = [];
  for (const t of graph.transitions) {
    const edges = layout.edges.filter((e) => e.id === t.id);
    const entries = layout.entries.filter((e) => e.id === t.id);
    if (t.from_status_id === null) {
      if (edges.length !== 0 || entries.length !== 1) problems.push(`${t.key}: из любого — ${entries.length} обозначений, ${edges.length} рёбер`);
      continue;
    }
    if (edges.length !== 1 || entries.length !== 0) {
      problems.push(`${t.key}: ${edges.length} рёбер`);
      continue;
    }
    const e = edges[0];
    if (e.reject !== (t.kind === 'reject')) problems.push(`${t.key}: возврат не помечен`);
    const arrow = e.arrow.trim().split(/\s+/);
    if (arrow.length !== 3 || !e.d.startsWith('M ')) problems.push(`${t.key}: ребро без стрелки`);
    const target = byId.get(t.to_status_id);
    if (!target || !pointInBox(e.tip, target, 4) || pointInBox(e.tip, target, -1)) problems.push(`${t.key}: стрелка не у рамки «${target?.key}»`);
    if (!e.points.every((p) => inside(p, 1))) problems.push(`${t.key}: ребро вне области схемы`);
    // Ребро не проходит сквозь чужие узлы: иначе не понять, куда оно ведёт.
    const through = layout.nodes.filter((b) => b.id !== e.from && b.id !== e.to && e.points.some((p) => pointInBox(p, b, -2)));
    if (through.length) problems.push(`${t.key}: проходит через ${through.map((b) => b.key).join(',')}`);
  }
  check(`${graph.name}: у каждого перехода одно ребро со стрелкой, «из любого» — одно обозначение`, problems.length === 0, problems.join('; '));

  const ds = layout.edges.map((e) => e.d);
  check(`${graph.name}: рёбра не совпадают (вперёд и назад различимы)`, new Set(ds).size === ds.length);
  check(`${graph.name}: обозначения «из любого» вне узлов и в области схемы`,
    layout.entries.every((e) => inside(e.origin) && layout.nodes.every((b) => !pointInBox(e.origin, b, 2))),
    JSON.stringify(layout.entries.map((e) => e.origin)));
  return layout;
}

for (const g of [simpleNow, simpleV2, simpleV1, epic, release, ...synthetic, ...stand]) verify(g);

console.log('раскладка: пустой цикл');
const empty = layoutCycle({statuses: [], transitions: []});
check('пустой цикл — пустая схема без ошибки', empty.nodes.length === 0 && empty.edges.length === 0);

console.log('раскладка: переход к статусу другой версии пропущен');
const broken = {...epic, transitions: [...epic.transitions, {...epic.transitions[0], id: 'чужой', to_status_id: 'нет-такого'}]};
check('переход к неизвестному статусу не роняет раскладку', layoutCycle(broken).edges.every((e) => e.id !== 'чужой'));

console.log('раскладка: порядок в ответе не важен');
const reversed = {...simpleNow, statuses: [...simpleNow.statuses].reverse(), transitions: [...simpleNow.transitions].reverse()};
check('та же версия в другом порядке — та же схема',
  JSON.stringify(layoutCycle(reversed).nodes) === JSON.stringify(layoutCycle(simpleNow).nodes));

// ── состояние на схеме ──────────────────────────────────────────────────────
console.log('состояние на схеме');
const run = (status_key, extra = {}) => ({id: `${status_key}-${Math.random()}`, status_key, state: 'passed', attempt: 1, entered_at: '2026-10-25T10:00:00Z', ...extra});
const gate = (type, status, blocking = true) => ({gate_key: type, gate_name: type, type, blocking, status});
const advance = (gates) => ({key: 'go', name: 'go', kind: 'advance', to_status: 'x', allowed: false, gates});
const runs = [
  run('new', {finished_at: '2026-10-25T10:01:00Z'}),
  run('analysis', {finished_at: '2026-10-25T10:02:00Z'}),
  run('development', {finished_at: '2026-10-25T10:03:00Z'}),
  run('development', {id: 'review', parent_run_id: 'x', finished_at: '2026-10-25T10:03:30Z'}),
  run('analysis', {state: 'in_progress', attempt: 2}),
];
const progress = cycleProgress(simpleNow.statuses, 'analysis', runs, [
  advance([gate('artifacts_required', 'passed'), gate('agent_review', 'waived'), gate('human_approval', 'pending'), gate('external_check', 'failed', false)]),
]);
check('текущий статус — по ключу задачи', progress.get('analysis').state === 'current');
check('пройденный — есть законченный прогон верхнего уровня', progress.get('new').state === 'passed' && progress.get('development').state === 'passed');
check('будущий — прогонов нет', progress.get('testing').state === 'future' && progress.get('done').state === 'future');
check('попытки — прогоны верхнего уровня, перепроверка не считается',
  progress.get('analysis').attempts === 2 && progress.get('development').attempts === 1, JSON.stringify([...progress]));
check('ждёт апрува — только у текущего', progress.get('analysis').awaitingApproval && !progress.get('development').awaitingApproval);

check('ждёт апрува: всё блокирующее, кроме апрува, прошло или снято', awaitsApproval([
  advance([gate('artifacts_required', 'passed'), gate('agent_review', 'waived'), gate('human_approval', 'pending')]),
]));
check('не ждёт: держит ещё и артефакт', !awaitsApproval([
  advance([gate('artifacts_required', 'pending'), gate('human_approval', 'pending')]),
]));
check('не ждёт: апрув уже поставлен', !awaitsApproval([
  advance([gate('artifacts_required', 'passed'), gate('human_approval', 'passed')]),
]));
check('не ждёт: апрува на переходе нет', !awaitsApproval([advance([gate('artifacts_required', 'passed')])]));
check('не ждёт: апрув не блокирующий', !awaitsApproval([advance([gate('human_approval', 'pending', false)])]));
check('не ждёт: апрув на возврате, а не на движении вперёд', !awaitsApproval([
  {...advance([gate('human_approval', 'pending')]), kind: 'reject'},
]));
check('не ждёт: из терминального статуса переходов нет', !awaitsApproval([]));
check('неблокирующий непройденный гейт апрува не отменяет', awaitsApproval([
  advance([gate('human_approval', 'pending'), gate('drift_clear', 'failed', false)]),
]));

const label = nodeLabel('Analysis', progress.get('analysis'), true);
check('подпись узла: имя, состояние, попытки, апрув, выбор',
  label === 'Analysis, текущий статус, попыток: 2, ждёт апрува, выбран', label);
check('подпись будущего узла без лишнего', nodeLabel('Testing', progress.get('testing'), false) === 'Testing, впереди');

console.log('выбор этапа в адресе');
check('известный ключ выбран', resolveStage('testing', simpleNow.statuses) === 'testing');
check('незнакомый ключ — как без выбора', resolveStage('нет-такого', simpleNow.statuses) === undefined);
check('без версии цикла выбора нет', resolveStage('testing', undefined) === undefined);
check('пустой параметр — без выбора', resolveStage('', simpleNow.statuses) === undefined);
check('выбор другого узла', toggleStage('analysis', 'testing') === 'testing');
check('повторный выбор снимает выбор', toggleStage('testing', 'testing') === undefined);

// ── без хардкода ────────────────────────────────────────────────────────────
console.log('ключи статусов и ролей не зашиты');
const KEYS = ['new', 'analysis', 'development', 'testing', 'merge', 'release', 'done', 'cancelled',
  'planning', 'in_progress', 'prepare', 'publish', 'verify', 'analytics', 'developer', 'test'];
const quoted = new RegExp(`(['"\`])(${KEYS.join('|')})\\1`);
const dirs = ['src/components/cycle', 'src/components/graph'];
const files = dirs.flatMap((d) => readdirSync(new URL(`../${d}/`, import.meta.url)).map((f) => `${d}/${f}`));
for (const file of files) {
  const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const hit = text.split('\n').find((line) => quoted.test(line));
  check(`${file}: ключей статусов и ролей нет`, !hit, hit);
}
for (const file of files.filter((f) => f.endsWith('.ts'))) {
  const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  check(`${file}: без React`, !/from ['"]react/.test(text));
}

console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
