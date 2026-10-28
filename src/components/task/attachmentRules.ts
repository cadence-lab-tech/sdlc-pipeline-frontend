// Правила вложений (CLAB-299) — чистые функции без React и без клиента API,
// чтобы e2e/attachments-rules.mjs проверял их прямо в исходниках, без
// браузера: тип → режим превью, имя файла, предел, порядок частей формы,
// выбор видов контракта.
import type {Artifact, Attachment, OutputContractItem, RoleVersion, StageRun} from '../../api/types';

// Текст раскрывается по действию, но крупнее этого предела не читается
// в страницу вовсе: тянуть мегабайты текста в DOM незачем, остаётся
// «Скачать».
export const TEXT_PREVIEW_MAX_BYTES = 1024 * 1024;

export type TextFormat = 'markdown' | 'json' | 'plain';

export type Preview =
  | {mode: 'image'}
  | {mode: 'pdf'}
  | {mode: 'text'; text: TextFormat}
  | {mode: 'none'};

const NONE: Preview = {mode: 'none'};

// Тип без параметров и регистра: `Text/Plain; charset=utf-8` → `text/plain`.
export function baseMediaType(mediaType?: string | null): string {
  return (mediaType ?? '').split(';')[0].trim().toLowerCase();
}

// Allowlist интерфейса, тот же перечень, что inline у сервера. Режим
// определяет тип вложения, а не `format` (у файла он всегда `binary`) и не
// имя. Всё вне перечня — только «Скачать»; в первую очередь text/html и
// image/svg+xml: они исполнились бы в origin интерфейса, поэтому не
// рендерятся никогда, даже когда заявлены как картинка. Крупный текст —
// тоже только «Скачать».
export function previewMode(mediaType?: string | null, sizeBytes?: number): Preview {
  switch (baseMediaType(mediaType)) {
    case 'image/png':
    case 'image/jpeg':
    case 'image/gif':
    case 'image/webp':
      return {mode: 'image'};
    case 'application/pdf':
      return {mode: 'pdf'};
    case 'text/markdown':
      return textPreview('markdown', sizeBytes);
    case 'application/json':
      return textPreview('json', sizeBytes);
    case 'text/plain':
    case 'text/csv':
      return textPreview('plain', sizeBytes);
    default:
      return NONE;
  }
}

function textPreview(text: TextFormat, sizeBytes?: number): Preview {
  if (sizeBytes !== undefined && sizeBytes > TEXT_PREVIEW_MAX_BYTES) return NONE;
  return {mode: 'text', text};
}

// Сервер отвечает `Content-Disposition: attachment`, когда сигнатура файла не
// сошлась с заявленным типом: тогда превью не строится, как бы ни назывался
// тип в списке (защита в глубину).
export function isAttachmentDisposition(header?: string | null): boolean {
  return /^\s*attachment\b/i.test(header ?? '');
}

// UTF-8 декодируется самим интерфейсом: сервер отдаёт текст без charset, и
// полагаться на браузер нельзя. Не UTF-8 — null, остаётся «Скачать».
export function decodeUtf8(bytes: ArrayBuffer | Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch {
    return null;
  }
}

const UNITS = ['Б', 'КиБ', 'МиБ', 'ГиБ'];

// Размер в человеческих единицах, двоичных: сервер считает предел в МиБ
// (64 МиБ), и «67108864» читателю ничего не говорит.
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const rounded = unit === 0 || Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
  return `${rounded.replace('.', ',')} ${UNITS[unit]}`;
}

// Отказ до отправки: предел известен и файл больше. Предела нет (сервер
// старше) — null, запрос уходит, и отказ придёт от сервера.
export function fileLimitProblem(name: string, size: number, limit?: number): string | null {
  if (!limit || limit <= 0 || size <= limit) return null;
  return `Файл «${name}» (${formatBytes(size)}) больше предела сервера — ${formatBytes(limit)}. Файл не отправлен.`;
}

// Обрыв отправки: срок загрузки на сервере кончается обрывом соединения без
// ответа, и от обрыва сети он неотличим — сообщение одно на оба случая.
export const UPLOAD_ABORTED =
  'Файл не сохранён: соединение оборвалось — истёк срок загрузки или пропала сеть. Попробуйте ещё раз.';

// Имя для показа и сохранения — то, что хранит сервер, как есть: `a%22b.png`
// остаётся `a%22b.png`, раскодировать его нечем и незачем. У текстового
// артефакта этапа имени нет, оно собирается из вида, версии и формата.
const EXTENSIONS: Record<string, string> = {
  markdown: '.md',
  json: '.json',
  yaml: '.yaml',
  diff: '.diff',
  html: '.html',
  text: '.txt',
};

export function fileNameOf(a: Pick<Artifact, 'file_name' | 'kind' | 'version' | 'format'>): string {
  if (a.file_name) return a.file_name;
  return `${a.kind}-v${a.version}${EXTENSIONS[a.format] ?? '.txt'}`;
}

// Части формы: поля идут до `file` — сервер читает форму потоком и на части
// `file` останавливается (readUploadForm), поле после неё он не увидит. Пустые
// поля в форму не кладутся.
export function buildForm(fields: Record<string, string | undefined>, file: File): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value) form.append(name, value);
  }
  form.append('file', file, file.name);
  return form;
}

// Виды для сдачи файла: из контракта роли, без видов со схемой — файл под
// такой вид сервер не примет (400). Порядок контракта, без повторов.
export function contractKinds(contract: OutputContractItem[] | undefined | null): string[] {
  const kinds: string[] = [];
  for (const item of contract ?? []) {
    if (!item.kind || (item.schema !== undefined && item.schema !== null)) continue;
    if (!kinds.includes(item.kind)) kinds.push(item.kind);
  }
  return kinds;
}

// Прогон, в который сдаётся файл по контракту: незавершённый прогон этапа
// (не перепроверки) в текущем статусе задачи, самый поздний. Статус берётся
// из данных задачи, а не из списка в коде. Прогона нет — файл уйдёт без
// stage_run_id, и этап выберет сервер, как при сдаче текста.
export function activeStageRun(statusKey: string, runs: StageRun[]): StageRun | undefined {
  return runs
    .filter((r) => r.kind === 'stage' && r.status_key === statusKey && !r.finished_at)
    .sort((a, b) => b.entered_at.localeCompare(a.entered_at))[0];
}

// Версия роли прогона: та, под которой он идёт; у прогона без снимка версии
// (ещё не забран) — самая свежая версия роли.
export function roleVersionOf(run: StageRun | undefined, versions: RoleVersion[] | undefined): RoleVersion | undefined {
  if (!run || !versions?.length) return undefined;
  return (
    versions.find((v) => v.id === run.role_version_id) ??
    (run.role_version_id ? undefined : [...versions].sort((a, b) => b.version - a.version)[0])
  );
}

// Виды режима «Файл»: контракт версии роли без видов со схемой; контракта
// нет или в нём нечего сдавать файлом — виды гейтов, как в режиме «Текст».
export function fileKinds(version: RoleVersion | undefined, gateKinds: string[]): string[] {
  const fromContract = contractKinds(version?.output_contract);
  return fromContract.length ? fromContract : gateKinds;
}

// Текущие версии и цепочки прежних: сервер отдаёт всё одним списком
// (include_superseded), версию заменяет та, чей supersedes_id на неё указывает.
// Прежние версии выстроены от более новой к старой.
export function groupVersions(list: Attachment[]): {current: Attachment; history: Attachment[]}[] {
  const byId = new Map(list.map((a) => [a.id, a]));
  const replaced = new Set(list.map((a) => a.supersedes_id).filter(Boolean));
  return list
    .filter((a) => !replaced.has(a.id))
    .map((current) => {
      const history: Attachment[] = [];
      for (let prev = byId.get(current.supersedes_id ?? ''); prev; prev = byId.get(prev.supersedes_id ?? '')) {
        history.push(prev);
      }
      return {current, history};
    })
    .sort((a, b) => b.current.added_at.localeCompare(a.current.added_at));
}
