// Право на карточку и «Пайплайн» (CLAB-409, решение 0072, п. 9) — без браузера:
// правка постановки, выбор этапов, исполнитель, свойства и область по
// actor_rights, текст отказа дословно, «Снять предел» по actor_decisions,
// кнопки правки цикла на «Пайплайне», сервер прежней версии. Модули — чистые
// функции, проверяются прямо в исходниках. Ключи статусов и ролей в данных
// нарочно ни на что не похожи: правила не должны о них знать.
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

const T = await import('../src/components/task/taskRights.ts');
const S = await import('../src/components/task/stageRights.ts');
const C = await import('../src/components/pipeline/cycleRights.ts');

let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const deny = (message, reason = 'not_allowed') => ({code: 'forbidden', reason, message});
const gate = (over = {}) => ({
  gate_key: 'lim', gate_name: 'Предел', type: 'some_limit', blocking: true, status: 'failed', ...over,
});

// ── K-1…K-3: право на карточку ───────────────────────────────────────────────
console.log('сотрудник: всё разрешено сервером');
const all = {edit: true, stage_choice: true, create_child: true, assign: true, link: true, scope: true};
check('edit: true — правка открыта, даже если запасное значение «нельзя»', T.rightOf(all, 'edit', false) === true);
check('stage_choice: true — выбор этапов открыт', T.rightOf(all, 'stage_choice', false) === true);
check('assign: true', T.rightOf(all, 'assign', false) === true);
check('scope: true', T.rightOf(all, 'scope', false) === true);
check('причины нет, когда разрешено', T.denyOf(all, 'edit') === undefined);

console.log('наблюдатель: сервер запретил, причина — его текст дословно');
const MSG = 'Наблюдатель только читает задачи (e2e-текст сервера)';
const MSG2 = 'Задача закрыта: этапы не выбирают (e2e-текст сервера)';
const ro = {
  edit: false, stage_choice: false, create_child: false, assign: false, link: false, scope: false,
  actor_deny: {edit: deny(MSG, 'viewer'), stage_choice: deny(MSG2, 'task_closed'), assign: deny(MSG, 'viewer')},
};
check('edit: false — правка закрыта вопреки запасному «можно»', T.rightOf(ro, 'edit', true) === false);
check('stage_choice: false', T.rightOf(ro, 'stage_choice', true) === false);
check('assign: false, scope: false', T.rightOf(ro, 'assign', true) === false && T.rightOf(ro, 'scope', true) === false);
check('denyOf: текст сервера дословно', T.denyOf(ro, 'edit') === MSG && T.denyOf(ro, 'stage_choice') === MSG2);
check('reasonOf с правом: текст сервера, не прежний', T.reasonOf(ro, 'edit', 'прежний текст') === MSG);
check('reasonOf с правом, но без текста по действию — ничего, своего текста нет', T.reasonOf(ro, 'scope', 'прежний текст') === undefined);

console.log('закрытая задача: правка постановки открыта, выбор этапов нет');
const closed = {edit: true, stage_choice: false, create_child: false, assign: true, link: true, scope: true, actor_deny: {stage_choice: deny(MSG2, 'task_closed')}};
check('edit: true, stage_choice: false независимо',
  T.rightOf(closed, 'edit', false) === true && T.rightOf(closed, 'stage_choice', true) === false);
check('причина выбора этапов — текст сервера', T.reasonOf(closed, 'stage_choice', 'прежний') === MSG2);

// ── K-8: сервер прежней версии ───────────────────────────────────────────────
console.log('сервер прежней версии (actor_rights нет)');
check('rightOf без объекта — запасное значение true', T.rightOf(undefined, 'edit', true) === true);
check('rightOf без объекта — запасное значение false', T.rightOf(undefined, 'stage_choice', false) === false);
check('rightOf на пустом объекте — запасное значение', T.rightOf({}, 'assign', true) === true && T.rightOf({}, 'scope', false) === false);
check('испорченное (не булево) поле — запасное значение', T.rightOf({edit: 'yes'}, 'edit', false) === false);
check('denyOf без объекта — undefined', T.denyOf(undefined, 'edit') === undefined);
check('reasonOf без объекта — прежний текст', T.reasonOf(undefined, 'stage_choice', 'прежний текст') === 'прежний текст');
check('denyOf: пустой текст — как без текста', T.denyOf({actor_deny: {edit: deny('')}}, 'edit') === undefined);

// ── K-4: «Снять предел» ──────────────────────────────────────────────────────
console.log('«Снять предел»');
check('предел: [waived], гейт не пройден — кнопка',
  same(S.waiveControl(gate({actor_may_decide: true, actor_decisions: ['waived']}), true), {button: true}));
check('статус pending — кнопка', S.waiveControl(gate({status: 'pending', actor_may_decide: true, actor_decisions: ['waived']}), true).button);
check('статус failed — кнопка', S.waiveControl(gate({status: 'failed', actor_decisions: ['waived']}), true).button);
check('статус passed — кнопки нет', !S.waiveControl(gate({status: 'passed', actor_decisions: ['waived']}), true).button);
check('статус waived — кнопки нет', !S.waiveControl(gate({status: 'waived', actor_decisions: ['waived']}), true).button);
check('статус skipped — кнопки нет', !S.waiveControl(gate({status: 'skipped', actor_decisions: ['waived']}), true).button);
check('нет waived в actor_decisions — кнопки нет', !S.waiveControl(gate({actor_decisions: ['passed', 'failed']}), true).button);
check('пустой actor_decisions — кнопки нет', !S.waiveControl(gate({actor_decisions: []}), true).button);
check('actor_may_decide: false сильнее списка', !S.waiveControl(gate({actor_may_decide: false, actor_decisions: ['waived'], actor_deny: deny(MSG)}), true).button);
check('нет обработчика решения — кнопки нет', !S.waiveControl(gate({actor_decisions: ['waived']}), false).button);
check('сервер прежней версии (нет actor_decisions) — кнопки нет', !S.waiveControl(gate(), true).button);
check('испорченный actor_decisions — кнопки нет', !S.waiveControl(gate({actor_decisions: 'waived'}), true).button);
check('waived вместе с passed и failed (апрув, чек-лист) — не предел, кнопки нет',
  !S.waiveControl(gate({type: 'human_approval', actor_decisions: ['passed', 'failed', 'waived']}), true).button);
check('тип гейта на решение не влияет',
  ['attempts_limit', 'stage_time_limit', 'agent_review', 'тип-из-будущего'].every((type) =>
    S.waiveControl(gate({type, actor_decisions: ['waived']}), true).button));
const approve = S.gateControl(gate({type: 'human_approval', status: 'pending', actor_may_decide: true, actor_decisions: ['passed', 'failed']}), true);
check('апрув и отклонение — по-прежнему по gateControl', approve.approve && approve.reject);
const limit = S.gateControl(gate({actor_may_decide: true, actor_decisions: ['waived']}), true);
check('gateControl у предела не меняется: кнопок апрува нет', !limit.approve && !limit.reject && !limit.save);

// ── K-6: «Пайплайн» ──────────────────────────────────────────────────────────
console.log('«Пайплайн»: правка цикла');
let ctl = C.cycleControls(true, false);
check('черновик, права нет — холст не правится, кнопки неактивны, есть пояснение',
  ctl.editable === false && ctl.locked === true && ctl.hint === 'цикл правит сопровождающий проекта', JSON.stringify(ctl));
ctl = C.cycleControls(true, true);
check('черновик, право есть — правится, пояснения нет', ctl.editable && !ctl.locked && ctl.hint === undefined, JSON.stringify(ctl));
ctl = C.cycleControls(false, true);
check('активная версия, право есть — не правится, кнопки не заблокированы (копия в черновик)', !ctl.editable && !ctl.locked && ctl.hint === undefined);
ctl = C.cycleControls(false, false);
check('активная версия, права нет — «черновик копией» неактивна, пояснение есть', !ctl.editable && ctl.locked && ctl.hint === C.CYCLE_READONLY_HINT);
check('текст пояснения', C.CYCLE_READONLY_HINT === 'цикл правит сопровождающий проекта');

// ── K-9: граница кода ────────────────────────────────────────────────────────
console.log('в новых модулях нет уровней доступа, ролей и ключей статусов');
const code = (p) => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const modules = [
  'src/components/task/taskRights.ts',
  'src/components/task/stageRights.ts',
  'src/components/pipeline/cycleRights.ts',
];
for (const p of modules) {
  const src = code(p);
  check(`${p}: без разметки и без '@/'`, !/from\s+['"]@\//.test(src) && !/from\s+['"]react/.test(src));
  check(`${p}: без уровней доступа, ролей и ключей статусов`,
    !/['"](viewer|agent|maintainer|admin|developer|analyst|test|integrator)['"]/.test(src) &&
    !/\b(role_keys|memberships)\b|\.level\b|status_key\s*[=!]==/.test(src));
}
const usage = code('src/components/task/Details.tsx');
check('Details.tsx: право читается через rightOf, а не по уровню доступа',
  /rightOf\(rights, 'edit'/.test(usage) && /rightOf\(rights, 'stage_choice'/.test(usage) &&
  /rightOf\(rights, 'assign'/.test(usage) && /rightOf\(rights, 'scope'/.test(usage));
check('Details.tsx: старый текст о сопровождающем только как запасной (аргумент reasonOf)',
  /reasonOf\(rights, 'stage_choice', STAGES_READONLY_HINT\)/.test(usage));

console.log(`\nпройдено ${ok}, упало ${fail}`);
process.exit(fail ? 1 : 0);
