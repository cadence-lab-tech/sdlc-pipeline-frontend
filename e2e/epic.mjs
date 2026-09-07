import {session, helpers} from './driver.mjs';

// Оркестрация в интерфейсе: у эпика свой цикл и своя доска, карточка
// показывает нарезку и стоимость, доска задач фильтруется по эпику
// (решения 0024, 0026).
const BASE = process.env.SDLC_UI_URL ?? 'http://localhost:5173';
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};

const s = await session(BASE + '/p/SDLC/board');
const run = (body) => s.evaluate(helpers + body);
await new Promise((r) => setTimeout(r, 2200));

console.log('доска: тип задач переключается');
let t = await run('return texts();');
check('доска показывает задачи, а не эпики', t.includes('SDLC-1') && !t.includes('Скелет системы'), t.slice(0, 400));
check('переключатель типа есть', t.includes('epic'), t.slice(0, 400));

await run('await clickExact("epic", "button, [role=radio], [role=tab]"); await sleep(1500); return true;');
t = await run('return texts();');
check('доска эпиков на своём цикле', t.includes('Decomposition') && t.includes('Planning'), t.slice(0, 400));
check('эпик показан', t.includes('Скелет системы'), t.slice(0, 400));

console.log('карточка эпика');
await s.goto(BASE + '/p/SDLC/tasks/SDLC-4');
await new Promise((r) => setTimeout(r, 2000));
t = await run('return texts();');
check('тип задачи назван', t.includes('epic'), t.slice(0, 300));
check('нарезка видна вкладкой', t.includes('Нарезка'), t.slice(0, 400));
check('стоимость показана', t.includes('Стоимость') && t.includes('Токенов'), t.slice(0, 600));

await run('await clickExact("Нарезка · 3", "button, [role=tab]"); await sleep(1200); return true;');
t = await run('return texts();');
check('дочерние задачи перечислены', t.includes('SDLC-1') && t.includes('SDLC-3'), t.slice(0, 700));
check('видно, сколько закрыто', t.includes('закрыто 0 из 3'), t.slice(0, 700));

console.log('дочерняя задача знает родителя');
await s.goto(BASE + '/p/SDLC/tasks/SDLC-1');
await new Promise((r) => setTimeout(r, 1800));
t = await run('return texts();');
check('ссылка на эпик в карточке', t.includes('SDLC-4'), t.slice(0, 400));

console.log('назначение исполнителя');
t = await run('return texts();');
check('панель исполнителя есть', t.includes('Исполнитель'), t.slice(0, 600));
// Принципал web заводится при первом же запросе интерфейса, назначать можно
// только на существующего.
await run(`
  const input = all('input').find((i) => (i.placeholder || '').includes('agent:developer'));
  if (!input) throw new Error('поля исполнителя нет');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'web');
  input.dispatchEvent(new Event('input', {bubbles: true}));
  await sleep(300);
  await clickExact('Назначить');
  await sleep(1400);
  return true;
`);
t = await run('return texts();');
check('исполнитель назначен', t.includes('заберёт только web'), t.slice(0, 600));

await run('await clickExact("Снять назначение"); await sleep(1400); return true;');
t = await run('return texts();');
check('назначение снимается', t.includes('заберёт любой агент'), t.slice(0, 600));

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
