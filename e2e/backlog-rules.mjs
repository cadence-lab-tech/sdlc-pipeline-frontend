// Правила страницы «Бэклог» (CLAB-402, эпик CLAB-368) — без браузера:
// запросы верхнего уровня и детей эпика, края меню порядка и тела запросов,
// дочитывание соседа для «Ниже», оптимистичный перенос, тексты тостов и
// объявлений, подсказка права уровня agent, ключ раскрытия эпика, отложенное
// перечитывание, сервер без порядка бэклога, подпись task.ranked в ленте,
// пометка «в работе» строки и поиск ключей статусов, ролей и типов в коде
// страницы. Модули — чистые функции, проверяются прямо в исходниках.
//
// Ключи статусов, ролей и типов в данных нарочно не похожи на ключи наших
// циклов: правила о них не знают.
import {readFileSync, readdirSync} from 'node:fs';
import {registerHooks} from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(specifier + '.ts', context);
      throw err;
    }
  },
});

const B = await import('../src/components/backlog/rules.ts');
const E = await import('../src/components/task/events.ts');
const M = await import('../src/components/taskrow/rules.ts');
const N = await import('../src/api/taskRow.ts');

let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const err = (httpStatus, message = 'отказ') => Object.assign(new Error(message), {httpStatus});

// ── К-3: запросы страницы ────────────────────────────────────────────────────
console.log('запросы');
check('К-3: верхний уровень — backlog, top_level, order=backlog, limit 50, offset 0',
  eq(B.topQuery(0), {backlog: true, top_level: true, order: 'backlog', limit: 50, offset: 0}), JSON.stringify(B.topQuery(0)));
check('К-3: дети эпика — parent, backlog, order=backlog, без top_level',
  eq(B.childrenQuery('ZZ-85', 0), {parent: 'ZZ-85', backlog: true, order: 'backlog', limit: 50, offset: 0}));
check('«Ещё 50» — следующая порция с offset', eq(B.topQuery(50), {backlog: true, top_level: true, order: 'backlog', limit: 50, offset: 50}));
check('сосед ниже — limit=1 и offset=загружено', B.topQuery(50, 1).limit === 1 && B.topQuery(50, 1).offset === 50);
check('перечитывание — сколько показано, не меньше 50', B.reloadLimit(0) === 50 && B.reloadLimit(12) === 50 && B.reloadLimit(100) === 100);
check('«Ещё 50 · показано 50 из 76»: остаток меньше порции — «Ещё 26»',
  B.moreLabel(50, 184) === 'Ещё 50 · показано 50 из 184' && B.moreLabel(50, 76) === 'Ещё 26 · показано 50 из 76');
check('всё показано — кнопки нет', B.moreLabel(76, 76) === null && B.moreLabel(0, 0) === null);
check('сводка без склонения', B.summaryText(76) === '76 на верхнем уровне · задачи эпика — внутри эпика');

// ── К-12: сервер без порядка бэклога ─────────────────────────────────────────
console.log('сервер без порядка бэклога');
check('400 по backlog — сервер не знает', B.isBacklogRejected(err(400, 'backlog: неизвестный параметр')));
check('400 по order — сервер не знает', B.isBacklogRejected(err(400, 'order: неизвестный порядок "backlog"')));
check('400 по другому параметру — не то', !B.isBacklogRejected(err(400, 'limit: не число')));
check('5xx и 403 — не то', !B.isBacklogRejected(err(500, 'backlog')) && !B.isBacklogRejected(err(403, 'backlog')));
check('строки без rank — сервер параметр пропустил', B.lacksRank({tasks: [{key: 'A-1'}, {key: 'A-2'}]}));
check('строки с rank и пустая страница — всё в порядке', !B.lacksRank({tasks: [{key: 'A-1', rank: 'V'}]}) && !B.lacksRank({tasks: []}));

// ── К-5: края меню и тела запросов ───────────────────────────────────────────
console.log('меню порядка');
const keys = ['A-1', 'A-2', 'A-3'];
check('К-5: первая строка — нет «Выше» и «В начало»', eq(B.moveEdges(0, 3, 3), {up: false, top: false, down: true, bottom: true}));
check('К-5: последняя (total = загружено) — нет «Ниже» и «В конец»', eq(B.moveEdges(2, 3, 3), {up: true, top: true, down: false, bottom: false}));
check('К-5: единственная — выключены все четыре', eq(B.moveEdges(0, 1, 1), {up: false, top: false, down: false, bottom: false}));
check('К-5: середина — всё доступно', eq(B.moveEdges(1, 3, 3), {up: true, top: true, down: true, bottom: true}));
check('К-5: последняя загруженная при неполной загрузке — «Ниже» и «В конец» есть', eq(B.moveEdges(49, 50, 76), {up: true, top: true, down: true, bottom: true}));
check('К-5: «Выше» — before строки сразу выше', eq(B.rankBody('up', keys, 1), {before: 'A-1'}));
check('К-5: «Ниже» — after строки сразу ниже', eq(B.rankBody('down', keys, 1), {after: 'A-3'}));
check('К-5: «В начало» — position top', eq(B.rankBody('top', keys, 2), {position: 'top'}));
check('К-5: «В конец» — position bottom', eq(B.rankBody('bottom', keys, 0), {position: 'bottom'}));
check('край — тела нет', B.rankBody('up', keys, 0) === null && B.rankBody('down', keys, 2) === null);
check('К-5: «Ниже» у последней загруженной — сосед дочитывается', B.needsNextNeighbor('down', 49, 50, 76) && !B.needsNextNeighbor('down', 48, 50, 76) &&
  !B.needsNextNeighbor('down', 49, 50, 50) && !B.needsNextNeighbor('up', 49, 50, 76));
check('К-5: «Ниже» с дочитанным соседом — after его ключа', eq(B.rankBody('down', keys, 2, 'A-4'), {after: 'A-4'}));
check('группа меню названа', B.groupTitle(null) === 'Порядок в бэклоге' && B.groupTitle('ZZ-85') === 'Порядок в эпике ZZ-85');
check('подписи пунктов', eq(Object.values(B.MOVE_LABELS), ['Выше', 'Ниже', 'В начало', 'В конец']));

// ── К-6: оптимистичный перенос ───────────────────────────────────────────────
console.log('перенос');
const rows = keys.map((key) => ({key}));
const order = (r) => r.map((x) => x.key).join();
check('«Выше» — строка над соседом', order(B.moveRows(rows, 2, 'up', 3)) === 'A-1,A-3,A-2');
check('«Ниже» — строка под соседом', order(B.moveRows(rows, 0, 'down', 3)) === 'A-2,A-1,A-3');
check('«В начало» и «В конец»', order(B.moveRows(rows, 2, 'top', 3)) === 'A-3,A-1,A-2' && order(B.moveRows(rows, 0, 'bottom', 3)) === 'A-2,A-3,A-1');
check('«Ниже» с дочитанным соседом — сосед встаёт выше и загружен', order(B.moveRows(rows, 2, 'down', 9, {key: 'A-4'})) === 'A-1,A-2,A-4,A-3');
check('«В конец» при неполной загрузке — строка уходит со страницы', order(B.moveRows(rows, 0, 'bottom', 9)) === 'A-2,A-3');
check('край — без изменений, исходный массив не трогается', B.moveRows(rows, 0, 'up', 3) === rows && order(rows) === 'A-1,A-2,A-3');
check('клиент не сортирует: порядок задаёт только перенос', !/\.sort\(/.test(readFileSync(new URL('../src/components/backlog/rules.ts', import.meta.url), 'utf8')));

// ── К-8: тексты ошибок ───────────────────────────────────────────────────────
console.log('ошибки');
check('К-8: 409', B.MOVE_ERRORS[B.moveFailure(err(409))] === 'Порядок не изменился: задача или соседняя уже закрыта. Список обновлён — переставьте ещё раз.');
check('К-8: 400 и 404 по соседу', B.moveFailure(err(400)) === 'neighbor' && B.moveFailure(err(404)) === 'neighbor' &&
  B.MOVE_ERRORS.neighbor === 'Порядок не изменился: соседняя задача ушла из списка. Список обновлён — переставьте ещё раз.');
check('К-8: 403', B.MOVE_ERRORS[B.moveFailure(err(403))] === 'Порядок не изменился: двигать бэклог могут участники уровня agent и выше.');
check('К-8: сеть и 5xx', B.moveFailure(err(undefined)) === 'offline' && B.moveFailure(err(502)) === 'offline' &&
  B.MOVE_ERRORS.offline === 'Порядок не изменился: нет связи с сервером. Попробуйте ещё раз.');
check('К-8: перечитывать при всех, кроме сети и 5xx', B.reloadAfterFailure('conflict') && B.reloadAfterFailure('neighbor') &&
  B.reloadAfterFailure('forbidden') && !B.reloadAfterFailure('offline'));
check('К-8: приоритет — сообщение сервера', B.priorityError('ZZ-12', err(400, 'неизвестный приоритет.')) === 'Приоритет ZZ-12 не изменился: неизвестный приоритет.',
  B.priorityError('ZZ-12', err(400, 'неизвестный приоритет.')));
check('К-8: приоритет при 403 — про уровень', B.priorityError('ZZ-12', err(403, 'нет права')) ===
  'Приоритет ZZ-12 не изменился: менять приоритет могут участники уровня agent и выше.');
check('приоритет без связи — не сырое «сервис недоступен: TypeError»', B.priorityError('ZZ-12', err(undefined, 'сервис недоступен: TypeError')) ===
  'Приоритет ZZ-12 не изменился: нет связи с сервером.');

// ── К-15: объявления ─────────────────────────────────────────────────────────
console.log('объявления');
const done = {changed: true, parent: null};
check('К-15: над соседом', B.movedAnnouncement('ZZ-12', {before: 'ZZ-15'}, done) === 'ZZ-12 поставлена над ZZ-15.');
check('под соседом', B.movedAnnouncement('ZZ-12', {after: 'ZZ-15'}, done) === 'ZZ-12 поставлена под ZZ-15.');
check('К-15: в начале эпика', B.movedAnnouncement('ZZ-12', {position: 'top'}, {changed: true, parent: 'ZZ-85'}) === 'ZZ-12 — в начале эпика ZZ-85.');
check('в конце бэклога', B.movedAnnouncement('ZZ-12', {position: 'bottom'}, done) === 'ZZ-12 — в конце бэклога.');
check('то же место', B.movedAnnouncement('ZZ-12', {position: 'top'}, {changed: false, parent: null}) === 'ZZ-12 уже на этом месте.');
check('подписи кнопок', B.menuLabel('ZZ-12') === 'Действия с ZZ-12' && B.expandLabel('ZZ-85', false) === 'Показать задачи эпика ZZ-85' &&
  B.expandLabel('ZZ-85', true) === 'Скрыть задачи эпика ZZ-85' && B.priorityLabelFor('ZZ-12', 'высокий') === 'Приоритет ZZ-12: высокий. Изменить');

// ── К-9: право ───────────────────────────────────────────────────────────────
console.log('право');
const me = (over = {}) => ({mode: 'token', principal: {is_admin: false}, memberships: [], teams: [], ...over});
const can = (m, teams, owner) => B.canEditBacklog({me: m, projectKey: 'ZZ', ownerTeamKey: owner, projectTeams: teams});
check('К-9: кто я не загрузился — можно', can(undefined, undefined));
check('К-9: режим header — можно', can(me({mode: 'header'}), []));
check('К-9: администратор системы — можно', can(me({principal: {is_admin: true}}), []));
for (const level of ['agent', 'maintainer', 'admin']) {
  check(`К-9: уровень ${level} поимённо — можно`, can(me({memberships: [{project_key: 'ZZ', role: level}]}), []));
  check(`К-9: уровень ${level} через команду — можно`, can(me({teams: [{team_key: 't1', role: 'member'}]}), [{team_key: 't1', level}]));
}
check('К-9: viewer поимённо и без команд — нельзя', !can(me({memberships: [{project_key: 'ZZ', role: 'viewer'}]}), []));
check('К-9: viewer через команду — нельзя', !can(me({teams: [{team_key: 't1', role: 'member'}]}), [{team_key: 't1', level: 'viewer'}]));
check('К-9: agent в другом проекте — нельзя', !can(me({memberships: [{project_key: 'YY', role: 'agent'}]}), []));
check('К-9: лид команды-владельца — можно', can(me({teams: [{team_key: 'own', role: 'lead'}]}), [], 'own'));
check('К-9: команды проекта не загрузились — можно', can(me({memberships: [{project_key: 'ZZ', role: 'viewer'}]}), undefined));
check('состав команд нужен только без прямого права', B.needsTeams(me({memberships: [{project_key: 'ZZ', role: 'viewer'}]}), 'ZZ') &&
  !B.needsTeams(me({memberships: [{project_key: 'ZZ', role: 'agent'}]}), 'ZZ') && !B.needsTeams(me({mode: 'header'}), 'ZZ') && !B.needsTeams(undefined, 'ZZ'));
check('плашка прав дословно', B.VIEWER_NOTE === 'Порядок и приоритет меняют участники уровня agent и выше. У вас — просмотр.');

// ── К-11, К-4: раскрытие и шеврон ────────────────────────────────────────────
console.log('раскрытие эпика');
check('К-11: ключ backlog.<проект>.<эпик>', B.expandedKey('ZZ', 'ZZ-85') === 'backlog.ZZ.ZZ-85');
check('К-4: шеврон по данным — есть дети в любой категории', B.hasChildren({done: 2}) && B.hasChildren({backlog: 1}) &&
  !B.hasChildren({}) && !B.hasChildren(undefined) && !B.hasChildren({backlog: 0}));

// ── К-10: отложенное перечитывание ───────────────────────────────────────────
console.log('отложенное перечитывание');
let runs = 0;
const gate = B.createReloadGate(() => runs++);
gate.wake();
check('без удержаний — сразу', runs === 1);
const r1 = gate.hold();
const r2 = gate.hold();
gate.wake(); gate.wake();
check('К-10: меню открыто — ждёт', runs === 1 && gate.held());
r1(); r1();
check('одно отпущено (дважды) — ещё ждёт', runs === 1 && gate.held());
r2();
check('К-10: всё отпущено — одно перечитывание сразу', runs === 2 && !gate.held());
const r3 = gate.hold(); r3();
check('удержание без событий — перечитывания нет', runs === 2);

// ── К-14: лента ──────────────────────────────────────────────────────────────
console.log('лента: task.ranked');
const ranked = (p) => E.eventDetails('task.ranked', p).summary;
check('К-14: подпись типа', E.eventLabel('task.ranked') === 'место в бэклоге изменено');
check('К-14: оба соседа — «над below · под above»', ranked({parent: null, above: 'ZZ-14', below: 'ZZ-15'}) === 'над ZZ-15 · под ZZ-14', ranked({parent: null, above: 'ZZ-14', below: 'ZZ-15'}));
check('оба соседа в эпике — с хвостом', ranked({parent: 'ZZ-85', above: 'ZZ-14', below: 'ZZ-15'}) === 'над ZZ-15 · под ZZ-14 · в эпике ZZ-85');
check('К-14: нет соседа выше — в начало бэклога', ranked({parent: null, above: null, below: 'ZZ-15'}) === 'в начало бэклога');
check('К-14: в начало эпика', ranked({parent: 'ZZ-85', above: null, below: 'ZZ-15'}) === 'в начало эпика ZZ-85');
check('К-14: нет соседа ниже — в конец', ranked({parent: null, above: 'ZZ-14', below: null}) === 'в конец бэклога' &&
  ranked({parent: 'ZZ-85', above: 'ZZ-14', below: null}) === 'в конец эпика ZZ-85');
check('единственная в группе — в начало', ranked({parent: null, above: null, below: null}) === 'в начало бэклога');
check('К-14: пустая и незнакомая нагрузка — без строки', ranked({}) === '' && ranked(null) === '' && ranked('x') === '' &&
  ranked({before: 'ZZ-1', after: 'ZZ-2'}) === '' && ranked({above: 5, below: 'ZZ-1'}) === '' && ranked({above: {}, below: null}) === '');
check('сырая нагрузка раскрывается', E.hasPayload({parent: null, above: 'ZZ-1', below: null}));

// ── К-4: пометка «в работе» ──────────────────────────────────────────────────
console.log('пометка «в работе»');
const row = (over = {}) => ({
  id: 't1', key: 'ZZ-85', title: 'Эпик', priority: 'normal', status_key: 'doing', status_name: 'Doing', workflow_id: 'wf',
  properties: {type: 'bug'}, labels: [], repositories: [], ...N.normalizeRowFields({}), ...over,
});
const NOW = Date.parse('2026-11-04T12:00:00Z');
check('in_work из ответа — только true', N.normalizeRowFields({in_work: true}).in_work === true && N.normalizeRowFields({in_work: 'yes'}).in_work === false &&
  N.normalizeRowFields({}).in_work === false);
const m = M.buildRowModel(row({in_work: true}), {zone: 'backlog', now: NOW, showInWork: true});
check('К-4: строка в работе на странице — «в работе» с подсказкой', m.inWork?.text === 'в работе' &&
  m.inWork?.title === 'Эпик в работе: на странице, пока у него есть неначатые задачи');
check('К-16: без пропа (Обзор) пометки нет', M.buildRowModel(row({in_work: true}), {zone: 'backlog', now: NOW}).inWork === null);
check('не в работе — пометки нет', M.buildRowModel(row(), {zone: 'backlog', now: NOW, showInWork: true}).inWork === null);
check('имя статуса из данных', m.stage.text === 'Doing');

// ── К-4, К-17: ключи проекта и сырые цвета в коде страницы ────────────────────
console.log('код страницы');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').split('\n')
  .filter((l) => !l.trim().startsWith('//')).join('\n').replace(/\/\/.*$/gm, '');
const dir = new URL('../src/components/backlog/', import.meta.url);
const sources = [
  ...readdirSync(dir).filter((n) => /\.tsx?$/.test(n)).map((n) => [n, code(readFileSync(new URL(n, dir), 'utf8'))]),
  ['Backlog.tsx', code(readFileSync(new URL('../src/pages/Backlog.tsx', import.meta.url), 'utf8'))],
  ['useBacklogEditable.ts', code(readFileSync(new URL('../src/hooks/useBacklogEditable.ts', import.meta.url), 'utf8'))],
];
const KEYWORDS = /['"`](analysis|development|testing|merge|release|design|epic|planning|in_progress|cancelled|task|bug|developer|analytics|integrator|test|new|done)['"`]/;
const hits = sources.filter(([, s]) => KEYWORDS.test(s)).map(([n]) => n);
check('К-4: ключей статусов, ролей и типов проекта нет', hits.length === 0, hits.join());
check('нет сравнений со status_key/role_key/type', !sources.some(([, s]) => /(status_key|role_key|\.type)\s*[!=]==\s*['"`]/.test(s)));
const raw = sources.filter(([, s]) => /\b(bg|text|border)-(blue|red|amber|emerald|green)-\d00(?!\/)/.test(s.replace(/text-(blue|red|amber)-700 dark:text-\1-300/g, ''))).map(([n]) => n);
check('К-13: сырых цветов без пары для тёмной темы нет', raw.length === 0, raw.join());
const literal = /['"`](?:stage|gate|lease|task|artifact|review|drift)\.[a-z_]*['"`]/;
check('К-10: литералов типов событий на странице нет — перечитывает любое событие', !sources.some(([, s]) => literal.test(s)));
const page = sources.find(([n]) => n === 'Backlog.tsx')[1];
check('К-3: каждый listTasks страницы — запросом topQuery/childrenQuery', (page.match(/listTasks\(/g) ?? []).length ===
  (page.match(/listTasks\([^,]+, (topQuery|childrenQuery)\(/g) ?? []).length);
check('К-3: страница не сортирует строки', !/\.sort\(/.test(page));
check('К-10: подписка на события — useProjectEvents', /useProjectEvents\(projectKey/.test(page));
check('страница обёрнута в WorkflowVersionsProvider', /<WorkflowVersionsProvider>/.test(page));
check('К-15: одна область объявлений на страницу', (page.match(/aria-live="polite"/g) ?? []).length === 1);
check('К-18: перетаскивания нет', !/onDrag|onDrop|draggable|dnd-kit|GripVertical/.test(page));
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
check('К-1: маршрут /p/:projectKey/backlog в оболочке «backlog»', /path="\/p\/:projectKey\/backlog"[\s\S]{0,80}<Shell page="backlog">/.test(app));
check('К-1: пункт «Бэклог» вторым, сразу за «Обзором», значок ListOrdered', /page: "overview",[\s\S]{0,140}\},\s*\{\s*page: "backlog",\s*label: "Бэклог",\s*icon: ListOrdered,/.test(app));
check('К-1: заголовок «Бэклог»', /backlog: "Бэклог"/.test(app));
const zone = readFileSync(new URL('../src/components/overview/BacklogZone.tsx', import.meta.url), 'utf8');
check('К-2: «Весь бэклог» в шапке блока ведёт на /backlog', /Весь бэклог/.test(readFileSync(new URL('../src/components/overview/zones.ts', import.meta.url), 'utf8')) &&
  /to=\{`\/p\/\$\{rowProps\.projectKey\}\/backlog`\}/.test(zone) && /<ArrowRight aria-hidden/.test(zone));

console.log(`\n${ok} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
