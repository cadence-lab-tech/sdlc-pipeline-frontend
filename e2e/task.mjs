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

// Артефакт с настоящей разметкой: заголовок, список, таблица GFM, чекбоксы,
// цитата, инлайн-код, блок кода, внешняя ссылка и сырой HTML. По нему
// проверяется, что оформление применилось, а HTML остался текстом.
const MARKDOWN = [
  '# Разметка артефакта',
  '',
  'Абзац с `инлайн-кодом` и [ссылкой](https://example.com/docs).',
  '',
  '- первый пункт',
  '- второй пункт',
  '',
  '| Колонка | Значение |',
  '| --- | --- |',
  '| строка | 42 |',
  '',
  '- [x] сделано',
  '- [ ] не сделано',
  '',
  '> цитата',
  '',
  '    блок кода',
  '',
  '<b>не жирный</b>',
].join('\n');

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
    await fill("Содержимое", ${JSON.stringify(MARKDOWN)});
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

console.log('оформление разметки в артефакте');
await run('await clickIn("analysis.brief", "Содержимое"); return true;');
await new Promise((r) => setTimeout(r, 1200));
const md = await run(`
  // Разметкой на карточке выводится и постановка задачи: нужен именно блок
  // раскрытого артефакта.
  const root = all('.prose-sdlc').find((el) => (el.innerText || '').includes('Разметка артефакта'));
  if (!root) return {missing: true};
  const size = (el) => (el ? parseFloat(getComputedStyle(el).fontSize) : 0);
  const h1 = root.querySelector('h1');
  const th = root.querySelector('th');
  const code = root.querySelector('p code');
  const link = root.querySelector('a');
  return {
    heading: size(h1),
    text: size(root.querySelector('p')),
    weight: h1 ? getComputedStyle(h1).fontWeight : '',
    marker: (() => { const ul = root.querySelector('ul'); return ul ? getComputedStyle(ul).listStyleType : ''; })(),
    cellBorder: th ? parseFloat(getComputedStyle(th).borderBottomWidth) : 0,
    codeBackground: code ? getComputedStyle(code).backgroundColor : '',
    quote: (() => { const q = root.querySelector('blockquote'); return q ? parseFloat(getComputedStyle(q).borderLeftWidth) : 0; })(),
    checkbox: Boolean(root.querySelector('input[type=checkbox]')),
    codeBlock: Boolean(root.querySelector('pre')),
    linkTarget: link ? link.target : '',
    linkRel: link ? link.rel : '',
    rawHtmlRendered: Boolean(root.querySelector('b')),
  };
`);
check('разметка отрисована', !md.missing, JSON.stringify(md));
check('заголовок крупнее текста', md.heading > md.text && Number(md.weight) >= 600, JSON.stringify(md));
check('у списка есть маркеры', md.marker === 'disc', md.marker);
check('у таблицы GFM есть границы', md.cellBorder > 0, String(md.cellBorder));
check('инлайн-код выделен фоном', Boolean(md.codeBackground) && md.codeBackground !== 'rgba(0, 0, 0, 0)', md.codeBackground);
check('цитата с боковой линией', md.quote > 0, String(md.quote));
check('чекбоксы GFM отрисованы чекбоксами', md.checkbox);
check('блок кода отрисован', md.codeBlock);
check('внешняя ссылка открывается в новой вкладке', md.linkTarget === '_blank' && md.linkRel.includes('noopener'), md.linkTarget + ' ' + md.linkRel);
check('сырой HTML не исполнен', !md.rawHtmlRendered);

console.log('копирование и чтение целиком');
let t2 = await run('return texts();');
check('кнопка копирования есть', t2.includes('Копировать'), t2.slice(0, 300));
check('кнопка «Открыть целиком» есть', t2.includes('Открыть целиком'), t2.slice(0, 300));
await run('await clickExact("Открыть целиком"); return true;');
await new Promise((r) => setTimeout(r, 900));
t2 = await run(`
  const dialog = all('[role=dialog]')[0];
  return dialog ? dialog.innerText.replace(/\\s+/g, ' ') : '';
`);
check('артефакт открылся во весь экран', t2.includes('Разметка артефакта'), t2.slice(0, 300));
await run(`
  document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
  await sleep(600);
  return true;
`);
t2 = await run("return String(all('[role=dialog]').length);");
check('диалог закрывается по Esc', t2 === '0', t2);
await run('await clickIn("analysis.brief", "Содержимое"); return true;');

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
  await fill("Описание", "## Что нужно\\n\\n- первый пункт\\n- второй пункт\\n\\nОписание, набранное в карточке.");
  await fill("Метки", "ux, phase8");
  await clickExact("Сохранить");
  await sleep(1500);
  return true;
`);
t = await run('return texts();');
check('карточка показывает новый заголовок', t.includes('Постановка поправлена из интерфейса'), t.slice(0, 400));
check('карточка показывает новое описание', t.includes('Описание, набранное в карточке.'), t.slice(0, 400));
// Постановка выводится разметкой, а не абзацем сырого текста: подзаголовок и
// список должны стать элементами, а не остаться строками с решётками.
const desc = await run(`
  const blocks = all('.prose-sdlc').filter((el) => (el.innerText || '').includes('Описание, набранное в карточке.'));
  const root = blocks[0];
  if (!root) return {missing: true};
  return {
    heading: Boolean(root.querySelector('h2')),
    items: root.querySelectorAll('li').length,
    raw: (root.innerText || '').includes('## Что нужно'),
  };
`);
check('описание отрисовано разметкой', !desc.missing && desc.heading && desc.items === 2, JSON.stringify(desc));
check('решётки заголовка не показаны текстом', !desc.raw, JSON.stringify(desc));
// Постановка короткая — сворачивать нечего, кнопки быть не должно.
t = await run('return texts();');
check('у короткой постановки нет кнопки «Показать целиком»', !t.includes('Показать целиком'), t.slice(0, 400));

await run('await press("Лента"); return true;');
await new Promise((r) => setTimeout(r, 900));
t = await run('return texts();');
check('правка попала в ленту', t.includes('task.updated'), t.slice(0, 400));

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
