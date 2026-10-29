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

// Необязательные этапы (CLAB-317, решение 0066): диалог статуса, бейджи строки
// и перехват тел запросов к статусам. Переключатель находится по подписи, а его
// состояние читается из aria-checked.
const optionalHelpers = `
  const dialog = () => document.querySelector('[role=dialog]');
  const sw = (label) => {
    const l = dialog() && Array.from(dialog().querySelectorAll('label')).find((x) => x.innerText.trim().startsWith(label));
    return l ? document.getElementById(l.getAttribute('for')) : null;
  };
  const rowOf = (key) => statusRows().find((li) => (li.querySelectorAll('p')[1]?.innerText || '').split('·')[0].trim() === key);
  const editStatus = async (key) => {
    Array.from(rowOf(key).querySelectorAll('button')).find((b) => (b.innerText || '').trim() === 'Править').click();
    await sleep(700);
  };
  const toggle = async (label) => { sw(label).click(); await sleep(300); };
  const saveDialog = async () => {
    Array.from(dialog().querySelectorAll('button')).find((b) => (b.innerText || '').trim() === 'Сохранить').click();
    await sleep(1800);
  };
  const closeDialog = async () => {
    Array.from(dialog().querySelectorAll('button')).find((b) => (b.innerText || '').trim() === 'Отмена').click();
    await sleep(600);
  };
  // Тела запросов к статусам: PATCH и POST. Запрос уходит настоящий.
  const spyStatuses = () => {
    window.__bodies = [];
    const orig = window.fetch;
    window.__origFetch = orig;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = (init?.method || 'GET').toUpperCase();
      if (['PATCH', 'POST'].includes(method) && /\\/statuses(\\/[a-z_]+)?$/.test(url)) {
        window.__bodies.push(JSON.parse(init.body));
      }
      return orig(input, init);
    };
  };
  const unspy = () => { if (window.__origFetch) window.fetch = window.__origFetch; };
`;

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

console.log('необязательный этап: диалог статуса');
// Обязательный статус: переключатель умолчания скрыт, пока отметки нет.
await run(statusHelpers + optionalHelpers + "await editStatus('architecture'); return true;");
const dlg0 = await run(optionalHelpers + `
  return {
    optional: sw('Необязательный')?.getAttribute('aria-checked'),
    hasDefault: Boolean(sw('Включён по умолчанию')),
  };
`);
check('у обязательного статуса «Необязательный» выключен', dlg0.optional === 'false', JSON.stringify(dlg0));
check('умолчание скрыто, пока отметки нет', !dlg0.hasDefault, JSON.stringify(dlg0));
const dlg1 = await run(optionalHelpers + `
  await toggle('Необязательный');
  return {
    optional: sw('Необязательный')?.getAttribute('aria-checked'),
    def: sw('Включён по умолчанию')?.getAttribute('aria-checked') ?? null,
  };
`);
check('с отметкой появляется «Включён по умолчанию», он включён',
  dlg1.optional === 'true' && dlg1.def === 'true', JSON.stringify(dlg1));
await run(optionalHelpers + "await closeDialog(); return true;");

console.log('необязательный этап: сохранение отметки и умолчания (AC-1, AC-5)');
const marked = await run(statusHelpers + optionalHelpers + `
  spyStatuses();
  await editStatus('architecture');
  await toggle('Необязательный');
  await toggle('Включён по умолчанию');
  await saveDialog();
  unspy();
  const row = rowOf('architecture');
  return {bodies: window.__bodies, row: row.innerText.replace(/\\s+/g, ' '), page: texts(),
    dialogOpen: Boolean(dialog()), toast: toasts()};
`);
check('тело запроса несёт отметку и умолчание «выключен»',
  marked.bodies.length === 1 && marked.bodies[0].is_optional === true && marked.bodies[0].enabled_by_default === false,
  JSON.stringify(marked.bodies));
check('диалог закрыт, тост называет статус',
  !marked.dialogOpen && marked.toast.some((x) => x.includes('architecture') && x.includes('сохранён')), JSON.stringify(marked.toast));
check('строка статуса показывает «необязательный» и «выключен по умолчанию»',
  marked.row.includes('необязательный') && marked.row.includes('выключен по умолчанию'), marked.row);
check('ключ статуса по-прежнему во втором <p> строки',
  (await run(statusHelpers + 'return statusKeys();')).includes('architecture'));
// Проверка пересчитана без перехода по адресу: у необязательного этапа
// сервер предупреждает об обходных переходах и не держит активацию.
check('предупреждения сервера видны без перезагрузки',
  marked.page.includes('Предупреждения') && marked.page.includes('"architecture"'), marked.page.slice(0, 600));
check('предупреждение активацию не держит',
  !marked.page.includes('Цикл не активируется') && !(await run(statusHelpers + "return tipOf('Активировать');")).disabled);

await s.goto(BASE + '/p/SDLC/workflow');
await pause(2000);
await run(statusHelpers + "await pickVersion('Default SDLC · v2'); return true;");
const afterReload = await run(statusHelpers + optionalHelpers + `
  return {row: rowOf('architecture').innerText.replace(/\\s+/g, ' '), other: rowOf('analysis').innerText.replace(/\\s+/g, ' ')};
`);
check('после перезагрузки отметка и умолчание на месте',
  afterReload.row.includes('необязательный') && afterReload.row.includes('выключен по умолчанию'), afterReload.row);
check('у обычного статуса бейджей отметки нет', !afterReload.other.includes('необязательный'), afterReload.other);

console.log('необязательный этап: диалог показывает сохранённое');
const reopened = await run(statusHelpers + optionalHelpers + `
  await editStatus('architecture');
  const r = {optional: sw('Необязательный')?.getAttribute('aria-checked'), def: sw('Включён по умолчанию')?.getAttribute('aria-checked')};
  await closeDialog();
  return r;
`);
check('в диалоге те же значения, что в списке', reopened.optional === 'true' && reopened.def === 'false', JSON.stringify(reopened));

console.log('необязательный этап: проблема держит активацию (AC-4, AC-5)');
const problem = await run(statusHelpers + optionalHelpers + `
  await editStatus('new');
  await toggle('Необязательный');
  await saveDialog();
  return texts();
`);
check('блок «Цикл не активируется» называет начальный статус текстом сервера',
  problem.includes('Цикл не активируется') && problem.includes('"new"') && problem.includes('начальный статус'), problem.slice(0, 600));
const tipProblem = await run(statusHelpers + "return tipOf('Активировать');");
check('«Активировать» выключена с подсказкой о проверке',
  tipProblem.disabled && tipProblem.text.includes('Цикл не проходит проверку'), JSON.stringify(tipProblem));
check('коды optional_* на экран не выводятся', !problem.includes('optional_'), problem.slice(0, 300));

console.log('необязательный этап: снятие отметки (AC-2)');
const cleared = await run(statusHelpers + optionalHelpers + `
  spyStatuses();
  await editStatus('new');
  await toggle('Необязательный');
  const hidden = !sw('Включён по умолчанию');
  await saveDialog();
  unspy();
  return {hidden, bodies: window.__bodies, dialogOpen: Boolean(dialog()), page: texts(),
    row: rowOf('new').innerText.replace(/\\s+/g, ' ')};
`);
check('при снятии отметки умолчание скрыто', cleared.hidden);
check('запрос несёт is_optional:false и enabled_by_default:true',
  cleared.bodies.length === 1 && cleared.bodies[0].is_optional === false && cleared.bodies[0].enabled_by_default === true,
  JSON.stringify(cleared.bodies));
check('сервер принял пару: диалог закрыт, бейджей нет',
  !cleared.dialogOpen && !cleared.row.includes('необязательный'), cleared.row);
check('проблема ушла без перезагрузки', !cleared.page.includes('Цикл не активируется'), cleared.page.slice(0, 400));

// Снятие отметки у статуса, который был «выключен по умолчанию»: пару сводит
// интерфейс, иначе сервер ответил бы 400.
const cleared2 = await run(statusHelpers + optionalHelpers + `
  spyStatuses();
  await editStatus('architecture');
  await toggle('Необязательный');
  await saveDialog();
  unspy();
  return {bodies: window.__bodies, dialogOpen: Boolean(dialog()), row: rowOf('architecture').innerText.replace(/\\s+/g, ' ')};
`);
check('снятие у «выключен по умолчанию» уходит с умолчанием «включён» и проходит',
  cleared2.bodies.length === 1 && cleared2.bodies[0].is_optional === false && cleared2.bodies[0].enabled_by_default === true &&
    !cleared2.dialogOpen && !cleared2.row.includes('необязательный') && !cleared2.row.includes('выключен'),
  JSON.stringify(cleared2));

console.log('необязательный этап: отказ сервера виден в диалоге (AC-3)');
const refusedSave = await run(statusHelpers + optionalHelpers + `
  const orig = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if ((init?.method || '').toUpperCase() === 'PATCH' && /\\/statuses\\/[a-z_]+$/.test(url)) {
      return new Response(JSON.stringify({error: {code: 'conflict', message: 'версия цикла уже активна, правка не принимается'}}),
        {status: 409, headers: {'Content-Type': 'application/json'}});
    }
    return orig(input, init);
  };
  const before = statusRows().map((li) => li.innerText.replace(/\\s+/g, ' '));
  await editStatus('architecture');
  await toggle('Необязательный');
  await toggle('Включён по умолчанию');
  await saveDialog();
  window.fetch = orig;
  return {dialogOpen: Boolean(dialog()), text: dialog() ? dialog().innerText.replace(/\\s+/g, ' ') : '',
    optional: sw('Необязательный')?.getAttribute('aria-checked'), def: sw('Включён по умолчанию')?.getAttribute('aria-checked'),
    same: statusRows().map((li) => li.innerText.replace(/\\s+/g, ' ')).join('|') === before.join('|'),
    toasts: toasts()};
`);
check('диалог остался открытым с текстом ответа',
  refusedSave.dialogOpen && refusedSave.text.includes('Статус не сохранён') && refusedSave.text.includes('версия цикла уже активна'),
  refusedSave.text.slice(0, 300));
check('введённое не потеряно', refusedSave.optional === 'true' && refusedSave.def === 'false',
  JSON.stringify([refusedSave.optional, refusedSave.def]));
check('список статусов не изменился, тоста об ошибке нет',
  refusedSave.same && !refusedSave.toasts.some((x) => x.includes('сохранён')), JSON.stringify(refusedSave.toasts));
await run(optionalHelpers + "await closeDialog(); return true;");

console.log('необязательный этап: статус сохранён, роли нет (BR-8)');
const partial = await run(statusHelpers + optionalHelpers + `
  const orig = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if ((init?.method || '').toUpperCase() === 'PUT' && /\\/statuses\\/[a-z_]+\\/roles$/.test(url)) {
      return new Response(JSON.stringify({error: {code: 'internal', message: 'роли не сохранены'}}),
        {status: 500, headers: {'Content-Type': 'application/json'}});
    }
    return orig(input, init);
  };
  await editStatus('architecture');
  await toggle('Необязательный');
  await saveDialog();
  window.fetch = orig;
  return {dialogOpen: Boolean(dialog()), text: dialog() ? dialog().innerText.replace(/\\s+/g, ' ') : '',
    row: rowOf('architecture').innerText.replace(/\\s+/g, ' ')};
`);
check('ошибка ролей остаётся в диалоге', partial.dialogOpen && partial.text.includes('роли не сохранены'), partial.text.slice(0, 300));
check('сохранённая отметка видна в списке без перезагрузки', partial.row.includes('необязательный'), partial.row);
await run(optionalHelpers + "await closeDialog(); return true;");
// Возвращаем статус обязательным: дальше сценарий идёт по прежнему циклу.
// Оставляем отметку у architecture до активации, чтобы проверить активную версию.
const restoreMark = await run(statusHelpers + optionalHelpers + `
  await editStatus('architecture');
  if (sw('Необязательный').getAttribute('aria-checked') !== 'true') await toggle('Необязательный');
  await toggle('Включён по умолчанию');
  await saveDialog();
  return rowOf('architecture').innerText.replace(/\\s+/g, ' ');
`);
check('перед активацией architecture — необязательный, выключен по умолчанию',
  restoreMark.includes('необязательный') && restoreMark.includes('выключен по умолчанию'), restoreMark);

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

console.log('активная версия: отметки видны, правки нет (AC-6)');
await s.goto(BASE + '/p/SDLC/workflow');
await pause(2000);
await run(statusHelpers + "await pickVersion('Default SDLC · v2'); return true;");
const readonlyRows = await run(statusHelpers + optionalHelpers + `
  const edit = statusRows().some((li) =>
    arrow(li, 'up') || arrow(li, 'down') ||
    Array.from(li.querySelectorAll('button')).some((b) => ['Править', 'Удалить'].includes((b.innerText || '').trim())));
  return {
    text: texts(),
    edit,
    addButton: all('button').some((b) => (b.innerText || '').trim() === 'Добавить статус'),
    row: rowOf('architecture').innerText.replace(/\\s+/g, ' '),
    plain: rowOf('analysis').innerText.replace(/\\s+/g, ' '),
  };
`);
check('активная версия помечена как неправимая', readonlyRows.text.includes('Эта версия не редактируется'), readonlyRows.text.slice(0, 200));
check('у активной версии отметка и умолчание видны',
  readonlyRows.row.includes('необязательный') && readonlyRows.row.includes('выключен по умолчанию'), readonlyRows.row);
check('у обычного статуса бейджей нет', !readonlyRows.plain.includes('необязательный'), readonlyRows.plain);
check('у активной версии нет ни правки, ни порядка, ни удаления, ни «Добавить статус»',
  !readonlyRows.edit && !readonlyRows.addButton, JSON.stringify(readonlyRows));

console.log('отметки переезжают с копией и связкой (AC-7)');
const API = process.env.SDLC_API_URL ?? 'http://localhost:8088';
const call = (method, path, body) =>
  fetch(API + '/v1' + path, {
    method,
    headers: {'X-SDLC-Actor': 'e2e', 'Content-Type': 'application/json'},
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({status: r.status, body: r.status === 204 ? null : await r.json()}));
const drafts = [];
await run('return click("Черновик копией активного");');
await pause(1800);
const copied = await run(statusHelpers + optionalHelpers + `
  return {text: texts(), row: rowOf('architecture').innerText.replace(/\\s+/g, ' '),
    plain: rowOf('analysis').innerText.replace(/\\s+/g, ' ')};
`);
check('черновик копией активного — правимый', copied.text.includes('Добавить статус') && !copied.text.includes('Эта версия не редактируется'), copied.text.slice(0, 200));
check('копия несёт те же отметку и умолчание',
  copied.row.includes('необязательный') && copied.row.includes('выключен по умолчанию') && !copied.plain.includes('необязательный'),
  copied.row);
const list = await call('GET', '/projects/SDLC/workflows');
const copyDraft = list.body.workflows.find((w) => w.state === 'draft' && w.task_types.includes('task'));
if (copyDraft) drafts.push(copyDraft.id);

// Связка: статус qa отмечен необязательным с умолчанием «включён», прочие метки
// остаются. Импорт заводит черновик, интерфейс показывает его так же.
const bundle = (await call('GET', '/projects/SDLC/export')).body;
const wfIn = bundle.workflows.find((w) => w.name === 'Default SDLC');
const st = (key) => wfIn.statuses.find((x) => x.key === key);
check('экспорт отдаёт отметку статуса architecture',
  st('architecture').is_optional === true && st('architecture').enabled_by_default === false, JSON.stringify(st('architecture')));
st('qa').is_optional = true;
st('qa').enabled_by_default = true;
const imported = await call('POST', '/projects/SDLC/import', bundle);
check('импорт связки с отметками прошёл', imported.status === 200, JSON.stringify(imported).slice(0, 300));
const afterImport = (await call('GET', '/projects/SDLC/workflows')).body.workflows;
const importDraft = afterImport.find((w) => w.state === 'draft' && !drafts.includes(w.id) && w.task_types.includes('task'));
if (importDraft) drafts.push(importDraft.id);
await s.goto(BASE + '/p/SDLC/workflow');
await pause(2000);
await run(statusHelpers + `await pickVersion('Default SDLC · v${importDraft ? importDraft.version : 4}'); return true;`);
const fromBundle = await run(statusHelpers + optionalHelpers + `
  return {arch: rowOf('architecture').innerText.replace(/\\s+/g, ' '), qa: rowOf('qa').innerText.replace(/\\s+/g, ' '),
    plain: rowOf('analysis').innerText.replace(/\\s+/g, ' ')};
`);
check('черновик из связки: architecture — необязательный, выключен по умолчанию',
  fromBundle.arch.includes('необязательный') && fromBundle.arch.includes('выключен по умолчанию'), fromBundle.arch);
check('черновик из связки: qa — необязательный, включён по умолчанию',
  fromBundle.qa.includes('необязательный') && !fromBundle.qa.includes('выключен'), fromBundle.qa);
check('черновик из связки: обычный статус без бейджей', !fromBundle.plain.includes('необязательный'), fromBundle.plain);

// Связка без полей (прежняя версия сервиса): все статусы обязательные.
for (const x of wfIn.statuses) { delete x.is_optional; delete x.enabled_by_default; }
const legacy = await call('POST', '/projects/SDLC/import', bundle);
const afterLegacy = (await call('GET', '/projects/SDLC/workflows')).body.workflows;
const legacyDraft = afterLegacy.find((w) => w.state === 'draft' && !drafts.includes(w.id) && w.task_types.includes('task'));
if (legacyDraft) drafts.push(legacyDraft.id);
check('импорт связки без полей прошёл', legacy.status === 200, JSON.stringify(legacy).slice(0, 300));
if (legacyDraft) {
  await s.goto(BASE + '/p/SDLC/workflow');
  await pause(2000);
  await run(statusHelpers + `await pickVersion('Default SDLC · v${legacyDraft.version}'); return true;`);
  const noFields = await run(statusHelpers + 'return statusRows().map((li) => li.innerText.replace(/\\s+/g, " ")).join("|");');
  check('черновик из связки без полей: бейджей отметки нет', !noFields.includes('необязательный'), noFields.slice(0, 300));
} else {
  check('черновик из связки без полей заведён', false, JSON.stringify(afterLegacy.map((w) => [w.version, w.state])));
}
// Черновики сценария снимаются: следующим сценариям нужен чистый список версий.
for (const id of drafts) await call('DELETE', '/workflows/' + id);

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
