// Сведения об инстансе в интерфейсе (CLAB-89): один запрос /v1/instance на
// загрузку, версия сервера в подвале меню, команды установки и входа CLI на
// странице входа. Профиль стенда сценарию не важен — то же в shared и single;
// идёт в общем прогоне (run.sh), то есть в режиме header.
//
// Чего стенд дать не может (404 у старого сервера, сбой сети, выпускная
// версия у локальной сборки dev), подменяется в браузере ответом одной ручки
// /v1/instance: остальной бэкенд живой.
import {session, helpers} from './driver.mjs';
import {INSTALL_SCRIPT, installCommand, loginCommand, releaseVersion} from '../src/components/cli.ts';

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
console.log('версия выпуска — по правилу parseRelease');
for (const v of ['v0.5.0', 'v1.12.3', 'v0.5.0-rc.1', 'v0.5.0+build.7']) {
  check(`${v} — выпуск`, releaseVersion(v) === v, String(releaseVersion(v)));
}
for (const v of ['dev', 'a1b2c3d', '0.5.0', 'v0.5', 'v0.5.0.1', '', undefined]) {
  check(`${JSON.stringify(v)} — не выпуск`, releaseVersion(v) === undefined, String(releaseVersion(v)));
}

console.log('команда установки');
check(
  'выпуск: CLAB_VERSION после «|»',
  installCommand('v0.5.0') ===
    'curl -fsSL https://raw.githubusercontent.com/cadence-lab-tech/homebrew-tap/main/install.sh | CLAB_VERSION=v0.5.0 sh',
  installCommand('v0.5.0'),
);
const latest = `curl -fsSL ${INSTALL_SCRIPT} | sh`;
for (const v of ['dev', 'a1b2c3d', undefined]) {
  check(`${JSON.stringify(v)} — без CLAB_VERSION`, installCommand(v) === latest, installCommand(v));
}
check('вход — на адрес страницы', loginCommand('http://localhost:5173') === 'clab auth login --host http://localhost:5173');

// ── в браузере ──────────────────────────────────────────────────────────────
const server = await (await fetch(API + '/v1/instance')).json();
console.log(`стенд: версия ${server.version}, профиль ${server.tenancy}`);

// Обёртка fetch записывает каждый запрос к /v1/instance (и был ли в нём
// токен или актор) и, если велено, подменяет ответ.
const probe = (mode) => `(() => {
  const mode = ${JSON.stringify(mode)};
  const orig = window.fetch.bind(window);
  window.__instance = [];
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.pathname === '/v1/instance') {
      const h = new Headers((init && init.headers) || (typeof input === 'string' ? undefined : input.headers));
      window.__instance.push({auth: h.has('Authorization'), actor: h.has('X-SDLC-Actor')});
      if (mode === '404') {
        return new Response(JSON.stringify({error: {code: 'not_found', message: 'нет такой ручки'}}), {
          status: 404, headers: {'Content-Type': 'application/json'},
        });
      }
      if (mode === 'fail') throw new TypeError('Failed to fetch');
      if (mode.startsWith('version:')) {
        const body = await (await orig(input, init)).json();
        return new Response(JSON.stringify({...body, version: mode.slice(8)}), {
          status: 200, headers: {'Content-Type': 'application/json'},
        });
      }
    }
    return orig(input, init);
  };
})();`;

const s = await session(BASE + '/login');
const run = (body) => s.evaluate(helpers + body);
await s.resize(1360, 900);
await s.grant(['clipboardReadWrite', 'clipboardSanitizedWrite'], ORIGIN);

const calls = () => run('return window.__instance || [];');
const footer = () => run(`
  const p = all('[data-sidebar=footer] p').find((el) => /^сервер /.test(el.textContent.trim()));
  if (!p) return {present: false};
  const box = p.getBoundingClientRect();
  return {present: true, text: p.textContent.trim(), visible: box.width > 0 && box.height > 0};
`);
const blocks = () => run(`
  return all('pre.code-block').map((pre) => pre.textContent.trim());
`);
const withProbe = async (mode, fn) => {
  const id = await s.addInitScript(probe(mode));
  try {
    return await fn();
  } finally {
    await s.removeInitScript(id);
  }
};

console.log('К1: один запрос /v1/instance на загрузку');
await withProbe('record', async () => {
  await s.goto(BASE + '/projects');
  await sleep(1500);
  await run('await click("Команды", "a"); await sleep(800); await click("Проекты", "a"); await sleep(800); return 1;');
  const c = await calls();
  check('оболочка спросила ровно раз за переходы', c.length === 1, JSON.stringify(c));
  check('без токена и актора', c.every((x) => !x.auth && !x.actor), JSON.stringify(c));

  await s.goto(BASE + '/login');
  await sleep(1500);
  const l = await calls();
  check('страница входа — тоже один запрос', l.length === 1, JSON.stringify(l));
});

console.log('К11: версия сервера в подвале меню');
await s.goto(BASE + '/projects');
await sleep(1500);
let f = await footer();
check(`строка «сервер ${server.version}»`, f.present && f.text === `сервер ${server.version}` && f.visible, JSON.stringify(f));
await run('await click("Toggle Sidebar", "button"); await sleep(600); return 1;');
f = await footer();
check('в свёрнутом меню скрыта', f.present && !f.visible, JSON.stringify(f));
await run('await click("Toggle Sidebar", "button"); await sleep(600); return 1;');
f = await footer();
check('развернули — снова видна', f.present && f.visible, JSON.stringify(f));

console.log('К12–К15: команды CLI на странице входа');
await s.goto(BASE + '/login');
await sleep(1500);
let b = await blocks();
check('команда установки — по версии сервера', b.includes(installCommand(server.version)), JSON.stringify(b));
check(
  releaseVersion(server.version) ? 'выпуск — с CLAB_VERSION' : `версия ${server.version} — без CLAB_VERSION`,
  b.some((x) => x.startsWith('curl ') && x.includes('CLAB_VERSION=') === Boolean(releaseVersion(server.version))),
  JSON.stringify(b),
);
check(`вход с --host ${ORIGIN}`, b.includes(`clab auth login --host ${ORIGIN}`), JSON.stringify(b));
const t = await run('return texts();');
check('ссылка на тап осталась', t.includes('как поставить CLI clab'), t.slice(0, 400));

const copied = await run(`
  const out = [];
  for (const pre of all('pre.code-block')) {
    const button = pre.parentElement.querySelector('button[aria-label="Скопировать"]');
    if (!button) { out.push(null); continue; }
    button.click();
    await sleep(300);
    out.push(await navigator.clipboard.readText());
  }
  return out;
`);
check('обе команды копируются кнопкой', copied.length === 2 && copied.every((x, i) => x === b[i]), JSON.stringify(copied));

await withProbe('version:v0.5.0', async () => {
  await s.goto(BASE + '/login');
  await sleep(1500);
  b = await blocks();
  check(
    'К12: выпуск v0.5.0 — CLAB_VERSION=v0.5.0',
    b.includes('curl -fsSL https://raw.githubusercontent.com/cadence-lab-tech/homebrew-tap/main/install.sh | CLAB_VERSION=v0.5.0 sh'),
    JSON.stringify(b),
  );
  await s.goto(BASE + '/projects');
  await sleep(1500);
  f = await footer();
  check('К11: в подвале «сервер v0.5.0»', f.text === 'сервер v0.5.0', JSON.stringify(f));
});

await withProbe('version:a1b2c3d', async () => {
  await s.goto(BASE + '/login');
  await sleep(1500);
  b = await blocks();
  check('К13: SHA — без CLAB_VERSION', b.includes(latest), JSON.stringify(b));
});

for (const mode of ['404', 'fail']) {
  console.log(`К2: /v1/instance — ${mode === '404' ? '404' : 'сбой сети'}`);
  await withProbe(mode, async () => {
    await s.goto(BASE + '/login');
    await sleep(1500);
    b = await blocks();
    check('К13: установка без CLAB_VERSION', b.includes(latest), JSON.stringify(b));
    check('вход на месте', (await run('return texts();')).includes('Другие способы входа'));

    await s.goto(BASE + '/projects');
    await sleep(1500);
    let page = await run('return texts();');
    check('«Проекты» открылись', page.includes('Каждый проект настраивает свой цикл') && !page.includes('Не удалось'), page.slice(0, 300));
    f = await footer();
    check('строки версии нет', !f.present, JSON.stringify(f));

    await s.goto(BASE + '/teams');
    await sleep(1500);
    page = await run('return texts();');
    // Без ответа профиль — shared: страница команд как на общем инстансе.
    check('«Команды» как в shared', page.includes('Завести организацию') && !page.includes('Завести команду'), page.slice(0, 400));
  });
}

s.close();
console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
