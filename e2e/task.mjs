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
check('неготовый тип гейта объяснён', t.includes('появится в следующей фазе'));

console.log('сдача артефактов');
for (const kind of ['analysis.brief', 'analysis.acceptance_criteria']) {
  await run(`
    await clickExact("Сдать артефакт");
    return true;
  `);
  await run(`
    // выбрать вид артефакта в выпадающем списке
    const sel = all('button, [role=combobox]').find(b => (b.innerText||'').includes('Select') || (b.innerText||'').includes('Вид'));
    (sel || byText('Select')).click();
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
const allowed = t.includes('Перевести');
check('переход разблокирован', allowed, t.slice(0, 600));
if (allowed) {
  await run('await clickIn("Аналитика готова", "Перевести"); return true;');
  await new Promise((r) => setTimeout(r, 2000));
  t = await run('return texts();');
  check('задача перешла на следующий статус', t.includes('Architecture'), t.slice(0, 300));
  check('прошлая попытка осталась в истории', t.includes('analysis'), t.slice(0, 400));
}

console.log('лента событий');
await run('await clickExact("Лента", "button, [role=tab]"); return true;');
await new Promise((r) => setTimeout(r, 800));
t = await run('return texts();');
check('лента показывает события', t.includes('task.') || t.includes('artifact.'), t.slice(0, 400));

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
