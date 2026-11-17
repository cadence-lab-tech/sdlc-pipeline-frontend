// Родитель задачи в «Деталях» (CLAB-196) — без браузера: право на правку по
// actor_rights.reparent, текст отказа дословно, сервер без поля, у задачи с
// детьми — только снятие, кандидаты — задачи верхнего уровня без самой задачи
// и её родителя; подпись task.reparented в ленте. Ключи в данных нарочно ни
// на что не похожи: правила не должны о них знать.
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

const P = await import('../src/components/task/parentRules.ts');
const E = await import('../src/components/task/events.ts');

let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('право на правку родителя');
check('сервер без поля — правки нет', same(P.parentEdit({edit: true}, 'QQ-1', 0), {mode: 'none'}));
check('без объекта права — правки нет', same(P.parentEdit(undefined, null, 0), {mode: 'none'}));
check('reparent: false — текст сервера дословно',
  same(P.parentEdit({reparent: false, actor_deny: {reparent: {code: 'forbidden', reason: 'human_action', message: 'смена родителя — решение человека'}}}, 'QQ-1', 0),
    {mode: 'denied', reason: 'смена родителя — решение человека'}));
check('reparent: false без текста — без своего текста', same(P.parentEdit({reparent: false}, null, 0), {mode: 'denied', reason: undefined}));
check('можно, детей нет, родитель есть — выбор и снятие',
  same(P.parentEdit({reparent: true}, 'QQ-1', 0), {mode: 'edit', canPick: true, pickHint: undefined, canDetach: true}));
check('можно, без родителя — снимать нечего', P.parentEdit({reparent: true}, null, 0).canDetach === false);
const withKids = P.parentEdit({reparent: true}, 'QQ-1', 2);
check('у задачи дети — выбора нет, пояснение, снятие есть',
  withKids.canPick === false && withKids.pickHint === P.HAS_CHILDREN_HINT && withKids.canDetach === true);
check('пояснение называет правило без имён проекта', P.HAS_CHILDREN_HINT.includes('один уровень') && !/эпик/i.test(P.HAS_CHILDREN_HINT));

console.log('кандидаты');
const found = [
  {key: 'QQ-7', title: 'Сама', parent_key: null},
  {key: 'QQ-1', title: 'Нынешний', parent_key: null},
  {key: 'QQ-3', title: 'Вложенная', parent_key: 'QQ-9'},
  {key: 'QQ-4', title: 'Верхняя'},
];
check('без самой задачи, нынешнего родителя и вложенных',
  same(P.parentCandidates(found, 'QQ-7', 'QQ-1'), [{value: 'QQ-4', label: 'QQ-4 · Верхняя'}]));
check('без родителя — нынешнего нет', P.parentCandidates(found, 'QQ-7', null).length === 2);

console.log('лента: task.reparented');
const line = (p) => E.eventDetails('task.reparented', p).summary;
check('подпись типа', E.eventLabel('task.reparented') === 'родитель изменён');
check('перенос', line({task: 'QQ-12', from: 'QQ-5', to: 'QQ-9'}) === 'QQ-12: QQ-5 → QQ-9');
check('снятие', line({task: 'QQ-12', from: 'QQ-5', to: null}) === 'QQ-12: QQ-5 → верхний уровень');
check('с верхнего уровня', line({task: 'QQ-12', from: null, to: 'QQ-9'}) === 'QQ-12: верхний уровень → QQ-9');
check('незнакомая нагрузка — пустая строка', line({task: 'QQ-12'}) === '' && line(null) === '' && line({task: 'QQ-1', from: 3, to: 'QQ-2'}) === '');

console.log('границы модуля');
const src = readFileSync(new URL('../src/components/task/parentRules.ts', import.meta.url), 'utf8');
check('без разметки и путей @/', !src.includes("from '@/") && !/<[A-Z][A-Za-z]*[\s>]/.test(src));

console.log(`\n${ok} прошло, ${fail} упало`);
if (fail > 0) process.exit(1);
