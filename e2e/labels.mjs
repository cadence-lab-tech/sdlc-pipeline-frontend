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
import {
  DISABLED_BY_DEFAULT_LABEL,
  OPTIONAL_LABEL,
  changedStages,
  cycleTargetNote,
  edgeLandingTitle,
  isUnavailable,
  landing,
  landingLines,
  notStartedNote,
  notStartedTitle,
  optionalBadges,
  optionalFields,
  optionalStatuses,
  skippedNotice,
  stageEnabled,
  stageLockHint,
  stageToggles,
  transitionTarget,
  unavailableReason,
} from '../src/components/optionalStage.ts';
import {externalLinks} from '../src/components/externalRef.ts';
import {
  AUTO_LABEL,
  MODEL_LEVELS,
  canEditTaskLevel,
  modelLevelLabel,
  needsProjectTeams,
  runModelLine,
} from '../src/components/modelLevel.ts';

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

// ── уровень модели (CLAB-262, решение 0060) ────────────────────────────────
// Строка прогона проверяется на всех строках таблицы AC-9 сразу: на стенде
// бывают не все сочетания снимка и учёта.
console.log('подписи уровня модели');
check('положения ползунка: авто, low, medium, high',
  [AUTO_LABEL, ...MODEL_LEVELS.map(modelLevelLabel)].join(',') === 'авто,low,medium,high',
  [AUTO_LABEL, ...MODEL_LEVELS.map(modelLevelLabel)].join(','));
check('null и пусто — «авто»', modelLevelLabel(null) === 'авто' && modelLevelLabel(undefined) === 'авто' && modelLevelLabel('') === 'авто');
check('незнакомый уровень показан ключом', modelLevelLabel('xhigh') === 'xhigh');

console.log('строка прогона «рекомендован · фактически»');
const usage = (models) => ({
  reported: models.length > 0, reports: models.length, models,
  input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_write_tokens: null, cost_usd: null, duration_ms: null,
});
const line = (run) => runModelLine(run);
for (const source of ['stage', 'task', 'role']) {
  check(`high из ${source} и одна модель`,
    line({model_level: 'high', model_level_source: source, usage: usage(['claude-opus-5-5'])}) === 'рекомендован high · фактически claude-opus-5-5',
    line({model_level: 'high', model_level_source: source, usage: usage(['claude-opus-5-5'])}));
}
check('источник none и нет отчёта',
  line({model_level_source: 'none', usage: usage([])}) === 'рекомендован: авто · фактически: нет данных',
  line({model_level_source: 'none', usage: usage([])}));
check('medium и две модели в порядке models',
  line({model_level: 'medium', model_level_source: 'task', usage: usage(['a', 'b'])}) === 'рекомендован medium · фактически a, b',
  line({model_level: 'medium', model_level_source: 'task', usage: usage(['a', 'b'])}));
check('снимка нет и нет отчёта — строки нет', line({usage: usage([])}) === null, String(line({usage: usage([])})));
check('снимка нет, отчёт есть — «фактически x»', line({usage: usage(['x'])}) === 'фактически x', line({usage: usage(['x'])}));
check('low без объекта usage — «рекомендован low»', line({model_level: 'low', model_level_source: 'role'}) === 'рекомендован low', line({model_level: 'low', model_level_source: 'role'}));
check('ни снимка, ни usage — строки нет', line({}) === null);
for (const s of ['рекомендован high · фактически claude-opus-5-5', line({model_level: 'low', model_level_source: 'stage'})]) {
  check(`в строке нет источника и стоимости: ${s}`, !/stage|task|role|\$|токен/.test(s), s);
}

console.log('право сдвинуть уровень задачи');
const person = (extra = {}) => ({
  mode: 'token', authenticated: true,
  principal: {handle: 'alice', kind: 'user', is_admin: false},
  memberships: [], teams: [], can_create_projects: false, ...extra,
});
const member = (role, project = 'SDLC') => ({project_key: project, role});
// Третий аргумент — состав команд проекта; null здесь — «не загрузился»
// (undefined в вызове), без аргумента — пустой состав.
const edit = (me, teams = [], ownerTeamKey) =>
  canEditTaskLevel({me, projectKey: 'SDLC', ownerTeamKey, projectTeams: teams === null ? undefined : teams});
check('viewer без команды — только чтение', edit(person({memberships: [member('viewer')]})) === false);
check('agent — только чтение', edit(person({memberships: [member('agent')]})) === false);
check('maintainer — можно', edit(person({memberships: [member('maintainer')]})) === true);
check('admin проекта — можно', edit(person({memberships: [member('admin')]})) === true);
check('maintainer другого проекта — только чтение', edit(person({memberships: [member('maintainer', 'OTHER')]})) === false);
check('администратор системы — можно', edit(person({principal: {handle: 'root', kind: 'user', is_admin: true}})) === true);
check('режим header — можно', edit(person({mode: 'header', authenticated: false})) === true);
check('кто я — неизвестно: решает сервер', edit(undefined) === true);
const inTeam = (team, role = 'member') => ({team_key: team, role});
const projectTeam = (team, level) => ({team_key: team, level});
check('maintainer через команду проекта — можно',
  edit(person({memberships: [member('viewer')], teams: [inTeam('web')]}), [projectTeam('web', 'maintainer')]) === true);
check('команда проекта с уровнем viewer — только чтение',
  edit(person({teams: [inTeam('web')]}), [projectTeam('web', 'viewer')]) === false);
check('чужая команда с уровнем maintainer — только чтение',
  edit(person({teams: [inTeam('web')]}), [projectTeam('ops', 'maintainer')]) === false);
check('лид команды-владельца — можно', edit(person({teams: [inTeam('acme', 'lead')]}), [], 'acme') === true);
check('рядовой команды-владельца — только чтение', edit(person({teams: [inTeam('acme')]}), [], 'acme') === false);
check('команды проекта не загрузились — решает сервер', edit(person({memberships: [member('viewer')]}), null) === true);
check('команды не нужны в режиме header и при прямом праве',
  !needsProjectTeams(person({mode: 'header'}), 'SDLC') && !needsProjectTeams(person({memberships: [member('maintainer')]}), 'SDLC') && !needsProjectTeams(undefined, 'SDLC'));
check('команды нужны наблюдателю', needsProjectTeams(person({memberships: [member('viewer')]}), 'SDLC'));

console.log('подписи необязательного этапа');
check('подписи отметки', OPTIONAL_LABEL === 'необязательный' && DISABLED_BY_DEFAULT_LABEL === 'выключен по умолчанию');
check('обязательный статус — без бейджей', optionalBadges({is_optional: false, enabled_by_default: true}).length === 0);
check('ответ без полей читается как обязательный', optionalBadges({}).length === 0);
check('необязательный включённый по умолчанию — один бейдж',
  optionalBadges({is_optional: true, enabled_by_default: true}).join(',') === 'необязательный');
check('необязательный, выключенный по умолчанию — два бейджа по порядку',
  optionalBadges({is_optional: true, enabled_by_default: false}).join(',') === 'необязательный,выключен по умолчанию');
check('умолчание «выключен» у обязательного бейджа не даёт',
  optionalBadges({is_optional: false, enabled_by_default: false}).length === 0);
check('отметка без умолчания в ответе — «включён»', optionalBadges({is_optional: true}).join(',') === 'необязательный');
let f = optionalFields(true, false);
check('необязательный выключенный уходит парой true/false', f.is_optional === true && f.enabled_by_default === false);
f = optionalFields(true, true);
check('необязательный включённый уходит парой true/true', f.is_optional === true && f.enabled_by_default === true);
f = optionalFields(false, false);
check('снятая отметка уходит с умолчанием «включён» (иначе сервер ответит 400)',
  f.is_optional === false && f.enabled_by_default === true);

console.log('выбор этапов у задачи (CLAB-318)');
const cyc = [
  {key: 'a', name: 'Альфа', position: 10},
  {key: 'c', name: 'Гамма', position: 30, is_optional: true, enabled_by_default: false},
  {key: 'b', name: 'Бета', position: 20, is_optional: true, enabled_by_default: true},
  {key: 'z', name: 'Омега', position: 40, is_terminal: true},
];
check('необязательные статусы — по position', optionalStatuses(cyc).map((s) => s.key).join() === 'b,c');
check('ответ без списка и без отметок — пусто', optionalStatuses(undefined).length === 0 && optionalStatuses([{key: 'a', name: 'A', position: 1}]).length === 0);
check('положение этапа: явный выбор главнее умолчания', stageEnabled(cyc[1], {c: true}, 'c') === true && stageEnabled(cyc[2], {b: false}, 'b') === false);
check('положение этапа: нет ключа — умолчание цикла', stageEnabled(cyc[1], {}, 'c') === false && stageEnabled(cyc[2], undefined, 'b') === true);
check('положение этапа: не bool в выборе читается как «нет выбора»', stageEnabled(cyc[1], {c: 'yes'}, 'c') === false);
check('обязательный статус всегда включён', stageEnabled(cyc[0], {a: false}, 'a') === true);
check('строки выбора: имя, порядок, умолчание',
  stageToggles(cyc).map((t) => `${t.key}:${t.name}:${t.value}`).join() === 'b:Бета:true,c:Гамма:false');
check('строки выбора: значение из выбора задачи', stageToggles(cyc, {b: false, c: true}).map((t) => t.value).join() === 'false,true');
check('цикл без необязательных — блока нет', stageToggles([cyc[0], cyc[3]]).length === 0);
const shown = stageToggles(cyc);
check('без правок поля в запросе нет', changedStages(shown, {}) === undefined);
check('правка до прежнего умолчания поля не даёт', changedStages(shown, {b: true, c: false}) === undefined);
check('уходят только изменённые ключи', JSON.stringify(changedStages(shown, {c: true, b: true})) === '{"c":true}');
check('ключ вне показанных не уходит', changedStages(shown, {q: true}) === undefined);
const task = {status_key: 'b'};
check('подсказка: этап идёт сейчас', stageLockHint('b', task, cyc) === 'этап идёт сейчас');
check('подсказка: другой этап переключается', stageLockHint('c', task, cyc) === undefined);
check('подсказка: задача закрыта (closed_at)', stageLockHint('c', {status_key: 'b', closed_at: '2026-10-29T00:00:00Z'}, cyc) === 'задача закрыта');
check('подсказка: терминальный статус — задача закрыта', stageLockHint('c', {status_key: 'z'}, cyc) === 'задача закрыта');
check('закрытость главнее «идёт сейчас»', stageLockHint('z', {status_key: 'z'}, cyc) === 'задача закрыта');

console.log('переход: назначение, пропуск, недоступность (CLAB-318)');
const t0 = {key: 'go', name: 'Дальше', to_status: 'b', allowed: true};
check('без полей назначение — to_status', landing(t0) === 'b' && transitionTarget(t0) === '→ b');
check('lands_in = to_status, пропусков нет — строка прежняя', transitionTarget({...t0, lands_in: 'b', skips: []}) === '→ b');
check('пропуск: фактическое назначение и список', transitionTarget({...t0, lands_in: 'z', skips: ['b', 'c']}) === '→ z (пропуск: b, c)');
check('пропуск: имена из версии цикла', transitionTarget({...t0, lands_in: 'z', skips: ['b']}, cyc) === '→ Омега (пропуск: Бета)');
check('недоступный: назначения нет', landing({...t0, lands_in: null}) === null && transitionTarget({...t0, lands_in: null}) === undefined);
check('цикловое назначение в подсказке, если отличается',
  cycleTargetNote({...t0, lands_in: 'z'}, cyc) === 'в цикле переход ведёт в Бета' && cycleTargetNote({...t0, lands_in: 'b'}, cyc) === undefined);
check('недоступен: причина «выключен» словами, кода нет',
  unavailableReason({to_status: 'c', unavailable: 'stage_disabled'}, cyc) === 'Этап Гамма выключен у задачи; включите его в «Деталях»');
check('недоступен: незнакомое значение — общий текст без значения',
  unavailableReason({to_status: 'c', unavailable: 'something_new'}, cyc) === 'Переход недоступен');
check('недоступен — только при allowed:false и причине',
  isUnavailable({allowed: false, unavailable: 'stage_disabled'}) && !isUnavailable({allowed: false}) && !isUnavailable({allowed: true, unavailable: 'x'}));
check('уведомление о пропуске', skippedNotice('Омега', ['b', 'c'], cyc) === 'Задача перешла в Омега, пропущено: Бета, Гамма');
check('без пропуска уведомления нет', skippedNotice('Омега', [], cyc) === undefined && skippedNotice('Омега', undefined, cyc) === undefined);
check('подпись ребра', edgeLandingTitle('Дальше', 'Альфа', 'Бета', ['b'], 'Омега', cyc) === 'Дальше: Альфа → Бета (пропуск: Бета; встанет в Омега)');
const lines = landingLines([
  {...t0, lands_in: 'z', skips: ['b']},
  {key: 'back', name: 'Назад', to_status: 'c', allowed: false, lands_in: null, skips: [], unavailable: 'stage_disabled'},
  {key: 'odd', name: 'Странный', to_status: 'c', allowed: false, unavailable: 'x'},
  {key: 'plain', name: 'Обычный', to_status: 'z', allowed: true, lands_in: 'z', skips: []},
], cyc);
check('строки под схемой: пропуск и недоступность, обычный переход без строки',
  lines.map((l) => l.text).join(' | ') === 'Дальше → Омега (пропуск: Бета) | Назад: недоступен: этап Гамма выключен | Странный: недоступен', lines.map((l) => l.text).join(' | '));
check('в строках нет кода причины', !lines.some((l) => /stage_disabled|optional_/.test(l.text)));
check('панель этапа: пропущен / выключен / ещё не начинался',
  notStartedTitle('skipped') === 'Этап пропущен' && notStartedTitle('disabled') === 'Этап выключен у задачи'
  && notStartedTitle('future') === 'Этап ещё не начинался' && notStartedTitle(undefined) === 'Этап ещё не начинался');
check('заметка панели есть только у пропущенного и выключенного', !!notStartedNote('skipped') && !!notStartedNote('disabled') && notStartedNote('future') === undefined);

console.log('события выбора этапов и пропуска (CLAB-318)');
check('stage.skipped подписано', eventLabel('stage.skipped') === 'этап пропущен');
check('stage.skipped: статус, обход, запрошенный переход',
  eventDetails('stage.skipped', {status: 'b', bypass_transition: 'skip_b', transition: 'go'}).summary === 'b · обход: skip_b · по переходу go');
check('stage.skipped без payload — пустая строка', eventDetails('stage.skipped', null).summary === '' && eventDetails('stage.skipped', {}).summary === '');
check('task.advanced с skips', eventDetails('task.advanced', {transition: 'go', from: 'a', to: 'z', skips: ['b', 'c']}).summary === 'go · a → z · пропущено: b, c');
check('task.advanced без skips — как раньше', eventDetails('task.advanced', {transition: 'go', from: 'a', to: 'b'}).summary === 'go · a → b');
check('task.advanced: skips не массив — без «пропущено»', !eventDetails('task.advanced', {transition: 'go', skips: 'b'}).summary.includes('пропущено'));
check('task.updated: этапы выкл → вкл',
  eventDetails('task.updated', {changed: {optional_stages: {from: {b: false, c: true}, to: {b: true, c: true}}}}).summary === 'этапы: b выкл → вкл');
check('task.updated: несколько ключей по алфавиту',
  eventDetails('task.updated', {changed: {optional_stages: {from: {b: true, c: false}, to: {b: false, c: true}}}}).summary === 'этапы: b вкл → выкл, c выкл → вкл');
check('task.updated: набор не объект — без мусора',
  !/undefined|object/.test(eventDetails('task.updated', {changed: {optional_stages: {from: 1, to: 'x'}}}).summary)
  && eventDetails('task.updated', {changed: {optional_stages: 5}}).summary === 'этапы: изменены');
check('task.updated: ключа не было раньше — «—»', eventDetails('task.updated', {changed: {optional_stages: {from: {}, to: {b: true}}}}).summary === 'этапы: b — → вкл');
check('task.workflow_moved: этапы при переезде',
  eventDetails('task.workflow_moved', {workflow: 'Simple', version: 2, optional_stages: {from: {b: false}, to: {b: true}}}).summary === 'Simple v2 · этапы: b выкл → вкл');
check('task.workflow_moved: optional_stages не объект — без мусора',
  eventDetails('task.workflow_moved', {workflow: 'Simple', optional_stages: 'x'}).summary === 'Simple');

console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
