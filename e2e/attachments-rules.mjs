// Правила вложений (CLAB-299) — без браузера и без бэкенда: тип → режим
// превью, предел текста, заголовок attachment, декодирование UTF-8, размеры,
// предел файла, имя как хранит сервер, порядок частей формы, виды контракта,
// прогон и версия роли для сдачи файла, цепочки версий. Модуль правил —
// чистые функции (src/components/task/attachmentRules.ts), поэтому
// проверяется прямо в исходниках, как правила панели этапа. Здесь же — код
// ошибки payload_too_large в клиенте и отсутствие ключей статусов и ролей в
// модулях вложений.
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

let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const MIB = 1024 * 1024;

// ── тип → режим превью (AC-25.1–25.3, AC-28.1) ──────────────────────────────
console.log('тип вложения → режим превью');
for (const t of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
  check(`${t} — картинка`, R.previewMode(t).mode === 'image');
}
check('application/pdf — PDF', R.previewMode('application/pdf').mode === 'pdf');
check('text/markdown — текст, разметка', same(R.previewMode('text/markdown'), {mode: 'text', text: 'markdown'}));
check('application/json — текст, код', same(R.previewMode('application/json'), {mode: 'text', text: 'json'}));
check('text/plain — текст как есть', same(R.previewMode('text/plain'), {mode: 'text', text: 'plain'}));
check('text/csv — текст как есть', same(R.previewMode('text/csv'), {mode: 'text', text: 'plain'}));
check('параметры и регистр типа не мешают', same(R.previewMode('Text/Markdown; charset=utf-8'), {mode: 'text', text: 'markdown'}));
check('HTML не рендерится никогда', R.previewMode('text/html').mode === 'none' && R.previewMode('text/html; charset=utf-8').mode === 'none');
check('SVG не рендерится никогда', R.previewMode('image/svg+xml').mode === 'none');
check('XHTML и XML — только скачать', R.previewMode('application/xhtml+xml').mode === 'none' && R.previewMode('text/xml').mode === 'none');
check('архив, офисный документ — только скачать',
  ['application/zip', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/octet-stream'].every((t) => R.previewMode(t).mode === 'none'));
check('неизвестный, пустой и отсутствующий тип — только скачать',
  R.previewMode('x-unknown/thing').mode === 'none' && R.previewMode('').mode === 'none' && R.previewMode(undefined).mode === 'none' && R.previewMode(null).mode === 'none');
check('тип похож на картинку, но не из перечня — только скачать', R.previewMode('image/tiff').mode === 'none' && R.previewMode('image/bmp').mode === 'none');
check('предел текста — 1 МиБ', R.TEXT_PREVIEW_MAX_BYTES === MIB);
check('текст ровно 1 МиБ — превью есть', R.previewMode('text/plain', MIB).mode === 'text');
check('текст на байт больше 1 МиБ — только скачать', R.previewMode('text/plain', MIB + 1).mode === 'none' && R.previewMode('application/json', 5 * MIB).mode === 'none');
check('крупная картинка и PDF предел текста не трогает', R.previewMode('image/png', 50 * MIB).mode === 'image' && R.previewMode('application/pdf', 50 * MIB).mode === 'pdf');
check('baseMediaType снимает параметры', R.baseMediaType(' IMAGE/PNG ; q=1') === 'image/png' && R.baseMediaType(undefined) === '');

// ── заголовок attachment (AC-28.3) ──────────────────────────────────────────
console.log('Content-Disposition: attachment');
check('attachment — превью не строится', R.isAttachmentDisposition('attachment; filename="a.png"; filename*=UTF-8\'\'a.png'));
check('регистр и пробелы не мешают', R.isAttachmentDisposition('  ATTACHMENT') && R.isAttachmentDisposition('Attachment;filename=x'));
check('inline — превью можно', !R.isAttachmentDisposition('inline; filename="a.png"'));
check('заголовка нет — превью можно', !R.isAttachmentDisposition(null) && !R.isAttachmentDisposition(undefined) && !R.isAttachmentDisposition(''));
check('слово attachment в имени файла не считается', !R.isAttachmentDisposition('inline; filename="attachment.png"'));

// ── UTF-8 (AC-25.2, R-8) ────────────────────────────────────────────────────
console.log('декодирование UTF-8');
const enc = new TextEncoder();
check('кириллица читается', R.decodeUtf8(enc.encode('Привет, мир — ёжик')) === 'Привет, мир — ёжик');
check('ArrayBuffer принимается так же', R.decodeUtf8(enc.encode('Привет').buffer) === 'Привет');
check('BOM отбрасывается', R.decodeUtf8(new Uint8Array([0xef, 0xbb, 0xbf, 0x61])) === 'a');
check('не UTF-8 (windows-1251) — null, остаётся «Скачать»', R.decodeUtf8(new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2])) === null);
check('оборванный многобайтный символ — null', R.decodeUtf8(new Uint8Array([0xd0])) === null);
check('пустой файл — пустая строка', R.decodeUtf8(new Uint8Array([])) === '');

// ── размеры и предел (AC-24.2, AC-24.3, UC-9) ───────────────────────────────
console.log('размеры и предел файла');
check('64 МиБ', R.formatBytes(64 * MIB) === '64 МиБ', R.formatBytes(64 * MIB));
check('байты и килобайты', R.formatBytes(0) === '0 Б' && R.formatBytes(1023) === '1023 Б' && R.formatBytes(1024) === '1 КиБ');
check('дробная часть через запятую', R.formatBytes(1536) === '1,5 КиБ' && R.formatBytes(2.25 * MIB) === '2,3 МиБ', R.formatBytes(2.25 * MIB));
check('ГиБ', R.formatBytes(3 * 1024 * MIB) === '3 ГиБ');
const limit = 64 * MIB;
const msg = R.fileLimitProblem('big.bin', limit + 1, limit);
check('файл больше предела — сообщение с пределом в МиБ', typeof msg === 'string' && msg.includes('64 МиБ') && msg.includes('big.bin') && msg.includes('не отправлен'), String(msg));
check('файл ровно в предел — уходит', R.fileLimitProblem('a', limit, limit) === null);
check('предела нет (сервер старше) — уходит любой', R.fileLimitProblem('a', 10 * limit, undefined) === null && R.fileLimitProblem('a', 10 * limit, 0) === null);
check('обрыв — понятное сообщение про повтор', /не сохранён/.test(R.UPLOAD_ABORTED) && /ещё раз/.test(R.UPLOAD_ABORTED));

// ── имя как хранит сервер (AC-25.4) ─────────────────────────────────────────
console.log('имя файла');
const art = (o = {}) => ({kind: 'doc', version: 2, format: 'markdown', ...o});
check('%22 остаётся буквально', R.fileNameOf(art({file_name: 'a%22b.png'})) === 'a%22b.png');
check('кириллица и пробелы как есть', R.fileNameOf(art({file_name: 'Отчёт за октябрь (1).pdf'})) === 'Отчёт за октябрь (1).pdf');
check('имени нет — вид, версия и формат', R.fileNameOf(art()) === 'doc-v2.md' && R.fileNameOf(art({format: 'json'})) === 'doc-v2.json');
check('незнакомый формат — .txt', R.fileNameOf(art({format: 'weird'})) === 'doc-v2.txt');

// ── порядок частей формы (AC-24.4, AC-27.1) ─────────────────────────────────
console.log('части формы');
const file = new File(['x'], 'a%22b.png', {type: 'image/png'});
const form = R.buildForm({title: 'a%22b.png', supersedes_id: '11111111-1111-1111-1111-111111111111'}, file);
check('поля идут до file', same([...form.keys()], ['title', 'supersedes_id', 'file']), JSON.stringify([...form.keys()]));
const contract = R.buildForm({kind: 'qa.shot', title: 't', stage_run_id: 'run-1', supersedes_id: undefined}, file);
check('сдача по контракту: kind, title, stage_run_id, затем file; пустое не кладётся',
  same([...contract.keys()], ['kind', 'title', 'stage_run_id', 'file']), JSON.stringify([...contract.keys()]));
check('имя файла в части — как выбрал человек, без раскодирования', contract.get('file').name === 'a%22b.png');
check('пустые поля не попадают в форму', !R.buildForm({title: '', supersedes_id: undefined}, file).has('title'));

// ── виды контракта, прогон, версия роли (AC-27.2) ───────────────────────────
console.log('виды для сдачи файла');
const item = (kind, extra = {}) => ({kind, title: kind, format: 'markdown', required: true, ...extra});
const contractItems = [item('shot'), item('spec', {schema: {type: 'object'}}), item('dump', {schema: null}), item('shot'), item('')];
check('контракт: без видов со схемой, без повторов, порядок сохранён', same(R.contractKinds(contractItems), ['shot', 'dump']), JSON.stringify(R.contractKinds(contractItems)));
check('контракта нет — пусто', R.contractKinds(undefined).length === 0 && R.contractKinds(null).length === 0 && R.contractKinds([]).length === 0);
const v = (id, version, output_contract) => ({id, version, output_contract});
check('виды из версии роли', same(R.fileKinds(v('v1', 1, contractItems), ['gate.kind']), ['shot', 'dump']));
check('контракта нет — виды гейтов', same(R.fileKinds(undefined, ['gate.kind']), ['gate.kind']));
check('в контракте только виды со схемой — виды гейтов', same(R.fileKinds(v('v1', 1, [item('spec', {schema: {}})]), ['gate.kind']), ['gate.kind']));
const run = (id, status_key, entered_at, extra = {}) => ({id, kind: 'stage', status_key, entered_at, ...extra});
const runs = [
  run('old', 'beta', '2026-10-01T10:00:00Z', {finished_at: '2026-10-01T11:00:00Z'}),
  run('cur', 'beta', '2026-10-02T10:00:00Z', {role_key: 'smith', role_version_id: 'v2'}),
  run('rev', 'beta', '2026-10-02T11:00:00Z', {kind: 'review'}),
  run('other', 'gamma', '2026-10-03T10:00:00Z'),
];
check('прогон: незавершённый, этапа, в статусе задачи', R.activeStageRun('beta', runs)?.id === 'cur');
check('перепроверка и чужой статус не берутся', R.activeStageRun('delta', runs) === undefined && R.activeStageRun('gamma', runs)?.id === 'other');
const versions = [v('v1', 1, []), v('v2', 2, [item('shot')]), v('v3', 3, [])];
check('версия роли — та, под которой идёт прогон', R.roleVersionOf(runs[1], versions)?.id === 'v2');
check('прогон ещё не забран — самая свежая версия', R.roleVersionOf(run('n', 'beta', '2026-10-04T10:00:00Z'), versions)?.id === 'v3');
check('версии под прогоном нет в списке — не гадаем', R.roleVersionOf(run('n', 'beta', 'x', {role_version_id: 'zzz'}), versions) === undefined);
check('прогона или версий нет — нет версии', R.roleVersionOf(undefined, versions) === undefined && R.roleVersionOf(runs[1], undefined) === undefined);

// ── цепочки версий вложений (AC-26.1) ───────────────────────────────────────
console.log('версии вложений');
const att = (id, version, added_at, supersedes_id) => ({id, version, added_at, supersedes_id, file_name: id, title: id});
const list = [
  att('a1', 1, '2026-10-01T10:00:00Z'),
  att('a2', 2, '2026-10-02T10:00:00Z', 'a1'),
  att('a3', 3, '2026-10-03T10:00:00Z', 'a2'),
  att('b1', 1, '2026-10-04T10:00:00Z'),
];
const groups = R.groupVersions(list);
check('текущие версии — новые сверху', same(groups.map((g) => g.current.id), ['b1', 'a3']), JSON.stringify(groups.map((g) => g.current.id)));
check('история — от более новой к старой', same(groups[1].history.map((h) => h.id), ['a2', 'a1']));
check('у вложения без версий истории нет', groups[0].history.length === 0);
check('пустой список', R.groupVersions([]).length === 0);

// ── код ошибки и ключи (AC-24.7) ────────────────────────────────────────────
console.log('код ошибки и источники');
const client = readFileSync(new URL('../src/api/client.ts', import.meta.url), 'utf8');
check('ErrorCode содержит payload_too_large', /\|\s*"payload_too_large"/.test(client));
check('сообщение сервера идёт в ApiError как есть (raise берёт error.message)', /err\?\.message \?\? `запрос завершился со статусом/.test(client));
check('отправка файла не ставит JSON-заголовок', !/xhr\.setRequestHeader\("Content-Type"/.test(client));
check('401 при отправке поднимает событие входа (через raise)', /function upload/.test(client) && /raise\(\s*\{ status: xhr\.status \}/.test(client));

const modules = [
  'src/components/task/attachmentRules.ts', 'src/components/task/AttachmentsSection.tsx', 'src/components/FileViewer.tsx',
  'src/components/task/fileItem.ts', 'src/components/FileTile.tsx', 'src/components/ArtifactView.tsx', 'src/components/fileContent.ts',
];
const forbidden = /['"`](analysis|development|testing|merge|release|new|done|cancelled|analytics|developer|reviewer|analyst)['"`]/;
for (const m of modules) {
  const src = readFileSync(new URL('../' + m, import.meta.url), 'utf8');
  check(`${m}: ключей статусов и ролей нет`, !forbidden.test(src), String(src.match(forbidden)));
}

console.log(`\nвложения, правила: ${ok} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
