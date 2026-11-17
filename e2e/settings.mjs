import {session, helpers} from './driver.mjs';

// Настройки проекта и метрики. Бэкенд поднят в режиме header: участники и
// токены заводятся, форма входа не показывается, а перенос связки работает
// по-настоящему — экспорт проекта, импортированный без изменений, обязан
// дать unchanged по всем записям.
const BASE = process.env.SDLC_UI_URL ?? 'http://localhost:5173';
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};

// Диалог рисуется в портале в конце документа, а подпись «Срок в днях» есть и
// у формы токенов: поле ищется внутри диалога. Строки приглашений читаются из
// своего раздела, чтобы «выдан» у токенов их не путал.
//
// dialog() отвечает и за AlertDialog: подтверждение вводом ключа — такое же
// поле с подписью, и находить его отдельным помощником незачем.
const dialogHelpers = `
  const dialog = () => document.querySelector('[role=dialog], [role=alertdialog]');
  const dialogText = () => ((dialog() || {}).innerText || '').replace(/\\s+/g, ' ');
  const alertText = () => {
    const d = document.querySelector('[role=alertdialog]');
    return d ? d.innerText.replace(/\\s+/g, ' ') : '';
  };
  // Кнопка в строке таблицы: одинаковых кнопок в таблице столько же, сколько
  // строк, и нужна та, что стоит против названного объекта.
  const clickInRow = async (rowText, buttonText) => {
    const row = all('tr').find((tr) => (tr.innerText || '').includes(rowText));
    if (!row) throw new Error('строка не найдена: ' + rowText);
    const btn = Array.from(row.querySelectorAll('button')).find((b) => (b.innerText || '').trim() === buttonText);
    if (!btn) throw new Error('в строке нет кнопки: ' + rowText + ' / ' + buttonText);
    btn.click();
    await sleep(700);
    return true;
  };
  // Кнопка подтверждения в открытом AlertDialog: до ввода ключа она выключена.
  const confirmDisabled = (t) => {
    const d = document.querySelector('[role=alertdialog]');
    const b = d && Array.from(d.querySelectorAll('button')).find((x) => (x.innerText || '').trim() === t);
    if (!b) throw new Error('в диалоге нет кнопки: ' + t);
    return b.disabled;
  };
  const fillIn = async (label, value) => {
    const root = dialog();
    const lbl = root && Array.from(root.querySelectorAll('label')).find((l) => l.innerText.trim().startsWith(label));
    const field = lbl && document.getElementById(lbl.getAttribute('for'));
    if (!field) throw new Error('поле в диалоге не найдено: ' + label);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, value);
    field.dispatchEvent(new Event('input', {bubbles: true}));
    await sleep(250);
    return true;
  };
  const inviteRows = () => {
    const sec = document.querySelector('section[aria-label="Приглашения"]');
    return sec ? Array.from(sec.querySelectorAll('tbody tr')).map((tr) => tr.innerText.replace(/\\s+/g, ' ').trim()) : [];
  };
`;

const s = await session(BASE + '/p/SDLC/settings');
const run = (body) => s.evaluate(helpers + dialogHelpers + body);
await new Promise((r) => setTimeout(r, 2500));

console.log('настройки: вкладки (CLAB-39)');
const TABS = ['members', 'teams', 'github', 'tokens', 'agents', 'transfer', 'audit', 'danger'];
const LABELS = ['Участники', 'Команды', 'GitHub', 'Токены', 'Агенты и модели', 'Перенос правил', 'Журнал', 'Опасная зона'];
let t = await run('return texts();');
check('режим отладки назван', t.includes('Режим отладки'), t.slice(0, 300));
const bar = await run(`
  const tabs = all('[role=tab][data-settings-tab]');
  return {
    keys: tabs.map((el) => el.getAttribute('data-settings-tab')),
    labels: tabs.map((el) => el.innerText.trim()),
    selected: tabs.filter((el) => el.getAttribute('aria-selected') === 'true').map((el) => el.getAttribute('data-settings-tab')),
    separators: document.querySelector('[data-slot=tabs]').parentElement.querySelectorAll('[data-slot=separator]').length,
  };
`);
check('восемь вкладок в порядке дизайна', JSON.stringify(bar.keys) === JSON.stringify(TABS) &&
  JSON.stringify(bar.labels) === JSON.stringify(LABELS), JSON.stringify(bar));
check('без адреса выбрана первая вкладка, ленты через Separator нет',
  JSON.stringify(bar.selected) === '["members"]' && bar.separators === 0, JSON.stringify(bar));
check('адрес пустой вкладкой не переписан', new URL(await run('return location.href;')).search === '');

// Разделы по вкладкам: заголовок h2 на своей вкладке, подзаголовок в одну
// строку и «Подробнее» с полным прежним текстом (AC-1, AC-16, AC-17).
const HEADINGS = {
  members: ['Участники'], teams: ['Команды'], github: ['Доступ к GitHub', 'Репозитории'], tokens: ['Токены'],
  agents: ['Агенты и модели'], transfer: ['Перенос правил'], audit: ['Журнал действий'], danger: ['Опасная зона'],
};
for (const key of TABS) {
  await run(`await openSettingsTab(${JSON.stringify(key)});`);
  const view = await run(`
    const panel = document.querySelector('[data-settings-panel="${key}"][data-state=active]');
    const visibleH2 = panel ? Array.from(panel.querySelectorAll('h2')).map((h) => h.innerText.trim()) : [];
    const infos = panel ? Array.from(panel.querySelectorAll('[data-section-details]')).map((b) => b.getAttribute('aria-label')) : [];
    return {
      h2: visibleH2, infos, search: location.search,
      note: document.body.innerText.includes('Режим отладки'),
      shown: all('[data-settings-panel]').filter((el) => el.getAttribute('data-state') === 'active' && el.offsetParent !== null).length,
    };
  `);
  check('вкладка ' + key + ': заголовки ' + HEADINGS[key].join(', '),
    HEADINGS[key].every((h) => view.h2.includes(h)) && view.shown === 1, JSON.stringify(view));
  check('вкладка ' + key + ': адрес ?tab= и «Подробнее» у каждого раздела',
    (view.search === '?tab=' + key || (key === 'members' && view.search === '')) && HEADINGS[key].every((h) => view.infos.includes('Подробнее: ' + h)), JSON.stringify(view));
  check('вкладка ' + key + ': заметка режима отладки на месте', view.note === true);
}
await run('await openSettingsTab("members");');

// Подзаголовок одной строкой, полный текст — по «Подробнее» (поповер).
const sub = await run(`
  const sec = Array.from(document.querySelectorAll('section')).find((el) => el.querySelector('h2')?.innerText.trim() === 'Участники');
  const p = sec.querySelector('h2').parentElement.querySelector('p');
  return {text: p.innerText.trim(), single: p.getBoundingClientRect().height < 24};
`);
check('подзаголовок раздела — одна строка', sub.text === 'Уровни доступа и роли специалистов' && sub.single, JSON.stringify(sub));
await run('document.querySelector(\'[data-section-details][aria-label="Подробнее: Участники"]\').click(); await sleep(500);');
const more = await run('return document.querySelector("[data-slot=popover-content]")?.innerText ?? "";');
check('«Подробнее» открывает прежний полный текст',
  more.includes('Уровень — про права') && more.includes('токен агента может только сузить этот набор'), more);
await run('document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true})); await sleep(500);');

// Адрес и история (AC-2, AC-3). Клик по вкладке пишет запись в историю.
await run('await openSettingsTab("tokens");');
check('переключение пишет ?tab= в адрес', (await run('return location.search;')) === '?tab=tokens');
await run('history.back(); await sleep(900);');
check('«Назад» возвращает прежнюю вкладку', (await run('return location.search;')) === '?tab=members',
  await run('return location.search;'));
await s.goto(BASE + '/p/SDLC/settings?tab=tokens');
await new Promise((r) => setTimeout(r, 2000));
let sel = await run('return all("[role=tab][aria-selected=true]").map((el) => el.getAttribute("data-settings-tab"));');
check('адрес ?tab=tokens открывает вкладку «Токены» в новой сессии', JSON.stringify(sel) === '["tokens"]', JSON.stringify(sel));
for (const bad of ['?tab=nope', '?tab=', '?x=1']) {
  await s.goto(BASE + '/p/SDLC/settings' + bad);
  await new Promise((r) => setTimeout(r, 2000));
  sel = await run('return all("[role=tab][aria-selected=true]").map((el) => el.getAttribute("data-settings-tab"));');
  const body = await run('return {search: location.search, text: texts()};');
  check('адрес ' + bad + ' — первая вкладка, адрес не переписан, ошибки нет',
    JSON.stringify(sel) === '["members"]' && body.search === bad && !body.text.includes('Не получилось'), JSON.stringify([sel, body.search]));
}
// Чужие параметры запроса переключение не трогает.
await s.goto(BASE + '/p/SDLC/settings?x=1');
await new Promise((r) => setTimeout(r, 2000));
await run('await openSettingsTab("teams");');
check('чужие параметры сохранены', (await run('return location.search;')) === '?x=1&tab=teams');
await s.goto(BASE + '/p/SDLC/settings');
await new Promise((r) => setTimeout(r, 2000));

console.log('настройки: участники');
await run(`await openSettingsTab("members");`);
t = await run('return texts();');
check('карточки «Добавить или изменить уровень» на странице нет',
  !t.includes('Добавить или изменить уровень') && !t.includes('Принципал'), t.slice(0, 400));

await run('await clickExact("Добавить участника");');
let d = await run('return dialogText();');
check('форма участника — диалог', d.includes('Добавить участника или изменить уровень') &&
  d.includes('Принципал, который уже в проекте, получит новый уровень и роли.'), d);
check('без принципала «Сохранить» выключено',
  await run('const b = Array.from(dialog().querySelectorAll("button")).find((x) => x.innerText.trim() === "Сохранить"); return b.disabled;') === true);
// Отказ сервера — Failure внутри диалога с текстом сервера, введённое на месте,
// тоста нет (AC-7).
await run(`await fillIn("Принципал", "user:e2e-nobody"); await clickExact("Сохранить"); await sleep(1500);`);
d = await run('return dialogText();');
check('отказ сервера в диалоге: заголовок, поля на месте',
  d.includes('Участник не сохранён') && d.includes('Добавить участника или изменить уровень') && d.includes('Сохранить'), d);
check('введённый принципал остался',
  await run('return Array.from(dialog().querySelectorAll("input")).some((i) => i.value === "user:e2e-nobody");') === true);
check('об отказе тоста нет', (await run('return toasts();')).length === 0);
await run('await clickExact("Отмена"); await sleep(500);');
check('диалог закрылся', (await run('return Boolean(dialog());')) === false);
await run('await clickExact("Добавить участника");');
check('повторно открытая форма пуста',
  await run('return Array.from(dialog().querySelectorAll("input")).every((i) => i.value === "");') === true);
await run(`
  await fillIn("Принципал", "agent:e2e-bot");
  await sleep(200);
  await clickExact("Сохранить");
  await sleep(1500);
`);
check('диалог закрылся после сохранения', (await run('return Boolean(dialog());')) === false);
let toastList = await run('return toasts();');
check('тост называет принципала', toastList.some((x) => x.includes('Уровень agent:e2e-bot сохранён')), toastList.join(' | '));
t = await run('return texts();');
check('участник добавлен', t.includes('agent:e2e-bot'), t.slice(0, 600));
// Роли специалиста (решение 0030): без выбора участник забирает любые, и
// колонка так и говорит.
check('роли участника показаны', t.includes('Роли') && t.includes('любые'), t.slice(0, 900));

console.log('приглашения');
// Тело запроса выдачи перехватывается в самой странице: клиент зовёт
// глобальный fetch, и так видно, что пустой срок не уходит полем days.
await run(`
  window.__inviteBodies = [];
  const orig = window.fetch;
  window.fetch = (url, init) => {
    if (String(url).endsWith('/invites') && init && init.method === 'POST') window.__inviteBodies.push(init.body);
    return orig(url, init);
  };
  await clickExact("Пригласить");
  await sleep(500);
  await fillIn("Срок в днях", "31");
  await clickExact("Выдать ссылку");
  await sleep(1500);
`);
d = await run('return dialogText();');
// Диапазон срока проверяет бэкенд, а не форма: его отказ остаётся в диалоге.
check('срок вне диапазона — отказ бэкенда в открытом диалоге',
  d.includes('от 1 до 30') && d.includes('Выдать ссылку'), d);

await run(`
  await fillIn("Срок в днях", "");
  await clickExact("Выдать ссылку");
  await sleep(1500);
`);
d = await run('return dialogText();');
check('ссылка показана один раз и с предупреждением',
  d.includes(BASE + '/invite/clab_inv_') && d.includes('показывается один раз') && d.includes('больше не покажется'), d);
const bodies = (await run('return window.__inviteBodies;')).map((b) => JSON.parse(b));
const issuedBody = bodies[bodies.length - 1] ?? {};
check('в теле уровень и пустые роли, пустой срок полем не уходит',
  bodies.length === 2 && bodies[0].days === 31 && issuedBody.level === 'viewer' &&
    Array.isArray(issuedBody.role_keys) && issuedBody.role_keys.length === 0 && !('days' in issuedBody),
  JSON.stringify(bodies));
// Срок по умолчанию ставит бэкенд — неделя; пустые роли у него значат «любые».
const issued = await run(`
  const r = await fetch('/v1/projects/SDLC/invites', {headers: {'X-SDLC-Actor': 'web'}});
  return (await r.json()).invites[0];
`);
const issuedDays = (Date.parse(issued.expires_at) - Date.parse(issued.created_at)) / 86400000;
check('срок по умолчанию — неделя, роли — любые',
  Math.abs(issuedDays - 7) < 0.01 && issued.role_keys === null && issued.status === 'pending',
  JSON.stringify(issued));

await run('await clickExact("Готово"); await sleep(1000);');
const leaks = await run(`
  const stored = [localStorage, sessionStorage].flatMap((st) => Object.keys(st).map((k) => st.getItem(k) || ''));
  return {
    storage: stored.some((v) => v.includes('clab_inv_')),
    url: location.href.includes('clab_inv_'),
    page: document.body.innerText.includes('clab_inv_'),
  };
`);
check('токена нет ни в хранилище, ни в адресе, ни на странице',
  !leaks.storage && !leaks.url && !leaks.page, JSON.stringify(leaks));
await run('await clickExact("Пригласить"); await sleep(500);');
d = await run('return dialogText();');
check('повторно открытый диалог ссылки не показывает', !d.includes('clab_inv_') && d.includes('Выдать ссылку'), d);
await run('await clickExact("Отмена"); await sleep(500);');

let r = await run('return inviteRows();');
check('выданное приглашение наверху списка: «выдан», уровень, любые роли',
  (r[0] ?? '').includes('выдан') && r[0].includes('viewer') && r[0].includes('любые') && r[0].includes('Отозвать'),
  r.join(' | '));
await run('await clickIn("Приглашения", "Отозвать"); await sleep(300);');
// Отзыв необратим: запрос уходит только после подтверждения.
let alert = await run(`
  const d = document.querySelector('[role=alertdialog]');
  return d ? d.innerText.replace(/\\s+/g, ' ') : '';
`);
check('отзыв приглашения просит подтверждения', alert.includes('Отозвать приглашение?'), alert);
r = await run('return inviteRows();');
check('до подтверждения приглашение выдано', (r[0] ?? '').includes('выдан') && r[0].includes('Отозвать'), r.join(' | '));
await run('await confirm("Отозвать"); await sleep(600);');
r = await run('return inviteRows();');
check('отозванное — «отозван», кнопки больше нет',
  (r[0] ?? '').includes('отозван') && !r[0].includes('Отозвать'), r.join(' | '));
toastList = await run('return toasts();');
check('об отзыве сообщил тост', toastList.some((x) => x.includes('Приглашение отозвано')), toastList.join(' | '));

console.log('токены: диалог выдачи (CLAB-39)');
await run('await openSettingsTab("tokens");');
t = await run('return texts();');
check('раскрытой карточки «Выдать токен» на вкладке нет',
  !t.includes('Токен действует в проекте') && !(await run('return all("h3").some((h) => h.innerText.trim() === "Выдать токен");')), t.slice(0, 400));
// Тела выдачи перехватываются в самой странице: пустые роли — role_keys: [],
// пустой срок поля expires_in_days в теле не даёт (AC-8).
await run(`
  window.__tokenBodies = [];
  const orig = window.fetch;
  window.fetch = (url, init) => {
    if (String(url).endsWith('/auth/tokens') && init && init.method === 'POST') window.__tokenBodies.push(init.body);
    return orig(url, init);
  };
  await clickExact("Выдать токен");
  await sleep(600);
`);
d = await run('return dialogText();');
check('форма токена — диалог с описанием', d.includes('Токен действует в проекте SDLC. Показывается один раз.') && d.includes('Выдать'), d);
const fields = await run(`
  const root = dialog();
  const lbl = (t) => Array.from(root.querySelectorAll('label')).find((l) => l.innerText.trim().startsWith(t));
  const roles = lbl('Роли специалистов');
  const days = lbl('Срок в днях');
  const rolesEl = roles && document.getElementById(roles.getAttribute('for'));
  const daysEl = days && document.getElementById(days.getAttribute('for'));
  return {rolesRole: rolesEl?.getAttribute('role'), rolesTag: rolesEl?.tagName, daysType: daysEl?.getAttribute('type'),
    text: root.innerText.replace(/\\s+/g, ' ')};
`);
check('«Роли специалистов» — выбор из списка, «Срок в днях» — числовое поле',
  fields.rolesRole === 'combobox' && fields.rolesTag === 'BUTTON' && fields.daysType === 'number' &&
    fields.text.includes('Любые роли') && !fields.text.includes('через запятую'), JSON.stringify(fields));
check('без имени «Выдать» выключено',
  await run('return Array.from(dialog().querySelectorAll("button")).find((x) => x.innerText.trim() === "Выдать").disabled;') === true);
// Отказ сервера (принципала «Кому» нет в системе): Failure в диалоге, поля на месте, токена нет (AC-10).
await run(`
  await fillIn("Имя", "e2e-token");
  await fillIn("Кому", "user:e2e-nobody");
  await fillIn("Срок в днях", "7");
  await clickExact("Выдать");
  await sleep(1500);
`);
d = await run('return dialogText();');
const refusal = await run('return Array.from(dialog().querySelectorAll("[role=alert]")).map((a) => a.innerText.replace(/\\s+/g, " "));');
check('отказ выдачи — Failure «Токен не выдан» в диалоге, токена нет',
  refusal.some((x) => x.includes('Токен не выдан')) && !(await run('return Boolean(document.querySelector("[data-token-shown]"));')), JSON.stringify(refusal));
check('поля после отказа на месте',
  await run('return Array.from(dialog().querySelectorAll("input")).filter((i) => i.value === "e2e-token" || i.value === "user:e2e-nobody" || i.value === "7").length === 3;') === true);
check('об отказе тоста нет', (await run('return toasts();')).length === 0);
check('Esc во время формы закрывает диалог без выдачи',
  (await run(`
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    await sleep(600);
    return Boolean(dialog());
  `)) === false);
await run('await clickExact("Выдать токен"); await sleep(600);');
check('после закрытия без выдачи форма пуста',
  await run('return Array.from(dialog().querySelectorAll("input")).every((i) => i.value === "");') === true);

await run(`
  await fillIn("Имя", "e2e-token");
  await sleep(200);
  await clickExact("Выдать");
  await sleep(1500);
`);
d = await run('return dialogText();');
const shown = await run(`
  const code = document.querySelector('[data-token-shown] pre.code-block');
  return {token: code ? code.textContent : '', focus: document.activeElement?.hasAttribute('data-token-shown') ?? false,
    close: Boolean(dialog()?.querySelector('[data-slot=dialog-close]')), role: document.querySelector('[data-token-shown]')?.getAttribute('role')};
`);
check('токен показан с предупреждением, заголовок называет имя',
  d.includes('Токен «e2e-token» выдан') && d.includes('Токен показывается один раз') && d.includes('больше не покажется') &&
    shown.token.startsWith('sdlc_'), d);
check('у показа role=status, фокус на нём, крестика нет, кнопка «Готово» одна',
  shown.role === 'status' && shown.focus && shown.close === false &&
    (await run('return Array.from(dialog().querySelectorAll("button")).map((b) => b.innerText.trim()).filter(Boolean);')).includes('Готово'),
  JSON.stringify(shown));
const tokenBodies = (await run('return window.__tokenBodies;')).map((b) => JSON.parse(b));
const lastBody = tokenBodies[tokenBodies.length - 1] ?? {};
check('в теле выдачи role_keys пуст, expires_in_days нет',
  Array.isArray(lastBody.role_keys) && lastBody.role_keys.length === 0 && !('expires_in_days' in lastBody) && lastBody.name === 'e2e-token' &&
    tokenBodies[0].expires_in_days === 7 && tokenBodies[0].principal === 'user:e2e-nobody', JSON.stringify(tokenBodies));
// Тост называет токен по имени, но не содержит самого токена (AC-9).
toastList = await run('return toasts();');
check('тост называет имя, а не токен', toastList.some((x) => x.includes('Токен e2e-token выдан')) && !toastList.some((x) => x.includes(shown.token)), toastList.join(' | '));
// Ни Esc, ни клик мимо диалога его не закрывают; закрывает только «Готово».
await run(`
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
  await sleep(500);
`);
check('Esc диалог с токеном не закрывает', await run('return Boolean(document.querySelector("[data-token-shown]"));') === true);
await run(`
  const overlay = document.querySelector('[data-slot=dialog-overlay]');
  const opts = {bubbles: true, cancelable: true, button: 0, pointerType: 'mouse', clientX: 3, clientY: 3};
  overlay.dispatchEvent(new PointerEvent('pointerdown', opts));
  overlay.dispatchEvent(new MouseEvent('mousedown', opts));
  overlay.dispatchEvent(new PointerEvent('pointerup', opts));
  overlay.dispatchEvent(new MouseEvent('click', opts));
  await sleep(500);
`);
check('клик мимо диалог с токеном не закрывает', await run('return Boolean(document.querySelector("[data-token-shown]"));') === true);
t = await run('return texts();');
check('токен в списке', t.includes('e2e-token') && t.includes('действует'));
await run('await clickExact("Готово"); await sleep(800);');
const leaksToken = await run(`
  const needle = ${JSON.stringify(shown.token)};
  const stored = [localStorage, sessionStorage].flatMap((st) => Object.keys(st).map((k) => st.getItem(k) || ''));
  return {
    storage: stored.some((v) => v.includes(needle)),
    url: location.href.includes(needle),
    page: document.body.innerText.includes(needle) || document.body.innerHTML.includes(needle),
  };
`);
check('после «Готово» токена нет ни на странице, ни в хранилище, ни в адресе',
  !leaksToken.storage && !leaksToken.url && !leaksToken.page, JSON.stringify(leaksToken));
await run('await clickExact("Выдать токен"); await sleep(600);');
d = await run('return dialogText();');
check('повторно открытый диалог — пустая форма без токена',
  !d.includes('sdlc_') && !d.includes('больше не покажется') &&
    await run('return Array.from(dialog().querySelectorAll("input")).every((i) => i.value === "");') === true, d);

// Роли токена выбираются из ролей проекта (AC-8): берётся первая из списка.
await run('const cb = dialog().querySelector("[role=combobox]"); cb.click(); await sleep(500);');
const roleLabel = await run(`
  const item = document.querySelector('[cmdk-item]');
  const label = item ? item.innerText.trim() : '';
  if (item) { item.click(); await sleep(300); }
  return label;
`);
const roleKey = roleLabel.slice(roleLabel.lastIndexOf('(') + 1, -1);
check('в списке ролей — роли проекта «Название (ключ)»', roleKey !== '' && roleLabel.includes(' ('), roleLabel);
await run('document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true})); await sleep(400);');
check('выбранная роль жетоном в поле',
  (await run('return dialog() ? dialog().querySelector("[role=combobox]").innerText : "";')).includes(roleLabel));
await run(`
  await fillIn("Имя", "e2e-narrow");
  await fillIn("Срок в днях", "5");
  await clickExact("Выдать");
  await sleep(1500);
  await clickExact("Готово");
  await sleep(800);
`);
const narrow = JSON.parse((await run('return window.__tokenBodies;')).slice(-1)[0]);
check('с выбранной ролью и сроком тело несёт role_keys и expires_in_days',
  JSON.stringify(narrow.role_keys) === JSON.stringify([roleKey]) && narrow.expires_in_days === 5, JSON.stringify(narrow));
t = await run('return texts();');
check('узкий токен в списке с ролью', t.includes('e2e-narrow') && t.includes(roleKey), t.slice(0, 1000));

console.log('отзыв токена');
await run('await clickInRow("e2e-token", "Отозвать"); await sleep(300);');
alert = await run(`
  const d = document.querySelector('[role=alertdialog]');
  return d ? d.innerText.replace(/\\s+/g, ' ') : '';
`);
check('отзыв токена просит подтверждения с именем токена',
  alert.includes('Отозвать токен?') && alert.includes('e2e-token'), alert);
// Esc закрывает диалог без запроса: токен по-прежнему действует.
await run(`
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
  await sleep(600);
`);
t = await run('return texts();');
check('Esc закрывает диалог, токен действует',
  !(await run('return Boolean(document.querySelector("[role=alertdialog]"));')) && t.includes('действует'), t.slice(0, 800));
await run('await clickInRow("e2e-token", "Отозвать"); await sleep(300); await confirm("Отозвать"); await sleep(600);');
t = await run('return texts();');
check('токен отозван', t.includes('отозван') && t.includes('e2e-token'), t.slice(0, 800));

console.log('перенос связки');
await run('await openSettingsTab("transfer");');
await run('await clickExact("Экспортировать проект"); await sleep(1500); return true;');
// Блок кода прокручивается, поэтому innerText содержит только видимую
// часть, а полный JSON — в textContent.
const exported = await run(`
  const code = document.querySelector('pre.code-block[data-language="json"] code');
  return code ? code.textContent : '';
`);
t = await run('return texts();');
check('экспорт показан', t.includes('bundle.json') && exported.includes('"roles"'), t.slice(0, 300));

// Сухой прогон связки и отчёт по строкам: «Что» и «Итог» каждой строки
// таблицы отчёта и заголовки примечаний под ней. Читается только карточка
// импорта, чтобы таблицы участников и токенов не попадали в отчёт.
const dryRun = async (bundle) => run(`
  await fill("Связка JSON", ${JSON.stringify(bundle)});
  await sleep(300);
  await clickExact("Проверить (без изменений)");
  await sleep(2000);
  const card = all('h3').find((h) => h.innerText.trim() === 'Импортировать связку')?.parentElement;
  if (!card) throw new Error('карточка импорта не найдена');
  const rows = Array.from(card.querySelectorAll('tbody tr')).map((tr) => {
    const cells = Array.from(tr.querySelectorAll('td')).map((td) => (td.innerText || '').trim());
    return {section: cells[0], key: cells[1], outcome: cells[2]};
  });
  return {text: (card.innerText || '').replace(/\\s+/g, ' '), rows};
`);
const outcomes = (report, section) => report.rows.filter((r) => r.section === section).map((r) => r.outcome);

// Экспорт целиком вставляется в поле импорта и проверяется сухим прогоном.
// Контракт CLAB-108: цикл, совпадающий с действующей версией, черновика не
// заводит и отчитывается unchanged, как и роли с той же инструкцией.
let report = await dryRun(exported);
let cycles = outcomes(report, 'цикл');
check('сухой прогон отчитался', report.text.includes('Сухой прогон'), report.text.slice(0, 500));
check('ничего не изменится', report.rows.length > 0 &&
  report.rows.every((r) => r.outcome !== 'new_version' && r.outcome !== 'draft_created'), JSON.stringify(report.rows));
check('цикл как есть отчитался unchanged', cycles.length > 0 && cycles.every((o) => o === 'unchanged'),
  JSON.stringify(report.rows));
check('примечание не зовёт активировать черновик неизменённого цикла',
  report.text.includes('не изменился') && !report.text.includes('активируйте черновик'), report.text.slice(0, 1500));

// Тот же экспорт с переименованным первым статусом первого цикла: имя статуса
// входит в сравнение циклов, и такой цикл приходит черновиком. «Применить» не
// нажимается — workflow.mjs рассчитывает на цикл демо-проекта без лишних
// черновиков.
const changed = JSON.parse(exported);
changed.workflows[0].statuses[0].name += ' (e2e)';
report = await dryRun(JSON.stringify(changed, null, 2));
cycles = outcomes(report, 'цикл');
check('изменённый цикл пришёл бы черновиком',
  cycles[0] === 'draft_created' && cycles.slice(1).every((o) => o === 'unchanged'), JSON.stringify(report.rows));
check('роли при изменённом цикле unchanged',
  outcomes(report, 'роль').length > 0 && outcomes(report, 'роль').every((o) => o === 'unchanged') &&
    report.rows.every((r) => r.outcome !== 'new_version'), JSON.stringify(report.rows));
check('примечание зовёт активировать черновик изменённого цикла',
  report.text.includes('активируйте черновик'), report.text.slice(0, 1500));

console.log('репозитории: отвязка и живая задача');
await run('await openSettingsTab("github");');
t = await run('return texts();');
check('раздел репозиториев показывает область проекта',
  t.includes('Репозитории') && t.includes('cadence-lab-tech/sdlc-pipeline-backend') && t.includes('в области'),
  t.slice(0, 1500));
await run('await clickInRow("cadence-lab-tech/sdlc-pipeline-backend", "Отвязать"); await sleep(300);');
alert = await run('return alertText();');
// Счётчиков до удаления бэкенд не отдаёт, поэтому диалог называет категории.
check('диалог называет репозиторий и что уйдёт вместе с ним',
  alert.includes('Отвязать репозиторий?') && alert.includes('cadence-lab-tech/sdlc-pipeline-backend') &&
    alert.includes('прогоны индексации') && alert.includes('сигналы дрейфа'), alert);
await run('await confirm("Отвязать"); await sleep(800);');
t = await run('return texts();');
// SDLC-1 и SDLC-3 стоят на нетерминальных статусах, и репозиторий у них в
// области: бэкенд называет ключи задач, а интерфейс показывает его текст как есть.
check('живая задача не даёт отвязать, репозиторий на месте',
  t.includes('терминального статуса') && t.includes('SDLC-') && t.includes('cadence-lab-tech/sdlc-pipeline-backend'),
  t.slice(0, 1500));
toastList = await run('return toasts();');
check('об отказе тоста нет', toastList.length === 0, toastList.join(' | '));

console.log('свой проект: отвязка репозитория и удаление проекта');
// Удаление проверяется только на том, что сценарий завёл сам: демонстрационный
// проект нужен следующим сценариям целым.
await s.goto(BASE + '/projects');
await new Promise((r) => setTimeout(r, 2000));
await run(`
  await clickExact("Новый проект");
  await sleep(300);
  await fill("Ключ", "delme");
  await fill("Название", "Проект на удаление");
  await sleep(200);
  await clickExact("Создать проект");
  await sleep(2000);
`);
// Репозиторий привязывается ручкой: в интерфейсе он приходит из установки
// GitHub, которой у dev-инстанса нет. Точка в имени проверяет экранирование
// пути отвязки.
const added = await run(`
  const r = await fetch('/v1/projects/DELME/repositories', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'X-SDLC-Actor': 'web'},
    body: JSON.stringify({
      repository: 'e2e-org/repo.one',
      default_branch: 'main',
      clone_url: 'https://example.invalid/e2e-org/repo.one.git',
      role_hint: 'e2e',
    }),
  });
  return r.status;
`);
check('репозиторий привязан ручкой', added === 200 || added === 201, String(added));
await s.goto(BASE + '/p/DELME/settings?tab=github');
await new Promise((r) => setTimeout(r, 2500));
t = await run('return texts();');
check('репозиторий виден в настройках нового проекта',
  t.includes('e2e-org/repo.one') && t.includes('main'), t.slice(0, 1500));
await run('await clickInRow("e2e-org/repo.one", "Отвязать"); await sleep(300); await confirm("Отвязать"); await sleep(1000);');
t = await run('return texts();');
check('репозиторий отвязан и список перезапрошен',
  !t.includes('e2e-org/repo.one') && t.includes('Репозиториев в проекте нет'), t.slice(0, 1500));
toastList = await run('return toasts();');
check('тост называет репозиторий и снятое',
  toastList.some((x) => x.includes('e2e-org/repo.one') && x.includes('отвязан')), toastList.join(' | '));

check('на других вкладках удаления проекта нет', !(await run('return texts();')).includes('Удалить проект DELME'));
await run('await openSettingsTab("danger");');
t = await run('return texts();');
// Опасная зона — отдельная последняя вкладка, карточка с рамкой и фоном destructive (AC-15).
const danger = await run(`
  const card = document.querySelector('[data-settings-panel="danger"] [data-slot=card]');
  return {classes: card ? card.className : '', tab: document.querySelector('[data-settings-tab="danger"]').className};
`);
check('опасная зона стоит отдельной вкладкой и объясняет цену',
  t.includes('Опасная зона') && t.includes('Удалить проект DELME') && t.includes('Необратимо: восстановления нет') &&
    t.includes('Проект исчезает целиком'), t.slice(-1500));
check('карточка опасной зоны — рамка и фон по токену destructive, подпись вкладки destructive',
  danger.classes.includes('border-destructive') && danger.classes.includes('bg-destructive') && danger.tab.includes('text-destructive'), JSON.stringify(danger));
await run('await clickExact("Удалить проект"); await sleep(500);');
alert = await run('return alertText();');
check('диалог называет проект, что исчезнет и что это навсегда',
  alert.includes('Удалить проект DELME?') && alert.includes('задачами') && alert.includes('артефактами') &&
    alert.includes('восстановления не будет'), alert);
check('без ключа подтверждение выключено', await run('return confirmDisabled("Удалить проект");') === true);
await run('await fillIn("Ключ проекта", "DELM"); await sleep(300);');
check('неполный ключ не открывает подтверждение', await run('return confirmDisabled("Удалить проект");') === true);
await run('await fillIn("Ключ проекта", "DELME"); await sleep(300);');
check('ключ введён — подтверждение доступно', await run('return confirmDisabled("Удалить проект");') === false);
await run('await confirm("Удалить проект"); await sleep(2000);');
check('после удаления интерфейс ушёл на список проектов',
  (await run('return location.pathname;')) === '/projects', await run('return location.pathname;'));
t = await run('return texts();');
check('удалённого проекта в списке нет', !t.includes('DELME'), t.slice(0, 1000));
toastList = await run('return toasts();');
check('тост называет ключ проекта и счётчики',
  toastList.some((x) => x.includes('Проект DELME удалён')), toastList.join(' | '));

console.log('возврат от GitHub на вкладку GitHub');
// Приложения у dev-инстанса нет: приход с installation_id показывает отказ и
// кнопку «Назад», которая идёт по сохранённому намерению (back). Новый back —
// с вкладкой, старый, без неё, открывает первую вкладку без ошибки (AC-11).
const goBack = async (back) => {
  await s.goto(BASE + '/');
  await run(`sessionStorage.setItem('sdlc.github.connect', JSON.stringify({state: 'e2e-state', team: 'e2e', project: 'SDLC', back: ${JSON.stringify(back)}}));`);
  await s.goto(BASE + '/settings/github/callback?installation_id=1&state=e2e-state');
  await new Promise((r) => setTimeout(r, 2000));
  await run('await clickExact("Назад"); await sleep(1500);');
  return run('return {path: location.pathname, search: location.search, tabs: all("[role=tab][aria-selected=true]").map((el) => el.getAttribute("data-settings-tab")), failed: texts().includes("Не получилось")};');
};
let back = await goBack('/p/SDLC/settings?tab=github');
check('back с вкладкой — открыта вкладка GitHub', back.path === '/p/SDLC/settings' && JSON.stringify(back.tabs) === '["github"]' && !back.failed, JSON.stringify(back));
back = await goBack('/p/SDLC/settings');
check('старый back без вкладки — первая вкладка, без ошибки', back.path === '/p/SDLC/settings' && JSON.stringify(back.tabs) === '["members"]' && !back.failed, JSON.stringify(back));

console.log('метрики');
await s.goto(BASE + '/p/SDLC/metrics');
await new Promise((r) => setTimeout(r, 2500));
t = await run('return texts();');
check('метрики открылись', t.includes('Метрики цикла') && t.includes('Создано задач'), t.slice(0, 300));
check('статусы взяты из цикла проекта', t.includes('По статусам') && t.includes('Аналитика') || t.includes('analysis'), t.slice(0, 900));

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
