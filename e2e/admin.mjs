import {session, helpers} from './driver.mjs';

// Команды, принципалы и настройки доступа проекта (решения 0027 и 0028).
// Бэкенд поднят в режиме header: права не проверяются, поэтому проверяется
// проводка — команда заводится, получает участника и уровень в проекте, а
// настройки GitHub сохраняются и проверяются по кнопке.
const BASE = process.env.SDLC_UI_URL ?? 'http://localhost:5173';
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};

// Диалог рисуется в портале в конце документа, а подписи его полей есть и на
// странице: поле ищется внутри диалога, строки приглашений — в своём разделе.
const dialogHelpers = `
  const dialog = () => document.querySelector('[role=dialog]');
  const dialogText = () => ((dialog() || {}).innerText || '').replace(/\\s+/g, ' ');
  const fillIn = async (label, value) => {
    const root = dialog();
    const lbl = root && Array.from(root.querySelectorAll('label')).find((l) => l.innerText.trim().startsWith(label));
    const field = lbl && document.getElementById(lbl.getAttribute('for'));
    if (!field) throw new Error('поле в диалоге не найдено: ' + label);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, value);
    field.dispatchEvent(new Event('input', {bubbles: true}));
    await sleep(250);
    return true;
  };
  const inviteRows = () => {
    const sec = document.querySelector('section[aria-label="Приглашения"]');
    return sec ? Array.from(sec.querySelectorAll('tbody tr')).map((tr) => tr.innerText.replace(/\\s+/g, ' ').trim()) : [];
  };
`;

const s = await session(BASE + '/teams');
const run = (body) => s.evaluate(helpers + dialogHelpers + body);
// Значение поля ввода в innerText не попадает: сохранённое читается из самого
// input, а не из текста страницы.
const valueOf = (label) => run(`
  const lbl = all('label').find((l) => l.innerText.trim().startsWith(${JSON.stringify(label)}));
  const field = lbl && document.getElementById(lbl.getAttribute('for'));
  return field ? field.value : '';
`);
await new Promise((r) => setTimeout(r, 2500));

console.log('команды');
let t = await run('return texts();');
check('раздел открылся', t.includes('Команды'), t.slice(0, 300));

console.log('приглашения: личный аккаунт');
// По умолчанию открыт личный аккаунт. Кнопка приглашения у него не прячется:
// отказ приходит от бэкенда, и его текст объясняет, что делать.
await run(`
  await clickExact("Пригласить");
  await sleep(500);
  await clickExact("Выдать ссылку");
  await sleep(1500);
`);
let d = await run('return dialogText();');
check('личный аккаунт: отказ бэкенда в диалоге, ссылки нет',
  d.includes('личный аккаунт — один человек') && !d.includes('clab_inv_'), d);
await run('await clickExact("Отмена"); await sleep(500);');
t = await run('return texts();');
check('у личного аккаунта список приглашений пуст', t.includes('Приглашений нет'), t.slice(0, 1500));

await run(`
  await clickExact("Завести организацию");
  await sleep(400);
  await fill("Ключ", "e2e-team");
  await fill("Название", "Команда e2e");
  await sleep(200);
  await clickExact("Завести");
  await sleep(1500);
`);
t = await run('return texts();');
check('организация заведена', t.includes('Команда e2e') && t.includes('организация'), t.slice(0, 600));
check('создатель стал лидом', t.includes('лид'), t.slice(0, 900));
check('разделы команды на месте',
  t.includes('Тариф') && t.includes('Состав') && t.includes('Доступ в проекты') && t.includes('GitHub') && t.includes('Группы провайдера') && t.includes('Бюджет'),
  t.slice(0, 900));
// Установки GitHub App живут на команде (решение 0034): у новой их нет, а
// кнопка подключения зависит от слага приложения в настройках инстанса.
check('установок у новой команды нет', t.includes('Установок нет') && t.includes('Подключить GitHub'), t.slice(0, 1200));

console.log('состав');
// Человек по хэндлу не заводится (решение 0033): e2e-lead появляется как
// актор заголовка до того, как его добавляют в состав — run.sh делает это
// запросом к API.
await run(`
  await fill("Принципал", "user:e2e-lead");
  await sleep(200);
  await clickIn("Добавить или изменить роль", "Сохранить");
  await sleep(1500);
`);
t = await run('return texts();');
check('участник добавлен', t.includes('user:e2e-lead'), t.slice(0, 900));

console.log('приглашения: организация');
await run(`
  await clickExact("Пригласить");
  await sleep(500);
  await fillIn("Срок в днях", "3");
  await clickExact("Выдать ссылку");
  await sleep(1500);
`);
d = await run('return dialogText();');
check('организация: ссылка выдана один раз и с предупреждением',
  d.includes(BASE + '/invite/clab_inv_') && d.includes('показывается один раз'), d);
const teamInvite = await run(`
  const r = await fetch('/v1/teams/e2e-team/invites', {headers: {'X-SDLC-Actor': 'web'}});
  return (await r.json()).invites[0];
`);
const teamDays = (Date.parse(teamInvite.expires_at) - Date.parse(teamInvite.created_at)) / 86400000;
check('роль по умолчанию — участник, срок из поля',
  teamInvite.team_role === 'member' && Math.abs(teamDays - 3) < 0.01, JSON.stringify(teamInvite));
await run('await clickExact("Готово"); await sleep(1000);');
const teamRows = await run('return inviteRows();');
check('в списке команды — «выдан» с ролью', (teamRows[0] ?? '').includes('выдан') && teamRows[0].includes('участник'),
  teamRows.join(' | '));

console.log('группы провайдера и бюджет');
await run(`
  await fill("Группы", "sdlc-платформа, sdlc-все");
  await sleep(200);
  await clickIn("Группы провайдера", "Сохранить");
  await sleep(1500);
`);
// Страница перечитывается целиком: так проверяется, что группы легли в базу,
// а не остались в поле ввода.
await s.goto(BASE + '/teams');
await new Promise((r) => setTimeout(r, 2500));
// По умолчанию открыт личный аккаунт: организацию надо выбрать заново.
await run('await clickExact("Команда e2e", "p"); await sleep(800);');
// Порядок задаёт база (ORDER BY idp_group), а не поле ввода, поэтому
// сравнивается набор.
const savedGroups = (await valueOf('Группы')).split(',').map((g) => g.trim()).sort();
check('группы сохранены', savedGroups.join('|') === 'sdlc-все|sdlc-платформа', savedGroups.join('|'));

await run(`
  await fill("Предел, $", "25");
  await sleep(200);
  await clickIn("Поставить предел", "Сохранить");
  await sleep(1500);
`);
t = await run('return texts();');
check('предел показан вместе с расходом', t.includes('$25.00') && t.includes('Потрачено'), t.slice(0, 1200));
check('состояние бюджета названо', t.includes('в пределах') || t.includes('исчерпан'), t.slice(0, 1200));

console.log('принципалы');
await s.goto(BASE + '/principals');
await new Promise((r) => setTimeout(r, 2000));
t = await run('return texts();');
check('список принципалов открылся', t.includes('Принципалы') && t.includes('user:e2e-lead'), t.slice(0, 600));
await run('await fill("Поиск", "e2e-lead"); await sleep(200); await clickExact("Найти"); await sleep(1200);');
t = await run('return texts();');
check('поиск сузил список', t.includes('e2e-lead') && !t.includes('system:'), t.slice(0, 600));

console.log('команда в проекте');
await s.goto(BASE + '/p/SDLC/settings');
await new Promise((r) => setTimeout(r, 2500));
await run(`
  await fill("Ключ команды", "e2e-team");
  await sleep(200);
  await clickIn("Пустить команду или изменить уровень", "Сохранить");
  await sleep(1500);
`);
t = await run('return texts();');
check('команда пущена в проект', t.includes('Команда e2e') && t.includes('viewer'), t.slice(0, 1500));

console.log('доступ к GitHub');
// Установка больше не вписывается руками: настройки показывают установки
// команды-владельца и кнопки подключения и выбора (решение 0034). Запасной
// путь — именованный секрет — остался и сохраняется.
t = await run('return texts();');
check('секция GitHub показывает установки владельца',
  t.includes('Установки команды') && t.includes('Подключить GitHub') && t.includes('Выбрать репозитории'),
  t.slice(0, 1500));
await run(`
  await fill("Секрет доступа", "E2E_TOKEN");
  await sleep(200);
  await clickExact("Сохранить секрет");
  await sleep(1500);
  await clickExact("Проверить доступ");
  await sleep(2500);
`);
t = await run('return texts();');
check('секрет сохранён', (await valueOf('Секрет доступа')) === 'E2E_TOKEN', await valueOf('Секрет доступа'));
// Приложения у dev-инстанса нет, и проверка обязана сказать это прямо, а не
// молча показать зелёные галочки.
check('проверка отчиталась по репозиториям',
  t.includes('Приложение у инстанса не настроено') || t.includes('Репозиторий'),
  t.slice(0, 1500));
// У репозиториев демонстрационного проекта своих учётных данных нет, у
// проекта только что сохранён секрет — им и проверяли (решение 0034).
check('проверка показывает, чем проверяли',
  t.includes('Чем проверяли') && t.includes('секрет проекта E2E_TOKEN'),
  t.slice(0, 1500));

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
