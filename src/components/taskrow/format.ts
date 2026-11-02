// Время и деньги строки задачи словами. Без разметки и без часов внутри:
// «сейчас» приходит параметром, поэтому правила проверяются без браузера
// (e2e/task-row-rules.mjs) на фиксированном моменте.

const ago = new Intl.RelativeTimeFormat('ru', {numeric: 'always'});
const absolute = new Intl.DateTimeFormat('ru', {dateStyle: 'medium', timeStyle: 'short'});

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const AGO_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * DAY],
  ['month', 30 * DAY],
  ['day', DAY],
  ['hour', HOUR],
  ['minute', MINUTE],
];

// Точное время для подсказки: относительное удобно читать, но спорить по
// нему о порядке событий нельзя. Нечитаемая дата — пустая строка.
export function exactTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : absolute.format(date);
}

// «5 минут назад». Меньше минуты — «только что»: секунды в строке списка
// мелькали бы при каждом обновлении. Будущее (часы разошлись) читается как
// «только что», а не «через 3 минуты».
export function agoText(iso: string | null | undefined, now: number): string {
  if (!iso) return '';
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return '';
  const delta = now - at;
  if (delta < MINUTE) return 'только что';
  for (const [unit, size] of AGO_UNITS) {
    if (delta >= size) return ago.format(-Math.floor(delta / size), unit);
  }
  return 'только что';
}

// Длительность в двух старших единицах: «1 ч 20 мин», «2 д 3 ч», «5 мин».
// Меньше минуты — «меньше минуты».
export function spanText(ms: number): string {
  if (!Number.isFinite(ms) || ms < MINUTE) return 'меньше минуты';
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);
  if (days > 0) return hours > 0 ? `${days} д ${hours} ч` : `${days} д`;
  if (hours > 0) return minutes > 0 ? `${hours} ч ${minutes} мин` : `${hours} ч`;
  return `${minutes} мин`;
}

// Длительность от момента до «сейчас». Нечитаемый момент — пустая строка.
export function sinceText(iso: string | null | undefined, now: number): string {
  if (!iso) return '';
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return '';
  return spanText(Math.max(0, now - at));
}

// Стоимость задачи одной цифрой: «$2.10». Сумма меньше цента, но не ноль, —
// «<$0.01»: округление в «$0.00» сказало бы «бесплатно» о том, что чего-то
// стоило. Ноль, о котором сообщили, остаётся «$0.00».
export function dollars(v: number): string {
  if (v > 0 && v < 0.01) return '<$0.01';
  return `$${v.toFixed(2)}`;
}
