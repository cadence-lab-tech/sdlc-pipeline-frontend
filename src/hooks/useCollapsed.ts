import {useState} from 'react';

// Свёрнутость секции — настройка вида, а не данные задачи: она про то, как
// человек привык читать карточку, и одинакова на всех задачах. Поэтому ключ
// общий, а не по задаче, и хранится в localStorage — конвенция «данные не
// кэшируются» про ответы API, а не про настройки экрана.
const PREFIX = 'sdlc.collapsed.';

export function useCollapsed(key: string): [boolean, (collapsed: boolean) => void] {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(PREFIX + key) === '1');

  const remember = (next: boolean) => {
    if (next) localStorage.setItem(PREFIX + key, '1');
    else localStorage.removeItem(PREFIX + key);
    setCollapsed(next);
  };

  return [collapsed, remember];
}
