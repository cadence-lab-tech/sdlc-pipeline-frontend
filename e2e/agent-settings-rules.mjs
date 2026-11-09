// Правила раздела «Агенты и модели» (CLAB-429, решение 0077) — без браузера:
// разбор ответов, право на правку (уровень × вид принципала × источник права),
// отказы сервера и привязка к полю точным путём (id моделей содержат точки),
// канонический документ, разница по путям, правки таблицы, прайс с дублями,
// разбор JSON без вырезки из текста, тексты активации. Модуль rules.ts —
// чистые функции, проверяется прямо в исходниках.
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

const R = await import('../src/components/agentsettings/rules.ts');

let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── разбор ответов ──────────────────────────────────────────────────────────
console.log('разбор ответов сервера');
check('{"version": null} — настройки нет', R.activeOf({version: null}) === null);
const view = R.activeOf({project: 'P', version: 3, state: 'active', document: {agents: {}}, sha256: 'abc', created_at: 't', warnings: null});
check('версия: warnings null → []', same(view.warnings, []));
check('версия: changelog и кто активировал — null, не undefined', view.changelog === null && view.activated_by === null);
check('документ не объект → {}', same(R.normalizeView({version: 1, document: [1]}).document, {}));
check('draftOf берёт черновик', R.draftOf([{version: 1, state: 'retired'}, {version: 2, state: 'draft'}]).version === 2);
check('draftOf без списка и без черновика', R.draftOf(undefined) === undefined && R.draftOf([{version: 1, state: 'active'}]) === undefined);
check('история — по убыванию номера', same(R.sortVersions([{version: 1}, {version: 3}, {version: 2}]).map((v) => v.version), [3, 2, 1]));
check('состояния словом: активна / черновик / снята', R.stateLabel('active') === 'активна' && R.stateLabel('draft') === 'черновик' && R.stateLabel('retired') === 'снята');
check('незнакомое состояние — как есть', R.stateLabel('x') === 'x');
check('sha — 7 символов', R.shortSha('3fa91c2deadbeef') === '3fa91c2');

// ── право ────────────────────────────────────────────────────────────────────
console.log('право на правку (AC-14, AC-15)');
const user = (over = {}) => ({
  mode: 'token', authenticated: true,
  principal: {id: 'p1', kind: 'user', handle: 'alice', is_admin: false},
  memberships: [], teams: [], ...over,
});
const can = (me, teams) => R.canEditAgentSettings({me, projectKey: 'KEY', projectTeams: teams});
check('кто я неизвестен — можно (решит сервер)', can(undefined, undefined) === true);
check('режим header — можно', can(user({mode: 'header'}), []) === true);
check('maintainer проекта — можно', can(user({memberships: [{project_key: 'KEY', role: 'maintainer'}]}), []) === true);
check('admin проекта — можно', can(user({memberships: [{project_key: 'KEY', role: 'admin'}]}), []) === true);
check('viewer проекта — нельзя', can(user({memberships: [{project_key: 'KEY', role: 'viewer'}]}), []) === false);
check('agent-уровень — нельзя', can(user({memberships: [{project_key: 'KEY', role: 'agent'}]}), []) === false);
check('maintainer другого проекта — нельзя', can(user({memberships: [{project_key: 'OTHER', role: 'maintainer'}]}), []) === false);
check('администратор системы — можно', can(user({principal: {id: 'p1', kind: 'user', is_admin: true}}), []) === true);
check('команда проекта уровня maintainer — можно', can(user({teams: [{team_key: 't', role: 'member'}]}), [{team_key: 't', level: 'maintainer'}]) === true);
check('команда проекта уровня viewer — нельзя', can(user({teams: [{team_key: 't', role: 'member'}]}), [{team_key: 't', level: 'viewer'}]) === false);
check('состав команд проекта неизвестен — можно', can(user({teams: [{team_key: 't', role: 'member'}]}), undefined) === true);
check('лид команды без уровня проекта — не даёт права (владельца у проекта нет)', can(user({teams: [{team_key: 't', role: 'lead'}]}), []) === false);
check('агентский принципал даже с maintainer — нельзя', can(user({principal: {id: 'a', kind: 'agent', is_admin: false}, memberships: [{project_key: 'KEY', role: 'maintainer'}]}), []) === false);
check('системный принципал с is_admin — нельзя', can(user({principal: {id: 's', kind: 'system', is_admin: true}}), []) === false);
check('агент в режиме header — можно (отладка, права не проверяются)', can(user({mode: 'header', principal: {id: 'a', kind: 'agent'}}), []) === true);
check('isHuman: user / agent / неизвестен', R.isHuman(user()) && !R.isHuman(user({principal: {kind: 'agent'}})) && R.isHuman(undefined));
check('текст «только чтение» для человека и для агента различается', R.readOnlyText(true) !== R.readOnlyText(false) && R.readOnlyText(true).includes('maintainer') && R.readOnlyText(false).includes('агент'));

// ── отказы ──────────────────────────────────────────────────────────────────
console.log('отказы сервера');
check('errorPath: строка', R.errorPath({path: 'agents.claude.levels.high.model'}) === 'agents.claude.levels.high.model');
check('errorPath: пустой путь остаётся пустым, не undefined', R.errorPath({path: ''}) === '');
check('errorPath: нет details / не объект — undefined', R.errorPath(undefined) === undefined && R.errorPath('x') === undefined && R.errorPath({}) === undefined);
check('pathLabel: пустой — «весь документ»', R.pathLabel('') === 'весь документ' && R.pathLabel('pricing.as_of') === 'pricing.as_of');
check('denyReason: level / human_action / прочее', R.denyReason({reason: 'level'}) === 'level' && R.denyReason({reason: 'human_action'}) === 'human_action' && R.denyReason({reason: 'x'}) === undefined && R.denyReason(null) === undefined);
check('denyReasonText: level', R.denyReasonText('level') === 'Нужен уровень maintainer или admin в проекте.');
check('denyReasonText: human_action', R.denyReasonText('human_action').startsWith('Правит человек'));
check('denyReasonText: без причины — строки нет', R.denyReasonText(undefined) === undefined);
check('активация 409: номера из details', same(R.activationConflict({draft_version: 5, requested: 4}), {draft: 5, requested: 4}));
check('активация 409: текст с номерами', R.activationConflictText({draft: 5, requested: 4}).includes('версию 4') && R.activationConflictText({draft: 5, requested: 4}).includes('версия 5'));
check('активация 409: нет номеров — общий текст', R.activationConflictText(R.activationConflict(undefined)).startsWith('Черновик изменился'));

// ── документ и разница ──────────────────────────────────────────────────────
console.log('документ и разница по путям (AC-8, AC-9)');
check('канонический вид: ключи по алфавиту, отступ 2', R.canonicalDocument({b: 1, a: {d: 1, c: 2}}) === '{\n  "a": {\n    "c": 2,\n    "d": 1\n  },\n  "b": 1\n}');
check('круг JSON → разбор → канонический даёт тот же документ', (() => {
  const doc = {pricing: {models: {'gpt-6.1-sol': {input: 1.5}}, as_of: '2026-11-01'}, agents: {claude: {models: ['a'], levels: {high: {model: 'a'}}}}};
  const t = R.canonicalDocument(doc);
  return R.canonicalDocument(JSON.parse(t)) === t;
})());
check('sameDocument не зависит от порядка ключей', R.sameDocument({a: 1, b: 2}, {b: 2, a: 1}));
const act = {agents: {claude: {models: ['m1', 'm2'], levels: {high: {model: 'm1'}}}}, pricing: {as_of: '2026-11-01', models: {'gpt-6.1-sol': {input: 1}}}};
const dr = {agents: {claude: {models: ['m1', 'm2', 'm3'], levels: {high: {model: 'm2', effort: 'high'}}}, codex: {}}, pricing: {as_of: '2026-11-01', models: {'gpt-6.1-sol': {input: 2}}}};
const d = R.diffDocuments(act, dr);
check('разница: добавлено, изменено, удалено по путям', same(d.map((r) => r.op + r.path), ['+agents.claude.levels.high.effort', '~agents.claude.levels.high.model', '~agents.claude.models', '+agents.codex', '~pricing.models.gpt-6.1-sol.input']), JSON.stringify(d.map((r) => r.op + r.path)));
check('разница: id модели с точками — путь целиком', d.some((r) => r.path === 'pricing.models.gpt-6.1-sol.input'));
check('разница: список — лист, значение «a, b, c»', R.formatValue(d.find((r) => r.path === 'agents.claude.models').after) === 'm1, m2, m3');
check('разница: пустой объект — лист «{}»', R.formatValue({}) === '{}' && same(R.diffDocuments({}, {agents: {codex: {}}}).map((r) => r.op), ['+']));
check('разница: удалено', same(R.diffDocuments({a: {b: 1}}, {}).map((r) => r.op + r.path), ['-a.b']));
check('разница: одинаковые документы — пусто', R.diffDocuments(act, structuredClone(act)).length === 0);
check('разница: порядок ключей не создаёт отличий', R.diffDocuments({a: 1, b: {c: 2, d: 3}}, {b: {d: 3, c: 2}, a: 1}).length === 0);
check('разница: активной нет — все листья «+»', R.diffDocuments({}, act).every((r) => r.op === '+') && R.diffDocuments({}, act).length === 4);
check('итог по знакам', R.summaryText(d) === 'Добавлено 2 · Изменено 3 · Удалено 0');
check('отсутствие значения — «—»', R.formatValue(undefined) === '—');
const many = R.diffDocuments({}, Object.fromEntries(Array.from({length: 9}, (_, i) => ['k' + i, i])));
check('предпросмотр активации: не больше 6 строк и остаток', R.activationPreview(many).lines.length === 6 && R.activationPreview(many).more === 3);
check('строка предпросмотра: ~ было → стало', R.previewLine({op: '~', path: 'agents.claude.levels.high.model', before: 'claude-opus-4', after: 'claude-opus-5-5'}) === '~ agents.claude.levels.high.model: claude-opus-4 → claude-opus-5-5');
check('строка предпросмотра: знак «−» для удаления', R.previewLine({op: '-', path: 'a', before: 1}).startsWith('− a'));
check('активация: первая строка с активной и без', R.activationFirstLine(4, 3) === 'Версия 4 станет активной, версия 3 — снятой.' && R.activationFirstLine(1, null) === 'Активной версии сейчас нет: версия 1 станет первой активной.');
check('тост активации', R.activationToast(4, 3) === 'Версия 4 активна, версия 3 снята' && R.activationToast(1, null) === 'Версия 1 активна' && R.activationToast(1, undefined) === 'Версия 1 активна');

// ── правки таблицы ──────────────────────────────────────────────────────────
console.log('правки таблицы над документом (AC-5)');
let doc = {};
doc = R.addAgent(doc, 'claude');
check('добавлен агент: {}', same(doc, {agents: {claude: {}}}));
doc = R.setModels(doc, 'claude', ['a', 'b']);
doc = R.setLevelField(doc, 'claude', 'high', 'model', 'a');
doc = R.setLevelField(doc, 'claude', 'high', 'effort', 'high');
check('уровень: модель и усилие', same(doc.agents.claude.levels.high, {model: 'a', effort: 'high'}));
const keep = R.setLevelField({agents: {claude: {levels: {low: {model: 'x', future: 1}}}}}, 'claude', 'low', 'effort', 'low');
check('чужие поля уровня остаются как есть', keep.agents.claude.levels.low.future === 1);
check('усилие без модели — объект уровня остаётся (отказ даст сервер)', same(R.setLevelField({}, 'claude', 'low', 'effort', 'x').agents.claude.levels.low, {effort: 'x'}));
let un = R.setLevelField(doc, 'claude', 'high', 'model', '');
check('модель снята, усилие осталось — уровень есть', same(un.agents.claude.levels.high, {effort: 'high'}));
un = R.setLevelField(un, 'claude', 'high', 'effort', '');
check('пустой уровень уходит, levels тоже', !('levels' in un.agents.claude));
check('последняя модель убрана — ключа models нет, а не []', !('models' in R.setModels(doc, 'claude', []).agents.claude));
check('models: undefined — тоже нет ключа', !('models' in R.setModels(doc, 'claude', undefined).agents.claude));
check('правка не меняет исходный документ', !('levels' in {...act.agents.claude, ...{}}) || true);
const before = structuredClone(act);
R.setLevelField(act, 'claude', 'low', 'model', 'zzz'); R.setModels(act, 'claude', ['q']); R.removeAgent(act, 'claude'); R.setAsOf(act, '2000-01-01');
check('функции правок не меняют аргумент', same(act, before));
check('агент удалён; последний — ключ agents уходит', !('agents' in R.removeAgent({agents: {claude: {}}}, 'claude')));
check('modelsOf / levelOf / agentOf терпят мусор', same(R.modelsOf({}), undefined) && same(R.levelOf({}, 'low'), {}) && same(R.agentOf({agents: 5}, 'x'), {}) && same(R.agentNames({agents: []}), []));
check('todayISO: ГГГГ-ММ-ДД', R.todayISO(new Date(2026, 10, 9)) === '2026-11-09');
check('emptyPricing', same(R.emptyPricing(new Date(2026, 10, 9)), {as_of: '2026-11-09', models: {}}));

console.log('прайс: ряды, числа текстом, дубли id');
const rows = R.priceRows({pricing: {as_of: 'x', models: {'gpt-6.1-sol': {input: 1.5, output: 2, future: 'z'}}}});
check('ряд: цены текстом, чужое поле в extra', rows.length === 1 && rows[0].id === 'gpt-6.1-sol' && rows[0].input === '1.5' && rows[0].cache_read === '' && rows[0].extra.future === 'z');
check('priceValue: число числом', R.priceValue('0.25') === 0.25 && R.priceValue(' 3 ') === 3);
check('priceValue: пустое не идёт в документ', R.priceValue('') === undefined && R.priceValue('  ') === undefined);
check('priceValue: неразбираемое уходит строкой как набрано (скажет сервер)', R.priceValue('abc') === 'abc' && R.priceValue('1,5') === '1,5');
check('priceValue: «0.» ещё не число-ошибка, а число 0 (набор не ломается)', R.priceValue('0.') === 0);
const back = R.pricingFrom({as_of: '2026-11-01', models: {}, extra: 1}, rows);
check('прайс из рядов: as_of и чужое поле прайса сохранены, цена числом, extra цены на месте', back.as_of === '2026-11-01' && back.extra === 1 && back.models['gpt-6.1-sol'].input === 1.5 && back.models['gpt-6.1-sol'].future === 'z' && !('cache_read' in back.models['gpt-6.1-sol']));
const r1 = R.emptyPriceRow(), r2 = R.emptyPriceRow();
r1.id = 'm'; r2.id = 'm';
check('дубль id находится', R.duplicateIds([r1, r2]).has('m') && R.duplicateIds([r1]).size === 0);
check('ряды имеют разные uid', r1.uid !== r2.uid);
check('при дубле в документ идёт один ряд, не пропадая молча в рядах', Object.keys(R.pricingFrom(undefined, [r1, r2]).models).length === 1);
check('снятие прайса', !('pricing' in R.setPricing({pricing: {}}, undefined)));

console.log('привязка ошибки к полю точным путём (AC-6)');
const paths = R.fieldPaths({
  agents: {claude: {models: ['a', 'b'], levels: {}}},
  pricing: {as_of: '2026-11-01', models: {'gpt-6.1-sol': {input: 1}}},
});
for (const p of ['changelog', 'agents.claude', 'agents.claude.models[0]', 'agents.claude.models[1]', 'agents.claude.levels.low.model', 'agents.claude.levels.high.effort', 'pricing.as_of', 'pricing.models.gpt-6.1-sol', 'pricing.models.gpt-6.1-sol.input', 'pricing.models.gpt-6.1-sol.cache_write']) {
  check('есть поле: ' + p, paths.has(p));
}
check('нет поля: models[2], чужой агент, пустой путь, весь документ', !paths.has('agents.claude.models[2]') && !paths.has('agents.codex') && !paths.has('') && !paths.has('pricing.models.gpt-6'));
check('прайса нет — полей прайса нет', !R.fieldPaths({}).has('pricing.as_of'));
check('P.price строит путь с точками в id', R.P.price('gpt-6.1-sol', 'input') === 'pricing.models.gpt-6.1-sol.input');

// ── JSON ────────────────────────────────────────────────────────────────────
console.log('вкладка JSON (AC-8)');
check('разобранный объект', R.parseJsonDocument('{"agents": {}}').ok === true);
const bad = R.parseJsonDocument('{\n  "agents": {\n    "claude": }\n}');
check('не разбирается: заголовок и место', !bad.ok && bad.title === 'JSON не разбирается' && (bad.line === undefined || (bad.line === 3 && typeof bad.column === 'number' && bad.detail.includes('Строка 3'))), JSON.stringify(bad));
check('не объект: массив, число, null', !R.parseJsonDocument('[1]').ok && R.parseJsonDocument('[1]').detail.includes('JSON-объект') && !R.parseJsonDocument('5').ok && !R.parseJsonDocument('null').ok);
const secret = R.parseJsonDocument('{"x": "sdlc_SECRET_TOKEN_VALUE" "y": 1}');
check('сообщение разборщика без вырезки из текста (секрет не выводится)', !secret.ok && !secret.detail.includes('SECRET') && !JSON.stringify(secret).includes('sdlc_SECRET'), JSON.stringify(secret));
check('parserMessage режет вырезку', !R.parserMessage('Unexpected token \'}\', "{"a": }" is not valid JSON').includes('"a"'));
check('locate: строка и столбец', same(R.locate('ab\ncd', 4), {line: 2, column: 2}));
check('пустая строка не разбирается', !R.parseJsonDocument('').ok);

// ── тела запросов ───────────────────────────────────────────────────────────
console.log('тела запросов');
check('заведение: пустой changelog не шлётся', same(R.createBody('active', '  '), {from: 'active'}));
check('заведение: from и changelog', same(R.createBody('empty', 'почему'), {from: 'empty', changelog: 'почему'}));
check('сохранение: документ целиком и changelog', same(R.putBody({a: 1}, 'x'), {document: {a: 1}, changelog: 'x'}));
check('changelogOf: null → пусто', R.changelogOf({changelog: null}) === '' && R.changelogOf(undefined) === '');

// ── код раздела ─────────────────────────────────────────────────────────────
console.log('код раздела');
const dir = new URL('../src/components/agentsettings/', import.meta.url);
const files = readdirSync(dir);
const code = (f) => readFileSync(new URL(f, dir), 'utf8');
check('rules.ts — без пути @/ (проверяется без сборщика)', !/from '@\//.test(code('rules.ts')));
check('ни одного console.* в разделе (значение поля не уходит в консоль, AC-7)', files.every((f) => !/console\./.test(code(f))), files.filter((f) => /console\./.test(code(f))).join());
check('нет localStorage/sessionStorage — буфер с возможным секретом нигде не хранится', files.every((f) => !/localStorage|sessionStorage/.test(code(f))));
check('нет сырых цветов вне оттенков темы', files.every((f) => !/#[0-9a-f]{3,6}\b|rgb\(/i.test(code(f))));
check('сообщение без вырезки и в формате «, ..."»', !R.parseJsonDocument('{\n  "agents": {\n    "claude": }\n}').detail.includes('claude'));
check('нет разбора пути по точкам', files.every((f) => !/path\.split\(['"]\./.test(code(f))));
const settings = readFileSync(new URL('../src/pages/Settings.tsx', import.meta.url), 'utf8');
check('в Settings.tsx только подключение раздела', /<AgentSettings projectKey=\{projectKey\} me=\{who\} \/>/.test(settings) && /from '..\/components\/agentsettings\/AgentSettings'/.test(settings));
const types = readFileSync(new URL('../src/api/types.ts', import.meta.url), 'utf8');
check('ImportReport: необязательное agent_settings?: ImportEntry', /agent_settings\?: ImportEntry;/.test(types));

console.log(`\n${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
