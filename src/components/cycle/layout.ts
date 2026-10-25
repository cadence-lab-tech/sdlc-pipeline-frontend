// Раскладка схемы цикла: версия цикла → узлы и рёбра с координатами. Чистая
// функция без React: проверяется без браузера (e2e/cycle-layout.mjs) на
// циклах стенда и синтетических графах.
//
// Ни одного ключа статуса или роли здесь нет и быть не должно — их
// придумывает проект. Раскладка опирается только на перечни схемы и порядок:
// `position` статусов, `kind` перехода (возврат — `reject`) и
// `from_status_id = null` («из любого статуса»).
import type {Status, Transition} from '../../api/types';
import {
  type Box,
  type Cubic,
  type Point,
  type Quad,
  add,
  arrowHead,
  boundsOf,
  boxBoundary,
  boxesOverlap,
  boxPoints,
  cubicAt,
  cubicPath,
  length,
  linePath,
  loopOn,
  mid,
  normal,
  polygonPoints,
  quadAt,
  quadBetween,
  quadPath,
  rotate,
  samples,
  scale,
  sub,
  unit,
} from '../graph/geometry';

export const NODE_WIDTH = 136;
export const NODE_HEIGHT = 40;
// Зазор между рамками узлов: меньше — стрелки между соседями не помещаются.
export const NODE_GAP = 28;
export const PADDING = 16;
// Круг вытянут по горизонтали: узлы шире, чем выше, и схема стоит над
// вкладками, где ширины больше, чем высоты.
const ASPECT = 1.6;
const MIN_RADIUS = 96;
const ENTRY_LENGTH = 30;

export interface CycleGraph {
  statuses: Status[];
  transitions: Transition[];
}

export interface CycleNode extends Box {
  id: string;
  key: string;
  name: string;
  color?: string;
  category: string;
  initial: boolean;
  terminal: boolean;
  // Место в порядке `position`, с нуля.
  index: number;
}

export interface CycleEdge {
  id: string;
  key: string;
  name: string;
  kind: string;
  // Возврат рисуется иначе, чем движение вперёд.
  reject: boolean;
  from: string;
  to: string;
  loop: boolean;
  d: string;
  arrow: string;
  // Точки кривой и остриё стрелки — для проверок раскладки, рисованию не нужны.
  points: Point[];
  tip: Point;
}

// Переход «из любого статуса» — одно обозначение у целевого узла, а не
// ребро из каждого статуса.
export interface CycleEntry {
  id: string;
  key: string;
  name: string;
  kind: string;
  to: string;
  origin: Point;
  d: string;
  arrow: string;
  tip: Point;
}

export interface CycleLayout {
  width: number;
  height: number;
  nodes: CycleNode[];
  edges: CycleEdge[];
  entries: CycleEntry[];
}

// Статусы в порядке `position`; при равных — по ключу, чтобы раскладка не
// зависела от порядка в ответе.
export function orderStatuses(statuses: Status[]): Status[] {
  return [...statuses].sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));
}

const ORIGIN: Point = {x: 0, y: 0};

// Узлы по эллипсу по часовой стрелке от верхней точки. Радиус растёт, пока
// рамки не разойдутся с зазором: так узлы не наезжают при любом числе статусов.
function ring(count: number): Point[] {
  if (count === 1) return [ORIGIN];
  let radius = MIN_RADIUS;
  for (let attempt = 0; attempt < 80; attempt++) {
    const centers = Array.from({length: count}, (_, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / count;
      return {x: radius * ASPECT * Math.cos(angle), y: radius * Math.sin(angle)};
    });
    const boxes = centers.map((c) => ({...c, width: NODE_WIDTH, height: NODE_HEIGHT}));
    let clear = true;
    for (let i = 0; i < boxes.length && clear; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (boxesOverlap(boxes[i], boxes[j], NODE_GAP)) {
          clear = false;
          break;
        }
      }
    }
    if (clear) return centers;
    radius *= 1.08;
  }
  throw new Error('раскладка цикла: узлы не разошлись');
}

type Curve = {kind: 'quad'; q: Quad} | {kind: 'cubic'; c: Cubic};

const curvePoints = (curve: Curve): Point[] =>
  curve.kind === 'quad' ? samples(curve.q, quadAt) : samples(curve.c, cubicAt);

export function layoutCycle(graph: CycleGraph): CycleLayout {
  const ordered = orderStatuses(graph.statuses);
  if (ordered.length === 0) return {width: 0, height: 0, nodes: [], edges: [], entries: []};

  const centers = ring(ordered.length);
  const nodes: CycleNode[] = ordered.map((s, index) => ({
    id: s.id,
    key: s.key,
    name: s.name,
    color: s.color || undefined,
    category: s.category,
    initial: s.is_initial,
    terminal: s.is_terminal,
    index,
    x: centers[index].x,
    y: centers[index].y,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const count = nodes.length;

  const transitions = [...graph.transitions].sort(
    (a, b) => a.position - b.position || a.key.localeCompare(b.key),
  );

  // Несколько рёбер между одной парой узлов (вперёд и назад, два разных
  // перехода) разводятся по сторонам и по величине изгиба.
  const lanes = new Map<string, number>();
  const lane = (key: string) => {
    const n = lanes.get(key) ?? 0;
    lanes.set(key, n + 1);
    return n;
  };

  const drafts: {t: Transition; curve: Curve; tipFrom: Point; tip: Point; loop: boolean}[] = [];
  for (const t of transitions) {
    if (t.from_status_id === null) continue;
    const from = byId.get(t.from_status_id);
    const to = byId.get(t.to_status_id);
    if (!from || !to) continue;
    const reject = t.kind === 'reject';

    if (from.id === to.id) {
      const k = lane(`loop:${from.id}`);
      const c = loopOn(from, unit(sub(from, ORIGIN)), 34 + 16 * k);
      drafts.push({t, curve: {kind: 'cubic', c}, tipFrom: c.c2, tip: c.end, loop: true});
      continue;
    }

    // Соседи по кругу соединяются дугой снаружи — это и есть «кольцо» цикла.
    // Всё остальное (возвраты, переходы через статус) идёт внутри круга, где
    // узлов нет.
    const gap = Math.abs(from.index - to.index);
    const adjacent = count <= 2 || gap === 1 || gap === count - 1;
    const outside = adjacent && !reject;
    const [lo, hi] = from.id < to.id ? [from, to] : [to, from];
    const k = lane(`${lo.id}:${hi.id}:${outside ? 'out' : 'in'}`);

    const m = mid(from, to);
    const chord = length(sub(to, from));
    const outward = unit(sub(m, ORIGIN), unit(normal(sub(hi, lo))));
    const bend = chord * (outside ? 0.14 : 0.22) + 22 * k;
    const control = add(m, scale(outward, outside ? bend : -bend));
    const q = quadBetween(from, to, control);
    drafts.push({t, curve: {kind: 'quad', q}, tipFrom: q.control, tip: q.end, loop: false});
  }

  // «Из любого статуса»: короткая стрелка снаружи к целевому узлу. Несколько
  // таких переходов в один статус расходятся веером.
  const entryCount = new Map<string, number>();
  for (const t of transitions) {
    if (t.from_status_id === null && byId.has(t.to_status_id)) {
      entryCount.set(t.to_status_id, (entryCount.get(t.to_status_id) ?? 0) + 1);
    }
  }
  const entryDrafts: {t: Transition; origin: Point; tip: Point}[] = [];
  for (const t of transitions) {
    if (t.from_status_id !== null) continue;
    const to = byId.get(t.to_status_id);
    if (!to) continue;
    const k = lane(`entry:${to.id}`);
    const total = entryCount.get(to.id) ?? 1;
    const out = rotate(unit(sub(to, ORIGIN)), (k - (total - 1) / 2) * 0.45);
    const tip = boxBoundary(to, add(to, scale(out, 1000)), 3);
    const origin = add(tip, scale(out, ENTRY_LENGTH));
    entryDrafts.push({t, origin, tip});
  }

  // Сдвиг всей картинки в положительные координаты с полями.
  const all: Point[] = [
    ...nodes.flatMap(boxPoints),
    ...drafts.flatMap((d) => curvePoints(d.curve)),
    ...entryDrafts.flatMap((e) => [add(e.origin, {x: -6, y: -6}), add(e.origin, {x: 6, y: 6})]),
  ];
  const b = boundsOf(all);
  const shift: Point = {x: PADDING - b.minX, y: PADDING - b.minY};
  const move = (p: Point) => add(p, shift);

  for (const n of nodes) {
    n.x += shift.x;
    n.y += shift.y;
  }

  const edges: CycleEdge[] = drafts.map(({t, curve, tipFrom, tip, loop}) => {
    const moved: Curve =
      curve.kind === 'quad'
        ? {kind: 'quad', q: {start: move(curve.q.start), control: move(curve.q.control), end: move(curve.q.end)}}
        : {
            kind: 'cubic',
            c: {start: move(curve.c.start), c1: move(curve.c.c1), c2: move(curve.c.c2), end: move(curve.c.end)},
          };
    const movedTip = move(tip);
    return {
      id: t.id,
      key: t.key,
      name: t.name,
      kind: t.kind,
      reject: t.kind === 'reject',
      from: t.from_status_id as string,
      to: t.to_status_id,
      loop,
      d: moved.kind === 'quad' ? quadPath(moved.q) : cubicPath(moved.c),
      arrow: polygonPoints(arrowHead(movedTip, move(tipFrom))),
      points: curvePoints(moved),
      tip: movedTip,
    };
  });

  const entries: CycleEntry[] = entryDrafts.map(({t, origin, tip}) => {
    const o = move(origin);
    const end = move(tip);
    return {
      id: t.id,
      key: t.key,
      name: t.name,
      kind: t.kind,
      to: t.to_status_id,
      origin: o,
      d: linePath(o, end),
      arrow: polygonPoints(arrowHead(end, o)),
      tip: end,
    };
  });

  return {
    width: Math.ceil(b.maxX - b.minX + PADDING * 2),
    height: Math.ceil(b.maxY - b.minY + PADDING * 2),
    nodes,
    edges,
    entries,
  };
}
