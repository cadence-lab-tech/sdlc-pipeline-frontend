// Драйвер headless-Chrome по DevTools Protocol. Проверки кликают настоящими
// кнопками в настоящем браузере поверх живого бэкенда: экраны здесь показывают
// вердикт гейтов и состояние цикла, и подменять их заглушками — значит
// проверять заглушки.
const PORT = Number(process.env.SDLC_CDP_PORT ?? 9333);

async function target(url) {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, {method: 'PUT'});
  return res.json();
}

export async function session(url) {
  const t = await target(url);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((ok) => (ws.onopen = ok));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((ok) => {
      const n = ++id;
      pending.set(n, ok);
      ws.send(JSON.stringify({id: n, method, params}));
    });

  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', {
      expression: `(async () => { ${expr} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result?.result?.value;
  };

  await send('Page.enable');
  await evaluate('return 1');
  return {
    evaluate,
    goto: async (u) => {
      await send('Page.navigate', {url: u});
      await new Promise((r) => setTimeout(r, 1200));
    },
    // Ширина окна — не украшение: раскладку «две колонки на широком экране, одна
    // на узком» иначе не проверить, а из страницы окно не изменить.
    resize: async (width, height) => {
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await new Promise((r) => setTimeout(r, 500));
    },
    // Настоящее нажатие клавиши, а не синтетическое событие из страницы:
    // только оно включает :focus-visible, по которому видно кольцо фокуса.
    key: async (key, code = key, keyCode = 0) => {
      for (const type of ['keyDown', 'keyUp']) {
        await send('Input.dispatchKeyEvent', {type, key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode});
      }
      await new Promise((r) => setTimeout(r, 150));
    },
    // Буфер обмена в headless закрыт разрешением: без него writeText
    // отклоняется молча, и проверить копирование нечем.
    grant: async (permissions, origin) => {
      await send('Browser.grantPermissions', {origin, permissions});
    },
    // Настройки среды (prefers-reduced-motion, тема) приходят от системы, и
    // подменить их можно только эмуляцией: features — список
    // {name, value} в терминах CSS.
    emulate: async (features) => {
      await send('Emulation.setEmulatedMedia', {features});
      await new Promise((r) => setTimeout(r, 300));
    },
    // Скрипт, который выполняется в каждом новом документе до кода страницы:
    // так подменяется ответ сервера, которого стенд дать не может (404 у
    // ручки, сбой сети), — а не заглушкой всего бэкенда. Возвращает
    // идентификатор для removeInitScript.
    addInitScript: async (source) => {
      const r = await send('Page.addScriptToEvaluateOnNewDocument', {source});
      return r.result?.identifier;
    },
    removeInitScript: async (identifier) => {
      await send('Page.removeScriptToEvaluateOnNewDocument', {identifier});
    },
    close: () => ws.close(),
  };
}

export const helpers = `
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const all = (s) => Array.from(document.querySelectorAll(s));
  // Тосты об успехе живут в той же странице несколько секунд и называют
  // объект; из текста страницы они вычитаются, чтобы проверка «объекта
  // больше нет» не находила его в тосте. Сами тосты читаются через toasts().
  const texts = () => {
    const toaster = document.querySelector('[data-sonner-toaster]');
    const page = document.body.innerText.replace(/\\s+/g, ' ');
    const toastText = toaster ? (toaster.innerText || '').replace(/\\s+/g, ' ') : '';
    return toastText.trim() ? page.replace(toastText, ' ') : page;
  };
  const toasts = () => all('[data-sonner-toast]').map((el) => (el.innerText || '').replace(/\\s+/g, ' ').trim());
  const byText = (t, sel = 'button, [role=button], a') =>
    all(sel).find((el) => (el.innerText || '').trim().includes(t));
  const click = async (t, sel) => {
    const el = byText(t, sel);
    if (!el) throw new Error('не найдено: ' + t);
    el.click();
    await sleep(700);
    return true;
  };
  const fill = async (label, value) => {
    const lbl = all('label').find((l) => l.innerText.trim().startsWith(label));
    const field = lbl && document.getElementById(lbl.getAttribute('for'));
    if (!field) throw new Error('поле не найдено: ' + label);
    const proto = field.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(field, value);
    field.dispatchEvent(new Event('input', {bubbles: true}));
    await sleep(250);
    return true;
  };
  // Вкладки Radix переключаются по mousedown, а не по click: el.click() их
  // не трогает. press повторяет то, что делает мышь человека.
  const press = async (t, sel = '[role=tab], button') => {
    const el = all(sel).find((e) => (e.innerText || '').trim() === t);
    if (!el) throw new Error('не найдено: ' + t);
    const opts = {bubbles: true, cancelable: true, button: 0};
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.click();
    await sleep(700);
    return true;
  };
  const clickExact = async (t, sel = 'button, [role=button]') => {
    const el = all(sel).find((e) => (e.innerText || '').trim() === t);
    if (!el) throw new Error('не найдено точно: ' + t);
    el.click();
    await sleep(700);
    return true;
  };
  // Кнопка внутри карточки, у которой в тексте есть заголовок: на странице
  // несколько одинаковых кнопок, и нужна конкретная.
  // Кнопка внутри блока, в тексте которого есть заголовок: одинаковых кнопок
  // на странице несколько, и нужна конкретная — берём самый узкий блок,
  // в котором эта кнопка есть.
  const clickIn = async (cardText, buttonText) => {
    const candidates = all('div, li, section, article')
      .filter((el) => (el.innerText || '').includes(cardText))
      .filter((el) =>
        Array.from(el.querySelectorAll('button')).some(
          (b) => (b.innerText || '').trim() === buttonText,
        ),
      )
      .sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
    const card = candidates[0];
    if (!card) throw new Error('блок с кнопкой не найден: ' + cardText + ' / ' + buttonText);
    const btn = Array.from(card.querySelectorAll('button')).find(
      (b) => (b.innerText || '').trim() === buttonText,
    );
    btn.click();
    await sleep(900);
    return true;
  };
  // Необратимое действие подтверждается в AlertDialog: клик по кнопке с этим
  // текстом внутри [role=alertdialog] и ожидание, пока диалог закроется.
  const confirm = async (t) => {
    const dialog = document.querySelector('[role=alertdialog]');
    if (!dialog) throw new Error('диалог подтверждения не открыт: ' + t);
    const btn = Array.from(dialog.querySelectorAll('button')).find((b) => (b.innerText || '').trim() === t);
    if (!btn) throw new Error('в диалоге подтверждения нет кнопки: ' + t);
    btn.click();
    for (let i = 0; i < 50 && document.querySelector('[role=alertdialog]'); i++) await sleep(100);
    await sleep(900);
    return true;
  };
  const selectDraft = async () => {
    const row = all('[class*=item], li').find((el) => (el.innerText || '').includes('черновик'));
    if (row) { row.click(); await sleep(1200); }
    return Boolean(row);
  };
`;
