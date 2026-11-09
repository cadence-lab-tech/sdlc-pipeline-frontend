// DOM-помощники раздела (отдельно от компонентов: быстрое обновление).

// Поле по серверному пути: первый фокусируемый контрол с таким data-path
// (подпись ошибки с тем же data-path идёт после него и фокуса не берёт).
export function fieldElement(path: string): HTMLElement | null {
  const sel = `[data-path="${path.replace(/["\\]/g, '\\$&')}"]`;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
    if (['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT'].includes(el.tagName) || el.hasAttribute('tabindex')) return el;
  }
  return null;
}

