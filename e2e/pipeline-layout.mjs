// Раскладка «Пайплайна» по слоям и правила адреса страницы (CLAB-346) — без
// браузера, как cycle-layout.mjs: раскладка — чистая функция «версия цикла →
// узлы, рёбра, входы, полосы» (src/components/cycle/layered.ts), адрес —
// src/components/pipeline/params.ts.
//
// Циклы: все версии всех циклов стенда (GET /v1/workflows/:id), циклы нашего
// проекта (Simple, Epic, Release по docs/PROCESS.md) и синтетика: один
// статус, пустой, 3 и 9 этапов, ветка через слой, цикл из переходов вперёд,
// несвязанный статус, несколько «из любого статуса», длинные названия.
import {readFileSync, readdirSync} from 'node:fs';
import {registerHooks} from 'node:module';

// Модули интерфейса импортируют друг друга без расширения — подставляем .ts.
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

const {layoutLayered, nodeBox, disabledIds, LAYERED_DEFAULTS, LAYERED_COMPACT} = await import('../src/components/cycle/layered.ts');
const {boxesOverlap, pointInBox} = await import('../src/components/graph/geometry.ts');
const {parsePipelineParams, patchParams, isViewPatch, legacyPipelineSearch, clampZoom, zoomParam} = await import(
  '../src/components/pipeline/params.ts'
);

const API = process.env.SDLC_API_URL ?? 'http://localhost:8088';

let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};

// ── построитель циклов ──────────────────────────────────────────────────────
// statuses: ключи по порядку; transitions: [ключ, из (null — из любого), в, вид].
function cycle(name, statuses, transitions, {terminal = [], shuffle = false, names = {}, categories = {}} = {}) {
  const ss = statuses.map((key, i) => ({
    id: `${name}:${key}`,
    workflow_id: name,
    key,
    name: names[key] ?? key[0].toUpperCase() + key.slice(1).replace(/_/g, ' '),
    category: categories[key] ?? (i === 0 ? 'backlog' : terminal.includes(key) ? 'done' : 'active'),
    position: (i + 1) * 10,
    is_initial: i === 0,
    is_terminal: terminal.includes(key),
    is_optional: false,
    enabled_by_default: true,
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
  return {name, statuses: shuffle ? [...ss].reverse() : ss, transitions: shuffle ? [...ts].reverse() : ts};
}

const chain = (name, n, extra = []) => {
  const keys = Array.from({length: n}, (_, i) => `s${i + 1}`);
  return cycle(name, keys, [...keys.slice(1).map((k, i) => [`go${i + 1}`, keys[i], k]), ...extra], {terminal: [keys[n - 1]]});
};

const simple = cycle('Simple',
  ['new', 'analysis', 'design', 'development', 'testing', 'merge', 'release', 'done', 'cancelled'],
  [
    ['start', 'new', 'analysis'],
    ['analysis_done', 'analysis', 'design'],
    ['skip_design', 'analysis', 'development'],
    ['design_done', 'design', 'development'],
    ['dev_done', 'development', 'testing'],
    ['skip_testing', 'development', 'merge'],
    ['testing_passed', 'testing', 'merge'],
    ['merge_ready', 'merge', 'release'],
    ['released', 'release', 'done'],
    ['reject_to_analysis', 'development', 'analysis', 'reject'],
    ['testing_failed', 'testing', 'development', 'reject'],
    ['merge_conflict', 'merge', 'development', 'reject'],
    ['release_failed', 'release', 'development', 'reject'],
    ['cancel', null, 'cancelled', 'cancel'],
  ], {terminal: ['done', 'cancelled'], shuffle: true, categories: {cancelled: 'cancelled'}});

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

const long = 'Очень длинное название статуса, которое не помещается в узел схемы и обрезается';
const synthetic = [
  cycle('один статус', ['only'], []),
  cycle('один статус и вход', ['only'], [['reset', null, 'only'], ['reset2', null, 'only']]),
  chain('3 этапа', 3, [['back', 's3', 's1', 'reject']]),
  chain('9 этапов', 9, [['back_far', 's8', 's2', 'reject'], ['back_mid', 's6', 's4', 'reject'], ['back_near', 's3', 's2', 'reject'], ['abort', null, 's9', 'cancel']]),
  cycle('ветка через слой', ['s0', 'a', 'b', 'c', 'side', 'end'], [
    ['go', 's0', 'a'], ['ab', 'a', 'b'], ['bc', 'b', 'c'], ['ce', 'c', 'end'],
    ['branch', 'a', 'side'], ['join', 'side', 'end'], ['jump', 's0', 'c'], ['back_side', 'side', 'a', 'reject'],
  ], {terminal: ['end']}),
  cycle('цикл из переходов вперёд', ['s1', 's2', 's3', 's4'], [
    ['a', 's1', 's2'], ['b', 's2', 's3'], ['c', 's3', 's2'], ['d', 's3', 's4'], ['loop', 's3', 's3'],
  ], {terminal: ['s4']}),
  cycle('несвязанный статус', ['s1', 's2', 'lonely', 'other', 's3'], [
    ['a', 's1', 's2'], ['b', 's2', 's3'], ['o', 'lonely', 'other'], ['back', 'other', 's2'],
  ], {terminal: ['s3']}),
  cycle('несколько «из любого статуса»', ['s1', 's2', 's3', 'stop', 'pause'], [
    ['a', 's1', 's2'], ['b', 's2', 's3'],
    ['abort', null, 'stop', 'cancel'], ['halt', null, 'stop', 'cancel'], ['hold', null, 'pause'], ['resume', 'pause', 's2'],
  ], {terminal: ['stop', 's3']}),
  cycle('длинные названия', ['s1', 's2', 's3'], [['a', 's1', 's2'], ['b', 's2', 's3'], ['r', 's3', 's1', 'reject']], {
    terminal: ['s3'], names: {s1: long, s2: long + ' (2)', s3: long + ' (3)'},
  }),
  cycle('ветвление', ['s0', 'a', 'b1', 'b2', 'c', 'end'], [
    ['go', 's0', 'a'], ['left', 'a', 'b1'], ['right', 'a', 'b2'], ['join1', 'b1', 'c'], ['join2', 'b2', 'c'], ['finish', 'c', 'end'],
    ['back1', 'b1', 's0', 'reject'], ['back2', 'b2', 'a', 'reject'],
  ], {terminal: ['end']}),
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

// Точки вдоль ломаной: каждые 4 px по каждому отрезку.
function along(points) {
  const out = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4));
    for (let k = 0; k <= n; k++) out.push({x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n});
  }
  return out;
}

// ── проверки раскладки ──────────────────────────────────────────────────────
function verify(graph, options = LAYERED_DEFAULTS, tag = '') {
  const name = `${graph.name}${tag}`;
  console.log(`раскладка: ${name}`);
  const layout = layoutLayered(graph, options);
  const n = graph.statuses.length;
  check(`${name}: все статусы — узлы`, layout.nodes.length === n, String(layout.nodes.length));

  const boxes = layout.nodes.map((x) => ({...nodeBox(x), key: x.status.key, id: x.status.id}));
  const overlaps = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxesOverlap(boxes[i], boxes[j], 8)) overlaps.push(`${boxes[i].key}/${boxes[j].key}`);
    }
  }
  check(`${name}: узлы не пересекаются`, overlaps.length === 0, overlaps.join(' '));

  const inside = (p, m = 0) => p.x >= -m && p.y >= -m && p.x <= layout.width + m && p.y <= layout.height + m;
  check(`${name}: узлы в области схемы`,
    layout.nodes.every((x) => inside({x: x.x, y: x.y}) && inside({x: x.x + x.w, y: x.y + x.h})));

  const spine = layout.nodes.filter((x) => x.spine);
  check(`${name}: хребет в одной колонке`, new Set(spine.map((x) => x.x)).size <= 1, spine.map((x) => `${x.status.key}@${x.x}`).join(' '));
  const layers = spine.map((x) => x.layer).sort((a, b) => a - b);
  check(`${name}: хребет идёт слоями подряд`, layers.every((l, i) => l === i), layers.join());

  // У каждого перехода ровно одна контрольная точка: ребро вперёд (пилюля
  // гейтов), возврат (дорожка) или вход «из любого статуса».
  // Без слоя возвратов (узкий экран, выключатель) возвратов нет вовсе.
  const returnIds = new Set(layoutLayered(graph, {...options, showReturns: true}).edges.filter((e) => e.kind === 'return').map((e) => e.id));
  const problems = [];
  for (const t of graph.transitions) {
    const edges = layout.edges.filter((e) => e.id === t.id);
    const entries = layout.entries.filter((e) => e.id === t.id);
    const want = !options.showReturns && returnIds.has(t.id) ? 0 : 1;
    if (edges.length + entries.length !== want) problems.push(`${t.key}: ${edges.length} рёбер, ${entries.length} входов`);
    if (t.from_status_id === null && entries.length !== 1) problems.push(`${t.key}: «из любого» без входа`);
    if (options.showReturns && t.kind === 'reject' && !(edges.length === 1 && edges[0].kind === 'return')) problems.push(`${t.key}: откат не на дорожке`);
    for (const e of edges) {
      if (!e.d.startsWith('M ') || e.arrow.trim().split(/\s+/).length !== 3) problems.push(`${t.key}: ребро без стрелки`);
      if (!inside(e.mid, 1)) problems.push(`${t.key}: контрольная точка вне схемы`);
      const target = boxes.find((b) => b.id === e.to);
      if (!pointInBox(e.tip, target, 6) || pointInBox(e.tip, target, -1)) problems.push(`${t.key}: стрелка не у рамки «${target.key}»`);
    }
  }
  check(`${name}: у каждого перехода ровно одна контрольная точка`, problems.length === 0, problems.join('; '));

  // Возвраты — справа: дорожка правее всех узлов рядов, которые она проходит,
  // а пересекающиеся по слоям — на разных дорожках. Отрезки не идут сквозь
  // чужие узлы.
  const returns = layout.edges.filter((e) => e.kind === 'return');
  const laneProblems = [];
  const layerOf = new Map(layout.nodes.map((x) => [x.status.id, x.layer]));
  for (const e of returns) {
    const lo = Math.min(layerOf.get(e.from), layerOf.get(e.to));
    const hi = Math.max(layerOf.get(e.from), layerOf.get(e.to));
    const right = Math.max(...layout.nodes.filter((x) => x.layer >= lo && x.layer <= hi).map((x) => x.x + x.w));
    if (!(e.mid.x > right)) laneProblems.push(`${e.id}: дорожка не справа`);
    const through = boxes.filter((b) => b.id !== e.from && b.id !== e.to && along(e.points).some((p) => pointInBox(p, b, -2)));
    if (through.length) laneProblems.push(`${e.id}: сквозь ${through.map((b) => b.key).join(',')}`);
    for (const f of returns) {
      if (f === e) continue;
      const flo = Math.min(layerOf.get(f.from), layerOf.get(f.to));
      const fhi = Math.max(layerOf.get(f.from), layerOf.get(f.to));
      if (!(hi < flo || lo > fhi) && f.track === e.track) laneProblems.push(`${e.id}/${f.id}: одна дорожка`);
    }
  }
  check(`${name}: каждый возврат на своей дорожке справа`, laneProblems.length === 0, laneProblems.join('; '));

  // Рёбра вперёд не идут сквозь узлы.
  const through = [];
  for (const e of layout.edges.filter((x) => x.kind === 'forward')) {
    const hit = boxes.filter((b) => b.id !== e.from && b.id !== e.to && along(e.points).some((p) => pointInBox(p, b, -2)));
    if (hit.length) through.push(`${e.id}: ${hit.map((b) => b.key).join(',')}`);
  }
  check(`${name}: рёбра вперёд не проходят сквозь узлы`, through.length === 0, through.join('; '));

  // Несвязанные — в нижней полосе: ниже всех связанных и отмечены полосой.
  const orphans = layout.nodes.filter((x) => x.orphan);
  const linked = layout.nodes.filter((x) => !x.orphan);
  const bottom = Math.max(0, ...linked.map((x) => x.y + x.h));
  check(`${name}: несвязанные — внизу, в своей полосе`,
    orphans.every((x) => x.y >= bottom && layout.bands.some((b) => b.orphan && b.y <= x.y && b.y + b.h >= x.y + x.h)),
    orphans.map((x) => x.status.key).join());

  check(`${name}: входы «из любого» в области схемы и вне узлов`,
    layout.entries.every((e) => inside(e.origin) && boxes.every((b) => !pointInBox(e.origin, b, 2))),
    JSON.stringify(layout.entries.map((e) => e.origin)));

  const again = layoutLayered(graph, options);
  check(`${name}: раскладка детерминирована`, JSON.stringify(again) === JSON.stringify(layout));
  return layout;
}

for (const g of [simple, epic, release, ...synthetic, ...stand]) verify(g);
for (const g of [simple, synthetic[3], synthetic[7]]) verify(g, LAYERED_COMPACT, ' (узкий экран)');

console.log('раскладка: пустой цикл');
const empty = layoutLayered({statuses: [], transitions: []});
check('пустой цикл — пустая схема без ошибки', empty.nodes.length === 0 && empty.edges.length === 0 && empty.width > 0);

console.log('раскладка: порядок в ответе не важен');
const reversed = {...simple, statuses: [...simple.statuses].reverse(), transitions: [...simple.transitions].reverse()};
check('та же версия в другом порядке — те же координаты',
  JSON.stringify(layoutLayered(reversed).nodes.map((x) => [x.status.key, x.x, x.y])) ===
    JSON.stringify(layoutLayered(simple).nodes.map((x) => [x.status.key, x.x, x.y])));

console.log('раскладка: переход к статусу другой версии пропущен');
const broken = {...epic, transitions: [...epic.transitions, {...epic.transitions[0], id: 'чужой', to_status_id: 'нет-такого'}]};
check('переход к неизвестному статусу не роняет раскладку', layoutLayered(broken).edges.every((e) => e.id !== 'чужой'));

console.log('раскладка: возвраты скрыты');
const hidden = layoutLayered(simple, {...LAYERED_DEFAULTS, showReturns: false});
check('без слоя возвратов — ни одной дорожки', hidden.edges.every((e) => e.kind !== 'return'));
check('рёбра вперёд и входы на месте', hidden.edges.filter((e) => e.kind === 'forward').length === layoutLayered(simple).edges.filter((e) => e.kind === 'forward').length);

console.log('раскладка: «из любого статуса» — справа от конца хребта, на узком — под ним');
const wide = layoutLayered(simple);
const narrow = layoutLayered(simple, LAYERED_COMPACT);
const cancelled = (l) => l.nodes.find((x) => x.status.key === 'cancelled');
const doneNode = (l) => l.nodes.find((x) => x.status.key === 'done');
check('на широком — правее конца хребта', cancelled(wide).x > doneNode(wide).x && cancelled(wide).layer === doneNode(wide).layer);
check('на узком — под концом хребта', cancelled(narrow).x === doneNode(narrow).x && cancelled(narrow).y > doneNode(narrow).y);

console.log('раскладка: путь задачи');
const off = disabledIds(simple.statuses, new Set(['design']));
const path = layoutLayered(simple, {...LAYERED_DEFAULTS, disabled: off});
const skip = path.edges.filter((e) => e.kind === 'skip');
check('выключенный этап хребта обойдён одним пунктиром', skip.length === 1 && skip[0].skipped.length === 1, JSON.stringify(skip.map((e) => e.skipped)));
check('узлы и рёбра цикла при просмотре не меняются',
  JSON.stringify(path.nodes) === JSON.stringify(wide.nodes) &&
    path.edges.filter((e) => e.kind !== 'skip').length === wide.edges.length);

// ── адрес страницы ──────────────────────────────────────────────────────────
console.log('адрес страницы');
const q = (s) => new URLSearchParams(s);
const parsed = parsePipelineParams(q('type=epic&wf=abc&status=dev&role=analyst&v=3&returns=0&off=a,b&zoom=0.8&minimap=1'));
check('выбор, версия и вид разбираются',
  parsed.type === 'epic' && parsed.wf === 'abc' && parsed.status === 'dev' && parsed.role === 'analyst' && parsed.v === 3 &&
    parsed.showReturns === false && [...parsed.off].join() === 'a,b' && parsed.zoom === 0.8 && parsed.minimap === true,
  JSON.stringify({...parsed, off: [...parsed.off]}));
const bare = parsePipelineParams(q(''));
check('без параметров — без выбора, возвраты видны, масштаб 100%',
  !bare.type && !bare.wf && !bare.status && bare.showReturns && bare.off.size === 0 && bare.zoom === 1 && !bare.minimap);
check('мусор в v и zoom — как без них', parsePipelineParams(q('v=abc&zoom=x')).v === undefined && parsePipelineParams(q('zoom=x')).zoom === 1);
check('масштаб 50–150 % с шагом 10 %',
  clampZoom(0.2) === 0.5 && clampZoom(3) === 1.5 && clampZoom(0.84) === 0.8 && zoomParam(1) === undefined && zoomParam(0.7) === '0.7');
check('вид холста — replace, выбор — в историю',
  isViewPatch({zoom: '0.8'}) && isViewPatch({returns: '0', off: 'a'}) && !isViewPatch({status: 'x'}) && !isViewPatch({zoom: '1', role: 'r'}));
check('правка адреса не теряет прочих параметров',
  patchParams(q('type=task&zoom=0.8&x=1'), {status: 'a', zoom: undefined}).toString() === 'type=task&x=1&status=a');

console.log('старые адреса');
check('/roles?role=X → ?role=X', legacyPipelineSearch('?role=analyst') === '?role=analyst');
check('/workflow?workflow=<id> → ?wf=<id>', legacyPipelineSearch('?workflow=w1') === '?wf=w1');
check('прочие параметры не теряются', legacyPipelineSearch('?workflow=w1&status=dev&x=1') === '?status=dev&x=1&wf=w1', legacyPipelineSearch('?workflow=w1&status=dev&x=1'));
check('без параметров — без «?»', legacyPipelineSearch('') === '');

// ── без хардкода ────────────────────────────────────────────────────────────
console.log('ключи статусов и ролей не зашиты');
// Ключи из живых циклов стенда и нашего проекта.
const live = new Set(['new', 'analysis', 'development', 'testing', 'merge', 'release', 'done', 'cancelled',
  'planning', 'in_progress', 'prepare', 'publish', 'verify', 'analytics', 'developer', 'test', 'designer', 'integrator']);
for (const g of stand) for (const s of g.statuses) live.add(s.key);
for (const g of stand) for (const s of g.statuses) for (const r of s.roles ?? []) live.add(r.role_key);
const quoted = new RegExp(`(['"\`])(${[...live].map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\1`);
const files = [
  'src/pages/Pipeline.tsx',
  'src/components/cycle/layered.ts',
  ...readdirSync(new URL('../src/components/pipeline/', import.meta.url)).map((f) => `src/components/pipeline/${f}`),
];
for (const file of files) {
  const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const hit = text.split('\n').find((line) => quoted.test(line));
  check(`${file}: ключей статусов и ролей нет`, !hit, hit);
}
// Цвета — токены темы и пары dark:, сырых значений нет.
const rawColor = /#[0-9a-fA-F]{3,8}\b|rgba?\(|\bbg-white\b|\btext-black\b|\bbg-black\b|\btext-white\b/;
for (const file of files) {
  const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  check(`${file}: сырых цветов нет`, !rawColor.test(text), String(text.match(rawColor)));
  const unpaired = text.split('\n').find((line) => /\btext-(red|amber|emerald|blue)-[6-9]00\b/.test(line) && !/dark:text-/.test(line));
  check(`${file}: у цветного текста есть пара для тёмной темы`, !unpaired, unpaired);
}
for (const file of files.filter((f) => f.endsWith('.ts'))) {
  const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  check(`${file}: без React`, !/from ['"]react/.test(text));
}

console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
