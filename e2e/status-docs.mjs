// Правила отбора документов роли на статусе (CLAB-348) — без браузера: что
// получит этап (счёт «Документов N» / «N из M», строка отбора, пометки
// отсутствующих, откат «ни одного → все», версия без ключа documents), и
// состояние поля в диалоге статуса (начальное из статуса, тело PUT …/roles,
// переотправка отбора неизменённых ролей, сброс при смене роли, блок
// «Сохранить» при пустых «Выбранных»). Модуль правил — чистые функции
// (src/components/pipeline/statusDocs.ts), поэтому проверяется прямо в
// исходниках, как role-docs.mjs. Здесь же — поиск ключей статусов и ролей и
// сырых цветов в модулях отбора.
//
// Имена документов и ключи ниже нарочно не похожи на наши.
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

const S = await import('../src/components/pipeline/statusDocs.ts');

let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const names = (docs) => docs.map((d) => d.name);
const version = {
  instructions: '',
  documents: ['core.md', 'vcs.md', 'ship.md', 'faq.md', 'style.md'].map((name, position) => ({name, kind: 'instructions', position})),
};

// ── AC-348.14: что получит этап ──────────────────────────────────────────────
console.log('что получит этап (AC-348.14)');
let s = S.stageDocuments(version);
check('без отбора — все документы версии', eq(names(s.documents), names(version.documents)) && !s.selected, JSON.stringify(s));
check('без отбора — «Документов 5»', S.documentsCountLabel(s) === 'Документов 5', S.documentsCountLabel(s));
check('без отбора строки отбора нет', S.selectionLine(undefined, s) === null && S.selectionItems(null, s) === null);
check('пустой список считается отсутствием отбора', !S.stageDocuments(version, []).selected);

s = S.stageDocuments(version, ['ship.md', 'core.md']);
check('отбор — названные, в порядке версии, а не отбора', eq(names(s.documents), ['core.md', 'ship.md']), JSON.stringify(names(s.documents)));
check('отбор — «Документов 2 из 5»', S.documentsCountLabel(s) === 'Документов 2 из 5', S.documentsCountLabel(s));
check('строка отбора — в порядке выдачи', S.selectionLine(['ship.md', 'core.md'], s) === 'Отбор: core.md, ship.md', S.selectionLine(['ship.md', 'core.md'], s));

s = S.stageDocuments(version, ['gone.md', 'vcs.md', 'lost.md']);
check('часть имён вне версии — найденные', eq(names(s.documents), ['vcs.md']) && eq(s.missing, ['gone.md', 'lost.md']) && !s.fallback, JSON.stringify(s));
check('часть имён вне версии — «Документов 1 из 5»', S.documentsCountLabel(s) === 'Документов 1 из 5', S.documentsCountLabel(s));
check('отсутствующие — в конце строки и помечены',
  S.selectionLine(['gone.md', 'vcs.md', 'lost.md'], s) === 'Отбор: vcs.md, gone.md (нет в версии роли), lost.md (нет в версии роли)',
  S.selectionLine(['gone.md', 'vcs.md', 'lost.md'], s));
check('пометка у элементов строки', eq(S.selectionItems(['gone.md', 'vcs.md'], S.stageDocuments(version, ['gone.md', 'vcs.md'])),
  [{name: 'vcs.md', missing: false}, {name: 'gone.md', missing: true}]));

s = S.stageDocuments(version, ['gone.md', 'lost.md']);
check('ни одного из отбора — все документы', eq(names(s.documents), names(version.documents)) && s.fallback && s.selected, JSON.stringify(s));
check('ни одного из отбора — «Документов 5», не «из»', S.documentsCountLabel(s) === 'Документов 5', S.documentsCountLabel(s));
check('ни одного из отбора — в строке только помеченные', eq(S.selectionItems(['gone.md', 'lost.md'], s),
  [{name: 'gone.md', missing: true}, {name: 'lost.md', missing: true}]));
check('текст отката говорит про «все»', S.FALLBACK_NOTE.includes('получит все'));

s = S.stageDocuments({instructions: 'текст'});
check('версия без ключа documents — один main.md', eq(names(s.documents), ['main.md']) && S.documentsCountLabel(s) === 'Документов 1', JSON.stringify(s));
s = S.stageDocuments({instructions: 'текст'}, ['main.md']);
check('отбор применяется к main.md прежнего ответа', S.documentsCountLabel(s) === 'Документов 1 из 1', S.documentsCountLabel(s));

// ── AC-348.13: поле в диалоге ────────────────────────────────────────────────
console.log('поле «Документы роли на этом этапе» (AC-348.13)');
const status = {roles: [
  {role_key: 'alpha', role_name: 'A', role_id: '1', is_primary: true, position: 0, document_names: ['ship.md', 'gone.md']},
  {role_key: 'beta', role_name: 'B', role_id: '2', is_primary: false, position: 1},
  {role_key: 'gamma', role_name: 'G', role_id: '3', is_primary: false, position: 2, document_names: ['faq.md']},
]};
let sel = S.selectionsFromStatus(status);
check('начальное — из сохранённого отбора', sel.primary.mode === 'picked' && eq(sel.primary.names, ['ship.md', 'gone.md']), JSON.stringify(sel));
check('роль без отбора — «Все»', sel.checkers.beta.mode === 'all' && sel.checkers.gamma.mode === 'picked', JSON.stringify(sel.checkers));
check('новый статус — «Все» у исполнителя', S.selectionsFromStatus(undefined).primary.mode === 'all');

const docsOf = (k) => (k === 'alpha' || k === 'gamma' ? version.documents : undefined);
let body = S.rolesBody('alpha', ['beta', 'gamma'], sel, docsOf);
check('неизменённые роли уходят с прежним отбором', eq(body, [
  {role: 'alpha', is_primary: true, position: 0, document_names: ['ship.md', 'gone.md']},
  {role: 'beta', is_primary: false, position: 1},
  {role: 'gamma', is_primary: false, position: 2, document_names: ['faq.md']},
]), JSON.stringify(body));
check('роль без отбора — без ключа document_names', !('document_names' in body[1]));

const opts = S.pickOptions(version.documents, sel.primary);
check('варианты — документы версии по порядку, отсутствующее следом помечено',
  eq(opts.map((o) => [o.name, o.missing, o.checked]), [
    ['core.md', false, false], ['vcs.md', false, false], ['ship.md', false, true], ['faq.md', false, false], ['style.md', false, false], ['gone.md', true, true],
  ]), JSON.stringify(opts));
check('без загруженной версии — только отмеченные, без пометок',
  eq(S.pickOptions(undefined, sel.primary).map((o) => [o.name, o.missing]), [['ship.md', false], ['gone.md', false]]));

let p = S.toggleName(sel.primary, 'gone.md');
check('отсутствующее имя снимается и пропадает из вариантов', !S.pickOptions(version.documents, p).some((o) => o.name === 'gone.md'));
p = S.toggleName(p, 'core.md');
check('тело — имена в порядке версии', eq(S.documentNames(p, version.documents), ['core.md', 'ship.md']), JSON.stringify(S.documentNames(p, version.documents)));
check('без версии — как отмечены', eq(S.documentNames(p), ['ship.md', 'core.md']));
check('«Все» — без document_names, отмеченное помнится', S.documentNames(S.withMode(p, 'all'), version.documents) === undefined && eq(S.withMode(p, 'all').names, p.names));

const emptyPick = {mode: 'picked', names: []};
check('«Выбранные» без отметок блокируют «Сохранить» у исполнителя', S.blocksSave('alpha', [], {...sel, primary: emptyPick}));
check('и у проверяющего', S.blocksSave('alpha', ['beta'], {...sel, checkers: {beta: emptyPick}}));
check('проверяющий, совпавший с исполнителем, не держит', !S.blocksSave('alpha', ['alpha'], {primary: S.ALL, checkers: {alpha: emptyPick}}));
check('обычный набор не держит', !S.blocksSave('alpha', ['beta', 'gamma'], sel));
check('пустые «Выбранные» не уходят пустым списком', S.documentNames(emptyPick, version.documents) === undefined);

let changed = S.changePrimary(sel, 'alpha', 'delta');
check('смена исполнителя сбрасывает отбор', changed.primary.mode === 'all' && eq(changed.checkers, sel.checkers));
check('тот же исполнитель — отбор на месте', S.changePrimary(sel, 'alpha', 'alpha') === sel);
changed = S.changeCheckers(sel, ['gamma', 'omega']);
check('убранный проверяющий теряет отбор, новый — «Все»',
  !('beta' in changed.checkers) && changed.checkers.gamma.mode === 'picked' && changed.checkers.omega.mode === 'all', JSON.stringify(changed.checkers));
body = S.rolesBody('delta', ['delta', 'gamma'], S.changePrimary(sel, 'alpha', 'delta'), docsOf);
check('проверяющий, совпавший с исполнителем, отбрасывается', eq(body.map((b) => b.role), ['delta', 'gamma']) && !('document_names' in body[0]), JSON.stringify(body));

// ── без хардкода и сырых цветов ─────────────────────────────────────────────
console.log('ключи статусов и ролей и сырые цвета');
const KEYS = ['new', 'analysis', 'development', 'testing', 'merge', 'release', 'done', 'cancelled',
  'planning', 'in_progress', 'prepare', 'publish', 'verify', 'analytics', 'developer', 'test', 'designer', 'integrator',
  'analyst', 'reviewer', 'qa'];
const quoted = new RegExp(`(['"\`])(${KEYS.join('|')})\\1`);
const comparison = /(status_key|role_key|statusKey|roleKey)\s*[!=]==?\s*['"`]/;
const rawColor = /#[0-9a-fA-F]{3,8}\b|rgba?\(|\bbg-white\b|\btext-black\b|\bbg-black\b|\btext-white\b/;
const files = [
  'src/components/pipeline/statusDocs.ts',
  'src/components/pipeline/StatusDocsField.tsx',
  'src/hooks/useRoleDocs.ts',
];
for (const file of files) {
  const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const lines = text.split('\n').filter((line) => !/^\s*(\/\/|\*|\{\/\*)/.test(line));
  const hit = lines.find((line) => quoted.test(line) || comparison.test(line));
  check(`${file}: ключей статусов и ролей нет`, !hit, hit);
  check(`${file}: сырых цветов нет`, !rawColor.test(text), String(text.match(rawColor)));
}
const rules = readFileSync(new URL('../src/components/pipeline/statusDocs.ts', import.meta.url), 'utf8');
check('модуль правил без React', !/from ['"]react/.test(rules));
check('модуль правил берёт нормализацию версии из roleDocs', /from '\.\/roleDocs'/.test(rules) && /versionDocuments\(/.test(rules));

console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
