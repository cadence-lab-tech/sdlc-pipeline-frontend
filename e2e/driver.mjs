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
    close: () => ws.close(),
  };
}

export const helpers = `
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const texts = () => document.body.innerText.replace(/\\s+/g, ' ');
  const all = (s) => Array.from(document.querySelectorAll(s));
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
  const selectDraft = async () => {
    const row = all('[class*=item], li').find((el) => (el.innerText || '').includes('черновик'));
    if (row) { row.click(); await sleep(1200); }
    return Boolean(row);
  };
`;
