// Состояние страницы «Пайплайн» в адресе (CLAB-346, design.spec v2 §3). Без
// React, чтобы правила разбора и перенаправления старых адресов проверялись
// без браузера (e2e/pipeline-layout.mjs).
//
// Выбор (статус, переход, роль, раскрытая версия роли, её режим «Документы» |
// «Изменения» и документ — CLAB-347), тип задач и версия цикла пишутся в историю: «Назад» возвращает прежний выбор. Вид холста
// (возвраты, просмотр пути, масштаб, мини-карта) — с replace: листать вид
// кнопкой «Назад» никто не хочет.

export interface PipelineParams {
  type?: string;
  wf?: string;
  status?: string;
  transition?: string;
  role?: string;
  v?: number;
  // Панель инструкции библиотеки (CLAB-351) и раскрытая её версия; режим
  // «Изменения» — тот же view=diff.
  instruction?: string;
  iv?: number;
  // Режим карточки версии роли: view=diff — «Изменения против vN-1», любое
  // иное значение и отсутствие — «Документы».
  view: RoleVersionView;
  // Выбранный документ версии; пустое — без выбора.
  doc?: string;
  showReturns: boolean;
  off: Set<string>;
  zoom: number;
  minimap: boolean;
}

export type RoleVersionView = 'docs' | 'diff';

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 1.5;
export const ZOOM_STEP = 0.1;
export const ZOOM_FIT_MAX = 0.7;

// Ключи вида: меняются с replace, а не записью в историю.
export const VIEW_KEYS = ['returns', 'off', 'zoom', 'minimap'] as const;

const clean = (v: string | null) => (v && v.trim() ? v.trim() : undefined);

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  const stepped = Math.round(z / ZOOM_STEP) * ZOOM_STEP;
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, stepped)) * 10) / 10;
}

export function parsePipelineParams(q: URLSearchParams): PipelineParams {
  const v = Number(q.get('v'));
  const iv = Number(q.get('iv'));
  const zoom = q.get('zoom');
  return {
    type: clean(q.get('type')),
    wf: clean(q.get('wf')),
    status: clean(q.get('status')),
    transition: clean(q.get('transition')),
    role: clean(q.get('role')),
    v: Number.isInteger(v) && v > 0 ? v : undefined,
    instruction: clean(q.get('instruction')),
    iv: Number.isInteger(iv) && iv > 0 ? iv : undefined,
    view: q.get('view') === 'diff' ? 'diff' : 'docs',
    doc: clean(q.get('doc')),
    showReturns: q.get('returns') !== '0',
    off: new Set((q.get('off') ?? '').split(',').map((k) => k.trim()).filter(Boolean)),
    zoom: zoom ? clampZoom(Number(zoom)) : 1,
    minimap: q.get('minimap') === '1',
  };
}

export type ParamPatch = Record<string, string | undefined>;

// Новый адрес из прежнего и правки: undefined и пустая строка ключ убирают,
// прочие параметры остаются как были.
export function patchParams(q: URLSearchParams, patch: ParamPatch): URLSearchParams {
  const next = new URLSearchParams(q);
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === '') next.delete(k);
    else next.set(k, v);
  }
  return next;
}

// Правка только вида холста пишется с replace.
export function isViewPatch(patch: ParamPatch): boolean {
  const keys = Object.keys(patch);
  return keys.length > 0 && keys.every((k) => (VIEW_KEYS as readonly string[]).includes(k));
}

export const zoomParam = (z: number) => (Math.abs(z - 1) < 1e-9 ? undefined : clampZoom(z).toFixed(1));
