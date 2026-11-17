// Вкладки настроек проекта (CLAB-39): словарь ключей, правило «незнакомая —
// первая» и адрес настроек. Без React и без пути @/, чтобы cli.ts и проверки
// без браузера (e2e/settings-rules.mjs) импортировали модуль прямо из
// исходников, как pipeline/params.ts.
//
// Ключи — слова словаря интерфейса, а не данные проекта: ни статусов, ни
// ролей, ни циклов здесь нет.

export const SETTINGS_TABS = [
  {key: 'members', label: 'Участники'},
  {key: 'teams', label: 'Команды'},
  {key: 'github', label: 'GitHub'},
  {key: 'tokens', label: 'Токены'},
  {key: 'agents', label: 'Агенты и модели'},
  {key: 'transfer', label: 'Перенос правил'},
  {key: 'audit', label: 'Журнал'},
  {key: 'danger', label: 'Опасная зона'},
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]['key'];

export const FIRST_SETTINGS_TAB: SettingsTab = SETTINGS_TABS[0].key;

// Вкладка из значения `?tab=`: в словаре — она, иначе (нет параметра, пустой,
// незнакомый) — первая. Адрес при этом не переписывается.
export function settingsTab(value: string | null | undefined): SettingsTab {
  const found = SETTINGS_TABS.find((t) => t.key === value);
  return found ? found.key : FIRST_SETTINGS_TAB;
}

// Единственное место, где строится адрес настроек проекта: ключ проекта
// экранируется, вкладка — строкой запроса.
export function settingsHref(projectKey: string, tab?: SettingsTab): string {
  const base = `/p/${encodeURIComponent(projectKey)}/settings`;
  return tab ? `${base}?tab=${tab}` : base;
}
