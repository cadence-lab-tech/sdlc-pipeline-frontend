// Правила плиток файлов (CLAB-308) — без браузера и без бэкенда: цепочка
// версий одной функцией для артефактов и вложений, приведение обоих к одному
// виду плитки, подписи плитки, право «Принять». Модули — чистые функции
// (src/components/task/attachmentRules.ts и fileItem.ts), поэтому проверяются
// прямо в исходниках. Здесь же — сырые цвета в модулях плитки и модалки.
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

const R = await import('../src/components/task/attachmentRules.ts');
const F = await import('../src/components/task/fileItem.ts');

let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── цепочка версий: одно правило на артефакты и вложения ────────────────────
console.log('цепочка версий');
const v = (id, supersedes_id) => ({id, supersedes_id});
const chain = [v('a1'), v('a2', 'a1'), v('a3', 'a2'), v('b1')];
check('прежние версии от новой к старой', same(R.versionHistory(chain, 'a3').map((x) => x.id), ['a2', 'a1']));
check('у первой версии истории нет', R.versionHistory(chain, 'a1').length === 0);
check('у середины цепочки — только то, что до неё', same(R.versionHistory(chain, 'a2').map((x) => x.id), ['a1']));
check('чужой id и пустой список — пусто', R.versionHistory(chain, 'zzz').length === 0 && R.versionHistory([], 'a1').length === 0);
check('null в supersedes_id — как отсутствие', R.versionHistory([v('x', null)], 'x').length === 0);
check('цикл в данных обрывается, а не зависает', same(R.versionHistory([v('p', 'q'), v('q', 'p')], 'p').map((x) => x.id), ['q']));
const groups = R.versionGroups(chain);
check('текущие — те, на кого никто не указывает', same(groups.map((g) => g.current.id), ['a3', 'b1']));
check('корень цепочки не меняется, когда выходит новая версия',
  R.versionRoot(groups[0].current, groups[0].history) === 'a1'
  && R.versionRoot(v('a2', 'a1'), [v('a1')]) === 'a1'
  && R.versionRoot(v('a1'), []) === 'a1');
const att = (id, version, added_at, supersedes_id) => ({id, version, added_at, supersedes_id, file_name: id + '.png', title: id, media_type: 'image/png', size_bytes: 10, added_by: 'web'});
check('вложения: groupVersions по-прежнему новые сверху',
  same(R.groupVersions([att('a1', 1, '2026-10-01T00:00:00Z'), att('b1', 1, '2026-10-02T00:00:00Z')]).map((g) => g.current.id), ['b1', 'a1']));

// ── артефакт → плитка ───────────────────────────────────────────────────────
console.log('плитка артефакта');
const runs = [
  {id: 'r1', role_key: 'scribe', role_version: 7},
  {id: 'r2', role_key: 'smith'},
];
const art = (extra = {}) => ({
  id: 'x1', kind: 'doc.main', title: 'Главный документ', format: 'markdown', size_bytes: 2048, version: 3,
  created_at: '2026-10-05T10:00:00Z', stage_run_id: 'r1', ...extra,
});
const t = F.artifactItem(art(), runs);
check('поля текстового артефакта', t.id === 'x1' && t.title === 'Главный документ' && t.kind === 'doc.main' && t.version === 3 && !t.isFile && !t.attachment && t.sizeBytes === 2048, JSON.stringify(t));
check('роль прогона с версией', t.role === 'scribe v7');
check('роль без версии — только ключ', F.artifactItem(art({stage_run_id: 'r2'}), runs).role === 'smith');
check('прогона нет в списке — роли нет', F.artifactItem(art({stage_run_id: 'nope'}), runs).role === '' && F.artifactItem(art({stage_run_id: undefined}), runs).role === '');
check('имя текста — вид, версия, расширение формата', t.name === 'doc.main-v3.md');
check('имя json — .json', F.artifactItem(art({format: 'json'}), runs).name === 'doc.main-v3.json');
check('время — время сдачи', t.at === '2026-10-05T10:00:00Z');
check('принят, если задан approved_by', !t.approved && F.artifactItem(art({approved_by: 'u1'}), runs).approved);
const bin = F.artifactItem(art({format: 'binary', file_name: 'макет.png', media_type: 'image/png', size_bytes: 70}), runs);
check('файл по контракту: isFile, имя и тип с сервера', bin.isFile && bin.name === 'макет.png' && bin.mediaType === 'image/png' && !bin.attachment, JSON.stringify(bin));
check('вложение, сданное артефактом, — attachment', F.artifactItem(art({format: 'binary', is_attachment: true}), runs).attachment);

console.log('плитка вложения');
const a = F.attachmentItem(att('a1', 2, '2026-10-06T10:00:00Z', 'a0'));
check('вложение приводится к файлу', a.isFile && a.attachment && a.format === 'binary' && a.version === 2 && a.kind === '' && a.role === '' && a.by === 'web', JSON.stringify(a));
check('заголовок вложения — имя как хранит сервер', a.title === 'a1.png' && a.name === 'a1.png');
check('имя с %22 не раскодируется', F.attachmentItem({...att('q', 1, 'x'), file_name: 'a%22b.png'}).name === 'a%22b.png');

// ── подписи ─────────────────────────────────────────────────────────────────
console.log('подписи плитки');
check('вторая строка текста — вид', F.fileSubtitle(t) === 'doc.main');
check('вторая строка файла — имя и тип', F.fileSubtitle(bin) === 'макет.png · image/png');
check('у вложения имя не повторяется заголовком', F.fileSubtitle(a) === 'image/png');
check('тип не указан — так и сказано', F.fileSubtitle({...bin, mediaType: ''}) === 'макет.png · тип не указан');
check('факты: роль и размер', same(F.fileFacts(t), ['scribe v7', '2 КиБ']), JSON.stringify(F.fileFacts(t)));
check('факты вложения: автор и размер', same(F.fileFacts(a), ['web', '10 Б']));
check('факты без роли — только размер', same(F.fileFacts(F.artifactItem(art({stage_run_id: undefined}), runs)), ['2 КиБ']));
check('строка версии в истории', F.versionLine(t) === 'v3 · scribe v7 · 2 КиБ', F.versionLine(t));
check('якорь артефакта', F.artifactAnchor('x1') === 'artifact-x1');

// ── «Принять» ───────────────────────────────────────────────────────────────
console.log('право «Принять»');
check('непринятому текущему артефакту этапа — можно', F.canApprove(t, true));
check('принятому — нельзя', !F.canApprove({...t, approved: true}, true));
check('вложению — нельзя (решение 0064)', !F.canApprove(a, true));
check('прежней версии — нельзя', !F.canApprove(t, false));
check('файлу этапа — можно', F.canApprove(bin, true));

// ── цвета и ключи ───────────────────────────────────────────────────────────
console.log('оформление и источники');
const modules = [
  'src/components/FileTile.tsx', 'src/components/ArtifactView.tsx', 'src/components/FileViewer.tsx',
  'src/components/task/AttachmentsSection.tsx', 'src/components/task/fileItem.ts', 'src/components/fileContent.ts',
];
const rawColor = /#[0-9a-fA-F]{3,8}\b|rgba?\(|\bbg-white\b|\btext-black\b|\bbg-black\b|\btext-white\b/;
const forbidden = /['"`](analysis|development|testing|merge|release|new|done|cancelled|analytics|developer|reviewer|analyst)['"`]/;
for (const m of modules) {
  const src = readFileSync(new URL('../' + m, import.meta.url), 'utf8');
  check(`${m}: сырых цветов нет, только токены темы`, !rawColor.test(src), String(src.match(rawColor)));
  check(`${m}: ключей статусов и ролей нет`, !forbidden.test(src), String(src.match(forbidden)));
}
const tile = readFileSync(new URL('../src/components/FileTile.tsx', import.meta.url), 'utf8');
check('содержимое плитка не запрашивает: запрос только внутри модалки (useCachedText в FileDialogView)',
  !/api\.artifactContent|api\.artifactFile/.test(tile) && /function FileDialogView[\s\S]*useCachedText/.test(tile));

console.log(`\nплитки файлов, правила: ${ok} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
