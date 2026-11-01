// Роли на странице «Пайплайн» (CLAB-346): панель роли вместо прежней страницы
// ролей. Старый адрес /roles?role=X ведёт на /pipeline?role=X.
import {session, helpers} from './driver.mjs';

const BASE = process.env.SDLC_UI_URL ?? 'http://localhost:5173';
const API = process.env.SDLC_API_URL ?? 'http://localhost:8088';
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};
const call = (method, path, body, actor = 'e2e') =>
  fetch(API + '/v1' + path, {
    method,
    headers: {'X-SDLC-Actor': actor, 'Content-Type': 'application/json'},
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null)}));

const s = await session(BASE + '/p/SDLC/roles?role=analyst');
const run = (body) => s.evaluate(helpers + body);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
await pause(2500);

console.log('старый адрес ролей ведёт на «Пайплайн» с выбором');
const where = await run('return location.pathname + location.search;');
check('/roles?role=analyst → /pipeline?role=analyst', where === '/p/SDLC/pipeline?role=analyst', where);

console.log('панель роли');
const api = (await call('GET', '/projects/SDLC/roles/analyst')).body;
let t = await run('return texts();');
const panel = await run(`
  const p = document.querySelector('[data-role-panel="analyst"]');
  return p ? p.innerText.replace(/\\s+/g, ' ') : '';
`);
check('панель роли открыта', panel.includes('Аналитик') && panel.includes('analyst'), panel.slice(0, 200));
check('инструкция версии показана', panel.includes('Ты аналитик'));
// Инструкцию пишут разметкой: на экране она должна быть отрисованной, а не
// абзацем сырого текста.
const instruction = await run(`
  return Boolean(all('[data-role-panel] .prose-sdlc').find((el) => (el.innerText || '').includes('Ты аналитик')));
`);
check('инструкция показана разметкой', instruction === true);
check('контракт вывода показан', panel.includes('analysis.acceptance_criteria'));
const usage = await run(`return all('[data-role-usage-status]').map((el) => el.getAttribute('data-role-usage-status') + ':' + el.getAttribute('data-role-usage-state'));`);
const wantUsage = (api.used_on ?? []).map((u) => `${u.status_key}:${u.workflow_state}`);
check('«Стоит на статусах» совпадает с used_on', usage.length > 0 && usage.join() === wantUsage.join(), `${usage.join()} / ${wantUsage.join()}`);

console.log('правка инструкции — новая версия');
await run('await clickExact("Новая версия"); return true;');
const wide = await run(`return document.querySelector('[data-pipeline-inspector]').getBoundingClientRect().width;`);
check('форма новой версии шире панели', wide > 600, String(wide));
await run(`
  await fill("Что изменилось", "уточнили формулировку требований");
  const ta = document.querySelector('[data-new-version] textarea');
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, 'Ты аналитик. Уточнённая инструкция.');
  ta.dispatchEvent(new Event('input', {bubbles: true}));
  await sleep(300);
  await clickExact("Сохранить версию");
  await sleep(1500);
  return true;
`);
t = await run('return texts();');
const card = await run(`
  const c = document.querySelector('[data-role-version]');
  return c ? {v: c.getAttribute('data-role-version'), text: c.innerText.replace(/\\s+/g, ' ')} : null;
`);
check('создана версия 2, раскрыта она', card?.v === '2' && card.text.includes('Уточнённая инструкция'), JSON.stringify(card));
check('версия 2 помечена актуальной', /Версия 2 актуальная/.test(card?.text ?? ''), card?.text);
const rows = await run(`return all('[data-role-version-row]').map((el) => el.getAttribute('data-role-version-row'));`);
check('прежняя версия — строкой, без текста', rows.join() === '1' && !t.includes('Разбери задачу до уровня'), rows.join());
await run(`document.querySelector('[data-role-version-row="1"]').click(); await sleep(700); return true;`);
const v1 = await run(`
  const c = document.querySelector('[data-role-version]');
  return {v: c?.getAttribute('data-role-version'), text: (c?.innerText || '').replace(/\\s+/g, ' '), url: location.search};
`);
check('клик раскрывает версию 1 нетронутой', v1.v === '1' && v1.text.includes('Разбери задачу до уровня'), JSON.stringify(v1).slice(0, 300));
check('раскрытая версия — в адресе', v1.url.includes('v=1'), v1.url);
const created = (await call('GET', '/projects/SDLC/roles/analyst/versions/2')).body;
check('версия 2 есть в API', created?.version === 2 && created.instructions.includes('Уточнённая'), JSON.stringify(created).slice(0, 200));

console.log('версия на узле обновилась');
await s.goto(BASE + '/p/SDLC/pipeline?type=task');
await pause(2000);
const node = await run(`
  const b = document.querySelector('[data-pipeline-role="analyst"]');
  return b ? b.getAttribute('data-pipeline-role-version') : null;
`);
check('узел показывает v2', node === '2', String(node));

console.log('архивирование роли, которая стоит на активном цикле');
await run(`document.querySelector('[data-pipeline-role="analyst"]').click(); await sleep(1500); return true;`);
await run('await clickExact("В архив"); return true;');
// Архив необратим для выбора ролей у статусов: сначала подтверждение с именем
// роли, запрос уходит после него.
const dialog = await run(`
  const d = document.querySelector('[role=alertdialog]');
  return d ? d.innerText.replace(/\\s+/g, ' ') : '';
`);
check('архив просит подтверждения с именем роли',
  dialog.includes('Отправить роль в архив?') && dialog.includes('Аналитик') && dialog.includes('(analyst)'), dialog);
t = await run('return texts();');
check('до подтверждения отказа нет', !t.includes('Роль не заархивирована'), t.slice(0, 400));
await run('return confirm("В архив");');
await pause(800);
t = await run('return texts();');
check('архивирование отклонено', t.includes('Роль не заархивирована'), t.slice(0, 400));
check('показано, где роль занята', t.includes('analysis'), t.slice(0, 500));
// Отказ бэкенда остаётся в Failure рядом с формой; тоста об успехе нет.
const toastsAfterRefusal = await run('return toasts();');
check('тоста при отказе нет', toastsAfterRefusal.length === 0, toastsAfterRefusal.join(' | '));
// Место отказа на этом цикле — кнопка: выбирает статус.
const picked = await run(`
  const b = all('[data-role-panel] button').find((x) => (x.innerText || '').trim().startsWith('analysis ('));
  if (!b) return 'нет кнопки';
  b.click();
  await sleep(900);
  return new URLSearchParams(location.search).get('status');
`);
check('место отказа выбирает статус', picked === 'analysis', String(picked));

console.log('обзор: роли на цикле, остальные, архивные');
await s.goto(BASE + '/p/SDLC/pipeline?type=task');
await pause(2000);
t = await run(`return document.querySelector('[data-pipeline-overview]').innerText.replace(/\\s+/g, ' ');`);
check('роли перечислены', t.includes('Роли на этом цикле') && t.includes('Аналитик') && t.includes('Ревьюер'), t.slice(0, 300));
check('остальные роли — своим разделом', t.includes('Остальные роли проекта') && t.includes('Не стоят ни на одном статусе этого цикла'), t.slice(0, 500));
const stamp = Date.now().toString(36);
const LONELY = `e2e-lonely-${stamp}`;
const ARCH = `e2e-arch-${stamp}`;
await call('POST', '/projects/SDLC/roles', {key: LONELY, name: `Одинокая ${stamp}`, version: {instructions: 'Роль без статуса.'}});
await call('POST', '/projects/SDLC/roles', {key: ARCH, name: `Архивная ${stamp}`, version: {instructions: 'Роль в архиве.'}});
await call('DELETE', `/projects/SDLC/roles/${ARCH}`);
await s.goto(BASE + '/p/SDLC/pipeline?type=task');
await pause(2000);
const lonely = await run(`return (document.querySelector('[data-pipeline-role-row="${LONELY}"]')?.innerText || '').replace(/\\s+/g, ' ');`);
check('роль без статуса — «ни на одном статусе»', lonely.includes('ни на одном статусе'), lonely);
const archHidden = await run(`return Boolean(document.querySelector('[data-pipeline-role-row="${ARCH}"]'));`);
check('архивная скрыта, пока переключатель выключен', archHidden === false);
await run(`
  const l = all('label').find((x) => x.innerText.trim().startsWith('Показать архивные'));
  document.getElementById(l.getAttribute('for')).click();
  await sleep(500);
  return true;
`);
const arch = await run(`return (document.querySelector('[data-pipeline-role-row="${ARCH}"]')?.innerText || '').replace(/\\s+/g, ' ');`);
check('«Показать архивные» добавляет архивную с пометкой', arch.includes('в архиве'), arch);

console.log('пустой проект: «Завести роль»');
const KEY = 'ROLESE2E';
await call('DELETE', `/projects/${KEY}`, undefined, 'web');
const project = await call('POST', '/projects', {key: KEY, name: 'Роли: пустой проект'}, 'web');
if (project.status !== 201 && project.status !== 200) {
  check('пустой проект заведён', false, JSON.stringify(project).slice(0, 300));
} else {
  await s.goto(`${BASE}/p/${KEY}/pipeline`);
  await pause(2000);
  t = await run('return texts();');
  check('у проекта без цикла — «Цикла для типа … нет» с двумя путями', t.includes('Цикла для типа task нет') && t.includes('Пустой черновик'), t.slice(0, 400));
  check('в пустом проекте — «Заведите роль»', t.includes('Заведите роль'), t.slice(0, 400));
  await run(`
    window.__roleBodies = [];
    const orig = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if ((init?.method || '').toUpperCase() === 'POST' && /\\/roles$/.test(url)) window.__roleBodies.push(JSON.parse(init.body));
      return orig(input, init);
    };
    await clickExact("Завести роль");
    await fill("Ключ", "scout");
    await fill("Название", "Разведчик");
    await fill("Описание", "Смотрит, что есть");
    const ta = all('textarea')[0];
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, 'Ты разведчик.');
    ta.dispatchEvent(new Event('input', {bubbles: true}));
    await sleep(300);
    return true;
  `);
  // Отказ сервера — у формы, введённое не теряется.
  const refused = await run(`
    const orig = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if ((init?.method || '').toUpperCase() === 'POST' && /\\/roles$/.test(url)) {
        return new Response(JSON.stringify({error: {code: 'conflict', message: 'роль с таким ключом уже есть'}}), {status: 409, headers: {'Content-Type': 'application/json'}});
      }
      return orig(input, init);
    };
    all('button').filter((b) => (b.innerText || '').trim() === 'Завести роль').pop().click();
    await sleep(900);
    window.fetch = orig;
    const key = all('label').find((x) => x.innerText.trim().startsWith('Ключ'));
    return {text: texts(), key: document.getElementById(key.getAttribute('for')).value};
  `);
  check('отказ виден у формы, введённое осталось',
    refused.text.includes('Роль не заведена') && refused.text.includes('роль с таким ключом уже есть') && refused.key === 'scout', refused.text.slice(0, 300));
  const done = await run(`
    all('button').filter((b) => (b.innerText || '').trim() === 'Завести роль').pop().click();
    await sleep(1500);
    return {bodies: window.__roleBodies, url: location.search, panel: Boolean(document.querySelector('[data-role-panel="scout"]')), toasts: toasts()};
  `);
  const body = done.bodies[done.bodies.length - 1] ?? {};
  check('POST …/roles несёт ключ, название, описание и первую версию',
    body.key === 'scout' && body.name === 'Разведчик' && body.summary === 'Смотрит, что есть' && body.version?.instructions === 'Ты разведчик.',
    JSON.stringify(done.bodies));
  check('роль заведена и открыта её панель', done.panel && done.url.includes('role=scout'), JSON.stringify(done));
  check('тост называет роль', done.toasts.some((x) => x.includes('scout') && x.includes('создана')), done.toasts.join(' | '));
  const v1api = (await call('GET', `/projects/${KEY}/roles/scout/versions/1`, undefined, 'web')).body;
  check('первая версия создана', v1api?.instructions === 'Ты разведчик.', JSON.stringify(v1api).slice(0, 200));
  await call('DELETE', `/projects/${KEY}`, undefined, 'web');
}

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
