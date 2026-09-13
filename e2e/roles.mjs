import {session, helpers} from './driver.mjs';

const BASE = process.env.SDLC_UI_URL ?? 'http://localhost:5173';
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};

const s = await session(BASE + '/p/SDLC/roles');
const run = (body) => s.evaluate(helpers + body);
await new Promise((r) => setTimeout(r, 2500));

console.log('роли проекта');
let t = await run('return texts();');
check('роли перечислены', t.includes('Аналитик') && t.includes('Ревьюер'));
check('видно, где роль стоит', t.includes('Стоит на статусах') && t.includes('analysis'));
check('инструкция версии показана', t.includes('Ты аналитик'));
// Инструкцию пишут разметкой: на экране она должна быть отрисованной, а не
// абзацем сырого текста.
const instruction = await run(`
  const root = all('.prose-sdlc').find((el) => (el.innerText || '').includes('Ты аналитик'));
  return Boolean(root);
`);
check('инструкция показана разметкой', instruction === true);
check('контракт вывода показан', t.includes('analysis.acceptance_criteria'));

console.log('правка инструкции — новая версия');
await run('await clickExact("Новая версия"); return true;');
await run(`
  await fill("Что изменилось", "уточнили формулировку требований");
  const ta = all('textarea')[0];
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, 'Ты аналитик. Уточнённая инструкция.');
  ta.dispatchEvent(new Event('input', {bubbles: true}));
  await sleep(300);
  await clickExact("Сохранить версию");
  await sleep(1500);
  return true;
`);
t = await run('return texts();');
check('создана версия 2', t.includes('Версия 2'), t.slice(0, 400));
check('версия 2 помечена актуальной', /Версия 2 актуальная/.test(t), t.slice(0, 400));
check('версия 1 осталась нетронутой', t.includes('Версия 1') && t.includes('Разбери задачу до уровня'), t.slice(0, 600));

console.log('архивирование роли, которая стоит на активном цикле');
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
await new Promise((r) => setTimeout(r, 800));
t = await run('return texts();');
check('архивирование отклонено', t.includes('Роль не заархивирована'), t.slice(0, 400));
check('показано, где роль занята', t.includes('analysis'), t.slice(0, 500));
// Отказ бэкенда остаётся в Failure рядом с формой; тоста об успехе нет.
const toastsAfterRefusal = await run('return toasts();');
check('тоста при отказе нет', toastsAfterRefusal.length === 0, toastsAfterRefusal.join(' | '));

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
