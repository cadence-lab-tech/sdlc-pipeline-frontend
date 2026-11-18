// Правила страницы согласия и раздела «Подключённые клиенты» (CLAB-482) без
// браузера и без бэкенда: состояние по ответу сервера (все коды контракта),
// допустимый адрес перехода, словарь причин отзыва, видимость раздела по
// сведениям об инстансе, метка токена клиента. Модуль rules.ts — чистые
// функции без React и без @/, проверяется прямо в исходниках. Заодно — поиск
// запрещённых слов и сырых цветов в коде новых экранов (AC-15).
import {readFileSync} from 'node:fs';

await import('./ts-resolve.mjs');
const R = await import('../src/components/oauth/rules.ts');

let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};
const src = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const http = (httpStatus, code, details) => ({httpStatus, code, message: 'текст сервера', details});

console.log('AC-12: раздел по сведениям об инстансе');
check('есть oauth.enabled: true → действует', R.oauthEnabledOf({oauth: {enabled: true}}) === true);
check('нет поля oauth (сервер старше) → выключено', R.oauthEnabledOf({}) === false);
check('enabled: false → выключено', R.oauthEnabledOf({oauth: {enabled: false}}) === false);
check('сбой запроса (нет ответа) → выключено', R.oauthEnabledOf(undefined) === false && R.oauthEnabledOf(null) === false);
check('enabled не булево → выключено', R.oauthEnabledOf({oauth: {enabled: 'true'}}) === false && R.oauthEnabledOf({oauth: {}}) === false);
check('ответа ещё нет → ждать, а не «выключено»', R.clientsAccess(undefined) === 'pending');
check('ответ пришёл: включено / выключено', R.clientsAccess({oauthEnabled: true}) === 'enabled' && R.clientsAccess({oauthEnabled: false}) === 'disabled');

console.log('AC-6: ответ на запрос — карточка и «выдать нельзя»');
check('can_grant: true → ready', R.consentLoaded({can_grant: true}).kind === 'ready');
for (const reason of ['task_token', 'not_a_person', 'project_not_found', 'not_a_member', 'token_bound_elsewhere', 'brand_new_reason', '']) {
  const st = R.consentLoaded({can_grant: false, reason, reason_message: `сервер: ${reason}`});
  check(`can_grant: false, reason «${reason}» → blocked с текстом сервера`, st.kind === 'blocked' && st.reason === reason && st.message === `сервер: ${reason}`.trim(), JSON.stringify(st));
}
check('пустой reason_message → запасной текст', R.consentLoaded({can_grant: false}).message === R.BLOCKED_FALLBACK && R.BLOCKED_FALLBACK === 'Выдать доступ с этой учётной записью нельзя.');
check('сообщение из одних пробелов → запасной текст', R.blockedMessage('   ') === R.BLOCKED_FALLBACK && R.blockedMessage(undefined) === R.BLOCKED_FALLBACK);
check('403 на GET → forbidden с текстом сервера', JSON.stringify(R.consentFailed(http(403, 'forbidden'))) === JSON.stringify({kind: 'forbidden', message: 'текст сервера'}));

console.log('AC-7: запрос не годится (GET)');
check('401 → вход', R.consentFailed(http(401, 'unauthenticated')).kind === 'login' && R.consentFailed({message: 'x', code: 'unauthenticated'}).kind === 'login');
check('409 expired → устарел', R.consentFailed(http(409, 'conflict', {reason: 'expired'})).kind === 'expired');
check('409 decided → обработан', R.consentFailed(http(409, 'conflict', {reason: 'decided'})).kind === 'decided');
check('409 с незнакомой причиной → сбой, кнопок решения нет', R.consentFailed(http(409, 'conflict', {reason: 'x'})).kind === 'failed' && R.consentActions('failed') === 'none');
check('409 без details → сбой', R.consentFailed(http(409, 'conflict')).kind === 'failed');
check('404 → не найден', R.consentFailed(http(404, 'not_found')).kind === 'notfound' && R.consentFailed({message: 'x', code: 'not_found'}).kind === 'notfound');
check('5xx и сеть → сбой с повтором', R.consentFailed(http(500, 'internal')).kind === 'failed' && R.consentFailed({message: 'сервис недоступен', code: 'internal'}).kind === 'failed');
check('details не объект → не падает', R.consentFailed(http(409, 'conflict', 'строка')).kind === 'failed' && R.consentFailed(http(409, 'conflict', null)).kind === 'failed');

console.log('AC-6, AC-7: ошибка POST решения');
check('401 → вход', R.decideFailed(http(401, 'unauthenticated')).kind === 'login');
check('403 → blocked с причиной и текстом сервера', JSON.stringify(R.decideFailed(http(403, 'forbidden', {reason: 'not_a_member'}))) === JSON.stringify({kind: 'blocked', reason: 'not_a_member', message: 'текст сервера'}));
check('403 без причины → blocked', R.decideFailed(http(403, 'forbidden')).kind === 'blocked');
check('409 expired / decided', R.decideFailed(http(409, 'conflict', {reason: 'expired'})).kind === 'expired' && R.decideFailed(http(409, 'conflict', {reason: 'decided'})).kind === 'decided');
check('404 → не найден', R.decideFailed(http(404, 'not_found')).kind === 'notfound');
check('сеть и 5xx → сбой (повтор тем же нажатием)', R.decideFailed(http(500, 'internal')).kind === 'failed' && R.decideFailed({message: 'x'}).kind === 'failed');

console.log('действия по состоянию');
check('ready и blocked — обе кнопки и «Войти другой»', R.consentActions('ready') === 'both' && R.consentActions('blocked') === 'both');
check('forbidden — только «Войти другой»', R.consentActions('forbidden') === 'switch');
check('устарел, обработан, не найден, сбой, загрузка, вход — без кнопок', ['expired', 'decided', 'notfound', 'failed', 'loading', 'login'].every((k) => R.consentActions(k) === 'none'));

console.log('AC-8: переход только на допустимый адрес');
for (const [uri, expected] of [
  ['https://claude.ai/cb?code=a&state=b', 'https://claude.ai/cb?code=a&state=b'],
  ['http://127.0.0.1:8123/cb?code=a', 'http://127.0.0.1:8123/cb?code=a'],
  ['http://localhost:3000/callback', 'http://localhost:3000/callback'],
  ['http://[::1]:5000/cb', 'http://[::1]:5000/cb'],
  ['HTTP://LOCALHOST:3000/cb', 'http://localhost:3000/cb'],
]) check(`допустим: ${uri}`, R.safeRedirect(uri) === expected, String(R.safeRedirect(uri)));
for (const bad of [
  'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\nscript:alert(1)', 'data:text/html,<p>x</p>', 'vbscript:x', 'file:///etc/passwd',
  '//evil.example/cb', '/relative/path', 'evil.example/cb', 'http://evil.example/cb', 'http://127.0.0.1.evil.example/cb',
  'http://localhost.evil.example/cb', 'https://user:pw@evil.example/cb', 'http://user@127.0.0.1/cb', 'ftp://claude.ai/cb', '', '   ',
]) check(`недопустим: ${JSON.stringify(bad)}`, R.safeRedirect(bad) === null, String(R.safeRedirect(bad)));
check('не строка → нет перехода', R.safeRedirect(undefined) === null && R.safeRedirect(null) === null && R.safeRedirect({}) === null && R.safeRedirect(42) === null);

console.log('AC-8: имя клиента');
check('пустое и из пробелов — не имя', R.clientName('') === undefined && R.clientName('   ') === undefined && R.clientName(undefined) === undefined && R.clientName(null) === undefined);
check('имя не меняется (теги остаются текстом)', R.clientName('<img src=x onerror=alert(1)>') === '<img src=x onerror=alert(1)>' && R.clientName('  Имя ') === 'Имя');
check('подпись пустого имени', R.NO_CLIENT_NAME === 'клиент без имени');

console.log('AC-10: причины отзыва и порядок списка');
check('user', R.revokeReasonText('user') === 'Вы отключили этот клиент.');
check('refresh_reuse', R.revokeReasonText('refresh_reuse') === 'Отозван автоматически: токен обновления использован повторно.');
check('code_reuse', R.revokeReasonText('code_reuse') === 'Отозван автоматически: код подключения использован повторно.');
check('expired', R.revokeReasonText('expired') === 'Отозван: истёк срок без использования.');
check('четыре разных текста', new Set(['user', 'refresh_reuse', 'code_reuse', 'expired'].map(R.revokeReasonText)).size === 4);
check('незнакомая причина — как есть', R.revokeReasonText('admin_wipe') === 'admin_wipe');
check('служебные имена не словарь', R.revokeReasonText('constructor') === 'constructor' && R.revokeReasonText('__proto__') === '__proto__' && R.revokeReasonText('toString') === 'toString');
check('причины нет — строки нет', R.revokeReasonText(undefined) === undefined && R.revokeReasonText(null) === undefined && R.revokeReasonText('  ') === undefined);
const list = [{id: 1}, {id: 2, revoked_at: 'x'}, {id: 3}, {id: 4, revoked_at: 'y'}, {id: 5}];
const part = R.partitionGrants(list);
check('живые первыми, порядок сервера внутри групп', part.live.map((g) => g.id).join() === '1,3,5' && part.revoked.map((g) => g.id).join() === '2,4');
check('пустой список', R.partitionGrants([]).live.length === 0 && R.partitionGrants([]).revoked.length === 0);
check('отозванные раскрыты, только если действующих нет', R.revokedOpenByDefault(0) === true && R.revokedOpenByDefault(1) === false);
check('текст подтверждения «Отключить» называет имя и хост', R.disconnectText('Example', 'claude.ai').startsWith('«Example» (claude.ai) перестанет работать сразу')
  && R.disconnectText(undefined, 'claude.ai').startsWith('«клиент без имени» (claude.ai)'));

console.log('AC-13: метка токена подключённого клиента');
check('у обычного токена метки нет', R.tokenClientMark({}) === undefined && R.tokenClientMark({oauth_grant: null}) === undefined);
check('имя и хост', JSON.stringify(R.tokenClientMark({oauth_grant: {client_name: 'Example', redirect_host: 'claude.ai'}})) === JSON.stringify({name: 'Example', host: 'claude.ai'}));
check('пустое имя → без имени', R.tokenClientMark({oauth_grant: {client_name: ' ', redirect_host: 'h'}}).name === undefined);
check('адреса', R.CLIENTS_PATH === '/clients' && R.CONSENT_PATH === '/login/oauth');

console.log('AC-15: код новых экранов');
const files = [
  '../src/components/oauth/rules.ts', '../src/components/oauth/ConsentRequest.tsx', '../src/components/oauth/GrantCard.tsx',
  '../src/pages/OAuthConsent.tsx', '../src/pages/Clients.tsx',
];
const code = Object.fromEntries(files.map((f) => [f, src(f)]));
const all = Object.values(code).join('\n');
// Тексты интерфейса — строки и JSX-текст; комментарии для читателя кода не в счёт.
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const shown = Object.values(code).map(strip).join('\n');
check('rules.ts — без React и без @/ (проверяется без сборщика)', !/from ['"]react|from ['"]@\//.test(code[files[0]]));
// grant как идентификатор (grant.client_name) — не текст.
const BAD = /коннектор|\bOAuth\b|\bgrant\b(?![.)(,:])/i;
const cyr = shown.split('\n').filter((l) => /[А-Яа-яЁё]/.test(l));
check('нет слов «коннектор», «grant», «OAuth» в строках с текстом интерфейса', !cyr.some((l) => BAD.test(l)), cyr.filter((l) => BAD.test(l)).join(' | '));
check('нет «выдача» в строках с текстом интерфейса', !cyr.some((l) => /выдач/i.test(l)), cyr.filter((l) => /выдач/i.test(l)).join(' | '));
check('нет имён провайдеров входа в текстах', !/GitHub|Google|Okta|Keycloak|OIDC/i.test(shown));
check('нет ключей статусов, ролей, переходов и типов проекта', !/['"`](analysis|design|development|testing|merge|release|analytics|designer|developer|integrator|dev_done|epic)['"`]/.test(all));
check('нет сырых цветов в разметке новых файлов', !/\b(bg|text|border|ring|fill|stroke)-(red|amber|emerald|blue|green|yellow|orange|slate|gray|zinc|neutral|stone|white|black)\b|#[0-9a-fA-F]{3,8}\b|rgb\(|oklch\(/.test(all));
check('нет dangerouslySetInnerHTML и обрезки', !/dangerouslySetInnerHTML|\btruncate\b|text-ellipsis|line-clamp/.test(all));
check('адрес возврата не в консоли', !/console\./.test(all));
check('переход — заменой записи истории', /location\.replace\(/.test(code['../src/pages/OAuthConsent.tsx']) && !/location\.assign|location\.href\s*=|history\.pushState/.test(code['../src/pages/OAuthConsent.tsx']));
check('срока из константы в тексте нет (10 минут)', !/10 мин/.test(shown));
check('автофокуса нет', !/autoFocus/.test(all));
check('«Токены» проекта меняются только у строки клиента', (() => {
  const settings = src('../src/pages/Settings.tsx');
  return settings.includes('tokenClientMark(t)') && settings.includes("Отозвать токен?");
})());

console.log(`\n${ok} из ${ok + fail} проверок прошли`);
process.exit(fail ? 1 : 0);
