// Правила библиотеки инструкций (CLAB-351) — без браузера: кого отмечать в
// «Обновить в ролях», подписи строк и кнопки, «есть новее», форма ключа,
// закрепление в черновике версии роли (тело запроса, отметки, счётчик,
// «Отвязать» и «Вернуть закрепление»), метки привязки в диффе версий роли.
// Здесь же — поиск ключей статусов, ролей и инструкций и сырых цветов в
// модулях библиотеки (AC-17).
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

const L = await import('../src/components/pipeline/libraryRules.ts');
const R = await import('../src/components/pipeline/roleDocs.ts');

let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const usage = (role_key, role_version, pinned_version, sha256 = 'aaa') => ({role_key, role_name: role_key, role_version, pinned_version, sha256});

// ── форма ключа ─────────────────────────────────────────────────────────────
console.log('ключ инструкции');
check('строчные, цифры, _ и - — годится', !L.keyIsBad('rule-set_2'));
check('пустой — не ошибка формы (кнопка выключена)', !L.keyIsBad(''));
for (const bad of ['Rule', 'rule.md', '-rule', 'a/b', 'x'.repeat(62)]) check(`«${bad.slice(0, 12)}» — не по форме`, L.keyIsBad(bad));
check('61 символ — годится', !L.keyIsBad('x'.repeat(61)));
check('имя документа — ключ.md', L.docName('zeta') === 'zeta.md');
check('ключ из имени документа', L.keyFromDocName('zeta.md') === 'zeta');
check('тип не из стандартных — первым', eq(L.kindChoices('policy'), ['policy', 'instructions', 'checklist', 'reference']));

// ── раздел и панель ─────────────────────────────────────────────────────────
console.log('раздел и «Где используется»');
check('закреплена: N', L.pinnedCaption({pinned_roles: 2}) === 'закреплена: 2');
check('ни одна роль не закрепила', L.pinnedCaption({pinned_roles: 0}) === 'ни одна роль не закрепила');
const us = [usage('r1', 20, 1), usage('r2', 3, 2), usage('r3', 13, null)];
check('отстают от последней — только закреплённые ниже', L.laggingCount(us, 2) === 1);
check('состояние строки', eq(us.map((u) => L.usageState(u, 2)), ['lag', 'current', 'plain']));
check('закреплена в ролях', eq(L.pinnedOn(us, 1), ['r1']));
check('подпись версии в списке', L.versionOptionLabel({version: 2, changelog: 'правка'}, 2) === 'v2 · последняя · правка');
check('подсказка «есть новее»', L.lagTitle([{key: 'zeta', pinned_version: 1, latest_version: 2}]) === 'zeta: закреплена v1, в библиотеке v2');
check('метка закрепления коротко', L.pinLabel({key: 'zeta', version: 1}, true) === 'zeta v1');
check('метка закрепления полностью', L.pinLabel({key: 'zeta', version: 1}) === 'библиотека: zeta v1');
check('«есть vN» при новее', L.newerLabel({key: 'zeta', version: 1}, 3) === 'есть v3');
check('«есть vN» нет на последней', L.newerLabel({key: 'zeta', version: 3}, 3) === undefined);

// ── «Обновить в ролях» ──────────────────────────────────────────────────────
console.log('«Обновить в ролях»: отметки по умолчанию и подписи');
const cands = [usage('lag', 20, 1), usage('cur', 3, 2), usage('same', 13, null, 'sha2'), usage('other', 5, null, 'zzz'), usage('ahead', 7, 3)];
let picks = L.defaultPicks(cands, 2, 'sha2');
check('отстающие и обычные с тем же текстом отмечены', picks.lag && picks.same);
check('актуальные, обычные с другим текстом и откат — нет', !picks.cur && !picks.other && !picks.ahead);
check('в запрос — только отмеченные и не актуальные', eq(L.chosen(cands, picks, 2).map((c) => c.role_key), ['lag', 'same']));
const pre = L.defaultPicks(cands, 2, 'sha2', ['other']);
check('из плашки роли отмечена только она', eq(Object.keys(pre).filter((k) => pre[k]), ['other']));
check('из плашки: актуальная не отмечается', !L.defaultPicks(cands, 2, 'sha2', ['cur']).cur);
const manual = {...picks, other: true};
const moved = L.repick(cands, manual, true, 3, undefined);
check('смена версии: ручные отметки остаются', moved.other && moved.lag);
check('смена версии: ставшие актуальными снимаются', moved.ahead === false);
check('без ручных отметок смена версии пересчитывает', eq(L.repick(cands, {}, false, 3, undefined), L.defaultPicks(cands, 3, undefined)));
check('состояния кандидатов', eq(cands.map((c) => L.candidateState(c, 2)), ['lag', 'current', 'plain', 'plain', 'ahead']));
check('строка роли', L.candidateLine(cands[0], 'zeta', 2) === 'v20 → v21 · zeta v1 → v2');
check('строка обычного документа', L.candidateLine(cands[2], 'zeta', 2) === 'v13 → v14 · обычный документ → v2');
check('строка актуальной', L.candidateLine(cands[1], 'zeta', 2) === 'Уже на v2: новой версии не будет');
check('текст тот же', L.plainNote(cands[2], 'sha2') === 'Текст тот же: документ только закрепится');
check('текст заменится', L.plainNote(cands[3], 'sha2') === 'Текст роли заменится текстом инструкции');
check('кнопка: 1 роли', L.applyButtonLabel(1) === 'Обновить в 1 роли');
check('кнопка: 2 ролях', L.applyButtonLabel(2) === 'Обновить в 2 ролях');
check('кнопка: 11 ролях', L.applyButtonLabel(11) === 'Обновить в 11 ролях');
check('кнопка: 21 роли', L.applyButtonLabel(21) === 'Обновить в 21 роли');
check('кнопка: ноль — «Отметьте роли»', L.applyButtonLabel(0) === 'Отметьте роли');
check('все на версии', L.allCurrent([usage('a', 1, 2), usage('b', 1, 2)], 2) && !L.allCurrent(cands, 2));
check('роль из отказа 409', L.conflictRole({role: 'lag', latest_version: 21}) === 'lag' && L.conflictRole(undefined) === undefined);
check('новая версия без правок — сохранять нечего', L.unchangedVersion({kind: 'instructions', content: 'x'}, 'instructions', 'x'));
check('смена типа — правка', !L.unchangedVersion({kind: 'instructions', content: 'x'}, 'checklist', 'x'));
check('байты UTF-8', L.byteLength('ёж') === 4);

// ── черновик версии роли с закреплением ─────────────────────────────────────
console.log('черновик версии роли: закрепление, «Отвязать», тело запроса');
const pin = {key: 'zeta', version: 1};
const version = {
  id: 'v', role_id: 'r', version: 4, instructions: '', input_kinds: [], output_contract: [], tool_policy: {},
  repo_scope: [], context_budget: {}, created_at: '',
  documents: [
    {name: 'main.md', kind: 'instructions', position: 0, content: 'Главное.\n', sha256: 'm'},
    {name: 'zeta.md', kind: 'reference', position: 1, content: 'Правило.\n', sha256: 'z', instruction: pin},
  ],
};
let draft = R.draftFromVersion(version);
const zeta = draft.docs[1];
check('закрепление пришло в черновик', eq(zeta.pin, pin) && eq(zeta.base.pin, pin));
check('без правок — без отметки', R.draftMark(zeta) === 'same');
let body = R.versionBody(draft, version);
check('закреплённый уходит ссылкой без текста', eq(body.documents[1], {instruction: {key: 'zeta', version: 1}}));
check('обычный — содержимым', eq(body.documents[0], {name: 'main.md', kind: 'instructions', content: 'Главное.\n'}));
check('счётчик: из библиотеки 1', R.countsLabel(R.draftCounts(draft.docs), R.pinnedCount(draft.docs)).endsWith('· из библиотеки 1'));

let docs = R.unpinDoc(draft.docs, zeta.id);
const un = docs[1];
check('«Отвязать»: обычный документ, помнит закрепление', !un.pin && eq(un.wasPin, pin) && un.content === 'Правило.\n');
check('«Отвязать» — отметка «изменён»', R.draftMark(un) === 'changed');
check('счётчик считает смену привязки', R.draftCounts(docs).changed === 1);
body = R.versionBody({...draft, docs}, version);
check('отвязанный уходит содержимым с unpin', eq(body.documents[1], {name: 'zeta.md', kind: 'reference', content: 'Правило.\n', unpin: true}));
check('вернуть без правок — без подтверждения', !R.repinNeedsConfirm(un));
docs = R.editDoc(docs, un.id, {content: 'Своё правило.\n'});
check('после правки текста — с подтверждением', R.repinNeedsConfirm(docs[1]));
docs = R.repinDoc(docs, un.id);
check('«Вернуть закрепление» возвращает текст версии', eq(docs[1].pin, pin) && docs[1].content === 'Правило.\n' && R.draftMark(docs[1]) === 'same');

const added = R.addPinnedDoc(draft.docs, {key: 'omega', version: 2}, 'checklist', '- пункт\n');
const om = added.docs.find((d) => d.id === added.id);
check('«Из библиотеки»: имя ключ.md, тип и текст версии', om.name === 'omega.md' && om.kind === 'checklist' && eq(om.pin, {key: 'omega', version: 2}));
check('добавленный — «новый»', R.draftMark(om) === 'added');

// ── дифф версий роли: метка привязки ────────────────────────────────────────
console.log('дифф версий роли: привязка — не текст');
const d0 = {name: 'zeta.md', kind: 'reference', position: 0, content: 'Правило.\n', sha256: 'z'};
let diff = R.diffVersions([d0], [{...d0, instruction: pin}]);
check('закрепление без смены текста — без изменений, с меткой', diff.docs[0].change === 'same' && R.pinChangeLabel(diff.docs[0].pinChange) === 'закреплён: zeta v1');
check('«Изменений в документах нет» не показывается при смене привязки', !diff.unchanged);
check('сводка не меняется', R.diffSummary(diff.counts) === 'изменён 0 · добавлен 0 · убран 0 · без изменений 1');
diff = R.diffVersions([{...d0, instruction: pin}], [{...d0, content: 'Новое.\n', sha256: 'y', instruction: {key: 'zeta', version: 2}}]);
check('перезакрепление', diff.docs[0].change === 'changed' && R.pinChangeLabel(diff.docs[0].pinChange) === 'библиотека: zeta v1 → v2');
diff = R.diffVersions([{...d0, instruction: pin}], [d0]);
check('отвязан', R.pinChangeLabel(diff.docs[0].pinChange) === 'отвязан от zeta v1');
diff = R.diffVersions([{...d0, instruction: pin}], [{...d0, instruction: pin}]);
check('та же привязка — меток нет', !diff.docs[0].pinChange && diff.unchanged);

// ── без хардкода и сырых цветов ─────────────────────────────────────────────
console.log('ключи статусов, ролей и инструкций и сырые цвета (AC-17)');
const KEYS = ['new', 'analysis', 'development', 'testing', 'merge', 'release', 'done', 'cancelled',
  'planning', 'in_progress', 'analytics', 'developer', 'test', 'designer', 'integrator',
  'analyst', 'reviewer', 'qa', 'git', 'selfhosted', 'report-format'];
const quoted = new RegExp(`(['"\`])(${KEYS.join('|')})\\1`);
const comparison = /(status_key|role_key|statusKey|roleKey|instKey|\.key)\s*[!=]==?\s*['"`]/;
const rawColor = /#[0-9a-fA-F]{3,8}\b|rgba?\(|\bbg-white\b|\btext-black\b|\bbg-black\b|\btext-white\b/;
const files = [
  'src/components/pipeline/libraryRules.ts',
  'src/components/pipeline/InstructionLibrary.tsx',
  'src/components/pipeline/DocumentEditor.tsx',
  'src/components/pipeline/RoleVersionCard.tsx',
  'src/components/pipeline/RolePanel.tsx',
  'src/components/pipeline/Inspector.tsx',
  'src/hooks/useLibraryLatest.ts',
];
for (const file of files) {
  const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const lines = text.split('\n').filter((line) => !/^\s*(\/\/|\*|\{\/\*)/.test(line));
  const hit = lines.find((line) => quoted.test(line) || comparison.test(line));
  check(`${file}: ключей статусов, ролей и инструкций нет`, !hit, hit);
  check(`${file}: сырых цветов нет`, !rawColor.test(text), String(text.match(rawColor)));
  const unpaired = text.split('\n').find((line) => /\b(text|bg|border)-(red|amber|emerald|blue|green|orange)-[4-9]00\b(?!\/)/.test(line) && !/dark:(text|bg|border)-/.test(line));
  check(`${file}: у цветов есть пара для тёмной темы`, !unpaired, unpaired);
}
const rules = readFileSync(new URL('../src/components/pipeline/libraryRules.ts', import.meta.url), 'utf8');
check('модуль правил без React', !/from ['"]react/.test(rules));

console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
