import {useCallback, useEffect, useLayoutEffect, useRef} from 'react';

// Опоры разметки: строка (TaskRow), её ссылка и элементы управления строки
// бэклога (шеврон, приоритет, меню), список страницы.
const ROW = '[data-task-key]';
const LINK = '[data-task-link]';
const CONTROL = '[data-row-control]';
const LIST = '[data-backlog-list]';

export type RowControl = 'link' | 'expand' | 'priority' | 'menu';

interface Memo {
  key: string;
  control: RowControl;
}

function focusLost(): boolean {
  const a = document.activeElement;
  return !a || a === document.body || a === document.documentElement || !a.isConnected;
}

function rowEl(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`${ROW}[data-task-key="${CSS.escape(key)}"]`);
}

function controlEl(row: HTMLElement, control: RowControl): HTMLElement | null {
  if (control === 'link') return row.querySelector<HTMLElement>(LINK);
  return (
    row.querySelector<HTMLElement>(`${CONTROL}[data-row-control="${control}"]`) ?? row.querySelector<HTMLElement>(LINK)
  );
}

// Фокус клавиатуры на странице бэклога (design.spec CLAB-368 §5.1, §6):
// строка, на которой он стоит, при переносе и перечитывании переставляется в
// документе, и браузер уводит фокус на <body>. Хук помнит задачу и элемент
// строки (ссылка, шеврон, приоритет, меню) и возвращает фокус туда же — на
// новом месте строки; строки на странице нет, а чтение закончилось — на
// первую строку списка. expect — запомнить заранее: меню порядка держит фокус
// в своём всплывающем списке, а после выбора фокус должен прийти на кнопку
// меню этой строки.
export interface BacklogFocus {
  expect: (key: string, control: RowControl) => void;
  restore: (key: string, control: RowControl) => void;
  check: () => void;
}

export function useBacklogFocus(busy: boolean): BacklogFocus {
  const memoRef = useRef<Memo | null>(null);

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      const row = target?.closest<HTMLElement>(ROW);
      if (!row?.dataset.taskKey) {
        // Фокус ушёл во всплывающее меню или список приоритета (портал): память
        // остаётся — после закрытия фокус вернётся на строку.
        if (target?.closest('[data-radix-popper-content-wrapper]')) return;
        memoRef.current = null;
        return;
      }
      const control = target?.closest<HTMLElement>(CONTROL)?.dataset.rowControl as RowControl | undefined;
      memoRef.current = {key: row.dataset.taskKey, control: control ?? 'link'};
    };
    // Нажатие мимо строк — человек ушёл сам, возвращать фокус некуда.
    const forget = (e: PointerEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('[data-radix-popper-content-wrapper]')) return;
      memoRef.current = null;
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('pointerdown', forget, true);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('pointerdown', forget, true);
    };
  }, []);

  // Вернуть потерянный фокус. Зовут страница и каждая группа (дети эпика
  // рисуются своим компонентом) после своей отрисовки.
  const busyRef = useRef(busy);
  useEffect(() => {
    busyRef.current = busy;
  });
  const check = useCallback(() => {
    const memo = memoRef.current;
    if (!memo || !focusLost()) return;
    const row = rowEl(memo.key);
    if (row) {
      controlEl(row, memo.control)?.focus({preventScroll: true});
      return;
    }
    if (busyRef.current) return;
    document.querySelector<HTMLElement>(`${LIST} ${LINK}`)?.focus({preventScroll: true});
  }, []);

  useLayoutEffect(() => {
    check();
  });

  const expect = useCallback((key: string, control: RowControl) => {
    memoRef.current = {key, control};
  }, []);

  // Вернуть фокус на элемент строки сейчас (после закрытия меню).
  const restore = useCallback((key: string, control: RowControl) => {
    memoRef.current = {key, control};
    const row = rowEl(key);
    if (row) controlEl(row, control)?.focus({preventScroll: true});
  }, []);

  return {expect, restore, check};
}
