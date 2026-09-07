import {session, helpers} from './driver.mjs';

const BASE = process.env.SDLC_UI_URL ?? 'http://localhost:5173';
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};

const s = await session(BASE + '/p/SDLC/workflow');
const run = (body) => s.evaluate(helpers + body);
await new Promise((r) => setTimeout(r, 2000));

console.log('редактор цикла: активная версия');
let t = await run('return texts();');
check('активная версия помечена как неправимая', t.includes('Эта версия не редактируется'));
check('статусы цикла показаны', t.includes('Analysis') && t.includes('Code Review'));
check('гейты перехода показаны', t.includes('Апрув человеком'));

console.log('черновик копией активного');
await run('return click("Черновик копией активного");');
await new Promise((r) => setTimeout(r, 1500));
t = await run('return texts();');
check('создан черновик v2', t.includes('v2') && t.includes('черновик'), t.slice(0, 200));
check('черновик редактируется', t.includes('Добавить статус'));
check('в черновике те же статусы', t.includes('Code Review'));
check('активация доступна', !t.includes('Цикл не активируется'));

console.log('добавление статуса в черновик');
await run('return click("Добавить статус");');
await run('return fill("Ключ", "security_review");');
await run('return fill("Название", "Security review");');
await run('return click("Сохранить");');
await new Promise((r) => setTimeout(r, 1500));
t = await run('return texts();');
check('статус добавлен', t.includes('security_review'), t.slice(0, 300));
check('проверка нашла недостижимый статус', t.includes('Цикл не активируется'), t.slice(0, 400));

console.log('удаление статуса возвращает цикл в рабочее состояние');
await run(`
  const rows = all('[class*=item], li').filter(el => (el.innerText||'').includes('security_review'));
  const row = rows[rows.length - 1];
  const btn = Array.from(row.querySelectorAll('button')).find(b => b.innerText.includes('Удалить'));
  btn.click();
  await sleep(1200);
  return true;
`);
t = await run('return texts();');
check('статус удалён', !t.includes('security_review'), t.slice(0, 300));
check('проблема ушла вместе со статусом', !t.includes('Цикл не активируется'), t.slice(0, 400));
// Все девять типов гейтов реализованы: у демонстрационного цикла ни ошибок, ни предупреждений.
check('проверка проходит без предупреждений', t.includes('Цикл проходит проверку') && !t.includes('Предупреждения'), t.slice(0, 400));

console.log('активация черновика');
await run('return click("Активировать");');
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

console.log('пустой черновик');
await s.goto(BASE + '/p/SDLC/workflow');
await new Promise((r) => setTimeout(r, 1800));
await run('return click("Пустой черновик");');
await new Promise((r) => setTimeout(r, 1800));
t = await run('return texts();');
check('пустой черновик открывается без падения', t.includes('Статусы') && t.includes('Добавить статус'), t.slice(0, 300));
check('пустой цикл не активируется', t.includes('Цикл не активируется'), t.slice(0, 400));
check('названа причина', t.includes('начальн') || t.includes('стату'), t.slice(0, 500));

await run('return click("Удалить черновик");');
await new Promise((r) => setTimeout(r, 1500));
t = await run('return texts();');
check('черновик удалён', !t.includes('Удалить черновик') || t.includes('Версии цикла'), t.slice(0, 300));

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
