// Аренда прогона, поиск по знанию проекта и состояние индекса. Аренду берёт
// настоящий агент через API перед сценарием (см. run.sh): показать «в работе
// у кого-то» можно только когда кто-то и правда работает.
import {session, helpers} from './driver.mjs';

const BASE = process.env.SDLC_UI_URL ?? 'http://localhost:5173';
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};

const s = await session(BASE + '/p/SDLC/board');
const run = (body) => s.evaluate(helpers + body);
await new Promise((r) => setTimeout(r, 2500));

console.log('аренда на доске');
let t = await run('return texts();');
check('видно, кто держит задачу', t.includes('в работе у analyst-bot'), t.slice(0, 600));

console.log('аренда в карточке задачи');
await s.goto(BASE + '/p/SDLC/tasks/SDLC-1');
await new Promise((r) => setTimeout(r, 2000));
t = await run('return texts();');
check('прогон забран', t.includes('claimed'), t.slice(0, 400));
check('исполнитель прогона назван', t.includes('в работе у analyst-bot'), t.slice(0, 600));
check('срок аренды показан', t.includes('аренда истекает'), t.slice(0, 600));
check('роль прогона показана', t.includes('analyst'), t.slice(0, 400));

console.log('поиск по знанию проекта');
await s.goto(BASE + '/p/SDLC/search');
await new Promise((r) => setTimeout(r, 2000));
t = await run('return texts();');
check('состояние индекса показано', t.includes('Состояние индекса') && t.includes('sdlc-pipeline-backend'), t.slice(0, 600));
// Индексация в dev-окружении не запускалась ни по одному репозиторию, кроме
// сидового: экран обязан говорить это прямо, а не показывать пустоту.
check('репозиторий без прогона назван', t.includes('не запускалась'), t.slice(0, 600));

await run(`
  await fill("Что ищем", "движок переходов");
  await clickExact("Найти");
  await sleep(1500);
  return true;
`);
t = await run('return texts();');
check('режим поиска назван', t.includes('полнотекстом') || t.includes('Ничего не нашлось'), t.slice(0, 700));
check('выдача отрисована', t.includes('Ничего не нашлось') || t.includes('артефакт') || t.includes('код'), t.slice(0, 700));

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
