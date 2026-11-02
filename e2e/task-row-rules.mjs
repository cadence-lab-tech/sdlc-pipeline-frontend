// Правила строки задачи (CLAB-364) — без браузера: нормализация полей списка,
// словарь причин, порядок причин, подпись ожидания решения, прежняя версия,
// тип, эпик и прогресс, стоимость одной цифрой, работа в прогоне, чужой цикл,
// два вида плотности. Модули taskrow/* и api/taskRow.ts — чистые функции,
// поэтому проверяются прямо в исходниках, как cost-rules.mjs.
// Здесь же — поиск ключей статусов, ролей и типов проекта и сырых цветов в
// новом коде строки (AC-12, AC-13).
//
// Ключи статусов, ролей и типов в данных ниже нарочно не похожи на ключи
// наших циклов (inbox/build/shipped, builder, bug): правила не должны о них знать.
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

const N = await import('../src/api/taskRow.ts');
const R = await import('../src/components/taskrow/reasons.ts');
const F = await import('../src/components/taskrow/format.ts');
const M = await import('../src/components/taskrow/rules.ts');

let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};

const NOW = Date.parse('2026-11-02T12:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

const task = (over = {}) => ({
  id: 't1', key: 'CLAB-7', title: 'Заголовок задачи', priority: 'normal',
  status_key: 'inbox', status_name: 'Входящие', workflow_id: 'wf-1',
  properties: {type: 'bug'}, labels: [], repositories: [],
  attention: [], blocked_by: [], current_run: null, cost: null, child_counts: {},
  last_moved_at: ago(5 * MIN), awaiting_approval: false,
  subtree_last_moved_at: null, subtree_cost_usd: null,
  ...over,
});
const run = (over = {}) => ({
  id: 'r1', kind: 'stage', state: 'in_progress', attempt: 1, status_key: 'build',
  role_key: 'builder', role_name: 'Сборщик', claimed_by_handle: 'bot-1', lease_alive: true,
  entered_at: ago(80 * MIN), claimable: false, ...over,
});
const version = {
  transitions: [
    {key: 'ship', name: 'Выпустить', gates: [{key: 'ok', name: 'Апрув владельца'}, {key: 'list', name: 'Чек-лист'}]},
    {key: 'redo', name: 'Переделать', gates: []},
  ],
};
const model = (t, zone, o = {}) => M.buildRowModel(t, {zone, now: NOW, canDecide: true, ...o});

// ── AC-1, AC-16: нормализация ────────────────────────────────────────────────
console.log('нормализация полей списка');
let f = N.normalizeRowFields({});
check('ответ без новых полей: пустые массивы и null', JSON.stringify(f.attention) === '[]' && JSON.stringify(f.blocked_by) === '[]' &&
  f.cost === null && f.current_run === null && f.last_moved_at === null && JSON.stringify(f.child_counts) === '{}' &&
  f.awaiting_approval === false && f.subtree_cost_usd === null && f.subtree_last_moved_at === null, JSON.stringify(f));
f = N.normalizeRowFields({
  attention: [{code: 'blocked', since: null}, {nocode: 1}, 'x', null], blocked_by: ['A-1', 5],
  child_counts: {done: 2, active: 0, backlog: 'x', waiting: 1}, cost: {cost_usd: 1}, current_run: {id: 'r'},
  last_moved_at: 'x', subtree_cost_usd: 4, awaiting_approval: true,
});
check('причины без кода отброшены', f.attention.length === 1 && f.attention[0].code === 'blocked');
check('блокирующие — только строки', JSON.stringify(f.blocked_by) === '["A-1"]');
check('дети: нулевые и нечисловые отброшены', JSON.stringify(f.child_counts) === '{"done":2,"waiting":1}', JSON.stringify(f.child_counts));
check('объекты и числа проходят', f.cost.cost_usd === 1 && f.current_run.id === 'r' && f.subtree_cost_usd === 4 && f.awaiting_approval === true);
check('испорченные значения — «нет поля»', N.normalizeRowFields({attention: 'x', child_counts: [1], cost: 5, current_run: []}).cost === null
  && JSON.stringify(N.normalizeRowFields({attention: 'x', child_counts: [1]}).attention) === '[]');

// ── AC-2: словарь причин ─────────────────────────────────────────────────────
console.log('словарь причин');
const ctx = {now: NOW, version, canDecide: true, blockedBy: ['CLAB-357']};
const d = (a, c = {}) => R.describeReason(a, {...ctx, ...c});
const gates = [{transition: 'ship', gate: 'ok'}];
let r = d({code: 'awaits_human', since: ago(HOUR), gates});
check('ждёт человека: гейт · «переход», значок, тон', r.text === 'Апрув владельца · «Выпустить»' && r.icon === 'UserCheck' && r.tone === 'blue', r.text);
r = d({code: 'awaits_human', since: null, gates}, {landsIn: (t) => (t === 'ship' ? 'Готово' : undefined)});
check('со стрелкой только из /approvals', r.text === 'Апрув владельца · «Выпустить» → Готово', r.text);
r = d({code: 'awaits_human', since: null, gates}, {canDecide: false});
check('наблюдателю — «ждёт решения человека», без гейта', r.text === 'ждёт решения человека', r.text);
r = d({code: 'awaits_human', since: null, gates: [{transition: 'zzz', gate: 'qqq'}]});
check('нет в версии — ключи как пришли', r.text === 'qqq · «zzz»', r.text);
r = d({code: 'awaits_human', since: null, gates}, {version: null});
check('версия не прочиталась — ключи, строка живёт', r.text === 'ok · «ship»', r.text);
r = d({code: 'awaits_human', since: null, gates: [{transition: 'ship', gate: 'ok'}, {transition: 'ship', gate: 'list'}]});
check('два гейта — «и ещё N», полный список в подсказке', r.text === 'Апрув владельца · «Выпустить» и ещё 1' && r.title.includes('Чек-лист · «Выпустить»'), r.text + '|' + r.title);
r = d({code: 'awaits_human', since: null});
check('ждёт человека без гейтов — нейтральный текст', r.text === 'ждёт решения человека');
r = d({code: 'lease_expired', since: ago(5 * MIN), holder: 'bot-1'});
check('аренда истекла у <хэндл> <N> назад', r.text === 'Аренда истекла у bot-1 5 минут назад' && r.icon === 'Unplug' && r.tone === 'red', r.text);
r = d({code: 'over_stage_limit', since: null, max_duration: '4h'});
check('этап дольше предела', r.text === 'Этап дольше предела 4h' && r.icon === 'TimerOff' && r.tone === 'orange', r.text);
r = d({code: 'gate_rejected', since: null, gates: [{transition: 'ship', gate: 'ok', reason: 'нет тестов'}]});
check('гейт отклонён: причина', r.text === 'Апрув владельца отклонён: нет тестов' && r.icon === 'XCircle' && r.tone === 'red', r.text);
r = d({code: 'gate_rejected', since: null, gates: [{transition: 'ship', gate: 'ok', reason: null}]});
check('гейт отклонён без причины', r.text === 'Апрув владельца отклонён', r.text);
r = d({code: 'blocked', since: null});
check('блокирующий: «Ждёт CLAB-357»', r.text === 'Ждёт CLAB-357' && r.icon === 'Lock' && r.tone === 'orange', r.text);
r = d({code: 'blocked', since: null}, {blockedBy: ['A-1', 'A-2', 'A-3']});
check('три ключа — через запятую', r.text === 'Ждёт A-1, A-2, A-3', r.text);
r = d({code: 'blocked', since: null}, {blockedBy: ['A-1', 'A-2', 'A-3', 'A-4', 'A-5']});
check('больше трёх — «и ещё N», полный список в подсказке', r.text === 'Ждёт A-1, A-2, A-3 и ещё 2' && r.title === 'Ждёт A-1, A-2, A-3, A-4, A-5', r.text);
r = d({code: 'returned', since: null, attempt: 3});
check('возврат, попытка N', r.text === 'Возврат, попытка 3' && r.icon === 'RotateCcw' && r.tone === 'orange', r.text);
r = d({code: 'unclaimed', since: ago(3 * HOUR)});
check('можно забрать: «ждёт N»', r.text === 'ждёт 3 ч' && r.icon === 'CircleDashed' && r.tone === 'default', r.text);
r = d({code: 'from_the_future', since: null});
check('незнакомый код — «Причина: <код>»', r.text === 'Причина: from_the_future' && r.icon === 'HelpCircle' && r.known === false, r.text);
r = d({code: 'awaits_reply', since: null});
check('«ждёт ответа» — место заложено: свой значок, текст по правилу незнакомого', r.icon === 'MessageCircleQuestion' && r.tone === 'blue' && r.text === 'Причина: awaits_reply');
check('все семь кодов движка известны', R.REASON_CODES.length === 7 && R.REASON_CODES.every((c) => d({code: c, since: null, gates}).known));

// ── AC-3: порядок причин ─────────────────────────────────────────────────────
console.log('порядок причин');
const three = [
  {code: 'lease_expired', since: ago(MIN), holder: 'bot-1'},
  {code: 'over_stage_limit', since: null, max_duration: '2h'},
  {code: 'blocked', since: null},
  {code: 'lease_expired', since: ago(MIN), holder: 'bot-1'},
];
let m = model(task({attention: three, blocked_by: ['CLAB-9'], current_run: run()}), 'stuck');
const codes = (x) => [x.primary, ...x.reasons].filter(Boolean).map((e) => e.code).join(',');
check('застряло: все причины в порядке сервера, код не повторяется', codes(m) === 'lease_expired,over_stage_limit,blocked', codes(m));
check('главная причина — первая', m.primary?.code === 'lease_expired');
m = model(task({attention: [{code: 'awaits_human', since: ago(3 * HOUR), gates}, {code: 'over_stage_limit', since: null, max_duration: '2h'}]}), 'decisions', {version});
check('ждут решения: главная — ожидание, вторая токеном', m.primary?.code === 'awaits_human' && m.reasons.map((x) => x.code).join() === 'over_stage_limit');
check('ждут решения: «ждёт N» от awaits_human.since', m.waiting?.text === 'ждёт 3 ч', JSON.stringify(m.waiting));
m = model(task({attention: three, blocked_by: ['CLAB-9'], current_run: run()}), 'working');
check('в работе: причины токенами не выводятся', m.primary === null && m.reasons.length === 0);

// ── AC-4: ожидание от человека, три варианта входа ───────────────────────────
console.log('ожидание решения (три варианта входа)');
const wait = task({attention: [{code: 'awaits_human', since: ago(HOUR), gates}]});
m = model(wait, 'decisions', {version, approvals: [{transition_key: 'ship', lands_in_name: 'Готово'}]});
check('сопровождающий, запись /approvals есть — со стрелкой', m.primary.text === 'Апрув владельца · «Выпустить» → Готово', m.primary.text);
m = model(wait, 'decisions', {version, approvals: []});
check('сопровождающий, записи нет — без стрелки', m.primary.text === 'Апрув владельца · «Выпустить»', m.primary.text);
m = model(wait, 'decisions', {version, approvals: [], canDecide: false});
check('наблюдатель — «ждёт решения человека» и без стрелки', m.primary.text === 'ждёт решения человека');
m = model(wait, 'decisions', {version, approvals: [{transition_key: 'other', lands_in_name: 'Чужое'}, {transition_key: 'x', lands_in_name: 'Иное'}]});
check('несколько записей без совпадения ключа — без догадок', m.primary.text === 'Апрув владельца · «Выпустить»');
check('подпись версии нужна только причинам с гейтом',
  R.needsVersion(wait.attention, true) === true && R.needsVersion(wait.attention, false) === false &&
  R.needsVersion([{code: 'blocked', since: null}], true) === false && R.needsVersion([{code: 'gate_rejected', since: null}], false) === true);

// ── AC-5: прежняя версия ─────────────────────────────────────────────────────
console.log('прежняя версия цикла');
const active = [{id: 'wf-2', task_types: ['bug']}, {id: 'wf-9', task_types: ['story']}];
check('версия не совпала с действующей для типа — токен', model(task(), 'backlog', {activeWorkflows: active}).oldVersion === true);
check('совпала — токена нет', model(task({workflow_id: 'wf-2'}), 'backlog', {activeWorkflows: active}).oldVersion === false);
check('нет цикла для типа или нет сведений — не утверждаем', model(task({properties: {type: 'epic'}}), 'backlog', {activeWorkflows: active}).oldVersion === false
  && model(task(), 'backlog').oldVersion === false);
m = model(task({status_key: 'gone', status_name: 'Ушедший статус', current_run: run({status_key: 'gone', role_name: null})}), 'working', {activeWorkflows: active});
check('статус, которого нет в цикле: имя из списка, роль без имени — только статус', m.stage.text === 'Ушедший статус');
check('тип без значения — task', M.taskTypeOf({properties: {}}) === 'task' && M.taskTypeOf({properties: {type: ''}}) === 'task');
check('версия не прочиталась — флаг строки', model(task(), 'stuck', {versionFailed: true}).versionFailed === true);

// ── AC-7: работа в прогоне, пять состояний ───────────────────────────────────
console.log('работа в прогоне');
m = model(task({current_run: run()}), 'working');
check('этап · роль, держатель с живой арендой', m.stage.text === 'Входящие · Сборщик' && m.holder.handle === 'bot-1' && m.holder.live === true);
check('на этапе — от entered_at: «1 ч 20 мин»', m.onStage.text === '1 ч 20 мин', JSON.stringify(m.onStage));
check('движение N назад — от last_moved_at', m.movement.text === 'движение 5 минут назад', m.movement.text);
m = model(task({current_run: run({lease_alive: false})}), 'working');
check('истёкшая аренда — держатель не живой', m.holder.live === false);
m = model(task({current_run: run({kind: 'review'})}), 'working');
check('перепроверка', m.review === true && model(task({current_run: run()}), 'working').review === false);
m = model(task({current_run: run({attempt: 3})}), 'working');
check('попытка N при N > 1', m.attempt === 3 && model(task({current_run: run({attempt: 1})}), 'working').attempt === null);
m = model(task({current_run: run({attempt: 2}), attention: [{code: 'returned', since: null, attempt: 2}, {code: 'blocked', since: null}]}), 'stuck');
check('возврат причиной — токен «попытка» не дублируется', m.attempt === null && [m.primary, ...m.reasons].some((x) => x.code === 'returned'));
m = model(task({current_run: run({claimed_by_handle: null, state: 'pending', role_name: null})}), 'queue');
check('прогон без роли и без держателя — только статус', m.stage.text === 'Входящие' && m.holder === null);
m = model(task({current_run: run({claimed_by_handle: null, state: 'pending', entered_at: ago(2 * HOUR)}), attention: [{code: 'unclaimed', since: ago(2 * HOUR)}]}), 'queue');
check('очередь: «ждёт N» от входа в прогон, без токена «можно забрать»', m.waiting.text === 'ждёт 2 ч' && m.reasons.length === 0, JSON.stringify(m.waiting));
m = model(task({attention: [{code: 'blocked', since: null}], blocked_by: ['CLAB-9']}), 'backlog');
check('бэклог: «Ждёт CLAB-9» токеном', m.reasons.map((x) => x.text).join() === 'Ждёт CLAB-9' && m.primary === null);
m = model(task({last_moved_at: ago(2 * DAY)}), 'done');
check('завершённые: «N назад» без слова «движение»', m.movement.text === '2 дня назад', m.movement.text);
check('время: меньше минуты — «только что»', F.agoText(ago(10_000), NOW) === 'только что' && F.agoText(ago(-5 * MIN), NOW) === 'только что');
check('длительности', F.spanText(30_000) === 'меньше минуты' && F.spanText(5 * MIN) === '5 мин' && F.spanText(2 * HOUR) === '2 ч' &&
  F.spanText(DAY + 3 * HOUR + 5 * MIN) === '1 д 3 ч' && F.spanText(3 * DAY) === '3 д');
check('точное время — в подсказке', m.movement.title.startsWith('Последнее движение: ') && m.movement.title.length > 25);
check('нечитаемая дата — пусто, без падения', F.agoText('мусор', NOW) === '' && F.sinceText('мусор', NOW) === '' && F.exactTime('мусор') === '');

// ── AC-8: стоимость одной цифрой ─────────────────────────────────────────────
console.log('стоимость');
check('нет учёта — «нет учёта», не $0', M.costOf({cost: null, subtree_cost_usd: null}).text === 'нет учёта' && M.costOf({cost: null, subtree_cost_usd: null}).title === 'Учёта стоимости нет'
  && M.costOf({cost: null, subtree_cost_usd: null}).hasData === false);
let c = M.costOf({cost: {cost_usd: 2.1, api_cost_usd: 0.4, subscription_cost_usd: 1.7, reports: 3}, subtree_cost_usd: null});
check('одна цифра: сумма по всем этапам, без деления на деньги и подписку', c.text === '$2.10' && !/API|подписк/i.test(c.text + c.title), JSON.stringify(c));
check('сообщённый ноль — $0.00', M.costOf({cost: {cost_usd: 0, api_cost_usd: 0, subscription_cost_usd: 0, reports: 1}}).text === '$0.00');
check('меньше цента, но не ноль', F.dollars(0.004) === '<$0.01' && F.dollars(0) === '$0.00' && F.dollars(12.5) === '$12.50');
c = M.costOf({cost: null, subtree_cost_usd: 7.5});
check('эпик без своего учёта — сумма по нарезке', c.text === 'в нарезке $7.50' && c.hasData === true, c.text);
check('эпик без учёта и без стоимости детей — «нет учёта»', M.costOf({cost: null, subtree_cost_usd: 0}).text === 'нет учёта');
check('собственный учёт эпика важнее суммы по нарезке', M.costOf({cost: {cost_usd: 1, api_cost_usd: 1, subscription_cost_usd: 0, reports: 1}, subtree_cost_usd: 9}).text === '$1.00');
check('стоимость только в «В работе»', model(task({current_run: run()}), 'working').cost !== null &&
  ['decisions', 'stuck', 'queue', 'backlog', 'done'].every((z) => model(task(), z).cost === null));

// ── AC-9: эпик и прогресс ────────────────────────────────────────────────────
console.log('эпик и прогресс');
m = model(task({parent_key: 'CLAB-60'}), 'working');
check('токен эпика — по parent_key', m.epic === 'CLAB-60' && model(task(), 'working').epic === null);
check('hideEpic убирает токен', model(task({parent_key: 'CLAB-60'}), 'working', {hideEpic: true}).epic === null);
let p = M.progressOf({done: 12, active: 2, waiting: 1, backlog: 5, cancelled: 4});
check('готово = done, в работе = active + waiting, в бэклоге = backlog; отменённые не входят', p.done === 12 && p.active === 3 && p.backlog === 5 && p.total === 20, JSON.stringify(p));
check('подпись и aria-label', p.label === '12 готово · 3 в работе · 5 в бэклоге' && p.aria === 'готово 12, в работе 3, в бэклоге 5');
check('без детей и только отменённые — полосы нет', M.progressOf({}) === null && M.progressOf(undefined) === null && M.progressOf({cancelled: 3}) === null);
m = model(task({child_counts: {backlog: 3}, last_moved_at: ago(DAY), subtree_last_moved_at: ago(10 * MIN)}), 'working');
check('у задачи с детьми движение — позднее из своего и поддерева', m.movement.text === 'движение 10 минут назад' && m.progress.total === 3, m.movement.text);

// ── AC-10, AC-11: приоритет и тип ────────────────────────────────────────────
console.log('приоритет и тип');
check('приоритет по-русски, normal не показывается', model(task({priority: 'urgent'}), 'backlog').priority.label === 'срочный' &&
  model(task({priority: 'high'}), 'backlog').priority.label === 'высокий' && model(task({priority: 'low'}), 'backlog').priority.label === 'низкий' &&
  model(task({priority: 'normal'}), 'backlog').priority === null);
check('цвета приоритета с парой для тёмной темы', /dark:/.test(model(task({priority: 'urgent'}), 'backlog').priority.className) &&
  /dark:/.test(model(task({priority: 'high'}), 'backlog').priority.className));
check('приоритета нет в словаре — как пришёл', model(task({priority: 'critical'}), 'backlog').priority.label === 'critical');
check('тип показывается, когда типов больше одного', model(task(), 'backlog', {projectTypes: ['task', 'bug']}).type === 'bug');
check('один тип в проекте — типа нет', model(task(), 'backlog', {projectTypes: ['bug']}).type === null && model(task(), 'backlog').type === null);
check('тип task не прячется по ключу', model(task({properties: {}}), 'backlog', {projectTypes: ['task', 'bug']}).type === 'task');

// ── AC-12: чужой цикл ────────────────────────────────────────────────────────
console.log('чужой цикл');
const alien = task({
  key: 'ZZ-1', status_key: 'shipped', status_name: 'Отгружено', properties: {type: 'bug'}, parent_key: 'ZZ-0', priority: 'urgent',
  current_run: run({status_key: 'shipped', role_key: 'builder', role_name: 'Сборщик'}),
  attention: [{code: 'gate_rejected', since: ago(HOUR), gates: [{transition: 'ship', gate: 'ok', reason: 'красный'}]}],
  cost: {cost_usd: 3, api_cost_usd: 3, subscription_cost_usd: 0, reports: 1}, child_counts: {done: 1, backlog: 1},
});
let all = true;
for (const z of ['decisions', 'stuck', 'working', 'queue', 'backlog', 'done']) {
  try { model(alien, z, {version, projectTypes: ['task', 'bug'], activeWorkflows: active}); } catch (e) { all = false; console.log(e); }
}
check('чужой цикл во всех зонах — без падения', all);
m = model(alien, 'stuck', {version, projectTypes: ['task', 'bug'], activeWorkflows: active});
check('чужой цикл: все поля выведены', m.stage.text === 'Отгружено · Сборщик' && m.type === 'bug' && m.epic === 'ZZ-0' && m.priority.label === 'срочный' &&
  m.primary.text === 'Апрув владельца отклонён: красный' && m.progress.total === 2 && m.oldVersion === true);

// ── AC-16, AC-17: старый сервер и плотность ──────────────────────────────────
console.log('старый сервер и плотность');
const old = {...task(), ...N.normalizeRowFields({})};
for (const z of ['decisions', 'stuck', 'working', 'queue', 'backlog', 'done']) {
  m = model(old, z);
  check(`без новых полей, зона ${z}: ключ, заголовок, статус; сигналов нет`, m.key === 'CLAB-7' && m.title === 'Заголовок задачи' && m.stage.text === 'Входящие' &&
    m.primary === null && m.reasons.length === 0 && m.holder === null && m.attempt === null && m.waiting === null && m.onStage === null && m.progress === null);
}
check('«нет учёта» у «В работе» на старом сервере — не падает', model(old, 'working').cost.text === 'нет учёта');
check('задача без прогона — нет блока этапа в работе и ожидания', model(old, 'working').onStage === null && model(old, 'queue').waiting === null);
check('модель не зависит от плотности — плотность в разметке', !('density' in model(old, 'working')));

// ── AC-12, AC-13: ключи проекта и сырые цвета в новом коде ───────────────────
console.log('ключи и цвета в коде строки');
const dir = new URL('../src/components/taskrow/', import.meta.url);
const files = readdirSync(dir).filter((n) => /\.tsx?$/.test(n));
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  .replace(/\/\/.*$/gm, '');
const sources = files.map((n) => [n, code(readFileSync(new URL(n, dir), 'utf8'))]);
const KEYWORDS = /['"`](analysis|development|testing|merge|release|design|epic|planning|in_progress|cancelled)['"`]/;
const hits = sources.filter(([, s]) => KEYWORDS.test(s)).map(([n]) => n);
check('сравнений с ключами статусов, ролей, типов проекта нет', hits.length === 0, hits.join());
const raw = sources.filter(([, s]) => /\b(bg|text)-(blue|red|amber|emerald|green)-\d00(?!\/)/.test(s.replace(/text-(blue|red|amber)-700 dark:text-\1-300/g, ''))).map(([n]) => n);
check('сырых цветов без пары для тёмной темы нет', raw.length === 0, raw.join());
check('задача не лезёт в ключи сравнением: нет === с status_key/role_key', !sources.some(([, s]) => /(status_key|role_key)\s*[!=]==/.test(s)));
const tsx = sources.find(([n]) => n === 'TaskRow.tsx')[1];
check('вся строка — ссылка на карточку задачи', /to=\{`\/p\/\$\{projectKey\}\/tasks\/\$\{task\.key\}`\}/.test(tsx));
check('внутри строки один <button> — токен эпика', (tsx.match(/<button/g) ?? []).length === 1);
check('значки причин скрыты от чтения с экрана', /<Icon aria-hidden/.test(tsx) && /<PrimaryIcon[^>]*aria-hidden/.test(tsx));

console.log(`\n${ok} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
