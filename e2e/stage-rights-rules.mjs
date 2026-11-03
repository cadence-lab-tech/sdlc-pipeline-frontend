// Право этапа на карточке и в «Ждут меня» (CLAB-383, решение 0072) — без
// браузера: какие кнопки показать и какой текст поставить вместо них по полям
// ответа сервера (actor_may, actor_decisions, actor_may_decide, actor_deny,
// can_decide), пометка самоапрува в ленте, ответ сервера прежней версии,
// сопровождающий. Модули — чистые функции, проверяются прямо в исходниках.
// Ключи ролей и статусов в данных нарочно ни на что не похожи: правила не
// должны о них знать (ПР-3).
import {readFileSync, readdirSync, statSync} from 'node:fs';
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

const S = await import('../src/components/task/stageRights.ts');
const E = await import('../src/components/task/events.ts');
const M = await import('../src/components/taskrow/rules.ts');
const R = await import('../src/components/taskrow/reasons.ts');
const Z = await import('../src/components/overview/zones.ts');

let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};

const deny = (message, reason = 'not_stage_role') => ({code: 'forbidden', reason, message});
const gate = (over = {}) => ({
  gate_key: 'ok', gate_name: 'Апрув', type: 'human_approval', blocking: true, status: 'pending', ...over,
});
const transition = (over = {}) => ({
  key: 'ship', name: 'Выпустить', kind: 'advance', to_status: 'z', lands_in: 'z', skips: [], allowed: true, gates: [], ...over,
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── ПР-1: свой этап ──────────────────────────────────────────────────────────
console.log('карточка: свой этап');
let c = S.gateControl(gate({actor_may_decide: true, actor_decisions: ['passed', 'failed']}), true);
check('human_approval: «Апрув» и «Отклонить» по actor_decisions', c.approve && c.reject && c.deny === undefined);
c = S.gateControl(gate({actor_may_decide: true, actor_decisions: ['passed', 'failed', 'waived']}), true);
check('waived кнопки не получает (в карточке его нет)', c.approve && c.reject && !c.save);
c = S.gateControl(gate({actor_may_decide: true, actor_decisions: ['passed']}), true);
check('только passed — одна кнопка «Апрув»', c.approve && !c.reject);
c = S.gateControl(gate({actor_may_decide: true, actor_decisions: ['failed']}), true);
check('только failed — одна кнопка «Отклонить»', !c.approve && c.reject);
check('переход actor_may: true — кнопка есть', same(S.transitionControl(transition({actor_may: true})), {button: true}));
c = S.gateControl(gate({type: 'checklist', actor_may_decide: true, actor_decisions: ['passed']}), true);
check('чек-лист: «Сохранить отметки» по passed', c.save && c.deny === undefined);
c = S.gateControl(gate({status: 'passed', actor_may_decide: true, actor_decisions: ['passed', 'failed']}), true);
check('пройденный human_approval — кнопок нет', !c.approve && !c.reject && c.deny === undefined);

// ── ПР-2: чужой этап ─────────────────────────────────────────────────────────
console.log('карточка: чужой этап');
const msg = 'Этап «Разработка» ведёт роль developer; у вас её нет';
let t = S.transitionControl(transition({actor_may: false, actor_deny: deny(msg)}));
check('actor_may: false — кнопки нет, текст сервера дословно', t.button === false && t.deny === msg, JSON.stringify(t));
t = S.transitionControl(transition({kind: 'cancel', actor_may: false, actor_deny: deny('Отмена — решение сопровождающего', 'maintainer_only')}));
check('cancel — без кнопки, с текстом', t.button === false && t.deny === 'Отмена — решение сопровождающего');
c = S.gateControl(gate({actor_may_decide: false, actor_deny: deny(msg)}), true);
check('actor_may_decide: false — кнопок нет, текст сервера', !c.approve && !c.reject && c.deny === msg);
c = S.gateControl(gate({actor_may_decide: false, actor_decisions: ['passed'], actor_deny: deny(msg)}), true);
check('actor_may_decide: false сильнее списка вердиктов', !c.approve && !c.reject);
c = S.gateControl(gate({type: 'checklist', actor_may_decide: false, actor_deny: deny(msg)}), true);
check('чек-лист: без «Сохранить отметки», с текстом', !c.save && c.deny === msg);
c = S.gateControl(gate({type: 'artifacts_required', actor_may_decide: false, actor_deny: deny(msg)}), true);
check('гейт без ручного решения — без кнопок и без текста', !c.approve && !c.reject && !c.save && c.deny === undefined);
c = S.gateControl(gate({actor_may_decide: false, actor_deny: deny(msg)}), false);
check('нет обработчика решения — нет и кнопок', !c.approve && !c.reject && c.deny === undefined);
t = S.transitionControl(transition({actor_may: false}));
check('actor_may: false без actor_deny — кнопки нет, текст не выдумывается', t.button === false && t.deny === undefined);

// ── ПР-7: сервер прежней версии ──────────────────────────────────────────────
console.log('сервер прежней версии (поля права отсутствуют)');
check('переход без actor_may — кнопка как раньше', same(S.transitionControl(transition()), {button: true}));
c = S.gateControl(gate(), true);
check('human_approval без actor_decisions — обе кнопки', c.approve && c.reject && c.deny === undefined);
c = S.gateControl(gate({status: 'failed'}), true);
check('human_approval failed — кнопки как раньше (status !== passed)', c.approve && c.reject);
c = S.gateControl(gate({status: 'passed'}), true);
check('human_approval passed — без кнопок', !c.approve && !c.reject);
c = S.gateControl(gate({type: 'checklist'}), true);
check('чек-лист без actor_decisions — «Сохранить отметки»', c.save);
c = S.gateControl(gate({actor_decisions: 'oops'}), true);
check('испорченный actor_decisions — как нет поля', c.approve && c.reject);

// ── ПР-9: сопровождающий ─────────────────────────────────────────────────────
console.log('сопровождающий');
c = S.gateControl(gate({actor_may_decide: true, actor_decisions: ['passed', 'failed', 'waived']}), true);
check('все вердикты — те же кнопки, что и раньше', c.approve && c.reject && c.deny === undefined);
check('все переходы actor_may: true — кнопка', ['advance', 'reject', 'cancel'].every((kind) =>
  S.transitionControl(transition({kind, actor_may: true})).button));

// ── ПР-5: лента ──────────────────────────────────────────────────────────────
console.log('лента: самоапрув');
const decided = (extra = {}) => ({gate: 'human_approval', transition: 'ship', status: 'passed', ...extra});
let sum = E.eventDetails('gate.decided', decided({self_approval: true, self_basis: ['lease']}), undefined, 'ivan').summary;
check('self_approval: true — «решил X» и пометка', sum === 'human_approval · ship · passed · решил ivan, исполнитель этапа сам', sum);
sum = E.eventDetails('gate.decided', decided({self_approval: true})).summary;
check('self_approval: true без актора — только пометка', sum.endsWith('исполнитель этапа сам') && !sum.includes('решил'), sum);
sum = E.eventDetails('gate.decided', decided({self_approval: false, self_basis: []}), undefined, 'ivan').summary;
check('self_approval: false — пометки нет', sum === 'human_approval · ship · passed', sum);
sum = E.eventDetails('gate.decided', decided(), undefined, 'ivan').summary;
check('события без поля — как раньше', sum === 'human_approval · ship · passed', sum);
sum = E.eventDetails('gate.decided', decided({self_approval: 'true'}), undefined, 'ivan').summary;
check('не булево — не самоапрув', !sum.includes('сам'), sum);
check('на других событиях пометки нет', !E.eventDetails('task.advanced', {transition: 'go', self_approval: true}, undefined, 'ivan').summary.includes('сам'));
check('E.SELF_APPROVAL_LABEL', E.SELF_APPROVAL_LABEL === 'исполнитель этапа сам');

// ── ПР-4: «Ждут меня» ────────────────────────────────────────────────────────
console.log('«Ждут меня»: решение по строке');
check('rowCanDecide: нет записей — undefined', M.rowCanDecide([]) === undefined && M.rowCanDecide(undefined) === undefined);
check('rowCanDecide: записи без поля (старый сервер) — undefined', M.rowCanDecide([{transition_key: 'a'}]) === undefined);
check('rowCanDecide: есть true — true', M.rowCanDecide([{can_decide: false}, {can_decide: true}]) === true);
check('rowCanDecide: все false — false', M.rowCanDecide([{can_decide: false}, {can_decide: false}]) === false);

const NOW = Date.parse('2026-11-03T12:00:00Z');
const task = {
  id: 't1', key: 'CLAB-7', title: 'Задача', priority: 'normal', status_key: 'inbox', status_name: 'Входящие',
  workflow_id: 'wf-1', properties: {}, labels: [], repositories: [], blocked_by: [], current_run: null, cost: null,
  child_counts: {}, last_moved_at: '2026-11-03T11:00:00Z', awaiting_approval: true,
  attention: [{code: 'awaits_human', since: null, gates: [{transition: 'ship', gate: 'ok'}]}],
};
const version = {transitions: [{key: 'ship', name: 'Выпустить', gates: [{key: 'ok', name: 'Апрув владельца'}]}]};
const build = (approvals, canDecide = true) =>
  M.buildRowModel(task, {zone: 'decisions', now: NOW, version, canDecide, approvals});
let m = build([{transition_key: 'ship', can_decide: true}]);
check('can_decide: true — гейт названием, как раньше', m.primary.text === 'Апрув владельца · «Выпустить»', m.primary.text);
m = build([{transition_key: 'ship', can_decide: false}]);
check('can_decide: false — строка с причиной «решение сопровождающего»', m.primary.text === 'решение сопровождающего', m.primary.text);
m = build([{transition_key: 'ship', can_decide: false}], false);
check('верхний can_decide: false (наблюдатель) — прежний текст', m.primary.text === 'ждёт решения человека', m.primary.text);
m = build([{transition_key: 'ship'}]);
check('записи без can_decide — как раньше', m.primary.text === 'Апрув владельца · «Выпустить»', m.primary.text);
m = build([{transition_key: 'ship'}], false);
check('старый сервер и наблюдатель — как раньше', m.primary.text === 'ждёт решения человека');
m = build([{transition_key: 'ship', can_decide: false}, {transition_key: 'ship2', can_decide: true}]);
check('есть решаемая запись — строка решаемая', m.primary.text.startsWith('Апрув владельца'), m.primary.text);

const approval = (key, can_decide) => ({
  task: {key, title: 'T ' + key, type: 'task', priority: 'normal', workflow_id: 'wf-1', status_key: 'inbox', status_name: 'Входящие'},
  transition: {key: 'ship', name: 'Выпустить', to_status: 'z', lands_in: 'z', lands_in_name: 'Готово'},
  gate: {gate_key: 'ok', gate_name: 'Апрув', type: 'human_approval', blocking: true, status: 'pending'},
  stage_run: {id: 'r', attempt: 1, lease_held: false, latest_artifact_id: null},
  ...(can_decide === undefined ? {} : {can_decide}),
});
const rows = Z.decisionRows([approval('A-1', true), approval('A-2', false), approval('A-3')], []);
check('decisionRows несёт can_decide записи в подсказку строки',
  rows[0].approvals[0].can_decide === true && rows[1].approvals[0].can_decide === false && rows[2].approvals[0].can_decide === undefined);
check('строка без can_decide у записи — строка есть, как раньше', rows.length === 3 && rows[2].task.key === 'A-3');
check('RESTRICTED_TEXT', R.RESTRICTED_TEXT === 'решение сопровождающего');

// ── ПР-3: клиент не считает право ────────────────────────────────────────────
console.log('в коде нет сравнений роли и статуса');
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = `${dir}/${name}`;
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(name)) files.push(p);
  }
};
walk('src/components/task');
walk('src/components/taskrow');
files.push('src/components/Gates.tsx');
// Комментарии вырезаются: проверяется код, а не пояснения.
const code = (p) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const offenders = files.filter((p) => /role_keys|\.level\b|role_key\s*[=!]==|status_key\s*[=!]==\s*['"]/.test(code(p)));
check('ни роль участника, ни уровень доступа, ни статус по ключу не сравниваются', offenders.length === 0, offenders.join(', '));
const adHoc = files.filter((p) => /(canDecide|may)\s*=\s*[^;]*(maintainer|admin)/.test(code(p)));
check('право на «maintainer» и «admin» не выводится', adHoc.length === 0, adHoc.join(', '));

console.log(`\nпройдено ${ok}, упало ${fail}`);
process.exit(fail ? 1 : 0);
