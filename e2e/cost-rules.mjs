// Правила стоимости на экранах (CLAB-223) — без браузера: формат денег,
// подписи двух видов стоимости, разрезов метрик, состояний учёта и типа
// оплаты. Модуль src/components/cost.ts — чистые функции, поэтому
// проверяется прямо в исходниках, как словари в labels.mjs.
import {readFileSync} from 'node:fs';

const C = await import('../src/components/cost.ts');

let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};

console.log('формат денег');
check('ноль — «0.00 $»', C.money(0) === '0.00 $', C.money(0));
check('меньше доллара — три знака', C.money(0.5) === '0.500 $' && C.money(0.123) === '0.123 $', C.money(0.5));
check('от доллара — два знака', C.money(1) === '1.00 $' && C.money(12.3456) === '12.35 $', C.money(12.3456));
check('сумма меньше доллара — всегда три знака', C.money(0.0004) === '0.000 $' && C.money(0.999) === '0.999 $');
check('null — «—», не «0.00 $»', C.moneyOrUnknown(null) === '—' && C.moneyOrUnknown(undefined) === '—' && C.moneyOrUnknown(NaN) === '—');
check('сообщённый ноль — ноль', C.moneyOrUnknown(0) === '0.00 $');
check('пометка «без признака» — только при сумме больше нуля',
  C.unspecifiedNote(0.5) === 'из них без признака оплаты: 0.500 $' && C.unspecifiedNote(0) === null && C.unspecifiedNote(null) === null && C.unspecifiedNote(undefined) === null);
check('подсказка к пометке', C.UNSPECIFIED_HINT === 'тип оплаты не указан, считается как API (решение 0062)');
check('доля: целое и десятые', C.percent(0) === '0 %' && C.percent(0.5) === '50 %' && C.percent(0.2222) === '22.2 %' && C.percent(1) === '100 %');

console.log('подписи стоимости');
check('постоянные подписи', C.MONEY_LABEL === 'Деньги (API)' && C.SUBSCRIPTION_LABEL === 'Условно (подписка)');
check('информативно, в бюджет не входит', C.BUDGET_INFO_NOTE === 'информативно, в бюджет не входит');
check('обе суммы раздельно', C.costPair(1.5, 2) === 'Деньги (API) 1.50 $ · Условно (подписка) 2.00 $', String(C.costPair(1.5, 2)));
check('только известная сторона', C.costPair(null, 2) === 'Условно (подписка) 2.00 $' && C.costPair(0.2, null) === 'Деньги (API) 0.200 $');
check('обе неизвестны — null', C.costPair(null, undefined) === null);
check('сообщённый ноль сохраняется', C.costPair(0, null) === 'Деньги (API) 0.00 $');

console.log('разрез метрик');
check('разрезы по-русски', C.dimensionLabel('status') === 'Статус' && C.dimensionLabel('role') === 'Роль' && C.dimensionLabel('model') === 'Модель');
check('незнакомый разрез — как есть', C.dimensionLabel('team') === 'team');
let cell = C.silentCell({dimension: 'role', reported_runs: 3, silent_runs: 2});
check('«без учёта»: silent из reported + silent', cell.text === '2 из 5' && cell.incomplete === true, JSON.stringify(cell));
cell = C.silentCell({dimension: 'status', reported_runs: 4, silent_runs: 0});
check('без пропусков — «0 из 4», не неполный', cell.text === '0 из 4' && cell.incomplete === false, JSON.stringify(cell));
cell = C.silentCell({dimension: 'model', reported_runs: 4, silent_runs: 0});
check('модель — «—» с подсказкой, не ноль', cell.text === '—' && cell.hint === 'модель известна только из отчёта' && cell.incomplete === false, JSON.stringify(cell));
check('строка без отчётов — суммы неизвестны', C.hasReports({reported_runs: 0}) === false && C.hasReports({reported_runs: 1}) === true);

console.log('закрытые задачи');
check('неполные — «неполных: N из M — стоимость занижена»',
  C.incompleteNote({incomplete_tasks: 2, closed_tasks: 5}) === 'неполных: 2 из 5 — стоимость занижена');
check('без неполных пометки нет', C.incompleteNote({incomplete_tasks: 0, closed_tasks: 5}) === null);
check('без учёта: число из всех и доля',
  C.closedSilentLine({reported_runs: 7, silent_runs: 2, silent_share: 2 / 9}) === '2 из 9 (22.2 %)',
  C.closedSilentLine({reported_runs: 7, silent_runs: 2, silent_share: 2 / 9}));

console.log('состояние учёта прогона');
check('state от сервера', C.usageState({reported: true, state: 'not_applicable'}) === 'not_applicable' && C.usageState({reported: false, state: 'missing'}) === 'missing');
check('сервер без state: отчёт есть — reported, нет — missing', C.usageState({reported: true}) === 'reported' && C.usageState({reported: false}) === 'missing');
check('объекта usage нет — missing, как без отчёта', C.usageState(undefined) === 'missing');
check('подписи состояний',
  C.usageStateLabel('reported') === 'учёт есть' && C.usageStateLabel('missing') === 'без учёта' && C.usageStateLabel('not_applicable').startsWith('учёт не ведётся'));
check('незнакомое состояние — как есть', C.usageStateLabel('lost') === 'lost');

console.log('тип оплаты');
const bill = (api, sub, unspecified = null) => C.billingLabel({api_cost_usd: api, subscription_cost_usd: sub, unspecified_cost_usd: unspecified});
check('API', bill(1, null) === 'API');
check('подписка', bill(null, 2) === 'подписка');
check('API и подписка', bill(1, 2) === 'API и подписка');
check('деньги целиком без признака — «без признака»', bill(1, null, 1) === 'без признака');
check('API и часть без признака', bill(1, null, 0.4) === 'API и без признака', String(bill(1, null, 0.4)));
check('API, подписка и без признака', bill(1, 2, 0.4) === 'API, подписка и без признака', String(bill(1, 2, 0.4)));
check('подписка и деньги целиком без признака', bill(0.4, 2, 0.4) === 'подписка и без признака', String(bill(0.4, 2, 0.4)));
check('нечего сказать — null', bill(null, null) === null);
check('сообщённый ноль API — тоже API', bill(0, null) === 'API');

console.log('модуль без ключей проекта');
const src = readFileSync(new URL('../src/components/cost.ts', import.meta.url), 'utf8')
  .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
const KEYS = ['new', 'analysis', 'development', 'testing', 'merge', 'release', 'done', 'cancelled',
  'planning', 'in_progress', 'prepare', 'publish', 'verify', 'analytics', 'developer', 'test', 'analyst', 'reviewer'];
check('ключей статусов и ролей нет', !new RegExp(`(['"\`])(${KEYS.join('|')})\\1`).test(src));
check('модуль без React', !/from ['"]react/.test(src));

console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
