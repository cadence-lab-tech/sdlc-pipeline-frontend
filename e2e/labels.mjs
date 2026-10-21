// Словари подписей проверяются без браузера: у них важна не разметка, а то,
// что незнакомый ключ не теряется. Событие неизвестного типа появится на
// бэкенде раньше, чем подпись здесь, и лента обязана показать его как есть.
import {eventDetails, eventLabel, hasPayload} from '../src/components/task/events.ts';
import {
  channelLabel,
  outcomeLabel,
  principalLabel,
  tokenKindColor,
  tokenKindLabel,
  tokenLabel,
} from '../src/components/audit.ts';
import {priorityClass, priorityLabel} from '../src/components/priorities.ts';
import {
  appNotice,
  clockNote,
  failureSource,
  healthMarks,
  installationState,
  runState,
} from '../src/components/health.ts';
import {externalLinks} from '../src/components/externalRef.ts';

let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};

console.log('подписи типов событий');
check('известный тип подписан по-русски', eventLabel('stage.entered') === 'этап начат', eventLabel('stage.entered'));
check('решение по гейту подписано', eventLabel('gate.decided') === 'решение по гейту', eventLabel('gate.decided'));
check('неизвестный тип показан сырым ключом', eventLabel('какой.то.новый') === 'какой.то.новый');

console.log('подписи приоритетов');
for (const [key, label] of [['urgent', 'срочный'], ['high', 'высокий'], ['normal', 'обычный'], ['low', 'низкий']]) {
  check(`${key} — «${label}»`, priorityLabel(key) === label, priorityLabel(key));
}
check('неизвестный приоритет показан ключом', priorityLabel('later') === 'later');
// У каждого цвета обязана быть пара для тёмной темы: либо класс dark:, либо
// токен темы, который меняется вместе с ней.
for (const key of ['urgent', 'high']) {
  check(`у цвета ${key} есть пара для тёмной темы`, priorityClass(key).includes('dark:'), priorityClass(key));
}
check('«низкий» окрашен токеном темы', priorityClass('low').includes('muted-foreground'), priorityClass('low'));

// ── состояние приложения GitHub и нечитаемые репозитории (CLAB-79) ──────────
// Правила «что сказать» проверяются здесь на всех состояниях сразу: стенд
// сквозного сценария находится в одном из них, а не во всех.
console.log('состояние приложения GitHub');
const at = '2026-10-05T14:00:00Z';
const rejected = appNotice({state: 'rejected', error: 'github 401: {"message":"Bad credentials"}', checked_at: at, clock_offset_seconds: 180});
const rejectedText = rejected ? [rejected.title, ...rejected.lines].join(' ') : '';
check('отказ ключа назван отказом', rejected?.title === 'Ключ приложения GitHub не принят' && rejected.tone === 'error', JSON.stringify(rejected));
for (const want of ['Bad credentials', 'администратор инстанса', 'SDLC_GITHUB_APP_KEY_FILE', 'SDLC_GITHUB_APP_ID', 'часы машины', 'отстают от времени провайдера на 3 мин']) {
  check(`в отказе есть «${want}»`, rejectedText.includes(want), rejectedText);
}
check('у отказа есть время проверки', rejected?.checkedAt === at);

const unknown = appNotice({state: 'unknown', error: 'github 500: upstream', checked_at: at});
const unknownText = unknown ? [unknown.title, ...unknown.lines].join(' ') : '';
check('«не удалось проверить» — нейтральная заметка', unknown?.title === 'Не удалось проверить приложение GitHub' && unknown.tone === 'info', JSON.stringify(unknown));
check('в ней есть причина', unknownText.includes('github 500: upstream'), unknownText);
check('и нет слов «не принят»', !unknownText.includes('не принят'), unknownText);

const drift = appNotice({state: 'ok', checked_at: at, clock_offset_seconds: -95});
check('принятый ключ с уехавшими часами — заметка о часах', drift?.tone === 'warning' && drift.lines.join(' ').includes('спешат относительно времени провайдера на 1 мин 35 с') && drift.lines.join(' ').includes('синхронизацию времени'), JSON.stringify(drift));
check('принятый ключ без расхождения — ничего', appNotice({state: 'ok', checked_at: at}) === undefined);
const none = appNotice({state: 'not_configured'});
check('«не настроено» названо сразу', none?.title === 'Приложение у инстанса не настроено' && none.tone === 'info', JSON.stringify(none));
check('бэкенд без поля app — ничего', appNotice(undefined) === undefined);
check('незнакомое состояние показано как есть', appNotice({state: 'throttled'})?.title.includes('throttled'));
check('расхождения нет — приписки нет', clockNote(undefined) === undefined && clockNote(0) === undefined);

console.log('бейдж установки');
const live = {}, removed = {removed_at: at}, suspended = {suspended_at: at};
check('при принятом ключе — «работает»', installationState(live, {state: 'ok'}).label === 'работает');
check('при отбитом ключе — не «работает»', installationState(live, {state: 'rejected'}).label === 'ключ приложения не принят' && installationState(live, {state: 'rejected'}).variant === 'destructive');
check('«не удалось проверить» бейдж не трогает', installationState(live, {state: 'unknown'}).label === 'работает');
check('состояние неизвестно — бейдж как раньше', installationState(live).label === 'работает');
check('снятая подписана по-прежнему', installationState(removed, {state: 'rejected'}).label === 'снята');
check('приостановленная подписана по-прежнему', installationState(suspended, {state: 'rejected'}).label === 'приостановлена');

console.log('прогон индексации');
check('очередь после сбоя — «повтор после сбоя»', runState({index_enabled: true, state: 'queued', error: 'github 401'}).label === 'повтор после сбоя');
check('ошибка повтора — в подсказке', runState({index_enabled: true, state: 'queued', error: 'github 401'}).title === 'github 401');
check('обычная очередь — как была', runState({index_enabled: true, state: 'queued'}).label === 'queued');
check('проваленный прогон — «сорвался»', runState({index_enabled: true, state: 'failed', error: 'x'}).label === 'сорвался');
check('выключенная индексация — «выключена»', runState({index_enabled: false, state: 'failed'}).label === 'выключена');
check('без прогонов — «не запускалась»', runState({index_enabled: true}).label === 'не запускалась');
check('источник провала подписан', failureSource('head') === 'голова ветки не читается' && failureSource('run') === 'прогон индексации не проходит');
check('незнакомый источник показан как есть', failureSource('mirror') === 'mirror');

console.log('отметки в меню проекта');
const marks = (h) => JSON.stringify(healthMarks(h));
check('отказ ключа — отметка у «Настроек»', marks({app: {state: 'rejected'}, unreadable_repositories: 0}) === JSON.stringify({settings: 'Ключ приложения GitHub не принят'}), marks({app: {state: 'rejected'}, unreadable_repositories: 0}));
check('нечитаемые репозитории — отметка у «Поиска» с числом', marks({app: {state: 'ok'}, unreadable_repositories: 2}) === JSON.stringify({search: 'Не читается репозиториев: 2'}), marks({app: {state: 'ok'}, unreadable_repositories: 2}));
for (const state of ['ok', 'unknown', 'not_configured']) {
  check(`${state} без нечитаемых — отметок нет`, marks({app: {state}, unreadable_repositories: 0}) === '{}');
}
check('сводки нет — отметок нет', marks(undefined) === '{}');
check('сводка без полей — отметок нет', marks({}) === '{}');

// ── ссылка на основной трекер (CLAB-95) ────────────────────────────────────
// Что показывать ссылкой, решает правило, а не разметка: старые данные бывают
// любыми, и `javascript:` в href превратил бы карточку в дыру.
console.log('ссылки на основной трекер');
const links = (ref) => JSON.stringify(externalLinks(ref));
check('ссылка jira разобрана',
  links({jira: {key: 'PROJ-12', url: 'https://jira.example.com/browse/PROJ-12'}}) ===
    JSON.stringify([{system: 'jira', key: 'PROJ-12', url: 'https://jira.example.com/browse/PROJ-12'}]),
  links({jira: {key: 'PROJ-12', url: 'https://jira.example.com/browse/PROJ-12'}}));
check('системы по порядку',
  externalLinks({youtrack: {key: 'YT-1', url: 'http://yt.example.com/YT-1'}, jira: {key: 'P-1', url: 'https://j.example.com/P-1'}})
    .map((l) => l.system).join(',') === 'jira,youtrack');
check('legacy_epic_key не ссылка', links({legacy_epic_key: 'SDLC-E1'}) === '[]', links({legacy_epic_key: 'SDLC-E1'}));
check('javascript: не выводится ссылкой', links({jira: {key: 'P-1', url: 'javascript:alert(1)'}}) === '[]');
check('ftp: не выводится ссылкой', links({jira: {key: 'P-1', url: 'ftp://j.example.com/P-1'}}) === '[]');
check('относительный адрес не выводится ссылкой', links({jira: {key: 'P-1', url: '/browse/P-1'}}) === '[]');
check('без ключа не выводится', links({jira: {url: 'https://j.example.com/P-1'}}) === '[]');
for (const empty of [undefined, null, {}, [], 'PROJ-12']) {
  check(`нет ссылок у ${JSON.stringify(empty)}`, links(empty) === '[]');
}

// ── подробности событий ленты (CLAB-211) ───────────────────────────────────
// Строка подробностей — из payload, которое пишет движок. Незнакомый тип,
// пустой и неполный payload не роняют ленту и не печатают мусор.
console.log('подробности событий ленты');
const details = (type, payload) => eventDetails(type, payload, priorityLabel);
const junk = (s) => /undefined|null|\[object Object\]|NaN/.test(s);

const upd = details('task.updated', {
  fields: ['description', 'labels', 'priority', 'title'],
  changed: {
    title: {from: 'Старое название', to: 'Новое название'},
    priority: {from: 'normal', to: 'high'},
    labels: {from: ['ui', 'old'], to: ['ui', 'audit']},
    description: {from: 'было так', to: null},
  },
});
check('правка постановки: название было → стало', upd.summary.includes('название: «Старое название» → «Новое название»'), upd.summary);
check('правка постановки: приоритет подписью', upd.summary.includes('приоритет: обычный → высокий'), upd.summary);
check('правка постановки: метки добавлены и сняты', upd.summary.includes('метки: + audit · − old'), upd.summary);
check('правка постановки: описание — по раскрытию', upd.summary.includes('описание изменено') && upd.long.length === 1 && upd.long[0].from === 'было так' && upd.long[0].to === '', JSON.stringify(upd));
check('правка постановки: поля по порядку', upd.summary.indexOf('название') < upd.summary.indexOf('приоритет') && upd.summary.indexOf('приоритет') < upd.summary.indexOf('метки'), upd.summary);
check('правка постановки: без мусора', !junk(upd.summary), upd.summary);
const updOdd = details('task.updated', {changed: {title: {to: 'Только новое'}, estimate: {from: 1, to: 2}}});
check('правка без from — прочерк, незнакомое поле — ключом', updOdd.summary.includes('название: — → «Только новое»') && updOdd.summary.includes('estimate изменено') && !junk(updOdd.summary), updOdd.summary);

const scope = details('task.scope_updated', {
  added_repositories: ['acme/web'],
  removed_repositories: ['acme/api'],
  primary_repository: 'acme/web',
  multi_repo: false,
  note: 'API уехал в другую задачу',
});
for (const want of ['добавлено: acme/web', 'убрано: acme/api', 'основной: acme/web', 'multi_repo: нет', 'заметка: API уехал в другую задачу']) {
  check(`область: «${want}»`, scope.summary.includes(want), scope.summary);
}
const scopeAdd = details('task.scope_updated', {added_repositories: null, multi_repo: true, note: ''});
check('область: null и пустая заметка не печатаются', scopeAdd.summary === 'multi_repo: да', scopeAdd.summary);

check('отпуск этапа: заметка', details('stage.released', {note: 'жду ответа', attempt: 1, kind: 'stage'}).summary === 'заметка: жду ответа', details('stage.released', {note: 'жду ответа'}).summary);
check('отпуск этапа без заметки — пусто', details('stage.released', {note: ''}).summary === '');

for (const type of ['task.advanced', 'task.rejected', 'task.cancelled']) {
  const d = details(type, {transition: 'dev_done', from: 'development', to: 'testing', comment: 'готово'});
  check(`${type}: ключи статусов как пришли и комментарий`, d.summary === 'dev_done · development → testing · «готово»', d.summary);
}
check('переход без комментария', details('task.advanced', {transition: 'start', from: 'new', to: 'analysis'}).summary === 'start · new → analysis');

const failed = details('gate.failed', {transition: 'dev_done', gates: [{gate_key: 'artifacts', status: 'failed'}, {gate_key: 'pr', status: 'passed'}, {gate_key: 'ok', status: 'waived'}]});
check('гейт не пропустил: держащие гейты', failed.summary === 'dev_done · держат: artifacts', failed.summary);
check('решение по гейту', details('gate.decided', {gate: 'approve', transition: 'dev_done', status: 'passed'}).summary === 'approve · dev_done · passed');
check('PR привязан', details('repo_ref.linked', {repository: 'acme/web', ref_type: 'pull_request', ref: '12', state: 'open'}).summary === 'acme/web · pull_request 12 · open');
check('стоимость', details('usage.reported', {model: 'opus', cost_usd: 1.5}).summary === 'opus · 1.50 $');
check('артефакт', details('artifact.submitted', {kind: 'dev.change_summary', title: 'Разбор', version: 2}).summary === 'dev.change_summary · v2 · Разбор');

for (const [name, type, payload] of [
  ['без payload', 'task.updated', undefined],
  ['payload null', 'task.scope_updated', null],
  ['пустой payload', 'task.advanced', {}],
  ['payload не объект', 'gate.failed', 'строка'],
  ['changed не объект', 'task.updated', {changed: 'x'}],
  ['поле не объект', 'task.updated', {changed: {title: null, labels: {from: null, to: [{}]}}}],
  ['вложенный объект в скаляре', 'task.advanced', {from: {a: 1}, to: ['x'], comment: {}}],
  ['незнакомый тип', 'какой.то.новый', {a: 1}],
]) {
  let d;
  try { d = details(type, payload); } catch (e) { d = {summary: 'исключение ' + e.message, long: []}; }
  check(`${name}: не падает и без мусора`, typeof d.summary === 'string' && !junk(d.summary) && !d.summary.startsWith('исключение'), d.summary);
}
check('без подписи приоритета — ключ как есть', eventDetails('task.updated', {changed: {priority: {from: 'low', to: 'urgent'}}}).summary === 'приоритет: low → urgent');
check('раскрытие есть у непустого payload, в том числе незнакомого типа', hasPayload({a: 1}) && !hasPayload({}) && !hasPayload(null) && !hasPayload(undefined));

// ── подписи журнала действий (CLAB-211) ────────────────────────────────────
console.log('подписи журнала действий');
check('api — «личный»', tokenKindLabel('api') === 'личный');
check('session — «сессия»', tokenKindLabel('session') === 'сессия');
check('task — «токен задачи»', tokenKindLabel('task') === 'токен задачи');
check('незнакомый вид — сырым ключом', tokenKindLabel('robot') === 'robot');
check('null — «без токена»', tokenKindLabel(null) === 'без токена' && tokenKindLabel(undefined) === 'без токена');
check('токен задачи оформлен отлично от личного и сессии', tokenKindColor('task') !== tokenKindColor('api') && tokenKindColor('api') === tokenKindColor('session'));
check('незнакомый вид оформлен как обычный', tokenKindColor('robot') === 'default');
check('канал подписан', channelLabel('mcp') === 'MCP' && channelLabel('rest') === 'REST' && channelLabel('ws') === 'ws');
check('успех', outcomeLabel({ok: true, code: null, status: null}) === 'успех');
check('отказ REST — код и статус', outcomeLabel({ok: false, code: 'forbidden', status: 403}) === 'forbidden · 403', outcomeLabel({ok: false, code: 'forbidden', status: 403}));
check('отказ MCP — только код', outcomeLabel({ok: false, code: 'gates_not_satisfied', status: null}) === 'gates_not_satisfied');
check('отказ без кода — «ошибка»', outcomeLabel({ok: false, code: null, status: 500}) === 'ошибка · 500');
check('исхода нет — «неизвестно»', outcomeLabel(undefined) === 'неизвестно');
check('человек — только handle', principalLabel({handle: 'alice', kind: 'user'}) === 'alice');
check('агент — с видом', principalLabel({handle: 'runner', kind: 'agent'}) === 'runner (agent)');
check('принципала нет — «неизвестный»', principalLabel(null) === 'неизвестный');
check('токен — имя и префикс', tokenLabel({id: null, name: 'clab-runner', prefix: 'clab_abcd1234', kind: 'api'}) === 'clab-runner · clab_abcd1234');
check('токен без имени — префикс', tokenLabel({id: null, name: null, prefix: 'clab_x', kind: 'task'}) === 'clab_x');
check('без токена — пусто', tokenLabel(null) === '');

console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
