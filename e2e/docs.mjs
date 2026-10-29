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
  KEY_PLACEHOLDER,
  docsHref,
  installCommand,
  loginCommand,
  mcpAddCommand,
  mcpJSON,
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
check('JSON для других агентов', cfg.mcpServers.sdlc.url === 'https://clab.acme.io/mcp/projects/ACME' && cfg.mcpServers.sdlc.type === 'http', JSON.stringify(cfg));
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
await s.goto(BASE + '/p/SDLC/board');
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
  ['JSON mcpServers', mcpJSON(ORIGIN, 'SDLC')],
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

const copied = await run(`
  const pre = all('pre.code-block').find((p) => p.textContent.trim().startsWith('clab setup'));
  pre.parentElement.querySelector('button[aria-label="Скопировать"]').click();
  await sleep(300);
  return navigator.clipboard.readText();
`);
check('clab setup копируется кнопкой', copied === setupCommand('SDLC'), copied);

console.log('К17: пользователь без проектов');
await withOverride(override('/v1/projects', 200, {projects: []}), async () => {
  await s.goto(BASE + '/docs');
  await sleep(1500);
  b = await blocks();
  check(`команды с ${KEY_PLACEHOLDER}`, b.includes(setupCommand()) && b.includes(mcpAddCommand(ORIGIN)), JSON.stringify(b));
  page = await run('return texts();');
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
});

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
