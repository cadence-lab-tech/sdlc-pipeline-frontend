// Раскладка «Пайплайна» (CLAB-346, design.spec v2 эпика CLAB-341): граф по
// слоям сверху вниз. Чистая функция «версия цикла → узлы, рёбра, входы и
// полосы» без React и без предметных ключей: ни одного ключа статуса или
// роли, только перечни схемы (вид перехода, категория статуса). Проверяется
// без браузера — e2e/pipeline-layout.mjs.
//
// Пять частей схемы:
//   - хребет — самый длинный путь переходов вперёд от начального статуса,
//     одной колонкой;
//   - ответвления — колонками слева от хребта;
//   - возвраты (вид reject, обратные рёбра и переходы «вверх») — отдельным
//     слоем дорожек справа, у пересекающихся по слоям — разные дорожки;
//   - цели «из любого статуса», недостижимые иначе, — справа от конца
//     хребта (на узком экране — под ним);
//   - статусы, не связанные с циклом, — по одному в ряд внизу.
// Фон — полосы фаз по категории статуса на хребте.
//
// Координаты узлов — левый верхний угол (узлы рисуются HTML поверх SVG);
// для геометрии graph/geometry есть nodeBox — прямоугольник по центру.
import type {Box, Point} from '../graph/geometry';

// Вид перехода «откат» — перечень схемы, а не ключ проекта.
const RETURN_KIND = 'reject';

export interface LayeredStatus {
  id: string;
  position: number;
  is_initial: boolean;
  is_terminal: boolean;
  category: string;
}

export interface LayeredTransition {
  id: string;
  position: number;
  from_status_id: string | null;
  to_status_id: string;
  kind: string;
}

export interface LayeredNode<S> {
  status: S;
  x: number;
  y: number;
  w: number;
  h: number;
  layer: number;
  col: number;
  spine: boolean;
  orphan: boolean;
  global: boolean;
}

export type EdgeKind = 'forward' | 'return' | 'skip';

export interface LayeredEdge<T> {
  // id перехода; у обхода выключенных этапов — свой, «skip:откуда:куда».
  id: string;
  transition?: T;
  kind: EdgeKind;
  from: string;
  to: string;
  d: string;
  arrow: string;
  // Вершины ломаной или опорные точки кривой: по ним проверка ищет пересечения.
  points: Point[];
  // Контрольная точка ребра: пилюля гейтов у ребра вперёд, середина дорожки у
  // возврата, пометка «пропуск» у обхода.
  mid: Point;
  tip: Point;
  track?: number;
  // Где ставить подпись возврата у выбранного узла: правее всех дорожек.
  labelAt?: Point;
  // Статусы, которые обходит пунктир просмотра пути (id).
  skipped?: string[];
}

export interface LayeredEntry<T> {
  id: string;
  transition: T;
  to: string;
  origin: Point;
  d: string;
  arrow: string;
}

export interface LayeredBand {
  category: string;
  orphan: boolean;
  y: number;
  h: number;
}

export interface LayeredLayout<S, T> {
  nodes: LayeredNode<S>[];
  edges: LayeredEdge<T>[];
  entries: LayeredEntry<T>[];
  bands: LayeredBand[];
  width: number;
  height: number;
}

export interface LayeredOptions {
  nodeW: number;
  nodeH: number;
  rowGap: number;
  colGap: number;
  gutter: number;
  showReturns: boolean;
  returnLabels: boolean;
  // Узкий экран: цели «из любого статуса» — под хребтом, а не справа.
  compact: boolean;
  // Выключенные необязательные этапы просмотра «Путь задачи» (id статусов).
  disabled: ReadonlySet<string>;
}

export const LAYERED_DEFAULTS: LayeredOptions = {
  nodeW: 280,
  nodeH: 92,
  rowGap: 64,
  colGap: 32,
  gutter: 168,
  showReturns: true,
  returnLabels: false,
  compact: false,
  disabled: new Set(),
};

export const LAYERED_COMPACT: LayeredOptions = {
  ...LAYERED_DEFAULTS,
  nodeW: 326,
  gutter: 16,
  colGap: 16,
  showReturns: false,
  compact: true,
};

const LANE_GAP = 20;
const LANE_OFFSET = 26;
const LABEL_W = 190;
const ENTRY_STEP = 22;
const ENTRY_PILL = 200;

const r = (v: number) => Math.round(v * 10) / 10;

export const nodeBox = (n: {x: number; y: number; w: number; h: number}): Box => ({
  x: n.x + n.w / 2,
  y: n.y + n.h / 2,
  width: n.w,
  height: n.h,
});

function arrowDown(x: number, y: number) {
  return `${r(x)},${r(y)} ${r(x - 4.5)},${r(y - 8)} ${r(x + 4.5)},${r(y - 8)}`;
}

function arrowLeft(x: number, y: number) {
  return `${r(x)},${r(y)} ${r(x + 8)},${r(y - 4)} ${r(x + 8)},${r(y + 4)}`;
}

// Ломаная со скруглёнными углами: прямые отрезки и короткие дуги в вершинах.
function roundedPath(points: Point[], radius = 8): string {
  if (points.length < 2) return '';
  const out = [`M ${r(points[0].x)} ${r(points[0].y)}`];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i - 1];
    const c = points[i];
    const n = points[i + 1];
    const inLen = Math.hypot(c.x - p.x, c.y - p.y);
    const outLen = Math.hypot(n.x - c.x, n.y - c.y);
    const k = Math.min(radius, inLen / 2, outLen / 2);
    const a = inLen ? {x: c.x - ((c.x - p.x) / inLen) * k, y: c.y - ((c.y - p.y) / inLen) * k} : c;
    const b = outLen ? {x: c.x + ((n.x - c.x) / outLen) * k, y: c.y + ((n.y - c.y) / outLen) * k} : c;
    out.push(`L ${r(a.x)} ${r(a.y)}`, `Q ${r(c.x)} ${r(c.y)} ${r(b.x)} ${r(b.y)}`);
  }
  const last = points[points.length - 1];
  out.push(`L ${r(last.x)} ${r(last.y)}`);
  return out.join(' ');
}

const byPosition = <X extends {position: number; id: string}>(a: X, b: X) =>
  a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function layoutLayered<S extends LayeredStatus, T extends LayeredTransition>(
  graph: {statuses: S[]; transitions: T[]},
  o: LayeredOptions = LAYERED_DEFAULTS,
): LayeredLayout<S, T> {
  // Порядок в ответе на раскладку не влияет: всё идёт по position.
  const statuses = [...graph.statuses].sort(byPosition);
  const byId = new Map(statuses.map((s) => [s.id, s]));
  const rank = new Map(statuses.map((s, i) => [s.id, i]));
  // Переход к статусу другой версии раскладку не роняет: его просто нет.
  const transitions = [...graph.transitions]
    .filter((t) => byId.has(t.to_status_id) && (t.from_status_id === null || byId.has(t.from_status_id)))
    .sort(byPosition);
  const initial = statuses.find((s) => s.is_initial) ?? statuses[0];
  if (!initial) {
    return {nodes: [], edges: [], entries: [], bands: [], width: o.gutter * 2, height: 64};
  }

  // Переходы вперёд — кандидаты в слои: не откат, не петля, не «из любого».
  const forwardCand = transitions.filter(
    (t) => t.from_status_id !== null && t.kind !== RETURN_KIND && t.from_status_id !== t.to_status_id,
  );
  const out = new Map<string, T[]>();
  for (const t of forwardCand) out.set(t.from_status_id!, [...(out.get(t.from_status_id!) ?? []), t]);

  // Обход в глубину от начального: ребро в предка — обратное, слои по нему
  // не считаются, иначе цикл переходов вперёд не дал бы слоям сойтись.
  const visit = new Map<string, 1 | 2>();
  const order: string[] = [];
  const back = new Set<string>();
  const dfs = (id: string) => {
    visit.set(id, 1);
    for (const t of out.get(id) ?? []) {
      const seen = visit.get(t.to_status_id);
      if (seen === 1) back.add(t.id);
      else if (!seen) dfs(t.to_status_id);
    }
    visit.set(id, 2);
    order.unshift(id);
  };
  dfs(initial.id);

  // Слой — длина самого длинного пути от начального.
  const layer = new Map<string, number>([[initial.id, 0]]);
  for (const id of order) {
    for (const t of out.get(id) ?? []) {
      if (back.has(t.id)) continue;
      layer.set(t.to_status_id, Math.max(layer.get(t.to_status_id) ?? 0, (layer.get(id) ?? 0) + 1));
    }
  }
  const reached = statuses.filter((s) => layer.has(s.id));

  // Конец хребта: самый глубокий; при равенстве — терминальный, затем меньшая позиция.
  let end = reached[0];
  for (const s of reached) {
    const ls = layer.get(s.id)!;
    const le = layer.get(end.id)!;
    if (ls > le || (ls === le && s.is_terminal && !end.is_terminal)) end = s;
  }
  const spine = new Set<string>();
  for (let cur: string | undefined = end.id; cur; ) {
    spine.add(cur);
    const l: number = layer.get(cur)!;
    const target: string = cur;
    const prev: T | undefined = forwardCand
      .filter((t) => !back.has(t.id) && t.to_status_id === target && layer.get(t.from_status_id!) === l - 1)
      .sort((a, b) => rank.get(a.from_status_id!)! - rank.get(b.from_status_id!)!)[0];
    cur = prev?.from_status_id ?? undefined;
  }
  const lastLayer = layer.get(end.id)!;

  // Колонки: хребет — 0, прочие достигнутые — влево, в порядке позиции.
  const col = new Map<string, number>();
  const taken = new Set<string>();
  const take = (id: string, l: number, c: number, step = -1) => {
    while (taken.has(`${l}:${c}`)) c += step;
    taken.add(`${l}:${c}`);
    col.set(id, c);
    layer.set(id, l);
  };
  for (const s of reached) if (spine.has(s.id)) take(s.id, layer.get(s.id)!, 0);
  for (const s of reached) if (!spine.has(s.id)) take(s.id, layer.get(s.id)!, -1);

  // Цели «из любого статуса», недостижимые переходами вперёд: справа от конца
  // хребта, одна под другой; на узком экране — под хребтом.
  const anyTargets = new Set(transitions.filter((t) => t.from_status_id === null).map((t) => t.to_status_id));
  const global = new Set<string>();
  let nextRow = lastLayer + 1;
  let globalRow = lastLayer;
  for (const s of statuses) {
    if (layer.has(s.id) || !anyTargets.has(s.id)) continue;
    global.add(s.id);
    if (o.compact) take(s.id, nextRow++, 0, 1);
    else take(s.id, globalRow++, 1, 1);
  }
  nextRow = Math.max(nextRow, globalRow);

  // Не связанные с циклом — по одному в ряд под всем остальным.
  const orphans = new Set<string>();
  for (const s of statuses) {
    if (layer.has(s.id)) continue;
    orphans.add(s.id);
    take(s.id, nextRow++, 0, 1);
  }

  // Над узлами первого ряда может стоять несколько входов «из любого».
  const entriesTo = new Map<string, T[]>();
  for (const t of transitions) {
    if (t.from_status_id === null) entriesTo.set(t.to_status_id, [...(entriesTo.get(t.to_status_id) ?? []), t]);
  }
  const firstRowEntries = Math.max(
    0,
    ...statuses.filter((s) => layer.get(s.id) === 0).map((s) => entriesTo.get(s.id)?.length ?? 0),
  );
  const top = 24 + Math.max(0, firstRowEntries - 1) * ENTRY_STEP;

  const minCol = Math.min(0, ...col.values());
  const maxLayer = Math.max(0, ...layer.values());
  const x0 = o.gutter + -minCol * (o.nodeW + o.colGap);
  const rowY = (l: number) => top + l * (o.nodeH + o.rowGap);
  const nodes: LayeredNode<S>[] = statuses.map((s) => ({
    status: s,
    x: x0 + col.get(s.id)! * (o.nodeW + o.colGap),
    y: rowY(layer.get(s.id)!),
    w: o.nodeW,
    h: o.nodeH,
    layer: layer.get(s.id)!,
    col: col.get(s.id)!,
    spine: spine.has(s.id),
    orphan: orphans.has(s.id),
    global: global.has(s.id),
  }));
  const node = new Map(nodes.map((n) => [n.status.id, n]));
  const rowNodes = (l: number) => nodes.filter((n) => n.layer === l);
  const leftOf = (lo: number, hi: number, fallback: number) =>
    Math.min(fallback, ...nodes.filter((n) => n.layer > lo && n.layer < hi).map((n) => n.x));

  const edges: LayeredEdge<T>[] = [];
  const entries: LayeredEntry<T>[] = [];
  const returns: T[] = [];

  // Переходы вперёд: от низа источника к верху цели. Параллельные рёбра между
  // одной парой сдвигаются, чтобы их контрольные точки не легли одна на другую.
  const parallel = new Map<string, number>();
  let detours = 0;
  for (const t of transitions) {
    if (t.from_status_id === null) continue;
    const a = node.get(t.from_status_id)!;
    const b = node.get(t.to_status_id)!;
    const isReturn = t.kind === RETURN_KIND || a === b || back.has(t.id) || b.layer <= a.layer;
    if (isReturn) {
      returns.push(t);
      continue;
    }
    const pairKey = `${a.status.id}>${b.status.id}`;
    const nth = parallel.get(pairKey) ?? 0;
    parallel.set(pairKey, nth + 1);
    const shift = nth * 14;
    const sy = a.y + a.h;
    const ey = b.y - 2;
    if (b.layer - a.layer > 1) {
      // Через слой: в обход слева от всего, что стоит в промежуточных рядах,
      // чтобы ребро не ушло под узлы. Обходы разводятся по горизонтали.
      const ax = a.x + 40 + shift;
      const bx = b.x + 40 + shift;
      // На узком экране слева только узкое поле: обход прижат к краю.
      const lx = o.compact
        ? Math.max(4, leftOf(a.layer, b.layer, Math.min(a.x, b.x)) - 8)
        : leftOf(a.layer, b.layer, Math.min(a.x, b.x)) - 84 - (detours % 3) * 12;
      detours++;
      const points = [
        {x: ax, y: sy},
        {x: ax, y: sy + 12},
        {x: lx, y: sy + 30},
        {x: lx, y: ey - 30},
        {x: bx, y: ey - 12},
        {x: bx, y: ey},
      ];
      const d = `M ${r(ax)} ${r(sy)} C ${r(ax)} ${r(sy + 30)} ${r(lx)} ${r(sy + 10)} ${r(lx)} ${r(sy + 50)} L ${r(lx)} ${r(ey - 50)} C ${r(lx)} ${r(ey - 10)} ${r(bx)} ${r(ey - 30)} ${r(bx)} ${r(ey)}`;
      edges.push({
        id: t.id,
        transition: t,
        kind: 'forward',
        from: a.status.id,
        to: b.status.id,
        d,
        arrow: arrowDown(bx, ey),
        points,
        mid: {x: lx, y: (sy + ey) / 2 + shift},
        tip: {x: bx, y: ey},
      });
      continue;
    }
    const sx = a.x + a.w / 2 + shift;
    const ex = b.x + b.w / 2 + shift;
    const cy = (sy + ey) / 2;
    const straight = Math.abs(sx - ex) < 1;
    const d = straight
      ? `M ${r(sx)} ${r(sy)} L ${r(ex)} ${r(ey)}`
      : `M ${r(sx)} ${r(sy)} C ${r(sx)} ${r(cy)} ${r(ex)} ${r(cy)} ${r(ex)} ${r(ey)}`;
    edges.push({
      id: t.id,
      transition: t,
      kind: 'forward',
      from: a.status.id,
      to: b.status.id,
      d,
      arrow: arrowDown(ex, ey),
      points: straight ? [{x: sx, y: sy}, {x: ex, y: ey}] : [{x: sx, y: sy}, {x: sx, y: cy}, {x: ex, y: cy}, {x: ex, y: ey}],
      mid: {x: (sx + ex) / 2, y: cy + (nth ? nth * 24 - 12 : 0)},
      tip: {x: ex, y: ey},
    });
  }

  // Просмотр пути: подряд выключенные этапы хребта обходятся пунктиром слева.
  if (o.disabled.size) {
    const sp = nodes.filter((n) => n.spine).sort((a, b) => a.layer - b.layer);
    for (let i = 1; i < sp.length - 1; i++) {
      if (!o.disabled.has(sp[i].status.id) || o.disabled.has(sp[i - 1].status.id)) continue;
      let j = i;
      while (j < sp.length - 1 && o.disabled.has(sp[j].status.id)) j++;
      if (o.disabled.has(sp[j].status.id)) continue;
      const a = sp[i - 1];
      const b = sp[j];
      const sx = a.x + 24;
      const sy = a.y + a.h;
      const ex = b.x + 24;
      const ey = b.y - 2;
      const lx = leftOf(a.layer, b.layer, a.x) - 56;
      const d = `M ${r(sx)} ${r(sy)} C ${r(sx)} ${r(sy + 30)} ${r(lx)} ${r(sy + 10)} ${r(lx)} ${r(sy + 50)} L ${r(lx)} ${r(ey - 50)} C ${r(lx)} ${r(ey - 10)} ${r(ex)} ${r(ey - 30)} ${r(ex)} ${r(ey)}`;
      edges.push({
        id: `skip:${a.status.id}:${b.status.id}`,
        kind: 'skip',
        from: a.status.id,
        to: b.status.id,
        d,
        arrow: arrowDown(ex, ey),
        points: [{x: sx, y: sy}, {x: lx, y: sy + 30}, {x: lx, y: ey - 30}, {x: ex, y: ey}],
        mid: {x: lx, y: (sy + ey) / 2},
        tip: {x: ex, y: ey},
        skipped: sp.slice(i, j).map((n) => n.status.id),
      });
      i = j;
    }
  }

  // Возвраты: дорожки справа. Короткий возврат — ближе к узлам; возвраты,
  // пересекающиеся по слоям, — на разных дорожках.
  let laneMax = 0;
  if (o.showReturns && returns.length) {
    const spans = returns
      .map((t) => {
        const a = node.get(t.from_status_id!)!;
        const b = node.get(t.to_status_id)!;
        return {t, a, b, lo: Math.min(a.layer, b.layer), hi: Math.max(a.layer, b.layer)};
      })
      .sort((p, q) => p.hi - p.lo - (q.hi - q.lo) || p.lo - q.lo || byPosition(p.t, q.t));
    const portCount = new Map<string, number>();
    for (const s of spans) {
      portCount.set(s.a.status.id, (portCount.get(s.a.status.id) ?? 0) + 1);
      portCount.set(s.b.status.id, (portCount.get(s.b.status.id) ?? 0) + 1);
    }
    const ports = new Map<string, number>();
    const port = (n: LayeredNode<S>) => {
      const i = ports.get(n.status.id) ?? 0;
      ports.set(n.status.id, i + 1);
      return n.y + 18 + ((n.h - 30) * (i + 0.5)) / portCount.get(n.status.id)!;
    };
    // Есть ли в ряду узел правее: тогда к дорожке идём не напрямую, а через
    // промежуток между рядами, иначе отрезок прошёл бы сквозь соседа.
    const blocked = (n: LayeredNode<S>) => rowNodes(n.layer).some((m) => m.x > n.x);
    const used: [number, number][][] = [];
    const laid: {s: (typeof spans)[number]; k: number; tx: number}[] = [];
    for (const s of spans) {
      let k = 0;
      while ((used[k] ?? []).some(([lo, hi]) => !(s.hi < lo || s.lo > hi))) k++;
      (used[k] ??= []).push([s.lo, s.hi]);
      const base = Math.max(...nodes.filter((n) => n.layer >= s.lo && n.layer <= s.hi).map((n) => n.x + n.w));
      const tx = base + LANE_OFFSET + k * LANE_GAP;
      laneMax = Math.max(laneMax, tx);
      laid.push({s, k, tx});
    }
    for (const {s, k, tx} of laid) {
      const {a, b, t} = s;
      const ay = port(a);
      const by = port(b);
      const up = b.layer < a.layer || (b.layer === a.layer && by < ay);
      const points: Point[] = [];
      const ar = a.x + a.w;
      const br = b.x + b.w;
      points.push({x: ar, y: ay});
      let laneFrom = ay;
      if (blocked(a)) {
        const gx = ar + o.colGap / 2;
        const gy = up ? a.y - 10 - k * 3 : a.y + a.h + 10 + k * 3;
        points.push({x: gx, y: ay}, {x: gx, y: gy}, {x: tx, y: gy});
        laneFrom = gy;
      } else {
        points.push({x: tx, y: ay});
      }
      let laneTo = by;
      if (blocked(b)) {
        const gx = br + o.colGap / 2;
        const gy = up ? b.y + b.h + 10 + k * 3 : b.y - 10 - k * 3;
        points.push({x: tx, y: gy}, {x: gx, y: gy}, {x: gx, y: by});
        laneTo = gy;
      } else {
        points.push({x: tx, y: by});
      }
      const tip = {x: br + 3, y: by};
      points.push(tip);
      edges.push({
        id: t.id,
        transition: t,
        kind: 'return',
        from: a.status.id,
        to: b.status.id,
        d: roundedPath(points),
        arrow: arrowLeft(tip.x, tip.y),
        points,
        mid: {x: tx, y: (laneFrom + laneTo) / 2},
        tip,
        track: k,
        labelAt: {x: 0, y: ay},
      });
    }
    for (const e of edges) if (e.kind === 'return' && e.labelAt) e.labelAt.x = laneMax + 8;
  }

  // «Из любого статуса»: одно обозначение над целевым узлом, несколько —
  // стопкой вверх.
  for (const [to, list] of entriesTo) {
    const b = node.get(to)!;
    list.forEach((t, i) => {
      const x = b.x + b.w - 28;
      const y = b.y - 16 - i * ENTRY_STEP;
      entries.push({
        id: t.id,
        transition: t,
        to,
        origin: {x, y},
        d: `M ${r(x)} ${r(y + 5)} L ${r(x)} ${r(b.y - 2)}`,
        arrow: arrowDown(x, b.y - 2),
      });
    });
  }

  // Полосы фаз: подряд идущие ряды одной категории хребта.
  const bands: LayeredBand[] = [];
  for (let l = 0; l <= maxLayer; l++) {
    const row = rowNodes(l);
    const n = row.find((x) => x.spine) ?? row.find((x) => !x.orphan) ?? row[0];
    if (!n) continue;
    const y0 = Math.max(0, rowY(l) - o.rowGap / 2 + 6);
    const y1 = rowY(l) + o.nodeH + o.rowGap / 2 - 6;
    const last = bands[bands.length - 1];
    if (last && last.category === n.status.category && last.orphan === n.orphan) last.h = y1 - last.y;
    else bands.push({category: n.status.category, orphan: n.orphan, y: y0, h: y1 - y0});
  }

  const maxRight = Math.max(...nodes.map((n) => n.x + n.w));
  const entryRight = entries.length ? Math.max(...entries.map((e) => e.origin.x + ENTRY_PILL)) : 0;
  const lanes = laneMax ? laneMax + 16 + (o.returnLabels ? LABEL_W : 0) : 0;
  const width = Math.max(maxRight + 16, entryRight, lanes);
  const height = rowY(maxLayer) + o.nodeH + 32;
  return {nodes, edges, entries, bands, width, height};
}

// Ключи статусов выключенных этапов просмотра пути → id статусов версии.
export function disabledIds(statuses: {id: string; key: string}[], keys: ReadonlySet<string>): Set<string> {
  return new Set(statuses.filter((s) => keys.has(s.key)).map((s) => s.id));
}
