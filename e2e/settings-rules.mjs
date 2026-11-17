// Правила вкладок настроек проекта (CLAB-39) без браузера: словарь ключей,
// правило «незнакомая — первая», адрес с экранированием, ключей проекта в
// модуле нет, возврат от GitHub и ссылка «Агенты и модели» строятся одним
// модулем, а страница настроек не держит раскрытых форм и ленты Separator.
// Модуль tabs.ts — чистые функции, проверяется прямо в исходниках.
import {readFileSync} from 'node:fs';

await import('./ts-resolve.mjs');
const T = await import('../src/components/settings/tabs.ts');

let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};
const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

console.log('словарь вкладок');
const keys = T.SETTINGS_TABS.map((t) => t.key);
check('восемь вкладок в порядке дизайна', keys.join() === 'members,teams,github,tokens,agents,transfer,audit,danger', keys.join());
check('подписи по-русски, подпись короче заголовка раздела',
  T.SETTINGS_TABS.map((t) => t.label).join() === 'Участники,Команды,GitHub,Токены,Агенты и модели,Перенос правил,Журнал,Опасная зона');
check('первая вкладка — участники', T.FIRST_SETTINGS_TAB === 'members');
check('ключи уникальны', new Set(keys).size === keys.length);

console.log('правило «незнакомая — первая»');
for (const k of keys) check(`${k} → ${k}`, T.settingsTab(k) === k);
for (const bad of [null, undefined, '', 'nope', 'MEMBERS', 'tokens ', '__proto__', 'constructor', 'analysis', 'developer']) {
  check(`${JSON.stringify(bad)} → первая`, T.settingsTab(bad) === 'members', String(T.settingsTab(bad)));
}

console.log('адрес настроек');
check('без вкладки — путь настроек', T.settingsHref('ACME') === '/p/ACME/settings');
check('с вкладкой — ?tab=', T.settingsHref('ACME', 'github') === '/p/ACME/settings?tab=github');
check('ключ проекта экранируется', T.settingsHref('A/B', 'agents') === '/p/A%2FB/settings?tab=agents' && T.settingsHref('A/B') === '/p/A%2FB/settings');

console.log('код');
const tabs = src('../src/components/settings/tabs.ts');
check('tabs.ts — без React и без пути @/ (проверяется без сборщика)', !/from 'react|from '@\//.test(tabs));
check('в словаре нет ключей статусов, ролей и циклов проекта (AC-4)',
  !/analysis|development|testing|merge|release|developer|analytics|designer|integrator|Simple|Epic/.test(tabs.replace(/\/\/.*$/gm, '')));
const page = src('../src/pages/Settings.tsx');
check('адрес вкладки берётся из ?tab= и пишется с записью в историю (без replace)',
  /params\.get\('tab'\)/.test(page) && !/replace:\s*true/.test(page));
check('ленты через Separator на странице нет', !/Separator/.test(page));
check('вкладки без собственных ключей: словарь из tabs.ts', /SETTINGS_TABS\.map/.test(page));
check('активация вкладок ручная', /activationMode="manual"/.test(page));
check('вкладка агентов остаётся смонтированной', /value="agents"[\s\S]{0,80}forceMount/.test(page));
check('опоры сценариев на кнопке и панели', /data-settings-tab=/.test(page) && /data-settings-panel=/.test(page));
check('возврат от GitHub из настроек и «Подключить ещё аккаунт» ведут на вкладку GitHub',
  /settingsHref\(projectKey, 'github'\)/.test(page) && /settingsHref\(projectKey, 'github'\)/.test(src('../src/pages/GitHubConnect.tsx')));
check('адрес возврата GitHub App не менялся', /GITHUB_CONNECT_PATH = '\/settings\/github\/callback'/.test(src('../src/api/github.ts')));
check('ссылка «Агенты и модели» строится settingsHref', /settingsHref\(key, 'agents'\)/.test(src('../src/components/cli.ts')));
check('карточек раскрытых форм «Добавить/Пустить/Выдать» на странице нет',
  !/Добавить или изменить уровень|Пустить команду или изменить уровень|<h3[^>]*>Выдать токен/.test(page));
check('роли токена — MultiSelector, срок — NumberInput, разбора через запятую нет',
  /MultiSelector/.test(src('../src/components/settings/IssueTokenDialog.tsx')) && /NumberInput/.test(src('../src/components/settings/IssueTokenDialog.tsx')) &&
    !/\.split\(','\)/.test(page + src('../src/components/settings/IssueTokenDialog.tsx')));
const issue = src('../src/components/settings/IssueTokenDialog.tsx');
check('токен не пишется в хранилища, адрес и тост', !/localStorage|sessionStorage|history\.|toast[^;]*token/.test(issue.replace(/\/\/.*$/gm, '')));
check('диалог токена: Esc, клик мимо и крестик не закрывают показ', /showCloseButton=\{!shown\}/.test(issue) && /onEscapeKeyDown/.test(issue) && /onPointerDownOutside/.test(issue));
const kit = src('../src/components/kit.tsx');
check('Section: details необязательный, без него описание прежнее', /details\?: React\.ReactNode/.test(kit) && /description \? \(\s*<p className="text-muted-foreground text-sm">/.test(kit));
const invites = src('../src/components/Invites.tsx');
check('InviteDialog не тронут: клик мимо по-прежнему закрывает его', !/onInteractOutside|onEscapeKeyDown/.test(invites));

console.log(`\n${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
