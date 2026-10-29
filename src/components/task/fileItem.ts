// Файл задачи, каким его видит плитка и модалка (CLAB-308): артефакт этапа и
// вложение приводятся к одному виду, и два раздела карточки рисуются одним
// компонентом. Чистые функции без React и без клиента API —
// e2e/file-tile-rules.mjs проверяет их прямо в исходниках, без браузера.
import type {Artifact, Attachment, StageRun, UUID} from '../../api/types';
import {fileNameOf, formatBytes} from './attachmentRules';
import {roleWithVersion} from './stagePanel';

export interface FileItem {
  id: UUID;
  title: string;
  // Вид артефакта по контракту роли; у вложения его нет.
  kind: string;
  version: number;
  // Формат артефакта; у файла и вложения — binary.
  format: string;
  // Файл не читается как текст: просмотр по типу, а не по формату.
  isFile: boolean;
  // Имя для сохранения: то, что хранит сервер, а у текста — kind-vN.<формат>.
  name: string;
  mediaType: string;
  sizeBytes: number;
  // Роль прогона с версией, «analytics v7»; у вложения пусто.
  role: string;
  // Кто приложил: только у вложения.
  by: string;
  // Когда сдан или приложен.
  at: string;
  approved: boolean;
  attachment: boolean;
}

// Роль берётся из прогона, в котором сдан артефакт (stage_run_id). Прогона в
// списке нет — роль пустая, плитка её не показывает.
export function artifactItem(a: Artifact, runs: Pick<StageRun, 'id' | 'role_key' | 'role_version'>[]): FileItem {
  const run = a.stage_run_id ? runs.find((r) => r.id === a.stage_run_id) : undefined;
  return {
    id: a.id,
    title: a.title,
    kind: a.kind,
    version: a.version,
    format: a.format,
    isFile: a.format === 'binary',
    name: fileNameOf(a),
    mediaType: a.media_type ?? '',
    sizeBytes: a.size_bytes,
    role: run ? roleWithVersion(run) : '',
    by: '',
    at: a.created_at,
    approved: Boolean(a.approved_by),
    attachment: Boolean(a.is_attachment),
  };
}

export function attachmentItem(a: Attachment): FileItem {
  return {
    id: a.id,
    // Имя как хранит сервер: заголовок вложения — оно же.
    title: a.file_name || a.title,
    kind: '',
    version: a.version,
    format: 'binary',
    isFile: true,
    name: a.file_name,
    mediaType: a.media_type,
    sizeBytes: a.size_bytes,
    role: '',
    by: a.added_by,
    at: a.added_at,
    approved: false,
    attachment: true,
  };
}

// Вторая строка плитки: у файла — имя и тип, у текста — вид артефакта.
export function fileSubtitle(item: FileItem): string {
  if (item.isFile) {
    const name = item.name;
    // Заголовок вложения — само имя: повторять его второй строкой незачем.
    const head = name && name !== item.title ? `${name} · ` : '';
    return `${head}${item.mediaType || 'тип не указан'}`;
  }
  return item.kind;
}

// Строка фактов без времени (время рисует Timestamp, он умеет подсказку):
// роль прогона или автор вложения и размер.
export function fileFacts(item: FileItem): string[] {
  return [item.role || item.by, formatBytes(item.sizeBytes)].filter(Boolean);
}

// Строка выбранной версии в истории: «v1 · analytics v7 · 1,2 КиБ».
export function versionLine(item: FileItem): string {
  return [`v${item.version}`, ...fileFacts(item)].join(' · ');
}

// Правки артефакта не бывает (иммутабелен), принять можно только текущую
// версию этапа, не вложение и не принятую (вложение в гейтах не участвует,
// решение 0064; прежняя версия — гейты её не читают).
export function canApprove(item: FileItem, isCurrent: boolean): boolean {
  return isCurrent && !item.approved && !item.attachment;
}

// Якорь плитки артефакта: на него ведёт ссылка на описание проблемы из строки
// возврата.
export const artifactAnchor = (id: string) => `artifact-${id}`;
