// Ссылка задачи на тикет основного трекера (CLAB-95): `tasks.external_ref` —
// объект «система → {key, url}». Список систем — данные, а не код, поэтому
// подпись строится из ключа системы как есть.
export interface ExternalLink {
  system: string;
  key: string;
  url: string;
}

// externalLinks отбирает ссылки, которые можно показать кликабельными.
// Бэкенд пишет только http(s), но старые данные могут быть любыми: у эпиков,
// перенесённых миграцией 000011, лежит `legacy_epic_key` строкой. Запись не той
// формы и URL не http(s) пропускаются молча — `javascript:` в href это дыра,
// а не опечатка.
export function externalLinks(ref: unknown): ExternalLink[] {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return [];
  const out: ExternalLink[] = [];
  for (const [system, value] of Object.entries(ref as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const {key, url} = value as {key?: unknown; url?: unknown};
    if (typeof key !== 'string' || key.trim() === '' || typeof url !== 'string') continue;
    if (!isWebURL(url)) continue;
    out.push({system, key, url});
  }
  return out.sort((a, b) => a.system.localeCompare(b.system));
}

function isWebURL(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.host !== '';
  } catch {
    return false;
  }
}
