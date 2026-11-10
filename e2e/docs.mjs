// Страница /docs — подключение локального проекта (CLAB-232, критерии 16 и
// 17): пункт меню, команды с адресом инстанса и ключом проекта, копирование
// кнопкой, скилы набора с /v1/agent-kit. Данных не меняет; профиль стенда
// не важен.
//
// Чего стенд дать не может (сервер без набора, пользователь без проектов),
// подменяется в браузере ответом одной ручки — остальной бэкенд живой.
import {session, helpers} from './driver.mjs';
import {
  BREW_COMMAND,
  GUIDE_COMMAND,
  KEY_PLACEHOLDER,
  PLUGIN_COMMAND,
  agentSettingsHref,
  codexAddCommand,
  codexTokenCommand,
  docsHref,
  installCommand,
  loginCommand,
  markerBlock,
  mcpAddCommand,
  mcpJSON,
  promptCommand,
  setupCommand,
  waitCommand,
} from '../src/components/cli.ts';

const BASE = process.env.SDLC_UI_URL ?? 'http://localhost:5173';
const API = process.env.SDLC_API_URL ?? 'http://localhost:8088';
const ORIGIN = new URL(BASE).origin;
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── правила без браузера ────────────────────────────────────────────────────
// Подробно правила новых команд — в docs-rules.mjs; здесь только то, что
// страница берёт у cli.ts.
console.log('команды подключения');
check('clab setup с ключом', setupCommand('ACME') === 'clab setup --project ACME', setupCommand('ACME'));
check('без проекта — заглушка', setupCommand() === `clab setup --project ${KEY_PLACEHOLDER}`, setupCommand());
// Ожидание апрува (CLAB-323): флаги — те, что есть в clab wait --help.
const wait = waitCommand('ACME');
check('clab wait с ключом проекта и флагами', wait.includes('clab wait ACME-12 --gate human_approval --timeout 8h --json')
  && wait.includes('clab heartbeat ACME-12 --with-credentials --'), wait);
check('clab wait без проекта — заглушка', waitCommand().includes(`clab wait ${KEY_PLACEHOLDER}-12`), waitCommand());
const add = mcpAddCommand('https://clab.acme.io', 'ACME');
check(
  'claude mcp add на адрес инстанса, токен — из clab auth token',
  add.includes('claude mcp add --transport http --scope local sdlc https://clab.acme.io/mcp/projects/ACME') &&
    add.includes('Bearer $(clab auth token)'),
  add,
);
const cfg = JSON.parse(mcpJSON('https://clab.acme.io', 'ACME'));
check('JSON для других агентов', cfg.mcpServers.sdlc.url === 'https://clab.acme.io/mcp/projects/ACME' && cfg.mcpServers.sdlc.type === 'http' && cfg.mcpServers.sdlc.headers.Authorization === 'Bearer ${SDLC_TOKEN}', JSON.stringify(cfg));
check('Codex: имя сервера по ключу, токен — именем переменной',
  codexAddCommand('https://clab.acme.io', 'ACME') === 'codex mcp add sdlc-acme --url https://clab.acme.io/mcp/projects/ACME --bearer-token-env-var SDLC_TOKEN', codexAddCommand('https://clab.acme.io', 'ACME'));
check('плагин — без ключа и адреса', PLUGIN_COMMAND === 'clab setup --plugin', PLUGIN_COMMAND);
check('ссылка со страницы проекта несёт ключ', docsHref('ACME') === '/docs?project=ACME' && docsHref() === '/docs', docsHref('ACME'));

// ── в браузере ──────────────────────────────────────────────────────────────
const server = await (await fetch(API + '/v1/instance')).json();
const kit = await (await fetch(API + '/v1/agent-kit')).json();
console.log(`стенд: версия ${server.version}, набор ${kit.version}, скилов ${kit.skills.length}`);

const override = (path, status, body) => `(() => {
  const orig = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.pathname === ${JSON.stringify(path)}) {
      return new Response(${JSON.stringify(JSON.stringify(body))}, {status: ${status}, headers: {'Content-Type': 'application/json'}});
    }
    return orig(input, init);
  };
})();`;

const s = await session(BASE + '/projects');
const run = (body) => s.evaluate(helpers + body);
await s.resize(1360, 900);
await s.grant(['clipboardReadWrite', 'clipboardSanitizedWrite'], ORIGIN);
const blocks = () => run(`return all('pre.code-block').map((pre) => pre.textContent.trim());`);
const navHref = () => run(`
  const a = all('[data-sidebar=content] a').find((el) => el.innerText.trim() === 'Подключение');
  return a ? a.getAttribute('href') : null;
`);
const withOverride = async (src, fn) => {
  const id = await s.addInitScript(src);
  try {
    return await fn();
  } finally {
    await s.removeInitScript(id);
  }
};

console.log('К16: пункт «Подключение» в глобальной группе меню');
await s.goto(BASE + '/projects');
await sleep(1500);
check('вне проекта — /docs', (await navHref()) === '/docs', String(await navHref()));
await s.goto(BASE + '/p/SDLC/overview');
await sleep(1500);
check('со страницы проекта — с его ключом', (await navHref()) === '/docs?project=SDLC', String(await navHref()));
await run('await click("Подключение", "a"); await sleep(1200); return 1;');
check('ведёт на /docs', await run('return location.pathname + location.search;') === '/docs?project=SDLC');

console.log('К16: команды с адресом инстанса и ключом проекта');
let b = await blocks();
for (const [name, cmd] of [
  ['Homebrew', BREW_COMMAND],
  ['install.sh по версии сервера', installCommand(server.version)],
  [`вход с --host ${ORIGIN}`, loginCommand(ORIGIN)],
  ['clab setup --project SDLC', setupCommand('SDLC')],
  ['claude mcp add', mcpAddCommand(ORIGIN, 'SDLC')],
  ['Codex: codex mcp add', codexAddCommand(ORIGIN, 'SDLC')],
  ['Codex: токен в переменную', codexTokenCommand],
  ['JSON mcpServers', mcpJSON(ORIGIN, 'SDLC')],
  ['строка привязки каталога', markerBlock(ORIGIN, 'SDLC')],
  ['clab guide', GUIDE_COMMAND],
  ['clab prompt work с ключом проекта', promptCommand('SDLC')],
  ['clab wait с ключом проекта', waitCommand('SDLC')],
]) {
  check(name, b.includes(cmd.trim()), JSON.stringify(b));
}
let page = await run('return texts();');
for (const sk of kit.skills) {
  check(`скил /${sk.name} с описанием`, page.includes('/' + sk.name) && page.includes(sk.description.slice(0, 40)), sk.name);
}
check('версия набора на странице', page.includes(`Версия набора — ${kit.version}`), page.slice(0, 200));
check('раздел коннекторов', page.includes('Коннекторы и плагины') && page.includes('--external-ref'), '');

console.log('CLAB-423: clab setup по агентам');
check('прежних утверждений о Claude нет', !page.includes('подключает MCP-сервер проекта к Claude Code') && !page.includes('--agent other'), '');
check('ставит набор и подключает MCP каждому найденному агенту; без привязки печатает конфигурацию',
  page.includes('каждому найденному агенту') && page.includes('печатает конфигурацию MCP'), '');
check('значения --agent', ['--agent auto', '--agent claude', '--agent codex', '--agent generic'].every((t) => page.includes(t)) && page.includes('по умолчанию'), '');
check('незнакомый агент пропускается с предупреждением', page.includes('не знает') && page.includes('пропускает с предупреждением'), '');
check('куда ложится набор', ['.claude/skills', '.claude/agents', '.agents/skills', '.codex/agents'].every((t) => page.includes(t)), '');
check('--scope по агентам, --trust, --force, --dry-run, повторный запуск',
  ['--scope user', '--scope project', '--trust', '--force', '--dry-run', '--no-marker', 'Повторный запуск безвреден'].every((t) => page.includes(t)), '');
check('версий агентов числами нет', !/2\.1\.296|0\.167\.0/.test(page), '');

console.log('CLAB-423: MCP вручную по агентам');
check('три блока подряд: Claude Code, Codex, другой агент', (await run(`return all('[data-agent-block]').map((e) => e.getAttribute('data-agent-block')).join();`)) === 'claude,codex,generic', '');
check('Codex: переменная нужна при запуске, в config.toml токена нет', page.includes('Переменная SDLC_TOKEN нужна при запуске Codex') && page.includes('токена нет'), '');
check('другой агент: clab mcp config и запрет класть в репозиторий', page.includes('clab mcp config') && page.includes('класть её в репозиторий нельзя'), '');

console.log('CLAB-423: вход для любого агента');
check('справка и стартовая инструкция — вход для любого агента', page.includes('Вход для любого агента') && page.includes('в том числе без скилов и MCP-промптов') && page.includes('тот же текст, что у MCP-промпта'), '');
check('скил по имени — частный случай', page.includes('/clab-work SDLC-12') && page.includes('$clab-work SDLC-12') && page.includes('способ привязки агента'), '');
check('прежней фразы «В Claude Code скил зовётся по имени» нет', !page.includes('В Claude Code скил зовётся по имени'), '');

console.log('CLAB-423: строка привязки');
check('пояснение: кто пишет, куда, --no-marker, секретов нет, в git кладёт человек',
  page.includes('AGENTS.md') && page.includes('CLAUDE.md') && page.includes('создаёт AGENTS.md') && page.includes('--no-marker') && page.includes('Секретов в блоке нет') && page.includes('в git его кладёт человек'), '');

console.log('CLAB-423: токена на странице нет');
const tokenLike = /\b(?:sdlc|clab)_[A-Za-z0-9_]{6,}|[A-Za-z0-9+_=-]{40,}/;
const stored = await run(`return localStorage.getItem('sdlc.token') || '';`);
check('токена сессии в тексте страницы нет', !stored || !page.includes(stored), '');
check('значения, похожего на токен, нет ни в тексте, ни в блоках', !tokenLike.test(page.replace(/https?:\/\/\S+/g, '')) && b.every((x) => !tokenLike.test(x.replace(/https?:\/\/\S+/g, ''))), '');
check('Bearer — только с подстановкой', [...b.join('\n').matchAll(/Bearer\s+(\S+)/g)].every((m) => /^(?:\$\(clab|\$\{SDLC_TOKEN\})/.test(m[1])), '');

console.log('CLAB-423: «Агенты и модели»');
const link = await run(`
  const a = all('[data-agent-settings] a')[0];
  return a ? {href: a.getAttribute('href'), text: a.innerText.trim()} : null;`);
check('ссылка на настройки проекта', link && link.href === agentSettingsHref('SDLC') && link.text === 'Агенты и модели', JSON.stringify(link));
check('пояснение: модели уровней и прайс', page.includes('модели у уровней') && page.includes('прайс'), '');

console.log('CLAB-329: плагин Claude');
check('команда плагина', b.includes(PLUGIN_COMMAND), JSON.stringify(b));
check('строки «плагина пока нет» нет', !page.includes('Плагина Claude Code пока нет'), '');
check('абзац о плагине', page.includes('clab-plugin') && page.includes('/clab-plugin SDLC-12') && page.includes('без GitHub'), '');
console.log('CLAB-340: что умеет плагин');
check('плагин: три вкладки', ['Этот чат', 'Ждут меня', 'Задачи'].every((t) => page.includes(`«${t}»`)), '');
check('плагин: артефакты этапов, апрув, возврат и чек-лист', ['артефактами по этапам', 'поставить апрув', 'вернуть задачу с причиной', 'отметить чек-лист'].every((t) => page.includes(t)), '');
check('плагин: права — maintainer и личный вход', page.includes('maintainer') && page.includes('clab auth login') && page.includes('Модель в чате задачу не меняет'), '');
check('плагин: панель среди мест апрува', page.includes('в панели плагина Claude'), '');
const pluginCopied = await run(`
  const pre = all('pre.code-block').find((p) => p.textContent.trim() === ${JSON.stringify(PLUGIN_COMMAND)});
  pre.parentElement.querySelector('button[aria-label="Скопировать"]').click();
  await sleep(300);
  return navigator.clipboard.readText();
`);
check('clab setup --plugin копируется кнопкой', pluginCopied === PLUGIN_COMMAND, pluginCopied);

const copied = await run(`
  const pre = all('pre.code-block').find((p) => p.textContent.trim().startsWith('clab setup'));
  pre.parentElement.querySelector('button[aria-label="Скопировать"]').click();
  await sleep(300);
  return navigator.clipboard.readText();
`);
check('clab setup копируется кнопкой', copied === setupCommand('SDLC'), copied);
const codexCopied = await run(`
  const pre = all('pre.code-block').find((p) => p.textContent.trim().startsWith('codex mcp add'));
  pre.parentElement.querySelector('button[aria-label="Скопировать"]').click();
  await sleep(300);
  return navigator.clipboard.readText();
`);
check('Codex-блок копируется кнопкой дословно', codexCopied === codexAddCommand(ORIGIN, 'SDLC'), codexCopied);

console.log('CLAB-423: ссылка «Агенты и модели» открывает настройки проекта');
await run('await click("Агенты и модели", "a"); await sleep(1500); return 1;');
const afterPath = await run('return location.pathname;');
check('переход на настройки проекта', afterPath === agentSettingsHref('SDLC'), afterPath);
check('раздел «Агенты и модели» на странице настроек', (await run('return texts();')).includes('Агенты и модели'), '');
await s.goto(BASE + '/docs?project=SDLC');
await sleep(1500);

console.log('К17: пользователь без проектов');
await withOverride(override('/v1/projects', 200, {projects: []}), async () => {
  await s.goto(BASE + '/docs');
  await sleep(1500);
  b = await blocks();
  check(`команды с ${KEY_PLACEHOLDER}`, b.includes(setupCommand()) && b.includes(mcpAddCommand(ORIGIN)), JSON.stringify(b));
  check(`блок привязки, Codex и clab prompt work с ${KEY_PLACEHOLDER}`,
    b.includes(markerBlock(ORIGIN)) && b.includes(codexAddCommand(ORIGIN)) && b.includes(promptCommand()), JSON.stringify(b));
  page = await run('return texts();');
  check('«Агенты и модели» без проекта — текстом, без ссылки',
    page.includes('Агенты и модели') && (await run(`return all('[data-agent-settings] a').length;`)) === 0, '');
  check('подсказка, как завести проект', page.includes('Проектов пока нет') && page.includes('«Проекты»'), page.slice(0, 400));
});

console.log('К17: сервер без набора');
await withOverride(override('/v1/agent-kit', 404, {error: {code: 'not_found', message: 'нет такой ручки'}}), async () => {
  await s.goto(BASE + '/docs?project=SDLC');
  await sleep(1500);
  page = await run('return texts();');
  check('раздел скилов говорит, что набора нет', page.includes('Набор агента недоступен на этой версии сервера'), page.slice(0, 400));
  b = await blocks();
  check('остальное на месте', b.includes(setupCommand('SDLC')) && b.includes(loginCommand(ORIGIN)), JSON.stringify(b));
  check('блоки подключения по агентам и clab guide на месте',
    b.includes(mcpAddCommand(ORIGIN, 'SDLC')) && b.includes(codexAddCommand(ORIGIN, 'SDLC')) && b.includes(mcpJSON(ORIGIN, 'SDLC')) && b.includes(GUIDE_COMMAND), JSON.stringify(b));
});

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
