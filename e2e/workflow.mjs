import {session, helpers} from './driver.mjs';

const BASE = process.env.SDLC_UI_URL ?? 'http://localhost:5173';
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};

const s = await session(BASE + '/p/SDLC/workflow');
const run = (body) => s.evaluate(helpers + body);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Строки секции «Статусы» и стрелки перестановки в них. Стрелка ищется по
// aria-label, а не по позиции: подпись — часть проверяемого поведения.
const statusHelpers = `
  const statusRows = () => {
    const section = all('section').find((e) => (e.querySelector('h2')?.innerText || '').trim() === 'Статусы');
    if (!section) throw new Error('секции «Статусы» на экране нет');
    return Array.from(section.querySelectorAll('ul > li'));
  };
  const statusKeys = () => statusRows().map((li) => (li.querySelectorAll('p')[1]?.innerText || '').split('·')[0].trim());
  const arrow = (li, kind) =>
    Array.from(li.querySelectorAll('button')).find((b) =>
      (b.getAttribute('aria-label') || '').startsWith(kind === 'up' ? 'Поднять' : 'Опустить'));
  // Версия выбирается кнопкой строки в панели версий и только ею: слово
  // «черновик» есть и в кнопке «Пустой черновик» над списком, а она заводит
  // новую версию вместо того, чтобы открыть существующую.
  const pickVersion = async (text) => {
    const row = Array.from(document.querySelectorAll('aside li button')).find((b) => (b.innerText || '').includes(text));
    if (!row) throw new Error('версии нет в панели: ' + text);
    row.click();
    await sleep(1600);
  };
  // Подсказка выключенной кнопки: события указателя до неё не доходят, их
  // получает обёртка, она же принимает фокус с клавиатуры.
  const tipOf = async (label) => {
    const btn = all('button').find((b) => (b.innerText || '').trim() === label);
    if (!btn) throw new Error('кнопки нет: ' + label);
    const wrap = btn.parentElement;
    wrap.dispatchEvent(new PointerEvent('pointermove', {bubbles: true}));
    if (wrap.focus) wrap.focus();
    await sleep(900);
    const tip = document.querySelector('[data-slot=tooltip-content]');
    return {disabled: btn.disabled, text: tip ? tip.innerText.replace(/\\s+/g, ' ').trim() : ''};
  };
`;
await new Promise((r) => setTimeout(r, 2000));

console.log('редактор цикла: активная версия');
let t = await run('return texts();');
check('активная версия помечена как неправимая', t.includes('Эта версия не редактируется'));
check('статусы цикла показаны', t.includes('Analysis') && t.includes('Code Review'));
check('гейты перехода показаны', t.includes('Апрув человеком'));
// Стрелки перестановки — правка, и на активной версии их быть не должно, как
// и «Править» с «Удалить»: по ней идут задачи.
const activeEditable = await run(statusHelpers + `
  return statusRows().some((li) =>
    arrow(li, 'up') || arrow(li, 'down') ||
    Array.from(li.querySelectorAll('button')).some((b) => ['Править', 'Удалить'].includes((b.innerText || '').trim())));
`);
check('у активной версии кнопок правки статусов нет', !activeEditable, String(activeEditable));

console.log('черновик копией активного');
await run('return click("Черновик копией активного");');
await new Promise((r) => setTimeout(r, 1500));
t = await run('return texts();');
check('создан черновик v2', t.includes('v2') && t.includes('черновик'), t.slice(0, 200));
check('черновик редактируется', t.includes('Добавить статус'));
check('в черновике те же статусы', t.includes('Code Review'));
check('активация доступна', !t.includes('Цикл не активируется'));

console.log('стрелки перестановки статусов');
const arrows = await run(statusHelpers + `
  const rows = statusRows();
  return {
    glyphs: rows.some((li) => Array.from(li.querySelectorAll('button')).some((b) => /[↑↓]/.test(b.innerText || ''))),
    rows: rows.map((li) => {
      const up = arrow(li, 'up');
      const down = arrow(li, 'down');
      return {
        name: (li.querySelectorAll('p')[0]?.innerText || '').trim(),
        key: (li.querySelectorAll('p')[1]?.innerText || '').split('·')[0].trim(),
        up: up?.getAttribute('aria-label') || '',
        down: down?.getAttribute('aria-label') || '',
        upOff: Boolean(up?.disabled),
        downOff: Boolean(down?.disabled),
        icons: Boolean(up?.querySelector('svg') && down?.querySelector('svg')),
      };
    }),
  };
`);
const rows = arrows.rows;
const order = rows.map((r) => r.key);
check('статусов в черновике больше двух', rows.length > 2, String(rows.length));
check('стрелки названы действием и статусом',
  rows.every((r) => r.up.includes(r.name) && r.up.includes('выше') && r.down.includes(r.name) && r.down.includes('ниже')),
  JSON.stringify(rows[0]));
check('стрелки — иконки, а не глифы ↑ ↓', !arrows.glyphs && rows.every((r) => r.icons));
check('на краях списка стрелка выключена',
  rows[0].upOff && !rows[0].downOff && rows[rows.length - 1].downOff && !rows[rows.length - 1].upOff,
  JSON.stringify(rows.map((r) => [r.upOff, r.downOff])));

console.log('удаление статуса называет, что уйдёт вместе с ним');
// Переходы ссылаются на статус с ON DELETE CASCADE: вместе со статусом
// пропадают и они, и гейты на них. Диалог обязан назвать это до подтверждения.
const cascade = await run(statusHelpers + `
  const row = statusRows()[1];
  const name = (row.querySelectorAll('p')[0].innerText || '').trim();
  Array.from(row.querySelectorAll('button')).find((b) => (b.innerText || '').trim() === 'Удалить').click();
  await sleep(700);
  const d = document.querySelector('[role=alertdialog]');
  const text = d ? d.innerText.replace(/\\s+/g, ' ') : '';
  await confirm('Отмена');
  const section = all('section').find((e) => (e.querySelector('h2')?.innerText || '').trim() === 'Переходы');
  return {name, text, transitions: (section?.innerText || '').replace(/\\s+/g, ' ')};
`);
// В списке переходов на экране стоят их названия, ключи — только в диалоге:
// сверяются названия, ключ остаётся при них для точности.
const named = (cascade.text.split('ведут: ')[1] || '').split(', а с ними')[0].split(', ');
const names = named.map((x) => x.replace(/\s*\([a-z0-9_]+\)\s*\.?$/, '').trim());
check('диалог удаления называет переходы и гейты, которые уйдут каскадом',
  cascade.text.includes(cascade.name) && cascade.text.includes('пропадут переходы') &&
    /гейты на этих переходах: [1-9]/.test(cascade.text), cascade.text);
check('названные переходы есть в цикле',
  names.length > 0 && names.every((n) => n && cascade.transitions.includes(n)), names.join(' | '));

console.log('перестановка статусов проходит');
// Ответ бэкенда задержан подменённым fetch: занятость кнопок иначе не поймать,
// запрос к локальному сервису отвечает быстрее, чем проверка успевает смотреть.
const moved = await run(statusHelpers + `
  const orig = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if ((init?.method || '').toUpperCase() === 'PUT' && /\\/statuses$/.test(url)) await sleep(1500);
    return orig(input, init);
  };
  arrow(statusRows()[1], 'down').click();
  await sleep(500);
  const row = statusRows()[1];
  const busy = [arrow(row, 'up').disabled, arrow(row, 'down').disabled];
  await sleep(2500);
  window.fetch = orig;
  const free = statusRows().map((li) => [arrow(li, 'up').disabled, arrow(li, 'down').disabled]);
  return {busy, free, keys: statusKeys(), page: texts()};
`);
check('пока перестановка в пути, обе стрелки строки заняты', moved.busy[0] && moved.busy[1], JSON.stringify(moved.busy));
check('после ответа занятость снята',
  moved.free.slice(1, -1).every(([u, d]) => !u && !d), JSON.stringify(moved.free));
check('порядок статусов изменился',
  moved.keys[1] === order[2] && moved.keys[2] === order[1], moved.keys.join(','));
check('удачная перестановка не показывает ошибку', !moved.page.includes('Порядок статусов не изменён'), moved.page.slice(0, 300));

await s.goto(BASE + '/p/SDLC/workflow');
await pause(2000);
const reloaded = await run(statusHelpers + 'return statusKeys();');
check('порядок сохранён после перезагрузки', reloaded.join(',') === moved.keys.join(','), reloaded.join(','));

console.log('отказ на перестановку виден');
// Отказ бэкенда на PUT статусов: на экране остаётся прежний порядок, причина
// названа сообщением бэкенда, необработанных отказов промиса нет.
const refused = await run(statusHelpers + `
  window.__unhandled = [];
  window.addEventListener('unhandledrejection', (e) => window.__unhandled.push(String(e.reason)));
  const orig = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if ((init?.method || '').toUpperCase() === 'PUT' && /\\/statuses$/.test(url)) {
      return new Response(JSON.stringify({error: {code: 'conflict', message: 'статуса нет в этой версии цикла'}}),
        {status: 409, headers: {'Content-Type': 'application/json'}});
    }
    return orig(input, init);
  };
  const before = statusKeys();
  arrow(statusRows()[1], 'down').click();
  await sleep(1500);
  window.fetch = orig;
  return {before, after: statusKeys(), unhandled: window.__unhandled, page: texts()};
`);
check('отказ перестановки показан баннером с сообщением бэкенда',
  refused.page.includes('Порядок статусов не изменён') && refused.page.includes('статуса нет в этой версии цикла'),
  refused.page.slice(0, 400));
check('при отказе порядок статусов не изменился', refused.after.join(',') === refused.before.join(','), refused.after.join(','));
check('необработанного отказа промиса нет', refused.unhandled.length === 0, refused.unhandled.join(' | '));

const restored = await run(statusHelpers + `
  arrow(statusRows()[2], 'up').click();
  await sleep(1800);
  return {keys: statusKeys(), page: texts()};
`);
check('повторный клик проходит и возвращает порядок', restored.keys.join(',') === order.join(','), restored.keys.join(','));
check('баннер отказа снят удачной перестановкой', !restored.page.includes('Порядок статусов не изменён'), restored.page.slice(0, 300));

console.log('проверка цикла ещё не ответила');
// Ответ проверки задержан: до него «Активировать» выключена, и подсказка
// обязана говорить именно про идущую проверку, а не про непройденную.
const pending = await run(statusHelpers + `
  const orig = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (/\\/validation$/.test(url)) await sleep(4000);
    return orig(input, init);
  };
  await pickVersion('Default SDLC · v1');
  await pickVersion('Default SDLC · v2');
  const tip = await tipOf('Активировать');
  await sleep(4500);
  window.fetch = orig;
  return tip;
`);
check('пока проверка не ответила, подсказка называет её',
  pending.disabled && pending.text.includes('Идёт проверка цикла'), JSON.stringify(pending));

console.log('проверка цикла отказала');
// Версия перевыбирается в панели: проверка запрашивается на монтировании
// редактора, и подменённый fetch пережил бы не перезагрузку, а только это.
const broken = await run(statusHelpers + `
  const orig = window.fetch;
  window.__restoreFetch = () => { window.fetch = orig; };
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (/\\/validation$/.test(url)) {
      return new Response(JSON.stringify({error: {code: 'internal', message: 'проверка недоступна'}}),
        {status: 500, headers: {'Content-Type': 'application/json'}});
    }
    return orig(input, init);
  };
  await pickVersion('Default SDLC · v1');
  await pickVersion('Default SDLC · v2');
  await sleep(600);
  return texts();
`);
check('отказ проверки цикла виден на экране',
  broken.includes('Проверка цикла не выполнена') && broken.includes('проверка недоступна'), broken.slice(0, 400));
const tipBroken = await run(statusHelpers + "return tipOf('Активировать');");
check('«Активировать» выключена, подсказка называет невыполненную проверку',
  tipBroken.disabled && tipBroken.text.includes('Проверку не удалось выполнить'), JSON.stringify(tipBroken));
// Та же подсказка одной клавиатурой: указателя не касаемся вовсе. Выключенная
// кнопка событий указателя не получает, и если бы фокус обёртки подсказку не
// открывал, причина недоступности осталась бы доступна только мыши.
const tipKeys = await run(`
  const btn = all('button').find((b) => (b.innerText || '').trim() === 'Активировать');
  const wrap = btn.parentElement;
  wrap.dispatchEvent(new PointerEvent('pointerleave', {bubbles: true}));
  wrap.blur();
  await sleep(1200);
  const closed = !document.querySelector('[data-slot=tooltip-content]');
  wrap.focus();
  await sleep(1000);
  const tip = document.querySelector('[data-slot=tooltip-content]');
  return {closed, focused: document.activeElement === wrap,
    text: tip ? tip.innerText.replace(/\\s+/g, ' ').trim() : ''};
`);
check('подсказка недоступной активации открывается одним фокусом, без указателя',
  tipKeys.closed && tipKeys.focused && tipKeys.text.includes('Проверку не удалось выполнить'),
  JSON.stringify(tipKeys));
const recovered = await run(`
  window.__restoreFetch();
  const again = all('button').find((b) => (b.innerText || '').trim() === 'Повторить');
  if (!again) throw new Error('кнопки «Повторить» у ошибки проверки нет');
  again.click();
  await sleep(1800);
  return texts();
`);
check('«Повторить» возвращает проверку',
  !recovered.includes('Проверка цикла не выполнена') && recovered.includes('Цикл проходит проверку'), recovered.slice(0, 300));

console.log('добавление статуса в черновик');
await run('return click("Добавить статус");');
await run('return fill("Ключ", "security_review");');
await run('return fill("Название", "Security review");');
await run('return click("Сохранить");');
await new Promise((r) => setTimeout(r, 1500));
t = await run('return texts();');
check('статус добавлен', t.includes('security_review'), t.slice(0, 300));
check('проверка нашла недостижимый статус', t.includes('Цикл не активируется'), t.slice(0, 400));
const tipInvalid = await run(statusHelpers + "return tipOf('Активировать');");
check('у непроходящего проверку черновика подсказка называет причину',
  tipInvalid.disabled && tipInvalid.text.includes('Цикл не проходит проверку'), JSON.stringify(tipInvalid));

console.log('удаление статуса возвращает цикл в рабочее состояние');
await run(`
  const rows = all('[class*=item], li').filter(el => (el.innerText||'').includes('security_review'));
  const row = rows[rows.length - 1];
  const btn = Array.from(row.querySelectorAll('button')).find(b => b.innerText.includes('Удалить'));
  btn.click();
  await sleep(700);
  return true;
`);
// Удаление необратимо: запрос уходит только после подтверждения в диалоге, и
// в тексте диалога назван удаляемый статус.
let dialog = await run(`
  const d = document.querySelector('[role=alertdialog]');
  return d ? d.innerText.replace(/\\s+/g, ' ') : '';
`);
check('удаление статуса просит подтверждения с именем статуса',
  dialog.includes('Удалить статус?') && dialog.includes('security_review'), dialog);
check('у статуса без переходов диалог так и говорит',
  dialog.includes('Переходов, которые его касаются, в цикле нет'), dialog);
t = await run('return texts();');
check('до подтверждения статус на месте', t.includes('security_review'), t.slice(0, 300));
await run('return confirm("Отмена");');
t = await run('return texts();');
check('«Отмена» закрывает диалог, статус на месте',
  t.includes('security_review') && !(await run('return Boolean(document.querySelector("[role=alertdialog]"));')), t.slice(0, 300));
await run(`
  const rows = all('[class*=item], li').filter(el => (el.innerText||'').includes('security_review'));
  const row = rows[rows.length - 1];
  const btn = Array.from(row.querySelectorAll('button')).find(b => b.innerText.includes('Удалить'));
  btn.click();
  await sleep(700);
  return confirm('Удалить');
`);
t = await run('return texts();');
check('статус удалён', !t.includes('security_review'), t.slice(0, 300));
const toastAfterDelete = await run('return toasts();');
check('об удалении сообщил тост с именем статуса',
  toastAfterDelete.some((x) => x.includes('удалён') && x.includes('security_review')), toastAfterDelete.join(' | '));
check('проблема ушла вместе со статусом', !t.includes('Цикл не активируется'), t.slice(0, 400));
// Все десять типов гейтов реализованы: у демонстрационного цикла ни ошибок, ни предупреждений.
check('проверка проходит без предупреждений', t.includes('Цикл проходит проверку') && !t.includes('Предупреждения'), t.slice(0, 400));

console.log('активация черновика');
// Второй клик по «Активировать», пока идёт первый, второй активации не шлёт:
// ответ задержан подменённым fetch, запросы считаются в нём же.
const activating = await run(`
  window.__activate = 0;
  const orig = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (/\\/activate$/.test(url)) { window.__activate++; await sleep(1500); }
    return orig(input, init);
  };
  const button = () => all('button').find((b) => (b.innerText || '').trim() === 'Активировать');
  button().click();
  await sleep(500);
  const busy = button().disabled;
  button().click();
  await sleep(2500);
  window.fetch = orig;
  return {busy, calls: window.__activate};
`);
check('пока активация идёт, кнопка занята', activating.busy, String(activating.busy));
check('второй клик второй активации не отправляет', activating.calls === 1, String(activating.calls));
await new Promise((r) => setTimeout(r, 2000));
t = await run('return texts();');
check('активация подтверждена', t.includes('активирована'), t.slice(0, 300));
check('показаны задачи, оставшиеся на прежней версии', t.includes('SDLC-1'), t.slice(0, 500));

console.log('доска после смены версии цикла');
await s.goto(BASE + '/p/SDLC/board');
await new Promise((r) => setTimeout(r, 1500));
t = await run('return texts();');
check('доска на новой версии цикла', t.includes('v2'), t.slice(0, 200));
check('задачи не пропали с доски', t.includes('SDLC-1') && t.includes('SDLC-3'), t.slice(0, 600));
check('задача с прежней версии помечена', t.includes('прежняя версия цикла'), t.slice(0, 600));

console.log('пустой черновик под другой тип задач');
await s.goto(BASE + '/p/SDLC/workflow');
await new Promise((r) => setTimeout(r, 1800));
// Циклов в проекте столько, сколько типов задач (решение 0024): черновик
// заводится под выбранный тип, а не под единственный.
await run(`
  const trigger = all('button').find((b) => (b.innerText || '').trim() === 'task');
  if (!trigger) throw new Error('переключателя типа задач нет');
  trigger.click();
  await sleep(600);
  const option = all('[role=option], li, button').find((e) => (e.innerText || '').trim() === 'epic');
  if (!option) throw new Error('типа epic нет в списке');
  option.click();
  await sleep(600);
  return true;
`);
await run('return click("Пустой черновик");');
await new Promise((r) => setTimeout(r, 1800));
t = await run('return texts();');
check('пустой черновик открывается без падения', t.includes('Статусы') && t.includes('Добавить статус'), t.slice(0, 300));
check('черновик заведён под тип epic', t.includes('черновик · epic'), t.slice(0, 400));
check('пустой цикл не активируется', t.includes('Цикл не активируется'), t.slice(0, 400));
check('названа причина', t.includes('начальн') || t.includes('стату'), t.slice(0, 500));

console.log('правка названия и типов черновика');
await run('return click("Название и типы");');
await run('return fill("Название", "Черновик под эпики");');
// Один цикл может вести несколько типов задач. Список типов в диалоге —
// последний на странице: такой же переключатель стоит в панели версий.
await run(`
  const triggers = all('button').filter((b) => (b.innerText || '').trim() === 'epic');
  triggers[triggers.length - 1].click();
  await sleep(700);
  const option = all('[role=option]').filter((o) => o.innerText.trim() === 'task').pop();
  if (!option) throw new Error('типа task нет в списке');
  option.click();
  await sleep(500);
  return true;
`);
await run('return click("Сохранить");');
await new Promise((r) => setTimeout(r, 1500));
t = await run('return texts();');
check('название черновика изменилось', t.includes('Черновик под эпики'), t.slice(0, 400));
check('черновик ведёт оба типа задач', t.includes('черновик · epic, task'), t.slice(0, 500));

await run('return click("Удалить черновик");');
dialog = await run(`
  const d = document.querySelector('[role=alertdialog]');
  return d ? d.innerText.replace(/\\s+/g, ' ') : '';
`);
check('удаление черновика просит подтверждения с его названием',
  dialog.includes('Удалить черновик?') && dialog.includes('Черновик под эпики'), dialog);
await run('return confirm("Удалить черновик");');
await new Promise((r) => setTimeout(r, 1000));
t = await run('return texts();');
check('черновик удалён', !t.includes('Черновик под эпики'), t.slice(0, 300));

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
