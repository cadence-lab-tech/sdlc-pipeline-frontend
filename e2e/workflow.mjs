// Редактор цикла на странице «Пайплайн» (CLAB-346): черновик, статусы,
// перестановка, переходы, гейты, необязательные этапы, проверка и активация.
// Сценарии и проверки прежнего редактора сохранены, DOM — холст и панели:
// статус выбирается узлом, правка и удаление — в его панели.
import {session, helpers} from './driver.mjs';

const BASE = process.env.SDLC_UI_URL ?? 'http://localhost:5173';
const API = process.env.SDLC_API_URL ?? 'http://localhost:8088';
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};
const call = (method, path, body) =>
  fetch(API + '/v1' + path, {
    method,
    headers: {'X-SDLC-Actor': 'e2e', 'Content-Type': 'application/json'},
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({status: r.status, body: r.status === 204 ? null : await r.json()}));
const keysOf = async (id) => (await call('GET', `/workflows/${id}`)).body.statuses
  .sort((a, b) => a.position - b.position)
  .map((x) => x.key);

const PAGE = BASE + '/p/SDLC/pipeline?type=task';
const s = await session(PAGE);
const run = (body) => s.evaluate(helpers + pipe + body);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
await s.resize(1440, 900);

// Холст и панель: узел выбирается кнопкой узла, действия — кнопками панели.
// Переключатели диалога статуса находятся по подписи, состояние — aria-checked.
const pipe = `
  const node = (key) => document.querySelector('[data-pipeline-status="' + key + '"]');
  const nodeText = (key) => (node(key)?.innerText || '').replace(/\\s+/g, ' ');
  const selectStatus = async (key) => {
    const n = node(key)?.querySelector('[role=button]');
    if (!n) throw new Error('узла нет: ' + key);
    n.click();
    await sleep(900);
  };
  const panel = () => document.querySelector('[data-pipeline-inspector]');
  const panelText = () => (panel()?.innerText || '').replace(/\\s+/g, ' ');
  const panelButton = (text) => Array.from(panel().querySelectorAll('button')).find((b) => (b.innerText || '').trim() === text);
  const clickPanel = async (text) => {
    const b = panelButton(text);
    if (!b) throw new Error('в панели нет кнопки: ' + text);
    b.click();
    await sleep(800);
  };
  const closePanel = async () => {
    const b = panel()?.querySelector('[aria-label="Закрыть панель"]');
    if (b) { b.click(); await sleep(900); }
  };
  const overviewText = () => (document.querySelector('[data-pipeline-overview]')?.innerText || '').replace(/\\s+/g, ' ');
  const arrow = (kind) => Array.from(panel().querySelectorAll('button')).find((b) =>
    (b.getAttribute('aria-label') || '').startsWith(kind === 'up' ? 'Поднять' : 'Опустить'));
  const currentWf = () => document.querySelector('[data-pipeline-version]')?.getAttribute('data-pipeline-version');
  // Версия выбирается в меню версий: Radix открывает его по pointerdown.
  const pickVersion = async (id) => {
    const trigger = document.querySelector('[data-pipeline-version]');
    trigger.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, button: 0, pointerType: 'mouse'}));
    await sleep(400);
    const item = document.querySelector('[data-pipeline-version-item="' + id + '"]');
    if (!item) throw new Error('версии нет в меню: ' + id);
    item.click();
    await sleep(1600);
  };
  const menuItem = async (text) => {
    const trigger = document.querySelector('[data-pipeline-version]');
    trigger.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, button: 0, pointerType: 'mouse'}));
    await sleep(400);
    const item = all('[role=menuitem]').find((x) => (x.innerText || '').trim() === text);
    if (!item) throw new Error('пункта нет в меню: ' + text);
    item.click();
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
  const dialog = () => document.querySelector('[role=dialog]');
  const sw = (label) => {
    const l = dialog() && Array.from(dialog().querySelectorAll('label')).find((x) => x.innerText.trim().startsWith(label));
    return l ? document.getElementById(l.getAttribute('for')) : null;
  };
  const editStatus = async (key) => {
    await selectStatus(key);
    await clickPanel('Править статус');
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
  // Перехват запросов правки: метод, путь и тело. Запрос уходит настоящий.
  const spy = (pattern) => {
    window.__calls = [];
    const orig = window.fetch;
    window.__origFetch = orig;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = (init?.method || 'GET').toUpperCase();
      if (method !== 'GET' && pattern.test(url)) {
        window.__calls.push({method, path: url.replace(/^.*\\/v1/, ''), body: init?.body ? JSON.parse(init.body) : null});
      }
      return orig(input, init);
    };
  };
  const unspy = () => { if (window.__origFetch) window.fetch = window.__origFetch; };
`;
await pause(2000);

console.log('редактор цикла: активная версия');
const active = (await call('GET', '/projects/SDLC/workflow?type=task')).body;
let t = await run('return texts();');
check('активная версия — только чтение: в шапке «Черновик копией этой версии»',
  t.includes('работает') && t.includes('Черновик копией этой версии') && !t.includes('Добавить статус'), t.slice(0, 300));
check('статусы цикла показаны', t.includes('Analysis') && t.includes('Code Review'));
const human = active.transitions.find((x) => (x.gates ?? []).some((g) => g.type === 'human_approval'));
await run(`document.querySelector('[data-pipeline-checkpoint="${human.key}"]').click(); await sleep(900); return true;`);
t = await run('return panelText();');
check('гейты перехода показаны', t.includes('Апрув человеком') && t.includes(`Гейты: ${human.gates.length}`), t.slice(0, 300));
check('у активной версии кнопок правки перехода нет', !t.includes('Править переход') && !t.includes('Добавить гейт') && !t.includes('Удалить'), t.slice(0, 300));
await run(`await selectStatus('analysis'); return true;`);
const activeEditable = await run(`
  return Boolean(arrow('up') || arrow('down') || panelButton('Править статус') || panelButton('Удалить') || panelButton('Переход отсюда'))
    || all('[aria-label^="Добавить переход из"]').length > 0;
`);
check('у активной версии кнопок правки статусов нет', !activeEditable, String(activeEditable));

console.log('черновик копией активного');
const created = await run(`
  spy(/\\/workflows(\\/|$)/);
  await clickExact('Черновик копией этой версии');
  await sleep(1500);
  unspy();
  return {calls: window.__calls, wf: currentWf(), text: texts(), url: location.search};
`);
const draftId = created.wf;
check('тот же запрос, что у прежнего редактора: копия активной под тип',
  created.calls.length === 1 && created.calls[0].method === 'POST' && created.calls[0].path === '/projects/SDLC/workflows' &&
    created.calls[0].body.from === 'active' && JSON.stringify(created.calls[0].body.task_types) === '["task"]',
  JSON.stringify(created.calls));
check('создан черновик v2, он открыт', created.text.includes('v2 · черновик') && created.url.includes(`wf=${draftId}`), created.text.slice(0, 200));
check('черновик редактируется', created.text.includes('Добавить статус'));
check('в черновике те же статусы', created.text.includes('Code Review'));
await pause(1000);
t = await run('return overviewText();');
check('активация доступна', !t.includes('Цикл не активируется'), t.slice(0, 300));

console.log('стрелки перестановки статусов');
const order = await keysOf(draftId);
const names = new Map((await call('GET', `/workflows/${draftId}`)).body.statuses.map((x) => [x.key, x.name]));
check('статусов в черновике больше двух', order.length > 2, String(order.length));
const arrows = [];
for (const key of [order[0], order[1], order[order.length - 1]]) {
  arrows.push(await run(`
    await selectStatus('${key}');
    const up = arrow('up');
    const down = arrow('down');
    return {key: '${key}', up: up?.getAttribute('aria-label') || '', down: down?.getAttribute('aria-label') || '',
      upOff: Boolean(up?.disabled), downOff: Boolean(down?.disabled),
      icons: Boolean(up?.querySelector('svg') && down?.querySelector('svg')),
      glyphs: /[↑↓]/.test((up?.innerText || '') + (down?.innerText || '')),
      words: (up?.innerText || '').trim() === 'Выше' && (down?.innerText || '').trim() === 'Ниже'};
  `));
}
check('стрелки названы действием и статусом',
  arrows.every((r) => r.up.includes(names.get(r.key)) && r.up.includes('выше') && r.down.includes(names.get(r.key)) && r.down.includes('ниже')),
  JSON.stringify(arrows[1]));
check('кнопки «Выше»/«Ниже» с иконками, без глифов ↑ ↓', arrows.every((r) => r.icons && !r.glyphs && r.words), JSON.stringify(arrows[0]));
check('на краях списка кнопка выключена',
  arrows[0].upOff && !arrows[0].downOff && arrows[2].downOff && !arrows[2].upOff && !arrows[1].upOff && !arrows[1].downOff,
  JSON.stringify(arrows.map((r) => [r.upOff, r.downOff])));

console.log('удаление статуса называет, что уйдёт вместе с ним');
// Переходы ссылаются на статус с ON DELETE CASCADE: вместе со статусом
// пропадают и они, и гейты на них. Диалог обязан назвать это до подтверждения.
const cascade = await run(`
  await selectStatus('${order[1]}');
  await clickPanel('Удалить');
  const d = document.querySelector('[role=alertdialog]');
  const text = d ? d.innerText.replace(/\\s+/g, ' ') : '';
  await confirm('Отмена');
  return {text};
`);
const draftNow = (await call('GET', `/workflows/${draftId}`)).body;
const named = (cascade.text.split('ведут: ')[1] || '').split(', а с ними')[0].split(', ');
const tNames = named.map((x) => x.replace(/\s*\([a-z0-9_]+\)\s*\.?$/, '').trim());
check('диалог удаления называет переходы и гейты, которые уйдут каскадом',
  cascade.text.includes(names.get(order[1])) && cascade.text.includes('пропадут переходы') &&
    /гейты на этих переходах: [1-9]/.test(cascade.text), cascade.text);
check('названные переходы есть в цикле',
  tNames.length > 0 && tNames.every((n) => n && draftNow.transitions.some((x) => x.name === n)), tNames.join(' | '));

console.log('перестановка статусов проходит');
// Ответ бэкенда задержан подменённым fetch: занятость кнопок иначе не поймать.
const moved = await run(`
  spy(/\\/statuses$/);
  const spied = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if ((init?.method || '').toUpperCase() === 'PUT' && /\\/statuses$/.test(url)) await sleep(1500);
    return spied(input, init);
  };
  await selectStatus('${order[1]}');
  arrow('down').click();
  await sleep(500);
  const busy = [arrow('up').disabled, arrow('down').disabled];
  await sleep(2500);
  unspy();
  return {busy, free: [arrow('up').disabled, arrow('down').disabled], calls: window.__calls, page: texts(), panel: panelText()};
`);
const afterMove = await keysOf(draftId);
check('пока перестановка в пути, обе кнопки заняты', moved.busy[0] && moved.busy[1], JSON.stringify(moved.busy));
check('после ответа занятость снята', !moved.free[0] && !moved.free[1], JSON.stringify(moved.free));
const swapped = [...order];
[swapped[1], swapped[2]] = [swapped[2], swapped[1]];
check('тот же PUT …/statuses с порядком целиком',
  moved.calls.length === 1 && moved.calls[0].method === 'PUT' && JSON.stringify(moved.calls[0].body) === JSON.stringify({order: swapped}),
  JSON.stringify(moved.calls));
check('порядок статусов изменился', afterMove[1] === order[2] && afterMove[2] === order[1], afterMove.join(','));
check('панель называет новое место', moved.panel.includes(`Колонка доски 3 из ${order.length}`), moved.panel.slice(0, 300));
check('удачная перестановка не показывает ошибку', !moved.page.includes('Порядок статусов не изменён'), moved.page.slice(0, 300));

await s.goto(`${BASE}/p/SDLC/pipeline?type=task&wf=${draftId}&status=${order[1]}`);
await pause(2000);
t = await run('return panelText();');
check('порядок сохранён после перезагрузки', (await keysOf(draftId)).join() === afterMove.join() && t.includes(`Колонка доски 3 из ${order.length}`), t.slice(0, 200));

console.log('отказ на перестановку виден');
const refused = await run(`
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
  arrow('down').click();
  await sleep(1500);
  window.fetch = orig;
  return {unhandled: window.__unhandled, panel: panelText()};
`);
check('отказ перестановки показан в панели с сообщением бэкенда',
  refused.panel.includes('Порядок статусов не изменён') && refused.panel.includes('статуса нет в этой версии цикла'), refused.panel.slice(0, 400));
check('при отказе порядок статусов не изменился', (await keysOf(draftId)).join() === afterMove.join());
check('необработанного отказа промиса нет', refused.unhandled.length === 0, refused.unhandled.join(' | '));

const restored = await run(`arrow('up').click(); await sleep(1800); return {panel: panelText()};`);
check('повторный клик проходит и возвращает порядок', (await keysOf(draftId)).join() === order.join());
check('отказ снят удачной перестановкой', !restored.panel.includes('Порядок статусов не изменён'), restored.panel.slice(0, 300));

console.log('проверка цикла ещё не ответила');
// Ответ проверки задержан: до него «Активировать» выключена, и подсказка
// обязана говорить именно про идущую проверку, а не про непройденную.
const pending = await run(`
  await closePanel();
  const orig = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (/\\/validation$/.test(url)) await sleep(4000);
    return orig(input, init);
  };
  await pickVersion('${active.id}');
  await pickVersion('${draftId}');
  const tip = await tipOf('Активировать');
  const text = overviewText();
  await sleep(4500);
  window.fetch = orig;
  return {...tip, overview: text};
`);
check('пока проверка не ответила, подсказка называет её',
  pending.disabled && pending.text.includes('Идёт проверка цикла'), JSON.stringify(pending).slice(0, 300));
check('обзор говорит «Проверяем цикл»', pending.overview.includes('Проверяем цикл'), pending.overview.slice(0, 200));

console.log('проверка цикла отказала');
const broken = await run(`
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
  await pickVersion('${active.id}');
  await pickVersion('${draftId}');
  await sleep(600);
  return texts();
`);
check('отказ проверки цикла виден на экране',
  broken.includes('Проверка цикла не выполнена') && broken.includes('проверка недоступна'), broken.slice(0, 400));
const tipBroken = await run("return tipOf('Активировать');");
check('«Активировать» выключена, подсказка называет невыполненную проверку',
  tipBroken.disabled && tipBroken.text.includes('Проверку не удалось выполнить'), JSON.stringify(tipBroken));
// Та же подсказка одной клавиатурой: указателя не касаемся вовсе.
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
  tipKeys.closed && tipKeys.focused && tipKeys.text.includes('Проверку не удалось выполнить'), JSON.stringify(tipKeys));
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
const added = await run(`
  spy(/\\/statuses/);
  await clickExact('Добавить статус');
  await fill('Ключ', 'security_review');
  await fill('Название', 'Security review');
  await click('Сохранить', '[role=dialog] button');
  await sleep(1500);
  unspy();
  return {calls: window.__calls, node: Boolean(node('security_review')), problem: node('security_review')?.querySelector('[data-pipeline-problem]')?.getAttribute('data-pipeline-problem'),
    orphanBand: Boolean(document.querySelector('[data-pipeline-band=orphan]')), overview: overviewText()};
`);
check('статус добавлен тем же POST …/statuses', added.node && added.calls[0]?.method === 'POST' && added.calls[0].body.key === 'security_review', JSON.stringify(added.calls));
check('проверка нашла недостижимый статус', added.overview.includes('Цикл не активируется'), added.overview.slice(0, 400));
check('узел с ошибкой проверки помечен ⚠, статус — в полосе «Не связаны с циклом»', added.problem === 'error' && added.orphanBand, JSON.stringify(added));
const tipInvalid = await run("return tipOf('Активировать');");
check('у непроходящего проверку черновика подсказка называет причину',
  tipInvalid.disabled && tipInvalid.text.includes('Цикл не проходит проверку'), JSON.stringify(tipInvalid));
const fromReport = await run(`
  const b = all('[data-pipeline-validation] button').find((x) => (x.innerText || '').includes('security_review'));
  if (!b) return 'нет кнопки';
  b.click();
  await sleep(900);
  return new URLSearchParams(location.search).get('status');
`);
check('статус в отчёте проверки выбирает узел', fromReport === 'security_review', String(fromReport));

console.log('удаление статуса возвращает цикл в рабочее состояние');
await run(`await clickPanel('Удалить'); return true;`);
// Удаление необратимо: запрос уходит только после подтверждения в диалоге, и
// в тексте диалога назван удаляемый статус.
let dialogText = await run(`
  const d = document.querySelector('[role=alertdialog]');
  return d ? d.innerText.replace(/\\s+/g, ' ') : '';
`);
check('удаление статуса просит подтверждения с именем статуса',
  dialogText.includes('Удалить статус?') && dialogText.includes('security_review'), dialogText);
check('у статуса без переходов диалог так и говорит', dialogText.includes('Переходов, которые его касаются, в цикле нет'), dialogText);
check('до подтверждения статус на месте', await run(`return Boolean(node('security_review'));`));
await run('return confirm("Отмена");');
check('«Отмена» закрывает диалог, статус на месте',
  await run(`return Boolean(node('security_review')) && !document.querySelector('[role=alertdialog]');`));
await run(`spy(/\\/statuses/); await clickPanel('Удалить'); await confirm('Удалить'); unspy(); return true;`);
const removed = await run(`return {node: Boolean(node('security_review')), calls: window.__calls, overview: overviewText(), toasts: toasts(), url: location.search};`);
check('статус удалён тем же DELETE', !removed.node && removed.calls.length === 1 && removed.calls[0].method === 'DELETE' && removed.calls[0].path.endsWith('/statuses/security_review'), JSON.stringify(removed.calls));
check('об удалении сообщил тост с именем статуса', removed.toasts.some((x) => x.includes('удалён') && x.includes('security_review')), removed.toasts.join(' | '));
check('выбор снят — панель вернулась к обзору', !removed.url.includes('status='), removed.url);
check('проблема ушла вместе со статусом', !removed.overview.includes('Цикл не активируется'), removed.overview.slice(0, 400));
// Все десять типов гейтов реализованы: у демонстрационного цикла ни ошибок, ни предупреждений.
check('проверка проходит без предупреждений', removed.overview.includes('Цикл проходит проверку') && !removed.overview.includes('Предупреждения'), removed.overview.slice(0, 400));

console.log('переход отсюда и гейт: те же запросы');
const tr = await run(`
  spy(/\\/transitions/);
  await selectStatus('qa');
  await clickPanel('Переход отсюда');
  const from = dialog().innerText.replace(/\\s+/g, ' ');
  await fill('Ключ', 'e2e_skip');
  await fill('Название', 'Пропустить ревью');
  return {from};
`);
check('«Переход отсюда» заполняет «Откуда» выбранным статусом', tr.from.includes('QA'), tr.from.slice(0, 300));
const trSaved = await run(`
  // «Куда» — последний выпадающий список диалога.
  const triggers = Array.from(dialog().querySelectorAll('button[role=combobox]'));
  triggers[1].click();
  await sleep(500);
  const option = all('[role=option]').find((o) => o.innerText.trim().startsWith('Done'));
  if (!option) throw new Error('статуса Done нет в списке');
  option.click();
  await sleep(400);
  await click('Сохранить', '[role=dialog] button');
  await sleep(1500);
  return {calls: window.__calls, checkpoint: Boolean(document.querySelector('[data-pipeline-checkpoint="e2e_skip"]'))};
`);
check('переход создан тем же POST …/transitions из выбранного статуса',
  trSaved.calls.length === 1 && trSaved.calls[0].method === 'POST' && trSaved.calls[0].body.key === 'e2e_skip' && trSaved.calls[0].body.from_status === 'qa' && trSaved.calls[0].body.to_status === 'done',
  JSON.stringify(trSaved.calls));
check('на холсте появилась контрольная точка перехода', trSaved.checkpoint);
const gate = await run(`
  document.querySelector('[data-pipeline-checkpoint="e2e_skip"]').click();
  await sleep(900);
  await clickPanel('Добавить гейт');
  await fill('Ключ', 'e2e_gate');
  await fill('Название', 'Проверка e2e');
  await click('Сохранить', '[role=dialog] button');
  await sleep(1500);
  return {calls: window.__calls, panel: panelText()};
`);
check('гейт добавлен тем же POST …/gates', gate.calls.some((c) => c.method === 'POST' && c.path.endsWith('/transitions/e2e_skip/gates') && c.body.key === 'e2e_gate'), JSON.stringify(gate.calls));
check('панель перехода показывает гейт', gate.panel.includes('Гейты: 1') && gate.panel.includes('Проверка e2e'), gate.panel.slice(0, 300));
await run(`await clickIn('Проверка e2e', 'Удалить'); await confirm('Удалить'); return true;`);
await run(`await clickPanel('Удалить'); await confirm('Удалить'); unspy(); return true;`);
const trGone = await run(`return {calls: window.__calls, checkpoint: Boolean(document.querySelector('[data-pipeline-checkpoint="e2e_skip"]'))};`);
check('гейт и переход удалены теми же DELETE',
  trGone.calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/gates/e2e_gate')) &&
    trGone.calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/transitions/e2e_skip')) && !trGone.checkpoint,
  JSON.stringify(trGone.calls));

console.log('необязательный этап: диалог статуса');
// Обязательный статус: переключатель умолчания скрыт, пока отметки нет.
await run("await editStatus('architecture'); return true;");
const dlg0 = await run(`return {optional: sw('Необязательный')?.getAttribute('aria-checked'), hasDefault: Boolean(sw('Включён по умолчанию'))};`);
check('у обязательного статуса «Необязательный» выключен', dlg0.optional === 'false', JSON.stringify(dlg0));
check('умолчание скрыто, пока отметки нет', !dlg0.hasDefault, JSON.stringify(dlg0));
const dlg1 = await run(`
  await toggle('Необязательный');
  return {optional: sw('Необязательный')?.getAttribute('aria-checked'), def: sw('Включён по умолчанию')?.getAttribute('aria-checked') ?? null};
`);
check('с отметкой появляется «Включён по умолчанию», он включён', dlg1.optional === 'true' && dlg1.def === 'true', JSON.stringify(dlg1));
await run('await closeDialog(); return true;');

console.log('необязательный этап: сохранение отметки и умолчания');
const marked = await run(`
  spy(/\\/statuses\\/[a-z_]+$/);
  await editStatus('architecture');
  await toggle('Необязательный');
  await toggle('Включён по умолчанию');
  await saveDialog();
  unspy();
  return {calls: window.__calls, node: nodeText('architecture'), panel: panelText(),
    problem: node('architecture')?.querySelector('[data-pipeline-problem]')?.getAttribute('data-pipeline-problem'),
    dialogOpen: Boolean(dialog()), toast: toasts()};
`);
check('тело запроса несёт отметку и умолчание «выключен»',
  marked.calls.length === 1 && marked.calls[0].method === 'PATCH' && marked.calls[0].body.is_optional === true && marked.calls[0].body.enabled_by_default === false,
  JSON.stringify(marked.calls));
check('диалог закрыт, тост называет статус',
  !marked.dialogOpen && marked.toast.some((x) => x.includes('architecture') && x.includes('сохранён')), JSON.stringify(marked.toast));
check('узел показывает «выключен по умолчанию», панель — оба жетона',
  marked.node.includes('выключен по умолчанию') && marked.panel.includes('необязательный') && marked.panel.includes('выключен по умолчанию'), marked.node);
check('предупреждение проверки помечено на узле', marked.problem === 'warning', String(marked.problem));
const warn = await run('await closePanel(); return overviewText();');
// Проверка пересчитана без перехода по адресу: у необязательного этапа
// сервер предупреждает об обходных переходах и не держит активацию.
check('предупреждения сервера видны без перезагрузки', warn.includes('Предупреждения') && warn.includes('"architecture"'), warn.slice(0, 600));
check('предупреждение активацию не держит',
  !warn.includes('Цикл не активируется') && !(await run("return tipOf('Активировать');")).disabled);

await s.goto(`${BASE}/p/SDLC/pipeline?type=task&wf=${draftId}`);
await pause(2000);
const afterReload = await run(`return {arch: nodeText('architecture'), other: nodeText('analysis')};`);
check('после перезагрузки отметка и умолчание на месте', afterReload.arch.includes('выключен по умолчанию'), afterReload.arch);
check('у обычного статуса жетонов отметки нет', !afterReload.other.includes('необязательный') && !afterReload.other.includes('выключен'), afterReload.other);

console.log('необязательный этап: диалог показывает сохранённое');
const reopened = await run(`
  await editStatus('architecture');
  const r = {optional: sw('Необязательный')?.getAttribute('aria-checked'), def: sw('Включён по умолчанию')?.getAttribute('aria-checked')};
  await closeDialog();
  return r;
`);
check('в диалоге те же значения, что на узле', reopened.optional === 'true' && reopened.def === 'false', JSON.stringify(reopened));

console.log('необязательный этап: проблема держит активацию');
const problem = await run(`
  await editStatus('new');
  await toggle('Необязательный');
  await saveDialog();
  const mark = node('new')?.querySelector('[data-pipeline-problem]')?.getAttribute('data-pipeline-problem');
  await closePanel();
  return {text: overviewText(), mark};
`);
check('блок «Цикл не активируется» называет начальный статус текстом сервера',
  problem.text.includes('Цикл не активируется') && problem.text.includes('"new"') && problem.text.includes('начальный статус'), problem.text.slice(0, 600));
check('узел начального статуса помечен ошибкой', problem.mark === 'error', String(problem.mark));
const tipProblem = await run("return tipOf('Активировать');");
check('«Активировать» выключена с подсказкой о проверке', tipProblem.disabled && tipProblem.text.includes('Цикл не проходит проверку'), JSON.stringify(tipProblem));
check('коды optional_* на экран не выводятся', !problem.text.includes('optional_'), problem.text.slice(0, 300));

console.log('необязательный этап: снятие отметки');
const cleared = await run(`
  spy(/\\/statuses\\/[a-z_]+$/);
  await editStatus('new');
  await toggle('Необязательный');
  const hidden = !sw('Включён по умолчанию');
  await saveDialog();
  unspy();
  const r = {hidden, calls: window.__calls, dialogOpen: Boolean(dialog()), node: nodeText('new'), panel: panelText()};
  await closePanel();
  r.overview = overviewText();
  return r;
`);
check('при снятии отметки умолчание скрыто', cleared.hidden);
check('запрос несёт is_optional:false и enabled_by_default:true',
  cleared.calls.length === 1 && cleared.calls[0].body.is_optional === false && cleared.calls[0].body.enabled_by_default === true, JSON.stringify(cleared.calls));
check('сервер принял пару: диалог закрыт, жетонов нет',
  !cleared.dialogOpen && !cleared.node.includes('необязательный') && !cleared.panel.includes('необязательный'), cleared.node);
check('проблема ушла без перезагрузки', !cleared.overview.includes('Цикл не активируется'), cleared.overview.slice(0, 400));

// Снятие отметки у статуса, который был «выключен по умолчанию»: пару сводит
// интерфейс, иначе сервер ответил бы 400.
const cleared2 = await run(`
  spy(/\\/statuses\\/[a-z_]+$/);
  await editStatus('architecture');
  await toggle('Необязательный');
  await saveDialog();
  unspy();
  return {calls: window.__calls, dialogOpen: Boolean(dialog()), node: nodeText('architecture')};
`);
check('снятие у «выключен по умолчанию» уходит с умолчанием «включён» и проходит',
  cleared2.calls.length === 1 && cleared2.calls[0].body.is_optional === false && cleared2.calls[0].body.enabled_by_default === true &&
    !cleared2.dialogOpen && !cleared2.node.includes('необязательный') && !cleared2.node.includes('выключен'),
  JSON.stringify(cleared2));

console.log('необязательный этап: отказ сервера виден в диалоге');
const refusedSave = await run(`
  const orig = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if ((init?.method || '').toUpperCase() === 'PATCH' && /\\/statuses\\/[a-z_]+$/.test(url)) {
      return new Response(JSON.stringify({error: {code: 'conflict', message: 'версия цикла уже активна, правка не принимается'}}),
        {status: 409, headers: {'Content-Type': 'application/json'}});
    }
    return orig(input, init);
  };
  const before = nodeText('architecture');
  await editStatus('architecture');
  await toggle('Необязательный');
  await toggle('Включён по умолчанию');
  await saveDialog();
  window.fetch = orig;
  return {dialogOpen: Boolean(dialog()), text: dialog() ? dialog().innerText.replace(/\\s+/g, ' ') : '',
    optional: sw('Необязательный')?.getAttribute('aria-checked'), def: sw('Включён по умолчанию')?.getAttribute('aria-checked'),
    same: nodeText('architecture') === before, toasts: toasts()};
`);
check('диалог остался открытым с текстом ответа',
  refusedSave.dialogOpen && refusedSave.text.includes('Статус не сохранён') && refusedSave.text.includes('версия цикла уже активна'), refusedSave.text.slice(0, 300));
check('введённое не потеряно', refusedSave.optional === 'true' && refusedSave.def === 'false', JSON.stringify([refusedSave.optional, refusedSave.def]));
check('узел не изменился, тоста об ошибке нет', refusedSave.same && !refusedSave.toasts.some((x) => x.includes('сохранён')), JSON.stringify(refusedSave.toasts));
await run('await closeDialog(); return true;');

console.log('необязательный этап: статус сохранён, роли нет');
const partial = await run(`
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
  return {dialogOpen: Boolean(dialog()), text: dialog() ? dialog().innerText.replace(/\\s+/g, ' ') : '', node: nodeText('architecture')};
`);
check('ошибка ролей остаётся в диалоге', partial.dialogOpen && partial.text.includes('роли не сохранены'), partial.text.slice(0, 300));
check('сохранённая отметка видна на узле без перезагрузки', partial.node.includes('необязательный'), partial.node);
await run('await closeDialog(); return true;');
// Оставляем отметку у architecture до активации, чтобы проверить активную версию.
const restoreMark = await run(`
  await editStatus('architecture');
  if (sw('Необязательный').getAttribute('aria-checked') !== 'true') await toggle('Необязательный');
  await toggle('Включён по умолчанию');
  await saveDialog();
  return {node: nodeText('architecture'), panel: panelText()};
`);
check('перед активацией architecture — необязательный, выключен по умолчанию',
  restoreMark.node.includes('выключен по умолчанию') && restoreMark.panel.includes('необязательный'), restoreMark.node);

console.log('активация черновика');
await run('await closePanel(); return true;');
await run(`all('button').find((b) => (b.innerText || '').trim() === 'Активировать').click(); await sleep(700); return true;`);
const confirmText = await run(`return (document.querySelector('[role=alertdialog]')?.innerText || '').replace(/\\s+/g, ' ');`);
check('активация просит подтверждения с названием версии и последствиями',
  confirmText.includes('Активировать Default SDLC · v2?') && confirmText.includes('Версия станет рабочей для типа task, прежняя активная — выведенной') &&
    confirmText.includes('Вернуть прежнюю версию можно только новым черновиком'), confirmText);
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
  const action = () => Array.from(document.querySelectorAll('[role=alertdialog] button')).find((b) => (b.innerText || '').trim() === 'Активировать');
  action().click();
  await sleep(500);
  const busy = action().disabled && all('button').some((b) => (b.innerText || '').trim() === 'Активируем…' && b.disabled);
  action().click();
  await sleep(2500);
  window.fetch = orig;
  return {busy, calls: window.__activate, open: Boolean(document.querySelector('[role=alertdialog]'))};
`);
check('пока активация идёт, кнопки заняты', activating.busy, String(activating.busy));
check('второй клик второй активации не отправляет', activating.calls === 1, String(activating.calls));
check('после ответа подтверждение закрыто', !activating.open);
await pause(2000);
t = await run('return texts();');
check('активация подтверждена отчётом', t.includes('Версия 2 активирована'), t.slice(0, 300));
check('показаны задачи, оставшиеся на прежней версии', t.includes('SDLC-1'), t.slice(0, 500));
check('версия стала рабочей и только читается', t.includes('v2 · работает') && !t.includes('Добавить статус'), t.slice(0, 300));

// «Обзор» (CLAB-365): задача на прежней версии цикла видна в своей зоне с
// токеном. Зона «Завершено недавно» развёрнута заранее — задача могла
// дойти до конца.
console.log('«Обзор» после смены версии цикла');
await run(`localStorage.setItem('sdlc.collapsed.overview.done.open', '1'); return true;`);
await s.goto(BASE + '/p/SDLC/overview?q=SDLC-1');
await pause(2000);
t = await run('return texts();');
check('задача на прежней версии не пропала', t.includes('SDLC-1'), t.slice(0, 600));
check('задача с прежней версии помечена', t.includes('прежняя версия цикла'), t.slice(0, 600));
await run(`localStorage.removeItem('sdlc.collapsed.overview.done.open'); return true;`);

console.log('активная версия: отметки видны, правки нет');
await s.goto(PAGE);
await pause(2000);
const readonly = await run(`
  const r = {text: texts(), arch: nodeText('architecture'), plain: nodeText('analysis'),
    add: all('button').some((b) => (b.innerText || '').trim() === 'Добавить статус'),
    plus: all('[aria-label^="Добавить переход из"]').length};
  await selectStatus('architecture');
  r.panel = panelText();
  r.edit = Boolean(arrow('up') || arrow('down') || panelButton('Править статус') || panelButton('Удалить'));
  return r;
`);
check('у активной версии в шапке «Черновик копией этой версии»', readonly.text.includes('v2 · работает') && readonly.text.includes('Черновик копией этой версии'), readonly.text.slice(0, 200));
check('у активной версии отметка и умолчание видны', readonly.arch.includes('выключен по умолчанию') && readonly.panel.includes('необязательный'), readonly.arch);
check('у обычного статуса жетонов нет', !readonly.plain.includes('необязательный'), readonly.plain);
check('у активной версии нет ни правки, ни порядка, ни удаления, ни «Добавить статус», ни «+»',
  !readonly.edit && !readonly.add && readonly.plus === 0, JSON.stringify({edit: readonly.edit, add: readonly.add, plus: readonly.plus}));

console.log('отметки переезжают с копией и связкой');
const drafts = [];
await run(`await closePanel(); await clickExact('Черновик копией этой версии'); await sleep(1500); return true;`);
const copied = await run(`return {text: texts(), wf: currentWf(), arch: nodeText('architecture'), plain: nodeText('analysis')};`);
drafts.push(copied.wf);
check('черновик копией активной — правимый', copied.text.includes('Добавить статус') && copied.text.includes('· черновик'), copied.text.slice(0, 200));
check('копия несёт те же отметку и умолчание', copied.arch.includes('выключен по умолчанию') && !copied.plain.includes('необязательный'), copied.arch);
const draftHint = await run(`await pickVersion('${active.id}'); return texts();`);
check('у выведенной версии в шапке «есть черновик vN — открыть»', draftHint.includes('выведена') && /есть черновик v\d+ — открыть/.test(draftHint), draftHint.slice(0, 300));

// Связка: статус qa отмечен необязательным с умолчанием «включён». Импорт
// заводит черновик, интерфейс показывает его так же.
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
await s.goto(`${BASE}/p/SDLC/pipeline?type=task&wf=${importDraft?.id}`);
await pause(2000);
const fromBundle = await run(`
  const r = {arch: nodeText('architecture'), qa: nodeText('qa'), plain: nodeText('analysis')};
  await selectStatus('qa');
  r.qaPanel = panelText();
  return r;
`);
check('черновик из связки: architecture — выключен по умолчанию', fromBundle.arch.includes('выключен по умолчанию'), fromBundle.arch);
check('черновик из связки: qa — необязательный, включён по умолчанию',
  fromBundle.qa.includes('необязательный') && !fromBundle.qa.includes('выключен') && fromBundle.qaPanel.includes('необязательный'), fromBundle.qa);
check('черновик из связки: обычный статус без жетонов', !fromBundle.plain.includes('необязательный'), fromBundle.plain);

// Связка без полей (прежняя версия сервиса): все статусы обязательные.
for (const x of wfIn.statuses) { delete x.is_optional; delete x.enabled_by_default; }
const legacy = await call('POST', '/projects/SDLC/import', bundle);
const afterLegacy = (await call('GET', '/projects/SDLC/workflows')).body.workflows;
const legacyDraft = afterLegacy.find((w) => w.state === 'draft' && !drafts.includes(w.id) && w.task_types.includes('task'));
if (legacyDraft) drafts.push(legacyDraft.id);
check('импорт связки без полей прошёл', legacy.status === 200, JSON.stringify(legacy).slice(0, 300));
if (legacyDraft) {
  await s.goto(`${BASE}/p/SDLC/pipeline?type=task&wf=${legacyDraft.id}`);
  await pause(2000);
  const noFields = await run(`return all('[data-pipeline-status]').map((n) => n.innerText.replace(/\\s+/g, ' ')).join('|');`);
  check('черновик из связки без полей: жетонов отметки нет', !noFields.includes('необязательный') && !noFields.includes('выключен'), noFields.slice(0, 300));
} else {
  check('черновик из связки без полей заведён', false, JSON.stringify(afterLegacy.map((w) => [w.version, w.state])));
}
// Черновики сценария снимаются: следующим сценариям нужен чистый список версий.
for (const id of drafts) await call('DELETE', '/workflows/' + id);

console.log('пустой черновик под другой тип задач');
await s.goto(BASE + '/p/SDLC/pipeline?type=epic');
await pause(1800);
// Циклов в проекте столько, сколько типов задач (решение 0024): черновик
// заводится под выбранный тип, а не под единственный.
const emptyCalls = await run(`
  spy(/\\/workflows$/);
  await menuItem('Пустой черновик');
  unspy();
  return window.__calls;
`);
check('пустой черновик — тот же запрос под тип epic',
  emptyCalls.length === 1 && emptyCalls[0].body.from === 'empty' && JSON.stringify(emptyCalls[0].body.task_types) === '["epic"]', JSON.stringify(emptyCalls));
t = await run('return texts();');
const emptyId = await run('return currentWf();');
check('пустой черновик открывается без падения', t.includes('Статусов нет') && t.includes('Добавить статус'), t.slice(0, 300));
check('черновик заведён под тип epic', (await call('GET', `/workflows/${emptyId}`)).body.task_types.join() === 'epic');
check('пустой цикл не активируется', t.includes('Цикл не активируется'), t.slice(0, 400));
check('названа причина', t.includes('начальн') || t.includes('стату'), t.slice(0, 500));

console.log('правка названия и типов черновика');
await run('return click("Название и типы");');
await run('return fill("Название", "Черновик под эпики");');
// Один цикл может вести несколько типов задач. Список типов в диалоге —
// последний на странице: вкладки типов тоже подписаны «epic».
await run(`
  const triggers = all('[role=dialog] button').filter((b) => (b.innerText || '').trim() === 'epic');
  triggers[triggers.length - 1].click();
  await sleep(700);
  const option = all('[role=option]').filter((o) => o.innerText.trim() === 'task').pop();
  if (!option) throw new Error('типа task нет в списке');
  option.click();
  await sleep(500);
  return true;
`);
await run(`return click('Сохранить', '[role=dialog] button');`);
await pause(1500);
t = await run('return texts();');
check('название черновика изменилось', t.includes('Черновик под эпики'), t.slice(0, 400));
check('черновик ведёт оба типа задач', (await call('GET', `/workflows/${emptyId}`)).body.task_types.sort().join() === 'epic,task');

await run('return click("Удалить черновик");');
dialogText = await run(`
  const d = document.querySelector('[role=alertdialog]');
  return d ? d.innerText.replace(/\\s+/g, ' ') : '';
`);
check('удаление черновика просит подтверждения с его названием', dialogText.includes('Удалить черновик?') && dialogText.includes('Черновик под эпики'), dialogText);
await run('return confirm("Удалить черновик");');
await pause(1000);
t = await run('return texts();');
check('черновик удалён', !t.includes('Черновик под эпики') && (await call('GET', `/workflows/${emptyId}`)).status === 404, t.slice(0, 300));
check('после удаления открыта активная версия типа', t.includes('работает'), t.slice(0, 300));

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
