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

const s = await session(BASE + '/p/SDLC/settings');
const run = (body) => s.evaluate(helpers + body);
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
