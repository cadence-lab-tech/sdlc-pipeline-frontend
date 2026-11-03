// Правила фокуса «Обзора» при автообновлении (CLAB-367, AC-14.13) — без
// браузера: components/overview/focusKeeper.ts чистый. Куда возвращается фокус
// запомненной строки: на ту же задачу в любой зоне; задачи нет — на первую
// строку той же зоны; строк в зоне нет — на заголовок зоны; зоны ещё читаются —
// ждём. Плюс разметка, по которой хук находит строки, и неблокируемые кнопки.
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(specifier + '.ts', context);
      throw err;
    }
  },
});

const F = await import('../src/components/overview/focusKeeper.ts');

let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const memo = (key, zone) => ({key, zone});
const rows = (...r) => r.map(([key, zone]) => ({key, zone}));

console.log('куда возвращается фокус');
// Задача переехала из бэклога в очередь (пример тестировщика).
let t = F.resolveFocus(memo('SDLC-65', 'backlog'), rows(['SDLC-1', 'backlog'], ['SDLC-65', 'queue']), true);
check('задача переехала в другую зону — строка той же задачи', eq(t, {kind: 'task', key: 'SDLC-65', zone: 'queue'}), JSON.stringify(t));
t = F.resolveFocus(memo('SDLC-65', 'backlog'), rows(['SDLC-65', 'backlog'], ['SDLC-2', 'backlog']), false);
check('осталась в своей зоне — та же строка', eq(t, {kind: 'task', key: 'SDLC-65', zone: 'backlog'}));
t = F.resolveFocus(memo('SDLC-65', 'backlog'), rows(['SDLC-65', 'queue'], ['SDLC-65', 'backlog']), true);
check('на миг в двух зонах — предпочитается прежняя', eq(t, {kind: 'task', key: 'SDLC-65', zone: 'backlog'}));
t = F.resolveFocus(memo('SDLC-65', 'backlog'), rows(['SDLC-65', 'queue']), false);
check('пока зоны читаются, найденная в другой зоне задача берётся сразу', t.kind === 'task' && t.zone === 'queue');
t = F.resolveFocus(memo('SDLC-65', 'backlog'), rows(['SDLC-1', 'backlog']), false);
check('задачи нет, зоны ещё читаются — ждём (она может прийти в другую зону)', t.kind === 'wait');
t = F.resolveFocus(memo('SDLC-65', 'backlog'), rows(['SDLC-1', 'backlog'], ['SDLC-3', 'work']), true);
check('задачи нет, всё прочитано — первая строка той же зоны', eq(t, {kind: 'zone-first', zone: 'backlog'}));
t = F.resolveFocus(memo('SDLC-65', 'backlog'), rows(['SDLC-3', 'work']), true);
check('в зоне строк не осталось — заголовок зоны', eq(t, {kind: 'zone-toggle', zone: 'backlog'}));
t = F.resolveFocus(memo('SDLC-65', null), rows(['SDLC-3', 'work']), true);
check('строка была вне зон и ушла — возвращать некуда', t.kind === 'none');
t = F.resolveFocus(memo('SDLC-65', 'backlog'), [], true);
check('страница без строк — заголовок прежней зоны', t.kind === 'zone-toggle');

console.log('разметка');
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const row = read('../src/components/taskrow/TaskRow.tsx');
check('обе раскладки строки несут data-task-key', (row.match(/data-task-key=\{task\.key\}/g) ?? []).length === 2);
check('ссылка строки помечена data-task-link', /data-task-link/.test(row));
const hook = read('../src/components/overview/useFocusKeeper.ts');
check('хук ищет строки по тем же атрибутам и не знает зон по именам', /data-task-key/.test(hook) && /data-task-link/.test(hook) && !/'(backlog|queue|work|stuck|decisions|done)'/.test(hook));
const page = read('../src/pages/Overview.tsx');
check('страница подключает хранитель фокуса к состоянию чтения зон', /useFocusKeeper\(data\.loading\)/.test(page));
check('хранитель следит за фокусом (focusin) и забывает при нажатии мимо (pointerdown)', /'focusin'/.test(hook) && /'pointerdown'/.test(hook));
const refresh = page.slice(page.indexOf('data-refresh') - 900, page.indexOf('data-refresh'));
check('«Обновить» не блокируется на время чтения (AC-14.13)', !/(?<![-\w])disabled=/.test(refresh) && /aria-busy=\{data\.refreshing/.test(refresh));
const more = read('../src/components/overview/Zone.tsx');
const moreBtn = more.slice(more.indexOf('export function MoreButton'), more.indexOf('export function MoreFailed'));
check('«Ещё N» не блокируется (aria-disabled вместо disabled)', !/(?<![-\w])disabled=/.test(moreBtn) && /aria-disabled/.test(moreBtn));

console.log(`\n${ok} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
