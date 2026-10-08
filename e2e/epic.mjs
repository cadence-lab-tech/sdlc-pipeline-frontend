import {session, helpers} from './driver.mjs';

// Оркестрация в интерфейсе: у эпика свой цикл и своя доска, карточка
// показывает нарезку и стоимость, доска задач фильтруется по эпику
// (решения 0024, 0026).
const BASE = process.env.SDLC_UI_URL ?? 'http://localhost:5173';
const API = process.env.SDLC_API_URL ?? 'http://localhost:8088';
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

await run('await press("epic", "[role=radio], [role=tab], button"); await sleep(1500); return true;');
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

await run('await press("Нарезка · 3"); await sleep(1200); return true;');
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
check('исполнитель показан в деталях', t.includes('Детали') && t.includes('Исполнитель'), t.slice(0, 600));
// Форма назначения по умолчанию свёрнута: карточку чаще читают, чем правят.
check('форма назначения свёрнута',
  await run(`return !all('input').some((i) => (i.placeholder || '').includes('agent:developer'));`),
  t.slice(0, 600));
// Принципал web заводится при первом же запросе интерфейса, назначать можно
// только на существующего.
await run(`
  await clickExact('Изменить');
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

await run('await clickExact("Изменить"); await clickExact("Снять назначение"); await sleep(1400); return true;');
t = await run('return texts();');
check('назначение снимается', t.includes('заберёт любой агент'), t.slice(0, 600));

// Эпик открывается той же карточкой, и ссылка на тикет трекера у него та же
// (CLAB-95). Ставится и снимается через API: в интерфейсе её только показывают.
console.log('ссылка эпика на основной трекер');
const patchEpic = (body) => fetch(API + '/v1/tasks/SDLC-4', {
  method: 'PATCH',
  headers: {'Content-Type': 'application/json', 'X-SDLC-Actor': 'e2e'},
  body: JSON.stringify(body),
});
let res = await patchEpic({external_ref: {youtrack: {key: 'EPIC-7', url: 'https://yt.example.com/issue/EPIC-7'}}});
check('ссылка эпика записана', res.ok, String(res.status));
await s.goto(BASE + '/p/SDLC/tasks/SDLC-4');
await new Promise((r) => setTimeout(r, 2000));
const epicRefs = await run(`
  return all('a[data-external-ref]').map((a) => ({
    text: (a.innerText || '').replace(/\\s+/g, ' ').trim(),
    href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel'),
  }));
`);
check('карточка эпика показывает ссылку',
  epicRefs.length === 1 && epicRefs[0].text === 'youtrack EPIC-7' &&
    epicRefs[0].href === 'https://yt.example.com/issue/EPIC-7' &&
    epicRefs[0].target === '_blank' && epicRefs[0].rel === 'noopener noreferrer',
  JSON.stringify(epicRefs));
res = await patchEpic({external_ref: {}});
check('ссылка эпика снята', res.ok, String(res.status));

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
