// Перевод в статус вне цикла (CLAB-407, эпик CLAB-404) — правила без браузера:
// право на кнопку по actor_rights.move, список статусов версии цикла задачи,
// выключенные этапы и их пояснения, пояснение под списком, проверки полей
// диалога (причина, ключ, «Осталось»), тело запроса, подпись task.moved и
// «переведена вручную» у попытки; в новом коде нет сравнений по уровню доступа,
// роли и ключам статусов (F-13). Модули — чистые функции, проверяются прямо в
// исходниках. Ключи статусов в данных нарочно ни на что не похожи.
import {readFileSync} from 'node:fs';
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

const M = await import('../src/components/task/moveRights.ts');
const E = await import('../src/components/task/events.ts');
const P = await import('../src/components/task/stagePanel.ts');

let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};

const st = (key, name, position, extra = {}) => ({key, name, position, is_terminal: false, is_optional: false, enabled_by_default: true, ...extra});
// Версия цикла этой задачи (не активная версия проекта): порядок по position.
const statuses = [
  st('zz-end', 'Конец', 40, {is_terminal: true}),
  st('qq-start', 'Старт', 10),
  st('kk-extra', 'Дополнительно', 30, {is_optional: true, enabled_by_default: false}),
  st('mm-work', 'Работа', 20),
];
const task = (extra = {}) => ({key: 'ABC-7', title: 'Задача', status_key: 'mm-work', status_name: 'Работа', optional_stages: {}, ...extra});
const deny = (message, reason = 'not_allowed') => ({code: 'forbidden', reason, message});

// ── F-1: право на вход ───────────────────────────────────────────────────────
console.log('право на кнопку: считает сервер');
check('move: true — кнопка есть', M.moveAllowed({move: true}) === true);
check('move: false — кнопки нет', M.moveAllowed({move: false}) === false);
check('нет поля move (сервер до CLAB-408) — кнопки нет', M.moveAllowed({edit: true, stage_choice: true}) === false);
check('нет actor_rights (сервер прежней версии) — кнопки нет', M.moveAllowed(undefined) === false);
check('не булево — кнопки нет', M.moveAllowed({move: 'true'}) === false);
check('текст отказа не влияет: move: true с actor_deny.move — кнопка есть', M.moveAllowed({move: true, actor_deny: {move: deny('x')}}) === true);
check('текст отказа move на экран не выводится (решение Q2)',
  !('moveDenyText' in M) && !/actor_deny\??\.move|denyOf\(.*['"]move['"]/.test(readFileSync(new URL('../src/components/task/MoveTaskDialog.tsx', import.meta.url), 'utf8')));

// ── F-2, F-3: список статусов ────────────────────────────────────────────────
console.log('список статусов версии цикла задачи');
const rights = {move: true, stage_choice: true};
let rows = M.moveStatuses(statuses, task(), rights);
check('по position, а не в порядке ответа', rows.map((r) => r.key).join() === 'qq-start,mm-work,kk-extra,zz-end', rows.map((r) => r.key).join());
check('текущий отмечен и выбирается', rows[1].current === true && rows[1].disabled === false);
check('остальные не текущие', rows.filter((r) => r.current).length === 1);
check('завершающий и необязательный — по данным версии', rows[3].terminal === true && rows[2].optional === true && rows[0].terminal === false);
check('названия из версии, не ключи', rows[1].name === 'Работа');
check('выключенный по умолчанию этап не выбирается', rows[2].disabled === true);
check('выключенный: ссылка «Выбор этапов», когда право есть', rows[2].note?.kind === 'link' && rows[2].note.text === 'Выбор этапов', JSON.stringify(rows[2].note));
check('у включённых и обязательных пояснения нет', rows[0].note === undefined && rows[1].note === undefined && rows[3].note === undefined);
rows = M.moveStatuses(statuses, task({optional_stages: {'kk-extra': true}}), rights);
check('выбор задачи включил этап — выбирается', rows[2].disabled === false);
rows = M.moveStatuses(statuses.map((s) => (s.key === 'mm-work' ? {...s, is_optional: true} : s)), task({optional_stages: {'mm-work': false}}), rights);
check('выключен сам текущий этап — не выбирается, ссылки нет', rows[1].disabled === true && rows[1].note?.kind === 'readonly', JSON.stringify(rows[1]));
rows = M.moveStatuses(statuses, task({closed_at: '2026-11-05T10:00:00Z', status_key: 'zz-end'}), rights);
check('закрытая задача: вместо ссылки текст', rows[2].note?.kind === 'closed' && rows[2].note.text.startsWith('пока задача закрыта'), JSON.stringify(rows[2].note));
check('закрытая задача: текущий статус — завершающий, отмечен', rows[3].current === true);
rows = M.moveStatuses(statuses, task(), {move: true, stage_choice: false, actor_deny: {stage_choice: deny('Выбор этапов — только сопровождающему (текст сервера)')}});
check('нет права на выбор этапов: текст сервера дословно', rows[2].note?.kind === 'readonly' && rows[2].note.text === 'Выбор этапов — только сопровождающему (текст сервера)', JSON.stringify(rows[2].note));
rows = M.moveStatuses(statuses, task(), {move: true, stage_choice: false});
check('нет права и нет текста сервера — прежняя подсказка интерфейса', rows[2].note?.kind === 'readonly' && rows[2].note.text === 'этапы задачи выбирает сопровождающий проекта', JSON.stringify(rows[2].note));
check('версии цикла нет — пустой список', M.moveStatuses(undefined, task(), rights).length === 0);
check('ответ версии без отметок этапов — все выбираются', M.moveStatuses([{key: 'a1', name: 'A', position: 1}], task({status_key: 'a1'}), rights)[0].disabled === false);

// ── пояснение под списком ────────────────────────────────────────────────────
console.log('пояснение под списком');
check('ничего не выбрано — строки нет', M.moveEffect(task(), statuses, undefined) === undefined);
check('незнакомый ключ — строки нет', M.moveEffect(task(), statuses, 'нет-такого') === undefined);
check('текущий статус — начать заново', M.moveEffect(task(), statuses, 'mm-work') === 'Текущая попытка закроется как «переведена вручную», начнётся новая.');
check('завершающий статус — задача закроется', M.moveEffect(task(), statuses, 'zz-end') === 'Статус завершающий: задача будет закрыта.');
check('закрытая задача в не завершающий — снова откроется', M.moveEffect(task({closed_at: '2026-11-05T10:00:00Z', status_key: 'zz-end'}), statuses, 'qq-start') === 'Задача снова станет открытой.');
check('обычный перевод — названия из версии', M.moveEffect(task(), statuses, 'qq-start') === 'Текущая попытка Работа закроется как «переведена вручную», в Старт откроется новая.', M.moveEffect(task(), statuses, 'qq-start'));

// ── F-4, F-6: поля диалога ───────────────────────────────────────────────────
console.log('причина, ключ, «Осталось»');
check('причина: пусто, пробелы и переводы строк не годятся', !M.reasonValid('') && !M.reasonValid('   ') && !M.reasonValid(' \n\t '));
check('причина: текст годится', M.reasonValid('неверные требования') && M.reasonValid('  а  '));
check('ключ: точное совпадение', M.confirmMatches('ABC-7', 'ABC-7') === true);
check('ключ: пробелы по краям допускаются', M.confirmMatches('ABC-7', '  ABC-7 ') === true);
check('ключ: регистр важен', M.confirmMatches('ABC-7', 'abc-7') === false);
check('ключ: часть не годится', M.confirmMatches('ABC-7', 'ABC-') === false && M.confirmMatches('ABC-7', '') === false);
check('«не совпадает» — только когда что-то введено и не сошлось', M.confirmMismatch('ABC-7', 'ABC') && !M.confirmMismatch('ABC-7', '') && !M.confirmMismatch('ABC-7', '   ') && !M.confirmMismatch('ABC-7', 'ABC-7'));
const miss = (o) => M.moveMissing({selected: 'qq-start', reason: 'р', confirm: 'ABC-7', taskKey: 'ABC-7', ...o});
check('всё есть — «Осталось» пусто', miss({}).length === 0 && M.moveMissingLine(miss({})) === '');
check('нет статуса', miss({selected: undefined}).join() === 'выбрать статус');
check('причина из пробелов', miss({reason: '   '}).join() === 'указать причину');
check('все три по порядку: статус, причина, ключ', M.moveMissingLine(miss({selected: undefined, reason: '', confirm: ''})) === 'Осталось: выбрать статус, указать причину, ввести ключ', M.moveMissingLine(miss({selected: undefined, reason: '', confirm: ''})));

// ── F-7: тело запроса ────────────────────────────────────────────────────────
console.log('тело запроса');
check('to — ключ статуса, reason без пробелов по краям', JSON.stringify(M.moveBody('qq-start', '  требования неверны \n')) === '{"to":"qq-start","reason":"требования неверны"}');

// ── F-14: лента ──────────────────────────────────────────────────────────────
console.log('лента: task.moved');
const nameOf = (k) => statuses.find((s) => s.key === k)?.name ?? k;
const moved = {from: 'mm-work', to: 'qq-start', reason: 'неверные требования', level: 'agent', via: 'level', token_kind: 'session', attempt: 2};
check('подпись типа', E.eventLabel('task.moved') === 'перевёл вручную');
check('строка: из X в Y: причина · уровень · токен', E.eventDetails('task.moved', moved, undefined, undefined, nameOf).summary === 'из Работа в Старт: неверные требования · уровень agent · токен session', E.eventDetails('task.moved', moved, undefined, undefined, nameOf).summary);
check('без версии цикла — ключи как пришли', E.eventDetails('task.moved', moved).summary === 'из mm-work в qq-start: неверные требования · уровень agent · токен session');
check('неизвестный ключ статуса не ломает ленту', E.eventDetails('task.moved', {...moved, to: 'ghost'}, undefined, undefined, nameOf).summary.includes('в ghost'));
check('токен none — вида токена нет', !E.eventDetails('task.moved', {...moved, token_kind: 'none'}).summary.includes('токен'));
check('старое событие без level/token_kind — только «из X в Y: причина»', E.eventDetails('task.moved', {from: 'a', to: 'b', reason: 'р'}).summary === 'из a в b: р');
check('нет причины — без двоеточия', E.eventDetails('task.moved', {from: 'a', to: 'b', level: 'agent'}).summary === 'из a в b · уровень agent');
check('неполный payload: «из — в —» не выводится', E.eventDetails('task.moved', {to: 'b'}).summary === 'в b' && E.eventDetails('task.moved', {}).summary === '' && E.eventDetails('task.moved', null).summary === '');
check('составные значения не дают [object Object]', !/object|undefined|null/.test(E.eventDetails('task.moved', {from: {x: 1}, to: ['a'], reason: {r: 1}, level: 5}).summary));
check('уровень и токен — только у task.moved (Q1)',
  !/уровень|токен/.test(E.eventDetails('gate.decided', {gate: 'g', status: 'passed', level: 'agent', token_kind: 'session'}).summary)
  && !/уровень|токен/.test(E.eventDetails('task.advanced', {transition: 't', from: 'a', to: 'b', level: 'agent', token_kind: 'session'}).summary));
check('stage.entered не меняется', E.eventDetails('stage.entered', {status: 'qq-start', attempt: 2}).summary === 'qq-start · попытка 2');

// ── F-15: попытка ────────────────────────────────────────────────────────────
console.log('попытка этапа: переведена вручную');
const exit = {kind: 'moved', transition: '', to_status: 'qq-start', comment: 'неверные требования', by_handle: 'ann', at: '2026-11-05T10:00:00Z'};
check('выход «moved» — «переведена вручную в «Y»», без перехода', P.exitLabel(exit, statuses) === 'переведена вручную в «Старт»', P.exitLabel(exit, statuses));
check('нет версии цикла — ключ', P.exitLabel(exit, undefined) === 'переведена вручную в «qq-start»');
check('сырого «moved» в подписи нет', !/moved/.test(P.exitLabel(exit, statuses)));
check('исход moved в бейдже', P.outcomeLabel('moved') === 'переведена вручную');
check('остальные исходы как пришли', P.outcomeLabel('rejected') === 'rejected' && P.outcomeLabel('passed') === 'passed');
const runMoved = {id: 'r1', status_key: 'mm-work', exit, rejected_from_run_id: undefined};
check('возврат: попытка, закрытая переводом, возвратом не считается', P.returnedTo(runMoved, [], statuses) === null);
check('возврат: попытка после перевода не «вернулась»', P.returnedFrom({id: 'r2', status_key: 'qq-start'}, [runMoved], [], statuses) === null);

// ── F-13: условия показа не по уровню и не по ключам ─────────────────────────
console.log('код перевода: право от сервера, ключей статусов нет');
const code = ['src/components/task/moveRights.ts', 'src/components/task/MoveTaskDialog.tsx', 'src/components/task/Actions.tsx']
  .map((f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'))
  .join('\n')
  .split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\{\/\*)/.test(l))
  .join('\n');
check('нет сравнений по уровню, роли и виду участника', !/\b(level|maintainer|agent|viewer)\b\s*[!=]==?|[!=]==?\s*['"](maintainer|agent|viewer|admin)['"]/.test(code.replace(/уровень/g, '')));
check('нет ключей статусов в кавычках', !/(['"`])(new|analysis|development|testing|merge|release|done|cancelled|planning|in_progress)\1/.test(code));
check('модуль правил без React и без @/', !/from ['"](react|@\/)/.test(readFileSync(new URL('../src/components/task/moveRights.ts', import.meta.url), 'utf8')));

console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
