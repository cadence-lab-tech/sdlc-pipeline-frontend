// Правила страницы /docs без браузера (CLAB-423, решение 0077): подключение
// любого агента. Команды Claude Code и Codex, конфигурация другого агента,
// блок привязки каталога, вход для любого агента и адрес настроек проекта —
// чистые функции components/cli.ts, проверяются прямо в исходниках.
//
// Строки блока привязки и форма команды Codex записаны здесь явно, по
// решению 0077 и по backend/cmd/clab (markerBlockLines, codexAddCommand), а
// не вычисляются теми же функциями: расхождение с clab должно краснеть.
import * as C from '../src/components/cli.ts';

let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};

const ORIGIN = 'https://clab.acme.io';

// ── Codex ───────────────────────────────────────────────────────────────────
console.log('Codex: имя сервера и команда');
check('имя сервера — sdlc- и ключ в нижнем регистре', C.codexServerName('ACME') === 'sdlc-acme', C.codexServerName('ACME'));
check('смешанный регистр', C.codexServerName('ZeD') === 'sdlc-zed', C.codexServerName('ZeD'));
check('без проекта — sdlc-key', C.codexServerName() === 'sdlc-key' && C.codexServerName('') === 'sdlc-key', C.codexServerName());
check(
  'codex mcp add: имя, адрес проекта, токен именем переменной',
  C.codexAddCommand(ORIGIN, 'ACME') === `codex mcp add sdlc-acme --url ${ORIGIN}/mcp/projects/ACME --bearer-token-env-var SDLC_TOKEN`,
  C.codexAddCommand(ORIGIN, 'ACME'),
);
check(
  'без проекта: sdlc-key и <KEY> в адресе',
  C.codexAddCommand(ORIGIN) === `codex mcp add sdlc-key --url ${ORIGIN}/mcp/projects/${C.KEY_PLACEHOLDER} --bearer-token-env-var SDLC_TOKEN`,
  C.codexAddCommand(ORIGIN),
);
check('переменная токена — SDLC_TOKEN, значение берёт clab', C.codexTokenCommand === 'export SDLC_TOKEN="$(clab auth token)"', C.codexTokenCommand);

// ── Claude Code (без изменений) ─────────────────────────────────────────────
console.log('Claude Code: команда прежняя');
check(
  'claude mcp add на адрес проекта, токен из clab auth token',
  C.mcpAddCommand(ORIGIN, 'ACME') ===
    `claude mcp add --transport http --scope local sdlc ${ORIGIN}/mcp/projects/ACME \\\n  --header "Authorization: Bearer $(clab auth token)"`,
  C.mcpAddCommand(ORIGIN, 'ACME'),
);
check('setup и плагин — как были', C.setupCommand('ACME') === 'clab setup --project ACME' && C.PLUGIN_COMMAND === 'clab setup --plugin');

// ── другой агент ────────────────────────────────────────────────────────────
console.log('другой агент: конфигурация mcpServers');
const cfg = JSON.parse(C.mcpJSON(ORIGIN, 'ACME'));
check('единственный сервер sdlc', Object.keys(cfg.mcpServers).join() === 'sdlc', JSON.stringify(cfg));
check('type = http, url проекта', cfg.mcpServers.sdlc.type === 'http' && cfg.mcpServers.sdlc.url === `${ORIGIN}/mcp/projects/ACME`);
check('заголовок раскрывает переменную, токена нет', cfg.mcpServers.sdlc.headers.Authorization === 'Bearer ${SDLC_TOKEN}', cfg.mcpServers.sdlc.headers.Authorization);
check('без проекта — <KEY> в адресе', JSON.parse(C.mcpJSON(ORIGIN)).mcpServers.sdlc.url === `${ORIGIN}/mcp/projects/${C.KEY_PLACEHOLDER}`);

// ── блок привязки ───────────────────────────────────────────────────────────
console.log('блок привязки каталога');
const expected = (key, origin) =>
  [
    '<!-- cadence-lab:begin -->',
    `<!-- cadence-lab: project=${key} host=${origin} -->`,
    `Cadence Lab: this directory works with project ${key} at ${origin}; the \`clab\` CLI takes the project from this block.`,
    '<!-- cadence-lab:end -->',
  ].join('\n');
check('четыре строки по решению 0077', C.markerBlock(ORIGIN, 'ACME') === expected('ACME', ORIGIN) && C.markerBlock(ORIGIN, 'ACME').split('\n').length === 4, C.markerBlock(ORIGIN, 'ACME'));
check('другой ключ и адрес', C.markerBlock('http://localhost:5173', 'ZED') === expected('ZED', 'http://localhost:5173'));
check('без проекта — <KEY>', C.markerBlock(ORIGIN) === expected(C.KEY_PLACEHOLDER, ORIGIN), C.markerBlock(ORIGIN));
check('в блоке нет токена, модели и путей конфига', !/token|SDLC_|model|\.toml|\.json|config/i.test(C.markerBlock(ORIGIN, 'ACME')), C.markerBlock(ORIGIN, 'ACME'));

// ── вход для любого агента ──────────────────────────────────────────────────
console.log('вход для любого агента');
check('clab guide', C.GUIDE_COMMAND === 'clab guide');
check('clab prompt work с ключом проекта и примером номера', C.promptCommand('ACME') === 'clab prompt work ACME-12', C.promptCommand('ACME'));
check('без проекта — <KEY>', C.promptCommand() === `clab prompt work ${C.KEY_PLACEHOLDER}-12`, C.promptCommand());

// ── настройки проекта ───────────────────────────────────────────────────────
console.log('ссылка на «Агенты и модели»');
check('адрес настроек проекта', C.agentSettingsHref('ACME') === '/p/ACME/settings', String(C.agentSettingsHref('ACME')));
check('ключ экранируется', C.agentSettingsHref('A/B') === '/p/A%2FB/settings');
check('без проекта ссылки нет', C.agentSettingsHref() === undefined && C.agentSettingsHref('') === undefined);

// ── токена нет нигде, имён нашей настройки нет ──────────────────────────────
console.log('токена нет, нейтральность');
const outputs = [];
for (const key of ['ACME', 'ZED', undefined]) {
  outputs.push(
    C.setupCommand(key), C.mcpAddCommand(ORIGIN, key), C.codexAddCommand(ORIGIN, key), C.codexTokenCommand,
    C.mcpJSON(ORIGIN, key), C.markerBlock(ORIGIN, key), C.GUIDE_COMMAND, C.promptCommand(key),
    C.waitCommand(key), C.PLUGIN_COMMAND, C.loginCommand(ORIGIN), C.BREW_COMMAND, C.installCommand('v0.28.0'),
    C.agentSettingsHref(key) ?? '', C.docsHref(key), C.codexServerName(key),
  );
}
check('выходов для проверки достаточно', outputs.length === 48, String(outputs.length));
// Значение, похожее на токен: sdlc_…, clab_…_…, длинная случайная строка.
const tokenLike = /\b(?:sdlc|clab)_[A-Za-z0-9_]{6,}|[A-Za-z0-9+_=-]{40,}/;
check('значения, похожего на токен, нет ни в одной функции', outputs.every((o) => !tokenLike.test(o)), outputs.find((o) => tokenLike.test(o)));
// Bearer — только с подстановкой: $(clab auth token) или ${SDLC_TOKEN}.
const bearers = outputs.flatMap((o) => [...o.matchAll(/Bearer\s+(\S+)/g)].map((m) => m[1]));
check('Bearer есть и только с подстановкой', bearers.length > 0 && bearers.every((b) => /^(?:\$\(clab|\$\{SDLC_TOKEN\})/.test(b)), JSON.stringify(bearers));
// Новые функции не называют статусы, роли, переходы и циклы проекта.
const ours = /\b(?:analysis|analytics|development|testing|developer|designer|integrator|Simple|Epic|Release|stage)\b/i;
const fresh = [];
for (const key of ['ACME', 'ZED', undefined]) {
  fresh.push(C.codexAddCommand(ORIGIN, key), C.codexTokenCommand, C.mcpJSON(ORIGIN, key), C.markerBlock(ORIGIN, key), C.GUIDE_COMMAND, C.promptCommand(key), C.codexServerName(key), C.agentSettingsHref(key) ?? '');
}
check('в новых функциях нет имён статусов, ролей и циклов', fresh.every((o) => !ours.test(o)), fresh.find((o) => ours.test(o)));

console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
