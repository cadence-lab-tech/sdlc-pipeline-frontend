import {session, helpers} from './driver.mjs';

const BASE = process.env.SDLC_UI_URL ?? 'http://localhost:5173';
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};

const s = await session(BASE + '/projects');
const run = (body) => s.evaluate(helpers + body);
await new Promise((r) => setTimeout(r, 2000));

console.log('проекты');
let t = await run('return texts();');
check('проект показан', t.includes('SDLC Pipeline'));
check('репозитории проекта показаны', t.includes('sdlc-pipeline-backend'));

console.log('доска');
await s.goto(BASE + '/p/SDLC/board');
await new Promise((r) => setTimeout(r, 2000));
t = await run('return texts();');
check('колонки взяты из цикла проекта', t.includes('Code Review') && t.includes('QA'));
check('исполнитель колонки показан', t.includes('Аналитик'));
check('задачи разложены по статусам', t.includes('SDLC-1'));
check('мультирепозиторная задача помечена', t.includes('мультирепо'), t.slice(0, 600));

console.log('создание задачи');
await run(`
  await clickExact("Новая задача");
  await fill("Название", "Проверка формы свойств");
  await sleep(200);
  // включить системное свойство multi_repo
  const sw = all('input[type=checkbox]').find(c => {
    const lbl = c.getAttribute('id') && document.querySelector('label[for="' + c.id + '"]');
    return lbl && lbl.innerText.includes('Мультирепозиторная');
  });
  if (!sw) throw new Error('свойство multi_repo не найдено');
  sw.click();
  await sleep(300);
  await clickExact("Создать");
  await sleep(2000);
  return true;
`);
t = await run('return texts();');
check('после создания открылась карточка задачи', t.includes('Проверка формы свойств'), t.slice(0, 400));
check('свойство сохранилось', t.includes('Мультирепозиторная'), t.slice(0, 600));

await s.goto(BASE + '/p/SDLC/board');
await new Promise((r) => setTimeout(r, 1800));
t = await run('return texts();');
check('задача появилась на доске', t.includes('Проверка формы свойств'), t.slice(0, 600));

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
