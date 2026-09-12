import {session, helpers} from './driver.mjs';

const BASE = process.env.SDLC_UI_URL ?? 'http://localhost:5173';
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};

const s = await session(BASE + '/p/SDLC/tasks/SDLC-1');
const run = (body) => s.evaluate(helpers + body);
await new Promise((r) => setTimeout(r, 2500));

console.log('карточка задачи');
let t = await run('return texts();');
check('вердикт гейтов показан', t.includes('не сданы артефакты'), t.slice(0, 300));
check('переход заблокирован', t.includes('Держат гейты'));
check('перепроверка объяснена', t.includes('перепроверка не запускалась'), t.slice(0, 400));

console.log('сдача артефактов');
for (const kind of ['analysis.brief', 'analysis.acceptance_criteria']) {
  await run(`
    await clickExact("Сдать артефакт");
    return true;
  `);
  await run(`
    // выбрать вид артефакта в выпадающем списке: поле ищется по подписи,
    // как и текстовые, — у списка это кнопка, а не input
    const lbl = all('label').find(l => l.innerText.trim().startsWith('Вид'));
    const sel = lbl && document.getElementById(lbl.getAttribute('for'));
    if (!sel) throw new Error('поле «Вид» не найдено');
    sel.click();
    await sleep(400);
    const option = all('[role=option], li, button').find(o => (o.innerText||'').trim() === '${kind}');
    if (!option) throw new Error('нет варианта ${kind}');
    option.click();
    await sleep(300);
    await fill("Содержимое", "# ${kind}\\n\\nтекст артефакта");
    await clickExact("Сдать");
    await sleep(1500);
    return true;
  `);
}
t = await run(`
  const stage = all('div').filter(d => (d.innerText||'').includes('попытк') || (d.innerText||'').includes('analysis'));
  return texts();
`);
check('артефакты появились на этапе', t.includes('analysis.acceptance_criteria submitted') || t.includes('analysis.acceptance_criteria'), t.slice(0, 500));
check('гейт артефактов больше не держит', !t.includes('не сданы артефакты'), t.slice(0, 400));

console.log('апрув человеком');
await run('await clickIn("Апрув человеком", "Апрув"); return true;');
await new Promise((r) => setTimeout(r, 1500));
t = await run('return texts();');
check('апрув учтён', !t.includes('апрувов 0 из 1'), t.slice(0, 600));

console.log('переход');
t = await run('return texts();');
// Артефакты сданы и апрув стоит, но перепроверка ревьюером не запускалась:
// переход «Аналитика готова» остаётся закрытым, а отмена задачи доступна всегда.
// Кликать нельзя — единственная разблокированная кнопка отменит задачу.
check('переход вперёд держит перепроверка', t.includes('Держат гейты') && t.includes('перепроверка не запускалась'), t.slice(0, 600));
check('отмена доступна', t.includes('Перевести') && t.includes('cancelled'), t.slice(0, 600));
check('задача всё ещё в аналитике', t.includes('analysis') && !t.includes('Cancelled'), t.slice(0, 300));

console.log('лента событий');
await run('await press("Лента"); return true;');
await new Promise((r) => setTimeout(r, 800));
t = await run('return texts();');
check('лента показывает события', t.includes('task.') || t.includes('artifact.'), t.slice(0, 400));

console.log('правка постановки');
// Кнопка правки — иконка без текста, её ищут по подписи для программ чтения
// с экрана: та же связка, по которой её найдёт человек с читалкой.
const openEdit = `
  const btn = all('button[aria-label="Править постановку"]')[0];
  if (!btn) throw new Error('кнопки правки нет');
  btn.click();
  await sleep(700);
  return true;
`;
await run(openEdit);
t = await run(`
  const lbl = all('label').find(l => l.innerText.trim().startsWith('Название'));
  const field = lbl && document.getElementById(lbl.getAttribute('for'));
  return field ? field.value : '';
`);
check('форма открылась на текущем заголовке', t.includes('REST API'), t);

// Отмена не меняет ничего: введённое в форме на карточку не попадает.
await run(`
  await fill("Название", "Это сохранять не нужно");
  await clickExact("Отмена");
  return true;
`);
t = await run('return texts();');
check('отмена ничего не изменила', !t.includes('Это сохранять не нужно'), t.slice(0, 300));

// Отказ сервера показывается сообщением, а введённое остаётся в форме.
await run(openEdit);
t = await run(`
  await fill("Название", "я".repeat(81));
  await clickExact("Сохранить");
  await sleep(1200);
  return texts();
`);
check('сервер отбил длинный заголовок', t.includes('заголовок длиннее 80 символов'), t.slice(0, 400));
t = await run(`
  const lbl = all('label').find(l => l.innerText.trim().startsWith('Название'));
  const field = lbl && document.getElementById(lbl.getAttribute('for'));
  return field ? String(field.value.length) : 'нет поля';
`);
check('введённое в форме осталось', t === '81', t);

await run(`
  await fill("Название", "Постановка поправлена из интерфейса");
  await fill("Описание", "Описание, набранное в карточке.");
  await fill("Метки", "ux, phase8");
  await clickExact("Сохранить");
  await sleep(1500);
  return true;
`);
t = await run('return texts();');
check('карточка показывает новый заголовок', t.includes('Постановка поправлена из интерфейса'), t.slice(0, 400));
check('карточка показывает новое описание', t.includes('Описание, набранное в карточке.'), t.slice(0, 400));

await run('await press("Лента"); return true;');
await new Promise((r) => setTimeout(r, 900));
t = await run('return texts();');
check('правка попала в ленту', t.includes('task.updated'), t.slice(0, 400));

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
