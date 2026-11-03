// Правила предложений версий роли (CLAB-384, AC-9, AC-14) — без браузера и
// без живого бэкенда: права (кто предлагает, кто решает, кто отзывает),
// шапка роли, словарь состояний, номера #k, порядок и фильтр очереди,
// «Прочее» против последней версии, ответ сервера без полей. Здесь же —
// поиск ключей статусов и ролей и сырых цветов в модулях предложений.
//
// Ключи ниже нарочно не похожи на наши: правила не должны о них знать.
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

const P = await import('../src/components/pipeline/proposalRules.ts');

let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const PROJECT = 'ZZ';
const principal = (over = {}) => ({id: 'p-me', kind: 'user', handle: 'me', display_name: '', is_admin: false, created_at: '', ...over});
const member = (role, role_keys = null, project_key = PROJECT) => ({project_key, role, role_keys});
const meOf = (over = {}) => ({
  mode: 'token', authenticated: true, principal: principal(), memberships: [], teams: [], can_create_projects: false, ...over,
});
const rightsOf = (over = {}, teams = [], owner) =>
  P.computeRights({me: meOf(over), projectKey: PROJECT, ownerTeamKey: owner, projectTeams: teams});

// ── права ───────────────────────────────────────────────────────────────────
console.log('права: кто я');
check('me не загружен — права не известны', P.computeRights({me: undefined, projectKey: PROJECT, projectTeams: undefined}) === undefined);
check('режим header — права не известны (AC-14)', P.computeRights({me: meOf({mode: 'header'}), projectKey: PROJECT, projectTeams: undefined}) === undefined);
check('администратор системы — admin, любые роли', eq(rightsOf({principal: principal({is_admin: true})}), {level: 'admin', principalId: 'p-me', isHuman: true, roles: null}));
check('maintainer проекта', rightsOf({memberships: [member('maintainer')]}).level === 'maintainer');
check('участие в другом проекте не считается', rightsOf({memberships: [member('admin', null, 'OTHER')]}).level === 'none');
check('agent с role_keys null — любые роли', eq(rightsOf({memberships: [member('agent')]}).roles, null));
check('agent с набором — набор', eq(rightsOf({memberships: [member('agent', ['r1', 'r2'])]}).roles, ['r1', 'r2']));
check('agent с пустым набором — ни одной роли', eq(rightsOf({memberships: [member('agent', [])]}).roles, []));
check('viewer — набора ролей нет', eq(rightsOf({memberships: [member('viewer')]}).roles, []));
check('токен сужает набор', eq(rightsOf({memberships: [member('agent', ['r1', 'r2'])], token: {role_keys: ['r2', 'r9']}}).roles, ['r2']));
check('токен сужает «любые роли» до своих', eq(rightsOf({memberships: [member('agent')], token: {role_keys: ['r3']}}).roles, ['r3']));
check('пустой role_keys токена — без сужения', eq(rightsOf({memberships: [member('agent', ['r1'])], token: {role_keys: []}}).roles, ['r1']));
check('вид принципала запоминается', rightsOf({principal: principal({kind: 'agent'}), memberships: [member('maintainer')]}).isHuman === false);

console.log('права: команды проекта');
const team = (team_key, level, role_keys = null) => ({team_key, level, role_keys});
const inTeam = (team_key, role = 'member') => ({team_key, role});
check('команда нужна, если прямого maintainer нет', P.rightsNeedTeams(meOf({teams: [inTeam('t1')]}), PROJECT));
check('команда не нужна без команд у человека', !P.rightsNeedTeams(meOf({memberships: [member('agent')]}), PROJECT));
check('команда не нужна при прямом maintainer', !P.rightsNeedTeams(meOf({teams: [inTeam('t1')], memberships: [member('maintainer')]}), PROJECT));
check('команда не нужна администратору и в header', !P.rightsNeedTeams(meOf({teams: [inTeam('t1')], principal: principal({is_admin: true})}), PROJECT) && !P.rightsNeedTeams(meOf({mode: 'header', teams: [inTeam('t1')]}), PROJECT));
check('состав команд не загружен — права не известны', P.computeRights({me: meOf({teams: [inTeam('t1')]}), projectKey: PROJECT, projectTeams: undefined}) === undefined);
check('команда проекта даёт уровень', rightsOf({teams: [inTeam('t1')]}, [team('t1', 'maintainer')]).level === 'maintainer');
check('чужая команда проекта не считается', rightsOf({teams: [inTeam('t1')]}, [team('t2', 'maintainer')]).level === 'none');
check('максимум по путям', rightsOf({memberships: [member('agent', ['r1'])], teams: [inTeam('t1')]}, [team('t1', 'maintainer')]).level === 'maintainer');
check('роли — объединение путей уровня agent и выше', eq(rightsOf({memberships: [member('agent', ['r1'])], teams: [inTeam('t1')]}, [team('t1', 'agent', ['r2'])]).roles.sort(), ['r1', 'r2']));
check('путь с null — любая роль', eq(rightsOf({memberships: [member('agent', ['r1'])], teams: [inTeam('t1')]}, [team('t1', 'agent', null)]).roles, null));
check('путь viewer набор не расширяет', eq(rightsOf({memberships: [member('agent', ['r1'])], teams: [inTeam('t1')]}, [team('t1', 'viewer', ['r2'])]).roles, ['r1']));
check('лид команды-владельца — maintainer', rightsOf({teams: [inTeam('own', 'lead')]}, [], 'own').level === 'maintainer');

console.log('шапка роли (AC-1, AC-14)');
const R = {archived: false, hasVersions: true};
const agent = (keys) => rightsOf({memberships: [member('agent', keys)]});
check('права не известны — «Новая версия»', P.roleVersionAction(undefined, 'x', R).action === 'create');
check('maintainer — «Новая версия»', P.roleVersionAction(rightsOf({memberships: [member('maintainer')]}), 'x', R).action === 'create');
check('maintainer и архивная роль — «Новая версия», как раньше', P.roleVersionAction(rightsOf({memberships: [member('maintainer')]}), 'x', {archived: true, hasVersions: true}).action === 'create');
check('agent, набор null — «Предложить версию»', P.roleVersionAction(agent(null), 'x', R).action === 'propose');
check('agent, роль в наборе — «Предложить версию»', P.roleVersionAction(agent(['x', 'y']), 'x', R).action === 'propose');
const out = P.roleVersionAction(agent(['y']), 'x', R);
check('agent, роль вне набора — кнопок нет и строка', out.action === 'none' && out.note === 'Версию этой роли вы не предлагаете: она не в вашем наборе ролей', JSON.stringify(out));
check('agent, пустой набор — кнопок нет и строка', P.roleVersionAction(agent([]), 'x', R).note === P.NOT_IN_SET_NOTE);
check('agent и архивная роль — предложить нельзя', P.roleVersionAction(agent(null), 'x', {archived: true, hasVersions: true}).action === 'none');
const noVersions = P.roleVersionAction(agent(null), 'x', {archived: false, hasVersions: false});
check('agent и роль без версий — строка про первую версию', noVersions.action === 'none' && noVersions.note === 'У роли нет версий: первую заводит сопровождающий');
const viewer = P.roleVersionAction(rightsOf({memberships: [member('viewer')]}), 'x', R);
check('viewer — кнопок и строки нет', viewer.action === 'none' && viewer.note === undefined);
check('не участник — кнопок и строки нет', eq(P.roleVersionAction(rightsOf({}), 'x', R), {action: 'none'}));

console.log('решение и отзыв (AC-6, AC-7)');
const maint = rightsOf({memberships: [member('maintainer')]});
const agentRights = agent(null);
check('решает maintainer-человек', P.canDecide(maint));
check('агент-принципал уровня maintainer не решает', !P.canDecide(rightsOf({principal: principal({kind: 'agent'}), memberships: [member('maintainer')]})));
check('agent не решает', !P.canDecide(agentRights));
check('viewer не решает', !P.canDecide(rightsOf({memberships: [member('viewer')]})));
check('права не известны — кнопки решения показаны', P.canDecide(undefined));
check('автор отзывает своё', P.canWithdraw(agentRights, {created_by: 'p-me'}));
check('agent не отзывает чужое', !P.canWithdraw(agentRights, {created_by: 'other'}));
check('maintainer отзывает чужое', P.canWithdraw(maint, {created_by: 'other'}));
check('viewer не отзывает чужое', !P.canWithdraw(rightsOf({memberships: [member('viewer')]}), {created_by: 'other'}));
check('права не известны — «Отозвать…» показана', P.canWithdraw(undefined, {created_by: 'other'}));
check('свой автор — «вы»', P.authorLabel({created_by: 'p-me', created_by_handle: 'me'}, agentRights) === 'вы');
check('чужой автор — handle', P.authorLabel({created_by: 'o', created_by_handle: 'bot'}, agentRights) === 'bot');
check('права не известны — handle', P.authorLabel({created_by: 'p-me', created_by_handle: 'me'}, undefined) === 'me');

// ── состояния ───────────────────────────────────────────────────────────────
console.log('словарь состояний (AC-9)');
const prop = (over = {}) => ({id: 'a', state: 'pending', base_version: 3, created_at: '2026-01-01T00:00:00Z', created_by: 'x', created_by_handle: 'bot', changelog: 'c', ...over});
const lab = (p, latest) => P.proposalLabel(p, latest);
check('pending на последней — ожидает, синий', eq(lab(prop(), 3), {label: 'ожидает', color: 'blue'}));
check('pending на прежней — устарело, оранжевый', eq(lab(prop(), 5), {label: 'устарело', color: 'orange'}));
check('база больше последней читается как ожидает', lab(prop({base_version: 9}), 3).label === 'ожидает');
check('последняя версия не известна — ожидает', lab(prop(), undefined).label === 'ожидает');
check('approved с номером', eq(lab(prop({state: 'approved', result_version: 4}), 4), {label: 'утверждено · v4', color: 'green'}));
check('approved без номера', lab(prop({state: 'approved'}), 4).label === 'утверждено');
check('rejected — красный', eq(lab(prop({state: 'rejected'}), 4), {label: 'отклонено', color: 'red'}));
check('withdrawn — по умолчанию', eq(lab(prop({state: 'withdrawn'}), 4), {label: 'отозвано', color: 'default'}));
check('незнакомое состояние — ключ как есть', eq(lab(prop({state: 'frozen'}), 4), {label: 'frozen', color: 'default'}));
check('устаревает только pending', !P.isStale(prop({state: 'rejected'}), 9) && P.isStale(prop(), 9));
check('тексты устаревшего', P.staleTitle(6, 8) === 'Подано от v6, последняя v8; утвердить нельзя' && P.staleHint(8) === 'Отклоните предложение или попросите автора подать заново от v8.' && P.APPROVE_BLOCKED === 'Утвердить нельзя: база устарела');

// ── очередь ─────────────────────────────────────────────────────────────────
console.log('очередь: номера, порядок, фильтр');
const t = (n) => `2026-01-0${n}T00:00:00Z`;
const list = [
  prop({id: 'c', created_at: t(3)}),
  prop({id: 'a', created_at: t(1), state: 'rejected'}),
  prop({id: 'b', created_at: t(2), state: 'approved'}),
  prop({id: 'd', created_at: t(4), state: 'withdrawn'}),
];
const nums = P.proposalNumbers(list);
check('номер #k — по времени подачи', [...nums.entries()].map(([id, n]) => id + n).sort().join() === 'a1,b2,c3,d4');
check('номера не зависят от порядка в ответе', eq([...P.proposalNumbers([...list].reverse()).entries()].sort(), [...nums.entries()].sort()));
check('новые сверху', P.newestFirst(list).map((p) => p.id).join('') === 'dcba');
check('«Ожидают» — только pending', P.filterProposals(list, 'pending').map((p) => p.id).join('') === 'c');
check('«Все» — все, новые сверху', P.filterProposals(list, 'all').map((p) => p.id).join('') === 'dcba');
check('«Ожидают» включает устаревшие', P.filterProposals([prop({id: 'o', base_version: 1})], 'pending').length === 1);
check('заголовок с числом и без', P.sectionTitle(3) === 'Предложения (3)' && P.sectionTitle() === 'Предложения' && P.sectionTitle(0) === 'Предложения (0)');
const many = Array.from({length: 25}, (_, i) => prop({id: 'p' + String(i).padStart(2, '0'), created_at: `2026-02-${String(i + 1).padStart(2, '0')}T00:00:00Z`}));
const pg = P.pageProposals(P.filterProposals(many, 'all'), 'all');
check('«Все»: первые 10, остаток 15', pg.rows.length === 10 && pg.rest === 15);
check('«Показать ещё» добавляет десять', P.pageProposals(P.filterProposals(many, 'all'), 'all', 10).rows.length === 20);
check('«Ожидают» — целиком', P.pageProposals(P.filterProposals(many, 'pending'), 'pending').rows.length === 25);
check('пустой список', P.pageProposals([], 'all').rows.length === 0 && P.pageProposals([], 'all').rest === 0);

// ── «Прочее» ────────────────────────────────────────────────────────────────
console.log('«Прочее» против последней версии');
const version = (over = {}) => ({version: 4, input_kinds: ['k1'], output_contract: [{kind: 'o', title: 'T', format: 'markdown', required: true}], ...over});
check('одинаковое — пусто', eq(P.otherChanges(prop({input_kinds: ['k1'], output_contract: [{kind: 'o', title: 'T', format: 'markdown', required: true}]}), version()), []));
check('уровень модели: авто → high', eq(P.otherChanges(prop({input_kinds: ['k1'], output_contract: version().output_contract, model_level: 'high'}), version()), ['уровень модели: авто → high']));
check('уровень модели: medium → авто', eq(P.otherChanges(prop({input_kinds: ['k1'], output_contract: version().output_contract}), version({model_level: 'medium'})), ['уровень модели: medium → авто']));
check('контракт изменён', eq(P.otherChanges(prop({input_kinds: ['k1'], output_contract: []}), version()), ['контракт вывода изменён']));
check('вход изменён', eq(P.otherChanges(prop({input_kinds: ['k1', 'k2'], output_contract: version().output_contract}), version()), ['вход изменён']));
check('необязательные поля контракта не дают шума', eq(P.otherChanges(prop({input_kinds: [], output_contract: [{kind: 'o'}]}), version({input_kinds: [], output_contract: [{kind: 'o', title: '', format: '', required: false}]})), []));
check('tool_policy, repo_scope и бюджет не показываются', eq(P.otherChanges(prop({input_kinds: ['k1'], output_contract: version().output_contract, tool_policy: {a: 1}, repo_scope: ['r'], context_budget: {b: 2}}), version()), []));

console.log('ответ сервера без полей');
const n = P.normalizeProposal({id: 'x', state: 'pending', input_kinds: null, output_contract: null, documents: undefined, decided_by: null, decision_note: null, result_version: null});
check('массивы и объекты — пустые, null — без поля', eq(n.input_kinds, []) && eq(n.output_contract, []) && eq(n.documents, []) && eq(n.repo_scope, []) && eq(n.tool_policy, {}) && n.decided_by === undefined && n.decision_note === undefined && n.result_version === undefined);

// ── ключи и сырые цвета в модулях ───────────────────────────────────────────
console.log('ключей статусов и ролей, сырых цветов в модулях нет');
const files = ['proposalRules.ts', 'RoleProposals.tsx', 'ProposalNoteDialog.tsx'].map((f) => [f, readFileSync(new URL(`../src/components/pipeline/${f}`, import.meta.url), 'utf8')]);
files.push(['useRoleRights.ts', readFileSync(new URL('../src/hooks/useRoleRights.ts', import.meta.url), 'utf8')]);
// Ключи демонстрационного цикла, а не слова русского текста: по границе слова
// и в кавычках.
const KEYS = /['"`](analysis|development|testing|merge|release|new|done|analytics|designer|developer|test|integrator|analyst)['"`]/;
for (const [name, src] of files) {
  check(`${name}: ключей статусов и ролей нет`, !KEYS.test(src), (KEYS.exec(src) || [])[0]);
  check(`${name}: сырых цветов нет`, !/#[0-9a-fA-F]{3,8}\b|(?:text|bg|border)-(?:red|amber|emerald|blue|green|orange)-\d/.test(src));
}

console.log(`\n${ok} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
