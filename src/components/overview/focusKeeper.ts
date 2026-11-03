// Фокус клавиатуры при автообновлении «Обзора» (CLAB-367, AC-14.13, design
// §2.7): строка, на которой стоит фокус, может переехать в другую зону или
// уйти со страницы. Зоны — отдельные деревья, элемент пересоздаётся, и
// браузер уводит фокус на <body>. Страница помнит, на строке какой задачи
// стоит фокус, и когда он потерян, возвращает его на строку той же задачи — в
// любой зоне; задачи на странице нет — на первую строку той же зоны.
// Правила тут, без React и DOM; обход документа — useFocusKeeper.ts.

// Строка задачи, на которой стоял фокус: ключ и зона (data-zone; null — вне
// зон).
export interface FocusMemo {
  key: string;
  zone: string | null;
}

// Строка задачи на странице.
export type RowRef = FocusMemo;

export type FocusTarget =
  | {kind: 'task'; key: string; zone: string | null} // строка той же задачи
  | {kind: 'zone-first'; zone: string} // первая строка зоны, где был фокус
  | {kind: 'zone-toggle'; zone: string} // заголовок зоны, в которой строк не осталось
  | {kind: 'wait'} // зоны ещё читаются: задача может прийти в другую зону
  | {kind: 'none'};

// Куда вернуть фокус, который ушёл с запомненной строки. Пока зоны читаются
// (settled: false), задачи, которой нет, ждём: она может прийти в другую
// зону следующим ответом. Когда всё прочитано, а задачи нет — первая строка
// прежней зоны; строк там нет — заголовок зоны, чтобы фокус не ушёл в <body>.
export function resolveFocus(memo: FocusMemo, rows: RowRef[], settled: boolean): FocusTarget {
  const same = rows.filter((r) => r.key === memo.key);
  const row = same.find((r) => r.zone === memo.zone) ?? same[0];
  if (row) return {kind: 'task', key: row.key, zone: row.zone};
  if (!settled) return {kind: 'wait'};
  if (memo.zone === null) return {kind: 'none'};
  if (rows.some((r) => r.zone === memo.zone)) return {kind: 'zone-first', zone: memo.zone};
  return {kind: 'zone-toggle', zone: memo.zone};
}
