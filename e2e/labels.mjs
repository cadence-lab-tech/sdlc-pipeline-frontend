// Словари подписей проверяются без браузера: у них важна не разметка, а то,
// что незнакомый ключ не теряется. Событие неизвестного типа появится на
// бэкенде раньше, чем подпись здесь, и лента обязана показать его как есть.
import {eventLabel} from '../src/components/task/events.ts';
import {priorityClass, priorityLabel} from '../src/components/priorities.ts';

let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};

console.log('подписи типов событий');
check('известный тип подписан по-русски', eventLabel('stage.entered') === 'этап начат', eventLabel('stage.entered'));
check('решение по гейту подписано', eventLabel('gate.decided') === 'решение по гейту', eventLabel('gate.decided'));
check('неизвестный тип показан сырым ключом', eventLabel('какой.то.новый') === 'какой.то.новый');

console.log('подписи приоритетов');
for (const [key, label] of [['urgent', 'срочный'], ['high', 'высокий'], ['normal', 'обычный'], ['low', 'низкий']]) {
  check(`${key} — «${label}»`, priorityLabel(key) === label, priorityLabel(key));
}
check('неизвестный приоритет показан ключом', priorityLabel('later') === 'later');
// У каждого цвета обязана быть пара для тёмной темы: либо класс dark:, либо
// токен темы, который меняется вместе с ней.
for (const key of ['urgent', 'high']) {
  check(`у цвета ${key} есть пара для тёмной темы`, priorityClass(key).includes('dark:'), priorityClass(key));
}
check('«низкий» окрашен токеном темы', priorityClass('low').includes('muted-foreground'), priorityClass('low'));

console.log(`\n${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
