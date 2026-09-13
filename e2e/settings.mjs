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
const dialogHelpers = `
  const dialog = () => document.querySelector('[role=dialog]');
  const dialogText = () => ((dialog() || {}).innerText || '').replace(/\\s+/g, ' ');
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

console.log('настройки: режим и участники');
let t = await run('return texts();');
check('режим отладки назван', t.includes('Режим отладки'), t.slice(0, 300));
check('разделы на месте', t.includes('Участники') && t.includes('Токены') && t.includes('Перенос правил'));

await run(`
  await fill("Принципал", "agent:e2e-bot");
  await sleep(200);
  await clickIn("Добавить или изменить уровень", "Сохранить");
  await sleep(1200);
`);
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
let d = await run('return dialogText();');
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
let toastList = await run('return toasts();');
check('об отзыве сообщил тост', toastList.some((x) => x.includes('Приглашение отозвано')), toastList.join(' | '));

console.log('токены');
await run(`
  await fill("Имя", "e2e-token");
  await sleep(200);
  await clickIn("Выдать токен", "Выдать");
  await sleep(1500);
`);
t = await run('return texts();');
check('токен показан один раз', t.includes('скопируйте его сейчас') && t.includes('sdlc_'), t.slice(0, 800));
check('токен в списке', t.includes('e2e-token') && t.includes('действует'));
// Тост называет токен и исчезает сам; выданный токен при этом остаётся на
// экране — тост не заменяет результат.
toastList = await run('return toasts();');
check('о выдаче сообщил тост с именем токена', toastList.some((x) => x.includes('Токен e2e-token выдан')), toastList.join(' | '));
await new Promise((r) => setTimeout(r, 6000));
toastList = await run('return toasts();');
t = await run('return texts();');
check('тост исчез сам, токен остался на экране',
  toastList.length === 0 && t.includes('скопируйте его сейчас') && t.includes('sdlc_'), toastList.join(' | '));

console.log('отзыв токена');
await run('await clickIn("Токены", "Отозвать"); await sleep(300);');
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
await run('await clickIn("Токены", "Отозвать"); await sleep(300); await confirm("Отозвать"); await sleep(600);');
t = await run('return texts();');
check('токен отозван', t.includes('отозван') && t.includes('e2e-token'), t.slice(0, 800));

console.log('перенос связки');
await run('await clickExact("Экспортировать проект"); await sleep(1500); return true;');
// Блок кода прокручивается, поэтому innerText содержит только видимую
// часть, а полный JSON — в textContent.
const exported = await run(`
  const code = document.querySelector('pre.code-block[data-language="json"] code');
  return code ? code.textContent : '';
`);
t = await run('return texts();');
check('экспорт показан', t.includes('bundle.json') && exported.includes('"roles"'), t.slice(0, 300));

// Экспорт целиком вставляется в поле импорта и проверяется сухим прогоном.
await run(`
  const bundle = ${JSON.stringify(exported)};
  await fill("Связка JSON", bundle);
  await sleep(300);
  await clickExact("Проверить (без изменений)");
  await sleep(2000);
`);
t = await run('return texts();');
check('сухой прогон отчитался', t.includes('Сухой прогон'), t.slice(0, 500));
check('ничего не изменится', t.includes('unchanged') && !t.includes('new_version'), t.slice(0, 900));
check('цикл пришёл бы черновиком', t.includes('draft_created'), t.slice(0, 900));

console.log('метрики');
await s.goto(BASE + '/p/SDLC/metrics');
await new Promise((r) => setTimeout(r, 2500));
t = await run('return texts();');
check('метрики открылись', t.includes('Метрики цикла') && t.includes('Создано задач'), t.slice(0, 300));
check('статусы взяты из цикла проекта', t.includes('По статусам') && t.includes('Аналитика') || t.includes('analysis'), t.slice(0, 900));

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
