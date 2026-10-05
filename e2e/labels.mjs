// Словари подписей проверяются без браузера: у них важна не разметка, а то,
// что незнакомый ключ не теряется. Событие неизвестного типа появится на
// бэкенде раньше, чем подпись здесь, и лента обязана показать его как есть.
import {eventLabel} from '../src/components/task/events.ts';
import {priorityClass, priorityLabel} from '../src/components/priorities.ts';
import {
  appNotice,
  clockNote,
  failureSource,
  healthMarks,
  installationState,
  runState,
} from '../src/components/health.ts';

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

console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
