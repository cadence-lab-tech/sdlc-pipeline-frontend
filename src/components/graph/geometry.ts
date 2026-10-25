// Геометрия графа: прямоугольные узлы, кривые рёбер и наконечники стрелок.
// Без React и без предметной области — только точки и прямоугольники, чтобы
// раскладки разных графов (цикл задачи, граф эпика) считали одно и то же
// одинаково, а проверялось это без браузера (e2e/cycle-layout.mjs).

export interface Point {
  x: number;
  y: number;
}

// Узел — прямоугольник, заданный центром: раскладке удобнее думать о
// центрах, а рисованию — о левом верхнем углу (см. boxCorner).
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const add = (a: Point, b: Point): Point => ({x: a.x + b.x, y: a.y + b.y});
export const sub = (a: Point, b: Point): Point => ({x: a.x - b.x, y: a.y - b.y});
export const scale = (a: Point, k: number): Point => ({x: a.x * k, y: a.y * k});
export const length = (a: Point): number => Math.hypot(a.x, a.y);
export const mid = (a: Point, b: Point): Point => ({x: (a.x + b.x) / 2, y: (a.y + b.y) / 2});

// Единичный вектор; у нулевого — запасное направление, а не NaN.
export function unit(a: Point, fallback: Point = {x: 0, y: -1}): Point {
  const len = length(a);
  return len < 1e-9 ? fallback : {x: a.x / len, y: a.y / len};
}

// Нормаль слева от направления (в координатах экрана, где y растёт вниз).
export const normal = (a: Point): Point => ({x: a.y, y: -a.x});

export function rotate(a: Point, radians: number): Point {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return {x: a.x * c - a.y * s, y: a.x * s + a.y * c};
}

export const boxCorner = (b: Box): Point => ({x: b.x - b.width / 2, y: b.y - b.height / 2});

// Пересекаются ли прямоугольники с учётом зазора между ними.
export function boxesOverlap(a: Box, b: Box, gap = 0): boolean {
  return (
    Math.abs(a.x - b.x) < (a.width + b.width) / 2 + gap &&
    Math.abs(a.y - b.y) < (a.height + b.height) / 2 + gap
  );
}

export function pointInBox(p: Point, b: Box, margin = 0): boolean {
  return Math.abs(p.x - b.x) <= b.width / 2 + margin && Math.abs(p.y - b.y) <= b.height / 2 + margin;
}

// Точка на границе прямоугольника (плюс отступ) по лучу из его центра в
// сторону toward: отсюда ребро выходит и сюда упирается стрелка.
export function boxBoundary(b: Box, toward: Point, margin = 0): Point {
  const d = sub(toward, b);
  const hw = b.width / 2 + margin;
  const hh = b.height / 2 + margin;
  if (Math.abs(d.x) < 1e-9 && Math.abs(d.y) < 1e-9) return {x: b.x, y: b.y - hh};
  const tx = Math.abs(d.x) < 1e-9 ? Infinity : hw / Math.abs(d.x);
  const ty = Math.abs(d.y) < 1e-9 ? Infinity : hh / Math.abs(d.y);
  const t = Math.min(tx, ty);
  return {x: b.x + d.x * t, y: b.y + d.y * t};
}

// Квадратичная кривая Безье: начало, контрольная точка, конец.
export interface Quad {
  start: Point;
  control: Point;
  end: Point;
}

// Кубическая — для петли «переход в тот же статус».
export interface Cubic {
  start: Point;
  c1: Point;
  c2: Point;
  end: Point;
}

export function quadAt(q: Quad, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * q.start.x + 2 * u * t * q.control.x + t * t * q.end.x,
    y: u * u * q.start.y + 2 * u * t * q.control.y + t * t * q.end.y,
  };
}

export function cubicAt(c: Cubic, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return {
    x: a * c.start.x + b * c.c1.x + d * c.c2.x + e * c.end.x,
    y: a * c.start.y + b * c.c1.y + d * c.c2.y + e * c.end.y,
  };
}

// Кривая между двумя узлами с заданной контрольной точкой: концы обрезаны
// по границам узлов, чтобы стрелка упиралась в рамку, а не в центр.
export function quadBetween(from: Box, to: Box, control: Point, margin = 3): Quad {
  return {
    start: boxBoundary(from, control, margin),
    control,
    end: boxBoundary(to, control, margin),
  };
}

// Петля над узлом: выходит и входит по сторонам от направления out.
export function loopOn(b: Box, out: Point, size: number, margin = 3): Cubic {
  const dir = unit(out);
  const side = normal(dir);
  // Концы петли — по обе стороны от направления, примерно на 20° от него.
  const anchorA = boxBoundary(b, add(add(b, scale(dir, 1000)), scale(side, 350)), margin);
  const anchorB = boxBoundary(b, add(add(b, scale(dir, 1000)), scale(side, -350)), margin);
  return {
    start: anchorA,
    c1: add(anchorA, add(scale(dir, size), scale(side, size / 2))),
    c2: add(anchorB, add(scale(dir, size), scale(side, -size / 2))),
    end: anchorB,
  };
}

// Наконечник стрелки: остриё в tip, направление — от from к tip.
export function arrowHead(tip: Point, from: Point, size = 8): [Point, Point, Point] {
  const dir = unit(sub(tip, from));
  const base = sub(tip, scale(dir, size));
  const side = scale(normal(dir), size * 0.5);
  return [tip, add(base, side), sub(base, side)];
}

export function samples<T>(curve: T, at: (c: T, t: number) => Point, n = 24): Point[] {
  return Array.from({length: n + 1}, (_, i) => at(curve, i / n));
}

export function boundsOf(points: Point[]): {minX: number; minY: number; maxX: number; maxY: number} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return {minX, minY, maxX, maxY};
}

export function boxPoints(b: Box): Point[] {
  const c = boxCorner(b);
  return [c, {x: c.x + b.width, y: c.y + b.height}];
}

// Строки для SVG: координаты округляются до десятых — точнее экран не
// покажет, а разметка короче.
const r = (v: number) => Math.round(v * 10) / 10;
const pt = (p: Point) => `${r(p.x)} ${r(p.y)}`;

export const quadPath = (q: Quad) => `M ${pt(q.start)} Q ${pt(q.control)} ${pt(q.end)}`;
export const cubicPath = (c: Cubic) => `M ${pt(c.start)} C ${pt(c.c1)} ${pt(c.c2)} ${pt(c.end)}`;
export const linePath = (a: Point, b: Point) => `M ${pt(a)} L ${pt(b)}`;
export const polygonPoints = (ps: Point[]) => ps.map((p) => `${r(p.x)},${r(p.y)}`).join(' ');
