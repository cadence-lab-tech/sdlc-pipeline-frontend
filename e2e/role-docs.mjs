// Правила документов версии роли (CLAB-347) — без браузера: нормализация
// ответа, дифф двух версий по документам (категории, счётчики, отметки,
// свёртка, предел размера), черновик формы «Новая версия» (операции, отметки,
// счётчик, тело запроса) и разбор отказа сервера. Модуль правил — чистые
// функции (src/components/pipeline/roleDocs.ts), поэтому проверяется прямо в
// исходниках, как stage-panel.mjs. Здесь же — поиск ключей статусов и ролей и
// сырых цветов в модулях новой панели (AC-347.9, AC-347.19).
//
// Имена документов и ключи ниже нарочно не похожи на наши: правила не должны
// о них знать.
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';

// Модули интерфейса импортируют друг друга без расширения (так требует
// сборка); node без расширения файл не найдёт — подставляем .ts.
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

const R = await import('../src/components/pipeline/roleDocs.ts');

let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const doc = (name, content, kind = 'instructions', sha) => ({name, kind, position: 0, content, ...(sha ? {sha256: sha} : {})});
const withPos = (docs) => docs.map((d, i) => ({...d, position: i}));

// ── AC-347.1 нормализация ───────────────────────────────────────────────────
console.log('нормализация версии (AC-347.1)');
let docs = R.versionDocuments({
  instructions: 'склейка',
  documents: [
    {name: 'z-last.md', kind: 'reference', position: 2, sha256: 'c'.repeat(64), size_bytes: 3},
    {name: 'a-first.md', kind: 'instructions', position: 0, sha256: 'a'.repeat(64), size_bytes: 3, content: 'один'},
    {name: 'm-mid.md', kind: 'checklist', position: 1, sha256: 'b'.repeat(64), size_bytes: 3},
  ],
});
check('documents — по position', docs.map((d) => d.name).join() === 'a-first.md,m-mid.md,z-last.md', docs.map((d) => d.name).join());
check('content как есть, из instructions не придумывается', docs[0].content === 'один' && docs[1].content === undefined && docs[2].content === undefined);
docs = R.versionDocuments({instructions: '# Правила\nтекст'});
check('без ключа documents — один main.md типа instructions из instructions без sha256',
  eq(docs, [{name: 'main.md', kind: 'instructions', position: 0, content: '# Правила\nтекст'}]), JSON.stringify(docs));
check('documents: [] — пустой список, без падения', eq(R.versionDocuments({instructions: 'x', documents: []}), []));
check('documents: null — не падает (как ответ без documents)', R.versionDocuments({instructions: 'x', documents: null}).length === 1);
const norm = R.normalizeRoleVersion({id: 'v', version: 3, instructions: 'одна строка'});
check('normalizeRoleVersion заполняет documents', norm.documents?.length === 1 && norm.documents[0].name === 'main.md' && norm.version === 3);
check('hasContent: в списке версий текста нет', !R.hasContent(R.versionDocuments({documents: [{name: 'a.md', kind: 'k', position: 0, sha256: 'x'}]})) && R.hasContent(docs));
check('sha256[0:7]', R.shortSha('0123456789abcdef') === '0123456' && R.shortSha(undefined) === '');

// ── AC-347.2 категории ──────────────────────────────────────────────────────
console.log('категории диффа (AC-347.2)');
const prev = withPos([
  doc('keep.md', 'одна\nдве\n', 'instructions', 's1'),
  doc('edit.md', 'a\nb\nc\nd\n', 'checklist', 's2'),
  doc('gone.md', 'x\ny\nz\n', 'reference', 's3'),
  doc('old-name.md', 'r1\nr2\n', 'instructions', 's4'),
]);
const next = withPos([
  doc('keep.md', 'одна\nдве\n', 'instructions', 's1'),
  doc('edit.md', 'a\nB\nc\nd\ne\n', 'checklist', 's2b'),
  doc('fresh.md', 'n1\nn2\nn3\n', 'reference', 's5'),
  doc('new-name.md', 'r1\nr2\n', 'instructions', 's4'),
]);
let d = R.diffVersions(prev, next);
const byName = Object.fromEntries(d.docs.map((x) => [x.name, x]));
check('только в новой — added', byName['fresh.md']?.change === 'added');
check('только в прежней — removed', byName['gone.md']?.change === 'removed');
check('та же sha256 — same', byName['keep.md']?.change === 'same');
check('иная sha256 — changed', byName['edit.md']?.change === 'changed');
check('переименование — ровно одно removed и одно added',
  byName['old-name.md']?.change === 'removed' && byName['new-name.md']?.change === 'added');
check('счётчики changed: +2 −1', byName['edit.md'].plus === 2 && byName['edit.md'].minus === 1, `${byName['edit.md'].plus}/${byName['edit.md'].minus}`);
check('added: + число строк документа', byName['fresh.md'].plus === 3 && byName['fresh.md'].minus === 0);
check('removed: − число строк документа', byName['gone.md'].minus === 3 && byName['gone.md'].plus === 0);
check('два вызова на одних данных — равный результат', eq(R.diffVersions(prev, next), R.diffVersions(prev, next)));
// Без sha256 (прежний backend) сравнивается содержимое.
const noSha = R.diffVersions([doc('main.md', 'a\nb')], [doc('main.md', 'a\nb')]);
check('без sha256 — равенство содержимого → same', noSha.docs[0].change === 'same');
check('без sha256 — разное содержимое → changed', R.diffVersions([doc('main.md', 'a')], [doc('main.md', 'b')]).docs[0].change === 'changed');
check('sha256 одинаковы — same, даже если в списке нет content',
  R.diffVersions([{name: 'q.md', kind: 'k', position: 0, sha256: 'h'}], [{name: 'q.md', kind: 'k', position: 0, sha256: 'h', content: 'x'}]).docs[0].change === 'same');

// ── AC-347.3 порядок, сводка, отметки, свёртка ──────────────────────────────
console.log('порядок, сводка, отметки (AC-347.3)');
check('порядок: changed, added, removed, same; внутри — порядок документов',
  d.docs.map((x) => `${x.change}:${x.name}`).join() === 'changed:edit.md,added:fresh.md,added:new-name.md,removed:gone.md,removed:old-name.md,same:keep.md',
  d.docs.map((x) => `${x.change}:${x.name}`).join());
check('сводка «изменён N · добавлен N · убран N · без изменений N»', R.diffSummary(d.counts) === 'изменён 1 · добавлен 2 · убран 2 · без изменений 1', R.diffSummary(d.counts));
const quiet = R.diffVersions(prev, prev);
check('нулевые категории не скрываются', R.diffSummary(quiet.counts) === 'изменён 0 · добавлен 0 · убран 0 · без изменений 4', R.diffSummary(quiet.counts));
check('набор без изменений — признак «изменений нет»', quiet.unchanged === true && d.unchanged === false);
// Тип: та же sha256, другой тип — same с отметкой.
const kinded = R.diffVersions([doc('p.md', 't', 'policy', 'k1')], [doc('p.md', 't', 'checklist', 'k1')]);
check('тип сменился при той же sha256 — same с «тип: a → b»',
  kinded.docs[0].change === 'same' && R.kindChangeLabel(kinded.docs[0].kindChange) === 'тип: policy → checklist');
check('отметка типа — не «изменений нет»', kinded.unchanged === false);
// «Переставлен»: подняли один документ наверх — отметка только у него.
const order = (names) => withPos(names.map((n) => doc(n, n, 'instructions', 'h-' + n)));
let o = R.diffVersions(order(['a.md', 'b.md', 'c.md', 'checks.md']), order(['checks.md', 'a.md', 'b.md', 'c.md']));
check('подняли один документ — «переставлен» только у него',
  o.docs.filter((x) => x.moved).map((x) => x.name).join() === 'checks.md', o.docs.filter((x) => x.moved).map((x) => x.name).join());
check('отметки не меняют категорию same', o.docs.every((x) => x.change === 'same'));
o = R.diffVersions(order(['a.md', 'b.md', 'c.md']), order(['a.md', 'x.md', 'c.md']));
check('сдвиг от добавления и удаления соседей отметки не даёт', o.docs.every((x) => !x.moved), JSON.stringify(o.docs.map((x) => [x.name, x.moved])));
o = R.diffVersions(order(['a.md', 'b.md']), order(['b.md', 'a.md']));
check('обмен двух — отметка у одного, поднятого', o.docs.filter((x) => x.moved).map((x) => x.name).join() === 'b.md');
o = R.diffVersions(order(['a.md', 'b.md', 'c.md']), order(['a.md', 'c.md', 'b.md']));
check('подняли c на место b — отметка у c', o.docs.filter((x) => x.moved).map((x) => x.name).join() === 'c.md', o.docs.filter((x) => x.moved).map((x) => x.name).join());

console.log('свёртка (AC-347.3)');
const L = (op, n, p = 'l') => Array.from({length: n}, (_, i) => ({op, text: `${p}${i}`}));
let rows = R.foldLines([...L('-', 1), ...L(' ', 5), ...L('+', 1)]);
check('кусок из 5 строк между правками — свёрнут', rows.length === 3 && rows[1].type === 'fold' && rows[1].lines.length === 5);
rows = R.foldLines([...L('-', 1), ...L(' ', 4), ...L('+', 1)]);
check('кусок в 4 строки — не свёрнут', rows.length === 6 && rows.every((r) => r.type === 'line'));
rows = R.foldLines([...L(' ', 7, 'h'), ...L('+', 1), ...L(' ', 2, 't')]);
check('кусок на краю документа длиннее 4 строк — свёрнут, короткий на другом краю — нет',
  rows[0].type === 'fold' && rows[0].lines.length === 7 && rows.slice(1).every((r) => r.type === 'line') && rows.length === 4);
rows = R.foldLines([...L('+', 1), ...L(' ', 9, 'e')]);
check('кусок в конце документа — свёрнут', rows.length === 2 && rows[1].type === 'fold' && rows[1].lines.length === 9);
check('подпись свёртки: остаток больше порции — «показать ещё 200»', R.foldLabel(2400) === `⋯ ${R.formatCount(2400)} строк без изменений — показать ещё 200`, R.foldLabel(2400));
check('подпись свёртки: остаток в порцию — «показать»', R.foldLabel(200) === '⋯ 200 строк без изменений — показать' && R.foldLabel(22) === '⋯ 22 строки без изменений — показать');
check('порция раскрытия — 200 строк', R.FOLD_CHUNK === 200);
check('число с разделителем тысяч', R.formatCount(2400).replace(/\s/g, '') === '2400' && R.formatCount(2400) !== '2400', R.formatCount(2400));

// ── AC-347.4 крупные документы ──────────────────────────────────────────────
console.log('крупные документы (AC-347.4)');
const big = Array.from({length: 5000}, (_, i) => `строка ${i}`);
const bigA = big.join('\n');
const bigB = [...big.slice(0, 2500), 'вставка', ...big.slice(2501)].join('\n');
let t0 = performance.now();
let ld = R.lineDiff(bigA, bigB);
let ms = performance.now() - t0;
check(`5000×5000 с общими началом и концом — быстрее секунды (${ms.toFixed(1)} мс)`, ms < 1000 && !ld.tooBig && ld.plus === 1 && ld.minus === 1);
// Правки на обоих краях: срез не помогает, середина общая — уходит в предел.
const edgesB = ['другая первая', ...big.slice(1, 4999), 'другая последняя'].join('\n');
t0 = performance.now();
ld = R.lineDiff(bigA, edgesB);
ms = performance.now() - t0;
check(`5000×5000 с общей серединой и правками по краям — быстрее секунды (${ms.toFixed(1)} мс)`, ms < 1000);
check('после среза больше предела — только счётчики и «слишком велик», без строк',
  ld.tooBig === true && ld.lines === undefined && ld.plus === 5000 && ld.minus === 5000, JSON.stringify({...ld, lines: ld.lines?.length}));
check('предел — константа', R.LINE_DIFF_CELL_LIMIT === 4_000_000);
// Граница предела с обеих сторон: 2000×2000 = предел — строится, 2001×2000 — нет.
const side = (n, p) => Array.from({length: n}, (_, i) => `${p}${i}`).join('\n');
check('ровно предел ячеек — построчный дифф строится', R.lineDiff(side(2000, 'a'), side(2000, 'b')).tooBig === false);
check('на ячейку больше предела — «слишком велик»', R.lineDiff(side(2001, 'a'), side(2000, 'b')).tooBig === true);
check('предел передаётся параметром', R.lineDiff('a\nb', 'c\nd', 3).tooBig === true && R.lineDiff('a\nb', 'c\nd', 4).tooBig === false);
const bigDiff = R.diffVersions([doc('ref.md', bigA, 'reference', 'x1')], [doc('ref.md', edgesB, 'reference', 'x2')]);
check('в диффе версии слишком большой документ — changed с признаком, без строк',
  bigDiff.docs[0].change === 'changed' && bigDiff.docs[0].tooBig && !bigDiff.docs[0].lines && bigDiff.counts.changed === 1);
check('перевод строки в конце строкой не считается', R.splitLines('a\nb\n').length === 2 && R.splitLines('').length === 0);

// ── AC-347.5 черновик формы ─────────────────────────────────────────────────
console.log('черновик формы (AC-347.5)');
const base = {
  id: 'v7', role_id: 'r', version: 7, instructions: 'склейка', created_at: '2026-01-01T00:00:00Z',
  input_kinds: ['in.one', 'in.two'], output_contract: [{kind: 'out.x', required: true}],
  tool_policy: {t: 1}, repo_scope: ['o/r'], context_budget: {c: 2}, model_hint: 'старый-хинт', model_level: 'medium',
  documents: withPos([doc('rules.md', 'r1\nr2', 'instructions', 'h1'), doc('git.md', 'g1', 'checklist', 'h2'), doc('ref.md', 'f1', 'policy', 'h3')]),
};
let draft = R.draftFromVersion(base);
check('копия: документы, контракт, вход, уровень',
  draft.docs.map((x) => `${x.name}:${x.kind}:${x.content}`).join() === 'rules.md:instructions:r1\nr2,git.md:checklist:g1,ref.md:policy:f1' &&
    eq(draft.contract, base.output_contract) && draft.inputKinds === 'in.one, in.two' && draft.modelLevel === 'medium');
check('ни одной отметки', draft.docs.every((x) => R.draftMark(x) === 'same'));
check('счётчик «0 · 0 · 0»', R.countsLabel(R.draftCounts(draft.docs)) === 'Изменено 0 · добавлено 0 · убрано 0');
const [rules, git, ref] = draft.docs;
let ds = R.editDoc(draft.docs, rules.id, {content: 'r1\nr2\nr3'});
check('изменить текст → changed', R.draftMark(ds[0]) === 'changed' && eq(R.draftCounts(ds), {changed: 1, added: 0, removed: 0}));
ds = R.editDoc(draft.docs, git.id, {kind: 'reference'});
check('изменить тип → changed', R.draftMark(ds[1]) === 'changed' && R.draftCounts(ds).changed === 1);
ds = R.editDoc(ds, git.id, {kind: 'checklist'});
check('вернуть тип — отметка снята', R.draftMark(ds[1]) === 'same' && R.draftCounts(ds).changed === 0);
let added = R.addDoc(draft.docs);
check('добавить → added, имя по умолчанию не конфликтует', R.draftMark(added.docs[3]) === 'added' && added.docs[3].name === 'new-1.md' && R.draftCounts(added.docs).added === 1);
const added2 = R.addDoc(added.docs);
check('второе имя по умолчанию — следующее свободное', added2.docs[4].name === 'new-2.md');
ds = R.removeDoc(draft.docs, git.id);
check('убрать → removed, строка остаётся', ds.length === 3 && R.draftMark(ds[1]) === 'removed' && R.draftCounts(ds).removed === 1);
check('номер убранной строки — «–», остальные подряд', R.rowNumbers(ds).join() === '1,–,2');
ds = R.editDoc(draft.docs, git.id, {content: 'правка'});
ds = R.restoreDoc(R.removeDoc(ds, git.id), git.id);
check('вернуть → исходная отметка (правки не потеряны)', R.draftMark(ds[1]) === 'changed' && ds[1].content === 'правка');
ds = R.removeDoc(added.docs, added.id);
check('убрать добавленный до сохранения → строка исчезает', ds.length === 3 && R.draftCounts(ds).added === 0);
check('убрать добавленный без текста — без подтверждения, с текстом — с подтверждением',
  !R.removalNeedsConfirm(added.docs[3]) && R.removalNeedsConfirm({...added.docs[3], content: 'текст'}) && !R.removalNeedsConfirm(rules));
check('соседняя строка после исчезновения добавленного', R.neighbourAfterRemoval(added.docs, ds, added.id) === ref.id);
ds = R.moveDoc(draft.docs, ref.id, -1);
check('поднять меняет порядок', ds.map((x) => x.name).join() === 'rules.md,ref.md,git.md');
check('поднять первый и опустить последний — без эффекта',
  R.moveDoc(draft.docs, rules.id, -1) === draft.docs && R.moveDoc(draft.docs, ref.id, 1) === draft.docs &&
    !R.canMove(draft.docs, rules.id, -1) && R.canMove(draft.docs, rules.id, 1));
ds = R.moveDoc(R.removeDoc(draft.docs, git.id), ref.id, -1);
check('убранная строка в порядке не участвует: сосед — через неё', ds.map((x) => x.name).join() === 'ref.md,git.md,rules.md', ds.map((x) => x.name).join());
check('перестановка счётчик не меняет', eq(R.draftCounts(R.moveDoc(draft.docs, ref.id, -1)), {changed: 0, added: 0, removed: 0}));
ds = R.editDoc(draft.docs, git.id, {name: 'vcs.md'});
check('переименовать → «убрано +1, добавлено +1», подпись «было»',
  eq(R.draftCounts(ds), {changed: 0, added: 1, removed: 1}) && R.draftMark(ds[1]) === 'renamed' && ds[1].base.name === 'git.md');
ds = R.editDoc(ds, git.id, {content: 'другой текст'});
check('правка текста у переименованного счётчик не меняет', eq(R.draftCounts(ds), {changed: 0, added: 1, removed: 1}));
ds = R.editDoc(ds, git.id, {name: 'git.md', content: 'g1'});
check('вернули имя — отметка и счётчик назад', R.draftMark(ds[1]) === 'same' && eq(R.draftCounts(ds), {changed: 0, added: 0, removed: 0}));
// Счётчик — та же функция, что сводка диффа между базой и отправляемым.
ds = R.addDoc(R.editDoc(R.removeDoc(draft.docs, ref.id), rules.id, {content: 'x'})).docs;
const sent = R.sentDocs(ds).map((x, i) => ({name: x.name, kind: x.kind, content: x.content, position: i}));
const summary = R.diffVersions(base.documents.map((x) => ({...x, sha256: undefined})), sent, {kindIsChange: true}).counts;
check('счётчик формы равен сводке дифф-набора база → отправляемое',
  eq(R.draftCounts(ds), {changed: summary.changed, added: summary.added, removed: summary.removed}), JSON.stringify([R.draftCounts(ds), summary]));
check('типы на выбор: нестандартный тип базы первым', R.kindOptions(ref).join() === 'policy,instructions,checklist,reference' && R.kindOptions(rules).join() === 'instructions,checklist,reference');
check('нестандартный тип базы называется', R.customBaseKind(ref) === 'policy' && R.customBaseKind(rules) === undefined);
const fresh = R.newRoleDraft();
check('«Завести роль»: один пустой main.md типа instructions', fresh.docs.length === 1 && fresh.docs[0].name === 'main.md' && fresh.docs[0].kind === 'instructions' && fresh.docs[0].content === '' && R.draftMark(fresh.docs[0]) === 'added');

// ── AC-347.6 тело запроса ───────────────────────────────────────────────────
console.log('тело запроса (AC-347.6)');
let d2 = {...draft, docs: R.removeDoc(R.moveDoc(draft.docs, ref.id, -1), git.id), changelog: '', inputKinds: ' a.one, , b.two ,', modelLevel: null};
let body = R.versionBody(d2, base);
check('documents — в порядке строк, без убранных, {name, kind, content}',
  eq(body.documents, [{name: 'rules.md', kind: 'instructions', content: 'r1\nr2'}, {name: 'ref.md', kind: 'policy', content: 'f1'}]), JSON.stringify(body.documents));
check('ключа instructions нет', !('instructions' in body));
check('пустой changelog — ключа нет', !('changelog' in body));
check('input_kinds — из строки через запятую без пустых', eq(body.input_kinds, ['a.one', 'b.two']));
check('tool_policy, repo_scope, context_budget, model_hint базы — как были',
  eq(body.tool_policy, {t: 1}) && eq(body.repo_scope, ['o/r']) && eq(body.context_budget, {c: 2}) && body.model_hint === 'старый-хинт');
check('output_contract — из формы', eq(body.output_contract, base.output_contract));
check('«авто» — ключа model_level нет', !('model_level' in body));
body = R.versionBody({...d2, changelog: 'что поменяли', modelLevel: 'high'}, base);
check('непустой changelog и выбранный уровень уходят', body.changelog === 'что поменяли' && body.model_level === 'high');
body = R.versionBody({...fresh, docs: R.editDoc(fresh.docs, fresh.docs[0].id, {content: 'Ты новый.'})});
check('«Завести роль»: то же тело без базы', eq(body.documents, [{name: 'main.md', kind: 'instructions', content: 'Ты новый.'}]) &&
  eq(body.tool_policy, {}) && eq(body.repo_scope, []) && eq(body.context_budget, {}) && !('model_hint' in body) && !('instructions' in body));

// ── AC-347.7 разбор отказа ──────────────────────────────────────────────────
console.log('разбор отказа (AC-347.7)');
check('«документ 2 ("git.md"): …» → индекс 1', R.failedDocumentIndex('документ 2 ("git.md"): имя уже занято документом 1', 3) === 1);
check('«документ 1: пустое имя» → индекс 0', R.failedDocumentIndex('документ 1: пустое имя', 1) === 0);
check('сообщение без такого начала → undefined', R.failedDocumentIndex('в версии роли 51 документов, предел 50', 3) === undefined &&
  R.failedDocumentIndex('нужен уровень maintainer', 3) === undefined && R.failedDocumentIndex('', 3) === undefined);
check('номер вне диапазона → undefined, без исключения', R.failedDocumentIndex('документ 9 ("x.md"): пустое содержимое', 3) === undefined &&
  R.failedDocumentIndex('документ 0 ("x.md"): пустое содержимое', 3) === undefined);
check('«документ 12…» не путается с «документ 1»', R.failedDocumentIndex('документ 12 ("x.md"): тип', 3) === undefined);
ds = R.removeDoc(draft.docs, git.id);
check('номер — среди отправленных: убранные не считаются', R.failedDocumentId('документ 2 ("ref.md"): пустое содержимое', ds) === ref.id);

// ── без хардкода и сырых цветов ─────────────────────────────────────────────
console.log('ключи статусов и ролей и сырые цвета (AC-347.9, AC-347.19)');
const KEYS = ['new', 'analysis', 'development', 'testing', 'merge', 'release', 'done', 'cancelled',
  'planning', 'in_progress', 'prepare', 'publish', 'verify', 'analytics', 'developer', 'test', 'designer', 'integrator',
  'analyst', 'reviewer', 'qa'];
const quoted = new RegExp(`(['"\`])(${KEYS.join('|')})\\1`);
const comparison = /(status_key|role_key|statusKey|roleKey)\s*[!=]==?\s*['"`]/;
const rawColor = /#[0-9a-fA-F]{3,8}\b|rgba?\(|\bbg-white\b|\btext-black\b|\bbg-black\b|\btext-white\b/;
const files = [
  'src/components/pipeline/roleDocs.ts',
  'src/components/pipeline/RoleVersionCard.tsx',
  'src/components/pipeline/DocumentDiff.tsx',
  'src/components/pipeline/DocumentEditor.tsx',
  'src/components/pipeline/RolePanel.tsx',
  'src/components/RoleVersionForm.tsx',
];
for (const file of files) {
  const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const lines = text.split('\n').filter((line) => !/^\s*(\/\/|\*|\{\/\*)/.test(line));
  const hit = lines.find((line) => quoted.test(line) || comparison.test(line));
  check(`${file}: ключей статусов и ролей нет`, !hit, hit);
  check(`${file}: сырых цветов нет`, !rawColor.test(text), String(text.match(rawColor)));
  const unpaired = text.split('\n').find((line) => /\b(text|bg|border)-(red|amber|emerald|blue|green|orange)-[4-9]00\b(?!\/)/.test(line) && !/dark:(text|bg|border)-/.test(line));
  check(`${file}: у цветов есть пара для тёмной темы`, !unpaired, unpaired);
}
const rules2 = readFileSync(new URL('../src/components/pipeline/roleDocs.ts', import.meta.url), 'utf8');
check('модуль правил без React', !/from ['"]react/.test(rules2));

console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
