import {session, helpers} from './driver.mjs';

const BASE = process.env.SDLC_UI_URL ?? 'http://localhost:5173';
const API = process.env.SDLC_API_URL ?? 'http://localhost:8088';
// Часть состояний карточки браузером не сделать: привязку PR кладёт агент, а
// гейт перепроверки снимает решение человека. И то и другое — обычные ручки
// API, и подделывать их в странице нечем.
const apiPost = (path, body, actor = 'e2e') =>
  fetch(API + path, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'X-SDLC-Actor': actor},
    body: JSON.stringify(body),
  });
const apiGet = (path) => fetch(API + path, {headers: {'X-SDLC-Actor': 'e2e'}}).then((r) => r.json());
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};

const s = await session(BASE + '/p/SDLC/tasks/SDLC-1');
const run = (body) => s.evaluate(helpers + body);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(2500);

// В панели список гейтов свёрнут: его раскрывает клик по счётчику «держат N из
// M». Раскрытие идемпотентно — уже раскрытое повторным кликом не закрывается.
const OPEN_GATES = `
  for (const b of all('button[data-slot=collapsible-trigger]')) {
    const label = (b.innerText || '').trim();
    if (!label.startsWith('держат') && !label.startsWith('гейты пройдены')) continue;
    if (b.getAttribute('data-state') !== 'open') { b.click(); await sleep(250); }
  }
  await sleep(400);
`;

// Секция панели сворачивается кликом по своему заголовку.
const toggleSection = (title) => `
  const b = all('button[data-slot=collapsible-trigger]')
    .find((x) => (x.innerText || '').trim().startsWith(${JSON.stringify(title)}));
  if (!b) throw new Error('секции нет: ' + ${JSON.stringify(title)});
  b.click();
  await sleep(600);
  return true;
`;

console.log('карточка задачи: панель действий');
let t = await run('return texts();');
let first = await run(`
  const aside = all('aside')[0];
  const h = aside && aside.querySelector('h2');
  return h ? h.innerText.trim() : 'панели нет';
`);
check('первый блок панели — «Действия»', first === 'Действия', first);
check('счётчик держащих гейтов показан', /держат \d+ из \d+/.test(t), t.slice(0, 400));
check('список гейтов свёрнут', !t.includes('не сданы артефакты'), t.slice(0, 400));
check('переход заблокирован', t.includes('Держат гейты'));

await run(OPEN_GATES + 'return true;');
t = await run('return texts();');
check('вердикт гейтов показан после раскрытия', t.includes('не сданы артефакты'), t.slice(0, 400));
check('перепроверка объяснена', t.includes('перепроверка не запускалась'), t.slice(0, 400));

console.log('шапка и детали');
check('блок «Детали» перечисляет свойства задачи',
  t.includes('Детали') && t.includes('Исполнитель') && t.includes('Область'), t.slice(0, 600));
check('исполнитель в шапке не дублируется',
  (t.match(/Исполнитель/g) || []).length === 1, t.slice(0, 600));
check('приоритет написан по-русски',
  /(срочный|высокий|обычный|низкий)/.test(t) && !/\b(urgent|normal)\b/.test(t), t.slice(0, 400));
await s.grant(['clipboardReadWrite', 'clipboardSanitizedWrite'], BASE);
const copied = await run(`
  const b = all('button[aria-label="Скопировать ключ"]')[0];
  if (!b) return {missing: true};
  b.click();
  await sleep(700);
  return {clip: await navigator.clipboard.readText().catch((e) => 'нет доступа: ' + e.name)};
`);
check('кнопка в шапке копирует ключ задачи', copied.clip === 'SDLC-1', JSON.stringify(copied));

// Список свойств в «Деталях» строится по определениям проекта, а не по
// захардкоженному набору полей: сверяется с тем, что отдаёт API проекта.
const defs = (await apiGet('/v1/projects/SDLC')).task_property_defs
  .filter((d) => d.key !== 'type');
const propertyRows = await run(`
  const dl = all('aside dl')[0];
  return Array.from(dl.querySelectorAll('dt')).map((dt) => dt.innerText.trim());
`);
check('свойства нарисованы по определениям проекта',
  defs.length > 0 && defs.every((d) => propertyRows.includes(d.name)),
  JSON.stringify({defs: defs.map((d) => d.name), rows: propertyRows}));

// Сетевых запросов ради вида не добавилось: в dev-режиме StrictMode шлёт
// каждый запрос дважды, поэтому сравнивается набор адресов, а не их число.
const calls = await run(`
  return [...new Set(performance.getEntriesByType('resource')
    .map((e) => e.name.replace(location.origin, ''))
    .filter((n) => n.startsWith('/v1/')))].sort();
`);
// Сводку проекта спрашивает оболочка, а не карточка (CLAB-79): она одна на
// все страницы проекта и держит отметки в меню. Из набора карточки её запрос
// вычитается и проверяется отдельно.
const SHELL_HEALTH = '/v1/projects/SDLC/health';
// Сведения об инстансе (версия в подвале меню) оболочка спрашивает один раз
// на загрузку страницы (CLAB-89) — это тоже не запрос карточки.
const SHELL_INSTANCE = '/v1/instance';
const own = calls.filter((n) => n !== SHELL_HEALTH && n !== SHELL_INSTANCE);
check('карточка ходит только за своим',
  own.length === 8 && own.includes('/v1/tasks/SDLC-1/repo-refs'), JSON.stringify(calls));
check('сводку проекта на странице карточки спрашивает оболочка', calls.includes(SHELL_HEALTH), JSON.stringify(calls));

console.log('ссылки на PR в области задачи');
check('без привязок ссылок на PR нет и ошибки нет', !t.includes('PR #'), t.slice(0, 600));
await apiPost('/v1/tasks/SDLC-1/repo-refs', {
  repository: 'cadence-lab-tech/sdlc-pipeline-backend',
  ref_type: 'pull_request',
  ref: '42',
  url: 'https://github.com/cadence-lab-tech/sdlc-pipeline-backend/pull/42',
  state: 'open',
});
await s.goto(BASE + '/p/SDLC/tasks/SDLC-1');
await wait(2500);
const pr = await run(`
  const a = all('a').find((x) => (x.innerText || '').includes('PR #42'));
  return a ? a.getAttribute('href') : 'ссылки нет';
`);
check('PR привязан ссылкой рядом с репозиторием',
  pr === 'https://github.com/cadence-lab-tech/sdlc-pipeline-backend/pull/42', pr);

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
await run(OPEN_GATES + 'return true;');
t = await run('return texts();');
check('гейт артефактов больше не держит', !t.includes('не сданы артефакты'), t.slice(0, 400));

console.log('оформление разметки в артефакте');
await run('await clickIn("analysis.brief", "Содержимое"); return true;');
await wait(1200);
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
await wait(900);
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

console.log('ожидание апрува видно без раскрытия');
// Перепроверку снимает решение человека: после этого переход держит только
// апрув — тот случай, ради которого в «Действиях» есть короткий путь.
await apiPost('/v1/tasks/SDLC-1/transitions/analysis_done/gates/peer_review/decision',
  {status: 'waived'});
await s.goto(BASE + '/p/SDLC/tasks/SDLC-1');
await wait(2500);
t = await run('return texts();');
check('держит один гейт из пяти', t.includes('держат 1 из 5'), t.slice(0, 600));
check('апрув предложен без раскрытия списка', t.includes('Апрув человеком') && t.includes('Апрув'), t.slice(0, 600));
check('остальные гейты по-прежнему свёрнуты', !t.includes('снят вручную'), t.slice(0, 600));

console.log('апрув человеком');
await run('await clickIn("Апрув человеком", "Апрув"); return true;');
await wait(1500);
t = await run('return texts();');
check('апрув учтён', !t.includes('апрувов 0 из 1'), t.slice(0, 600));

console.log('переход');
t = await run('return texts();');
// Все гейты пройдены — кнопка перехода открылась. Кликать нельзя: задача
// должна остаться в аналитике, дальше на её прогоне берёт аренду knowledge.mjs.
check('переход открылся, когда гейты пройдены', t.includes('Перевести') && t.includes('гейты пройдены: 5'), t.slice(0, 600));
check('отмена доступна', t.includes('cancelled'), t.slice(0, 600));
// Схема цикла (CLAB-284) называет все статусы версии, в том числе Cancelled:
// «где задача» читается по шапке и панели, без схемы.
const placed = await run(`
  const d = document.querySelector('[data-cycle-diagram]');
  if (d) d.style.display = 'none';
  const text = texts();
  if (d) d.style.display = '';
  return text;
`);
check('задача всё ещё в аналитике', placed.includes('analysis') && !placed.includes('Cancelled'), placed.slice(0, 300));

console.log('лента событий');
await run('await press("Лента"); return true;');
await wait(800);
t = await run('return texts();');
check('типы событий подписаны по-русски',
  t.includes('этап начат') && t.includes('артефакт сдан'), t.slice(0, 500));
check('сырых ключей событий в ленте нет',
  !t.includes('stage.entered') && !t.includes('artifact.submitted'), t.slice(0, 500));
check('события сгруппированы по дням', t.includes('сегодня'), t.slice(0, 500));

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

// Метки читаются с самой карточки, а не из формы: диалог к этому моменту
// закрыт, и всё, что найдено, нарисовано шапкой.
const labelsOnCard = `
  return all('span')
    .filter((el) => el.children.length === 0 && /^#[^\\s#]+$/.test((el.innerText || '').trim()))
    .map((el) => el.innerText.trim());
`;
let labels = await run(labelsOnCard);
check('карточка показывает сохранённые метки', labels.includes('#ux') && labels.includes('#phase8'), JSON.stringify(labels));

// Пустое поле снимает все метки — с карточки они обязаны пропасть там же, без
// перезагрузки страницы.
await run(openEdit);
await run(`
  await fill("Метки", "");
  await clickExact("Сохранить");
  await sleep(1500);
  return true;
`);
labels = await run(labelsOnCard);
check('снятые метки пропали с карточки', !labels.includes('#ux') && !labels.includes('#phase8'), JSON.stringify(labels));
// Пропали метки, а не шапка целиком: ключ и заголовок на месте.
t = await run('return texts();');
check('шапка пережила снятие меток', t.includes('SDLC-1') && t.includes('Постановка поправлена из интерфейса'), t.slice(0, 400));

// Длинная постановка сворачивается. Проверяется правкой в той же карточке:
// мерка высоты обязана пересчитаться на новом тексте, а не остаться от прежнего.
await run(openEdit);
await run(`
  await fill("Описание", Array.from({length: 40}, (_, i) => 'Строка постановки номер ' + (i + 1)).join('\\n\\n'));
  await clickExact("Сохранить");
  await sleep(1500);
  return true;
`);
t = await run('return texts();');
check('длинная постановка сворачивается', t.includes('Показать целиком'), t.slice(0, 400));
const collapsed = await run(`
  const btn = all('button').find((b) => (b.innerText || '').trim() === 'Показать целиком');
  const box = btn && btn.parentElement.querySelector('.prose-sdlc').parentElement;
  const before = box.getBoundingClientRect().height;
  btn.click();
  await sleep(500);
  const after = box.getBoundingClientRect().height;
  return {before, after};
`);
check('свёрнутая постановка ниже раскрытой', collapsed.after > collapsed.before, JSON.stringify(collapsed));

await run('await press("Лента"); return true;');
await wait(900);
t = await run('return texts();');
check('правка попала в ленту', t.includes('постановка поправлена'), t.slice(0, 400));

console.log('этапы: раскрыта последняя попытка');
await run('await press("Этапы и артефакты"); return true;');
await wait(800);
const stages = await run(`
  return all('[data-stage-run]')
    .map((el) => el.getAttribute('data-stage-run') + ':' + el.getAttribute('data-state'))
    .join(' ');
`);
check('раскрыт последний прогон, прежний свёрнут', stages === 'analysis:open new:closed', stages);
await run(`
  const b = all('[data-stage-run="new"] button[data-slot=collapsible-trigger]')[0];
  if (!b) throw new Error('заголовка свёрнутого прогона нет');
  b.click();
  await sleep(500);
  return true;
`);
t = await run('return texts();');
check('свёрнутый прогон раскрывается по клику', t.includes('Артефактов на этой попытке нет'), t.slice(0, 400));

// Дрейфа у задачи нет и базы тоже: пустой секции на экране быть не должно.
// Счётчик открытых сигналов сценарием не проверяется — сигналы кладёт
// детектор по прогону индексации, а демонстрационный репозиторий здесь не
// индексируется; проверено руками, см. test.report.
t = await run(`return all('aside')[0].innerText.replace(/\\s+/g, ' ');`);
check('секции дрейфа без дрейфа нет', !t.includes('Дрейф кодовой базы'), t.slice(0, 300));

console.log('сворачиваемые секции панели');
await run(toggleSection('Стоимость'));
t = await run('return texts();');
check('секция «Стоимость» сворачивается', t.includes('Стоимость') && !t.includes('Токенов'), t.slice(0, 400));
await s.goto(BASE + '/p/SDLC/tasks/SDLC-1');
await wait(2500);
t = await run('return texts();');
check('свёрнутость пережила перезагрузку', t.includes('Стоимость') && !t.includes('Токенов'), t.slice(0, 400));
check('«Действия» раскрыты всегда', t.includes('Держат гейты') || t.includes('Перевести'), t.slice(0, 400));
// Развернуть обратно: свёрнутость лежит в localStorage и осталась бы у
// следующих сценариев, которые про «Стоимость» ничего не знают.
await run(toggleSection('Стоимость'));
t = await run('return texts();');
check('секция разворачивается обратно', t.includes('Токенов'), t.slice(0, 400));

console.log('раскладка панели');
await s.resize(1440, 900);
await wait(600);
const wide = await run(`
  const aside = all('aside')[0];
  const panel = aside && aside.firstElementChild;
  const main = aside && aside.previousElementSibling;
  return {
    position: panel ? getComputedStyle(panel).position : 'нет панели',
    overflow: panel ? getComputedStyle(panel).overflowY : '',
    besideMain: Boolean(main) && main.getBoundingClientRect().right <= aside.getBoundingClientRect().left + 1,
  };
`);
check('на широком экране панель липкая', wide.position === 'sticky', JSON.stringify(wide));
check('панель прокручивается сама', wide.overflow === 'auto', JSON.stringify(wide));
check('панель стоит сбоку от основного столбца', wide.besideMain, JSON.stringify(wide));

await s.resize(390, 780);
await wait(600);
const narrow = await run(`
  const aside = all('aside')[0];
  const main = aside && aside.previousElementSibling;
  const h = aside && aside.querySelector('h2');
  return {
    below: Boolean(main) && aside.getBoundingClientRect().top >= main.getBoundingClientRect().bottom - 1,
    first: h ? h.innerText.trim() : 'панели нет',
    scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
`);
check('на узком экране панель уходит под основной столбец', narrow.below, JSON.stringify(narrow));
check('«Действия» остаются первыми в панели', narrow.first === 'Действия', JSON.stringify(narrow));
check('горизонтальной прокрутки нет', narrow.scroll <= 0, JSON.stringify(narrow));
await s.resize(1280, 900);

// ── отказ движка и повторная попытка ───────────────────────────────────────
//
// Оба состояния ставятся на SDLC-2, чтобы не трогать SDLC-1: на её прогоне
// аналитики берёт аренду knowledge.mjs.
console.log('отказ движка показан в «Действиях»');
await apiPost('/v1/tasks/SDLC-2/transitions/start', {});
const gates = (await apiGet('/v1/tasks/SDLC-2/transitions')).transitions
  .find((x) => x.key === 'analysis_done').gates;
for (const g of gates) {
  await apiPost(`/v1/tasks/SDLC-2/transitions/analysis_done/gates/${g.gate_key}/decision`, {status: 'waived'});
}
await s.goto(BASE + '/p/SDLC/tasks/SDLC-2');
await wait(2500);
t = await run(`
  const b = all('aside button[data-slot=collapsible-trigger]').find((x) => /гейты пройдены/.test(x.innerText || ''));
  if (!b) throw new Error('счётчика гейтов нет');
  b.click(); await sleep(400);
  return b.getAttribute('data-state');
`);
check('список гейтов раскрыт перед отказом', t === 'open', t);

// Задачу уводит другой актор — страница об этом ещё не знает, и кнопка
// уходит в движок на устаревшем состоянии.
await apiPost('/v1/tasks/SDLC-2/transitions/analysis_done', {}, 'someone-else');
const refused = await run(`
  const btn = all('aside button').find((x) => (x.innerText || '').trim() === 'Перевести');
  btn.click();
  await sleep(1600);
  const trigger = all('aside button[data-slot=collapsible-trigger]').find((x) => /держат|гейты пройдены/.test(x.innerText || ''));
  const panel = all('aside')[0].innerText.replace(/\\s+/g, ' ');
  return {
    panel,
    gatesStillOpen: trigger ? trigger.getAttribute('data-state') : 'триггера нет',
  };
`);
check('отказ показан текстом бэкенда',
  refused.panel.includes('Переход не выполнен') && refused.panel.includes('недоступен из статуса'),
  refused.panel.slice(0, 300));
check('раскрытый список гейтов не схлопнулся', refused.gatesStillOpen === 'open', JSON.stringify(refused.gatesStillOpen));
check('карточка осталась в прежнем статусе', refused.panel.includes('Analysis'), refused.panel.slice(0, 300));

// Ссылка на основной трекер (CLAB-95) ставится через API: в интерфейсе её
// только показывают. Проверяется на SDLC-2, чтобы SDLC-1 осталась такой, какой
// её ждут следующие сценарии.
console.log('ссылка на основной трекер');
const apiPatch = (path, body) =>
  fetch(API + path, {
    method: 'PATCH',
    headers: {'Content-Type': 'application/json', 'X-SDLC-Actor': 'e2e'},
    body: JSON.stringify(body),
  });
const externalOnCard = `
  return all('a[data-external-ref]').map((a) => ({
    system: a.getAttribute('data-external-ref'),
    text: (a.innerText || '').replace(/\\s+/g, ' ').trim(),
    href: a.getAttribute('href'),
    target: a.getAttribute('target'),
    rel: a.getAttribute('rel'),
  }));
`;
let res = await apiPatch('/v1/tasks/SDLC-2', {external_ref: {
  jira: {key: 'PROJ-12', url: 'https://jira.example.com/browse/PROJ-12'},
}});
check('ссылка записана через API', res.ok, String(res.status));
await s.goto(BASE + '/p/SDLC/tasks/SDLC-2');
await wait(2500);
let refs = await run(externalOnCard);
check('карточка показывает «jira PROJ-12» ссылкой',
  refs.length === 1 && refs[0].text === 'jira PROJ-12' && refs[0].href === 'https://jira.example.com/browse/PROJ-12',
  JSON.stringify(refs));
check('ссылка открывается в новой вкладке без доступа к opener',
  refs[0]?.target === '_blank' && refs[0]?.rel === 'noopener noreferrer', JSON.stringify(refs));
// Ссылка стоит в шапке рядом с метаданными, а не где-то в ленте.
t = await run(`
  const a = all('a[data-external-ref]')[0];
  return a && a.closest('.border-b') ? a.closest('.border-b').innerText : '';
`);
check('ссылка — в шапке карточки', t.includes('SDLC-2'), t.slice(0, 200));

res = await apiPatch('/v1/tasks/SDLC-2', {external_ref: {}});
check('ссылка снята через API', res.ok, String(res.status));
await s.goto(BASE + '/p/SDLC/tasks/SDLC-2');
await wait(2500);
refs = await run(externalOnCard);
check('без ссылок в шапке их нет', refs.length === 0, JSON.stringify(refs));
t = await run('return texts();');
check('карточка без ссылок цела', t.includes('SDLC-2') && !t.includes('PROJ-12'), t.slice(0, 300));

console.log('повторная попытка этапа');
await apiPost('/v1/tasks/SDLC-2/transitions/reject_to_analysis/gates/problem_report/decision', {status: 'waived'});
await apiPost('/v1/tasks/SDLC-2/transitions/reject_to_analysis', {comment: 'возврат ради второй попытки'});
await s.goto(BASE + '/p/SDLC/tasks/SDLC-2');
await wait(2500);
const attempts = await run(`
  return all('[data-stage-run="analysis"]').map((el) => ({
    state: el.getAttribute('data-state'),
    head: el.querySelector('button').innerText.replace(/\\s+/g, ' ').trim(),
  }));
`);
check('раскрыта последняя попытка, прежняя свёрнута',
  attempts.length === 2 && attempts[0].state === 'open' && attempts[1].state === 'closed',
  JSON.stringify(attempts));
check('у обеих попыток виден номер',
  attempts.every((a) => /попытка \d/.test(a.head)), JSON.stringify(attempts));
check('у свёрнутой попытки видны статус, роль и время',
  /analysis/.test(attempts[1].head) && /analyst/.test(attempts[1].head) && /назад/.test(attempts[1].head),
  JSON.stringify(attempts[1]));
t = await run(`
  const el = all('[data-stage-run="analysis"]')[1];
  el.querySelector('button').click();
  await sleep(500);
  return el.getAttribute('data-state');
`);
check('свёрнутая попытка раскрывается по клику', t === 'open', t);

// ── панель выбранного этапа (CLAB-285) ─────────────────────────────────────
//
// Своя задача, проведённая ручками API: аналитика с отчётом о стоимости,
// перепроверкой и апрувом, архитектура с описанием проблемы и возвратом.
// Демонстрационные задачи остаются нетронутыми. Что показать, панель берёт
// из карточки и ленты стенда — с ними сценарий и сверяет экран.
console.log('панель этапа: данные');
const ag = (role) => `agent:${role}-bot`;
const PANEL_TITLE = 'Панель этапа: задача сценария';
const ptask = await (await apiPost('/v1/projects/SDLC/tasks', {title: PANEL_TITLE, repositories: ['cadence-lab-tech/sdlc-pipeline-frontend']})).json();
const PK = ptask.key;
if (!PK) throw new Error('задача не заведена: ' + JSON.stringify(ptask));
const submit = (role, kind, title, content, format = 'markdown') =>
  apiPost(`/v1/tasks/${PK}/artifacts`, {kind, title, format, content}, ag(role));
const steps = [
  await apiPost(`/v1/tasks/${PK}/transitions/start`, {}),
  await apiPost(`/v1/tasks/${PK}/claim`, {role: 'analyst'}, ag('analyst')),
  await apiPost(`/v1/tasks/${PK}/usage`, {model: 'claude-opus-5-5', input_tokens: 100, output_tokens: 50, cost_usd: 0.4}, ag('analyst')),
  await submit('analyst', 'analysis.brief', 'Разбор', 'Разбор требований.'),
  await submit('analyst', 'analysis.acceptance_criteria', 'Критерии', 'Критерии приёмки.'),
];
// Первый запрос перехода держит перепроверка — он её и запускает (409).
await apiPost(`/v1/tasks/${PK}/transitions/analysis_done`, {summary: 'сдано'}, ag('analyst'));
steps.push(
  await apiPost(`/v1/tasks/${PK}/claim`, {role: 'reviewer'}, ag('reviewer')),
  await submit('reviewer', 'review.verdict', 'Вердикт', '{"verdict":"pass","findings":[]}', 'json'),
  await apiPost(`/v1/tasks/${PK}/transitions/analysis_done/gates/human_approval/decision`, {status: 'passed'}, 'e2e-human'),
  await apiPost(`/v1/tasks/${PK}/transitions/analysis_done`, {summary: 'дальше'}, ag('analyst')),
  await apiPost(`/v1/tasks/${PK}/claim`, {role: 'architect'}, ag('arch')),
  await submit('arch', 'problem.report', 'Описание проблемы', 'Нет схемы данных.'),
  await apiPost(`/v1/tasks/${PK}/transitions/reject_to_analysis`, {comment: 'нет схемы данных'}, ag('arch')),
);
check('задача проведена: аналитика, перепроверка, архитектура, возврат', steps.every((r) => r.ok), steps.map((r) => r.status).join(','));
const pdetail = await apiGet(`/v1/tasks/${PK}`);
const pversion = await apiGet(`/v1/workflows/${pdetail.task.workflow_id}`);
const statusOf = (key) => pversion.statuses.find((x) => x.key === key);
const ANALYSIS = pdetail.stage_runs.find((r) => r.kind === 'review').status_key;
const RETURNED = pdetail.stage_runs.find((r) => r.exit?.kind === 'rejected');
const ARCH = RETURNED.status_key;
const topOf = (key) => pdetail.stage_runs.filter((r) => r.status_key === key && !r.parent_run_id)
  .sort((a, b) => b.entered_at.localeCompare(a.entered_at));
const [a2, a1] = topOf(ANALYSIS);
const review = pdetail.stage_runs.find((r) => r.parent_run_id === a1.id);
const problem = pdetail.artifacts.find((a) => a.stage_run_id === RETURNED.id && a.kind === 'problem.report');
// Будущий статус: ни одного прогона, у статуса есть роль.
const FUTURE = [...pversion.statuses].sort((a, b) => a.position - b.position)
  .find((x) => (x.roles ?? []).length && !pdetail.stage_runs.some((r) => r.status_key === x.key));

const openPanel = async (key) => {
  await s.goto(BASE + `/p/SDLC/tasks/${PK}${key ? `?stage=${encodeURIComponent(key)}` : ''}`);
  await wait(2200);
  for (let i = 0; i < 20 && key; i++) {
    if (await run(`return Boolean(document.querySelector('[data-stage-panel] [data-stage-events] h3'));`)) break;
    await wait(500);
  }
};
const PANEL = `
  const panel = document.querySelector('[data-stage-panel]');
  const attempts = () => all('[data-stage-panel] [data-stage-run]');
  const attempt = (id) => document.querySelector('[data-stage-panel] [data-run-id="' + id + '"]');
  const text = (el) => el ? el.innerText.replace(/\\s+/g, ' ').trim() : '';
`;

console.log('панель этапа: попытки статуса');
await openPanel(ANALYSIS);
let p = await run(PANEL + `return {
  panel: panel && panel.getAttribute('data-stage-panel'),
  ids: attempts().map((el) => el.getAttribute('data-run-id')),
  states: attempts().map((el) => el.getAttribute('data-state')),
  keys: attempts().map((el) => el.getAttribute('data-stage-run')),
  heads: attempts().map((el) => text(el.querySelector('button'))),
  outside: all('[data-stage-run]').filter((el) => !el.closest('[data-stage-panel]')).length,
  count: text(document.querySelector('[data-stage-attempts]')),
};`);
check('панель выбранного статуса вместо списка', p.panel === ANALYSIS && p.outside === 0, JSON.stringify(p));
check('попытки верхнего уровня, новые сверху', p.ids.join() === [a2.id, a1.id].join(), JSON.stringify(p.ids));
check('последняя раскрыта, прежняя свёрнута', p.states.join() === 'open,closed', JSON.stringify(p.states));
check('перепроверка — не отдельная попытка', !p.ids.includes(review.id) && p.count === 'попыток: 2', JSON.stringify(p));
check('роль с версией из карточки',
  p.heads.every((h, i) => h.includes(`${[a2, a1][i].role_key} v${[a2, a1][i].role_version}`)), JSON.stringify(p.heads));
p = await run(PANEL + `const el = attempt(${JSON.stringify(a2.id)}); return {
  meta: text(el.querySelector('[data-attempt-meta]')),
  from: text(el.querySelector('[data-return="from"]')),
  comment: text(el.querySelector('[data-return="from"] [data-return-comment]')),
  stageLink: el.querySelector('[data-return="from"] [data-return-stage]')?.getAttribute('data-return-stage'),
  gates: text(el.querySelector('[data-gate-results]')),
  cost: el.querySelector('[data-run-cost]')?.getAttribute('data-run-cost'),
  costText: text(el.querySelector('[data-run-cost]')),
};`);
check('у попытки исполнитель, роль, вход, захват, завершение',
  ['Исполнитель', 'Роль', 'Вход', 'Захват', 'Завершение'].every((x) => p.meta.includes(x)), p.meta);
check('«вернулась с» имя статуса из версии', p.from.startsWith(`вернулась с «${statusOf(ARCH).name}»`), p.from);
check('тот же комментарий возврата', p.comment === 'нет схемы данных', p.comment);
check('ссылка на этап, который вернул', p.stageLink === ARCH, String(p.stageLink));
check('без записей — «гейты не проверялись»', p.gates.includes('гейты не проверялись'), p.gates);
check('прогон без отчёта — «нет данных», не ноль', p.cost === 'silent' && p.costText.includes('нет данных') && !/0[.,]00/.test(p.costText), p.costText);

console.log('панель этапа: прежняя попытка, гейты и перепроверка');
p = await run(PANEL + `const el = attempt(${JSON.stringify(a1.id)});
  el.querySelector('button').click(); await sleep(600);
  return {
    state: el.getAttribute('data-state'),
    verdicts: all('[data-gate-verdict]').filter((v) => el.contains(v) && !v.closest('[data-review-run]')).map((v) => ({
      key: v.getAttribute('data-gate-verdict'), status: v.getAttribute('data-gate-status'), text: text(v)})),
    reviews: all('[data-review-run]').filter((r) => el.contains(r)).map((r) => ({id: r.getAttribute('data-review-run'), text: text(r), cost: r.querySelector('[data-run-cost]')?.getAttribute('data-run-cost')})),
    cost: text(el.querySelector('[data-run-cost]')),
    exit: el.querySelector('[data-attempt-exit]')?.getAttribute('data-attempt-exit'),
    model: text(el.querySelector('[data-run-model]')),
  };`);
check('прежняя попытка раскрывается', p.state === 'open', p.state);
check('вердикты гейтов — все записи gate_results',
  p.verdicts.map((v) => v.key).sort().join() === a1.gate_results.map((g) => g.gate_key).sort().join(), JSON.stringify(p.verdicts.map((v) => v.key)));
const approval = a1.gate_results.find((g) => g.gate_type === 'human_approval');
const shownApproval = p.verdicts.find((v) => v.key === approval.gate_key);
check('апрув: статус как записан и кто решил',
  shownApproval?.status === approval.status && shownApproval.text.includes(approval.decided_by_handle) && shownApproval.text.includes(approval.transition_key),
  JSON.stringify(shownApproval));
check('выход попытки — переход вперёд', p.exit === 'advanced', String(p.exit));
check('перепроверка внутри своей попытки', p.reviews.length === 1 && p.reviews[0].id === review.id, JSON.stringify(p.reviews));
check('у перепроверки роль с версией, исход и свой артефакт',
  p.reviews[0]?.text.includes(`${review.role_key} v${review.role_version}`) && p.reviews[0].text.includes('review.verdict'), p.reviews[0]?.text);
check('у перепроверки без отчёта — «нет данных»', p.reviews[0]?.cost === 'silent', JSON.stringify(p.reviews[0]));
check('стоимость прогона с отчётом — деньги и токены', p.cost.includes('0.40 $') && p.cost.includes('150'), p.cost);
check('строка модели прогона', p.model.includes('claude-opus-5-5'), p.model);

console.log('панель этапа: итог по этапу');
const runsOfStage = pdetail.stage_runs.filter((r) => r.status_key === ANALYSIS);
const reported = runsOfStage.filter((r) => r.usage?.reported);
const sum = reported.reduce((acc, r) => acc + (r.usage.cost_usd ?? 0), 0);
p = await run(PANEL + `const el = document.querySelector('[data-stage-total]'); return {
  reported: el?.getAttribute('data-stage-total'), silent: el?.getAttribute('data-stage-silent'), text: text(el)};`);
check('итог — сумма отчитавшихся прогонов карточки', p.reported === String(reported.length) && p.text.includes(`${sum.toFixed(2)} $`), JSON.stringify(p));
check('прогоны без отчёта — отдельным числом', p.silent === String(runsOfStage.length - reported.length) && p.text.includes(`без отчёта: ${runsOfStage.length - reported.length}`), JSON.stringify(p));

console.log('панель этапа: события статуса');
let stageTimeline = (await apiGet(`/v1/tasks/${PK}/timeline?status=${encodeURIComponent(ANALYSIS)}`)).events;
p = await run(PANEL + `return all('[data-stage-events] [data-event]').map((e) => e.getAttribute('data-event'));`);
check('события — те же, что timeline?status=', p.join() === stageTimeline.map((e) => e.type).join(), JSON.stringify({ui: p, api: stageTimeline.map((e) => e.type)}));
check('в событиях этапа — и перепроверка', p.includes('review.completed'), JSON.stringify(p));
check('чужих событий нет', !p.includes('task.rejected'), JSON.stringify(p));

console.log('панель этапа: возврат со стороны вернувшего');
await openPanel(ARCH);
p = await run(PANEL + `const el = attempt(${JSON.stringify(RETURNED.id)}); return {
  to: text(el.querySelector('[data-return="to"]')),
  comment: text(el.querySelector('[data-return="to"] [data-return-comment]')),
  href: el.querySelector('[data-return="to"] [data-return-problem]')?.getAttribute('href'),
  target: Boolean(document.querySelector('#artifact-${problem.id}')),
  gates: all('[data-gate-verdict]').filter((v) => el.contains(v)).map((v) => v.getAttribute('data-gate-verdict') + ':' + v.getAttribute('data-gate-status')),
};`);
check('«вернула в» имя статуса из версии', p.to.startsWith(`вернула в «${statusOf(ANALYSIS).name}»`), p.to);
check('комментарий перехода', p.comment === 'нет схемы данных', p.comment);
check('ссылка на problem.report этой попытки', p.href === `#artifact-${problem.id}` && p.target, JSON.stringify(p));
check('гейты возврата — как записаны', p.gates.join() === RETURNED.gate_results.map((g) => `${g.gate_key}:${g.status}`).join(), JSON.stringify(p.gates));
await run(PANEL + `attempt(${JSON.stringify(RETURNED.id)}).querySelector('[data-return-stage]').click(); await sleep(1500); return true;`);
check('ссылка возврата открывает этап, куда вернули', (await run('return location.search;')) === `?stage=${encodeURIComponent(ANALYSIS)}`, await run('return location.search;'));

console.log('панель этапа: этап ещё не начинался');
await openPanel(FUTURE.key);
const futureExits = pversion.transitions.filter((x) => x.from_status_id === FUTURE.id);
p = await run(PANEL + `const el = document.querySelector('[data-stage-unstarted]'); return {
  shown: Boolean(el), text: text(el), roles: text(document.querySelector('[data-stage-roles]')),
  exits: all('[data-stage-exit]').map((e) => e.getAttribute('data-stage-exit')).sort(),
  gates: all('[data-stage-exit-gate]').length,
  slider: Boolean(document.querySelector('[data-stage-model-level]')),
  events: text(document.querySelector('[data-stage-events]')),
};`);
check('«этап ещё не начинался»', p.shown && p.text.includes('Этап ещё не начинался'), p.text);
check('роль статуса из версии', FUTURE.roles.every((r) => p.roles.includes(r.role_name)), p.roles);
check('выходы — переходы версии из статуса', p.exits.join() === futureExits.map((x) => x.key).sort().join(), JSON.stringify(p.exits));
check('гейты выхода — из версии', p.gates === futureExits.reduce((n, x) => n + (x.gates ?? []).length, 0), String(p.gates));
check('ползунок уровня у статуса с ролью', p.slider);
check('событий нет — без ошибки', p.events.includes('Событий нет'), p.events);

console.log('панель этапа: снять выбор');
await run(`await clickExact("Показать все этапы"); await sleep(900); return true;`);
p = await run(`return {search: location.search, panel: Boolean(document.querySelector('[data-stage-panel]')), runs: all('[data-stage-run]').length};`);
check('«Показать все этапы» — снова список без панели',
  p.search === '' && !p.panel && p.runs === pdetail.stage_runs.filter((r) => !r.parent_run_id).length, JSON.stringify(p));

console.log('панель этапа: живой этап');
await apiPost(`/v1/tasks/${PK}/claim`, {role: a2.role_key}, ag('analyst'));
await openPanel(ANALYSIS);
await run(`window.__marker = 'та же страница'; return true;`);
const eventsBefore = await run(`return all('[data-stage-events] [data-event]').length;`);
await submit('analyst', 'analysis.brief', 'Разбор второй попытки', 'Схема данных добавлена.');
await wait(12000);
p = await run(PANEL + `const el = attempt(${JSON.stringify(a2.id)}); return {
  marker: window.__marker, text: text(el), events: all('[data-stage-events] [data-event]').length,
};`);
check('новый артефакт виден без перезагрузки', p.marker === 'та же страница' && p.text.includes('Разбор второй попытки'), p.text.slice(0, 300));
stageTimeline = (await apiGet(`/v1/tasks/${PK}/timeline?status=${encodeURIComponent(ANALYSIS)}`)).events;
check('лента этапа перезапрошена опросом', p.events > eventsBefore && p.events === stageTimeline.length, JSON.stringify({before: eventsBefore, now: p.events, api: stageTimeline.length}));
await apiPost(`/v1/tasks/${PK}/release`, {note: 'сценарий панели этапа'}, ag('analyst'));

console.log('панель этапа: тема');
const SHOTS = process.env.SDLC_E2E_SHOTS;
const paint = `
  const card = document.querySelector('[data-stage-panel] [data-slot=card]');
  const ret = document.querySelector('[data-return]');
  return {dark: document.documentElement.classList.contains('dark'), bg: getComputedStyle(card).backgroundColor,
    text: getComputedStyle(card).color, border: ret ? getComputedStyle(ret).borderLeftColor : ''};
`;
const themes = {};
for (const theme of ['light', 'dark']) {
  await run(`localStorage.setItem('sdlc.theme', '${theme}'); return true;`);
  await openPanel(ANALYSIS);
  themes[theme] = await run(paint);
  if (SHOTS) {
    const {writeFileSync} = await import('node:fs');
    for (const key of [ANALYSIS, ARCH, FUTURE.key]) {
      await openPanel(key);
      writeFileSync(`${SHOTS}/stage-panel-${key}-${theme}.png`, Buffer.from(await s.screenshot(), 'base64'));
    }
  }
}
await run(`localStorage.removeItem('sdlc.theme'); return true;`);
check('тёмная тема включается', themes.dark.dark && !themes.light.dark, JSON.stringify(themes));
check('фон и текст панели меняются с темой',
  themes.light.bg !== themes.dark.bg && themes.light.text !== themes.dark.text, JSON.stringify(themes));
check('строка возврата видна в обеих темах', Boolean(themes.light.border && themes.dark.border), JSON.stringify(themes));

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
