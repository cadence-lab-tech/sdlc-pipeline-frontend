import {useEffect, useLayoutEffect, useRef} from 'react';

import {resolveFocus, type FocusMemo, type FocusTarget, type RowRef} from './focusKeeper';

// Атрибуты разметки, по которым хук находит строки (TaskRow, Zone).
const ROW = '[data-task-key]';
const LINK = '[data-task-link]';
const ZONE = '[data-zone]';
const inZone = (zone: string) => `[data-zone="${CSS.escape(zone)}"]`;

const zoneOf = (el: Element) => el.closest<HTMLElement>(ZONE)?.dataset.zone ?? null;

// Фокус потерян: он на <body> или на элементе, которого уже нет в документе.
function focusLost(): boolean {
  const a = document.activeElement;
  return !a || a === document.body || a === document.documentElement || !a.isConnected;
}

function rowsOnPage(): RowRef[] {
  return Array.from(document.querySelectorAll<HTMLElement>(ROW), (el) => ({
    key: el.dataset.taskKey ?? '',
    zone: zoneOf(el),
  }));
}

function focusEl(el: Element | null | undefined) {
  if (el instanceof HTMLElement) el.focus({preventScroll: true});
}

function apply(target: FocusTarget) {
  switch (target.kind) {
    case 'task': {
      const rows = Array.from(document.querySelectorAll<HTMLElement>(ROW)).filter((e) => e.dataset.taskKey === target.key);
      const row = rows.find((e) => zoneOf(e) === target.zone) ?? rows[0];
      focusEl(row?.querySelector(LINK));
      break;
    }
    case 'zone-first':
      focusEl(document.querySelector(`${inZone(target.zone)} ${LINK}`));
      break;
    case 'zone-toggle':
      focusEl(document.querySelector(`${inZone(target.zone)} [data-zone-toggle]`));
      break;
  }
}

// Хранитель фокуса «Обзора». Следит за фокусом на странице: стоит на строке
// задачи — помнит её ключ и зону, ушёл на что-то другое или человек нажал
// мимо — забывает. После каждой отрисовки, пока память есть, а фокус потерян
// (строку пересоздали или убрали), возвращает его: на строку той же задачи,
// а когда страница дочитана и задачи нет — на первую строку её зоны.
// busy — страница сейчас читает зоны. Перечитывание не нужно запускать
// через хук: память держится с момента, как фокус встал на строку, и потому
// переживает и чтение, начатое раньше, чем человек пришёл на строку.
export function useFocusKeeper(busy: boolean) {
  const memoRef = useRef<FocusMemo | null>(null);

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const row = e.target instanceof Element ? e.target.closest<HTMLElement>(ROW) : null;
      memoRef.current = row?.dataset.taskKey ? {key: row.dataset.taskKey, zone: zoneOf(row)} : null;
    };
    const forget = () => {
      memoRef.current = null;
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('pointerdown', forget, true);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('pointerdown', forget, true);
    };
  }, []);

  // Без списка зависимостей: нужен каждый кадр, в котором пришли данные
  // какой-нибудь зоны. Без памяти или при живом фокусе — один выход.
  useLayoutEffect(() => {
    const memo = memoRef.current;
    if (!memo || !focusLost()) return;
    // Вернувшийся фокус даст focusin, и память обновится сама (зона новая).
    apply(resolveFocus(memo, rowsOnPage(), !busy));
  });
}
