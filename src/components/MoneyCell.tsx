import {UNSPECIFIED_HINT, money, unspecifiedNote} from './cost';

// Сумма в таблице: значение и, если часть денег без признака оплаты, мелкая
// пометка под ним с подсказкой о трактовке (решение 0062). Само значение
// форматирует `cost.ts`; неизвестное сюда не приходит — его пишут «—».
export function MoneyCell({value, unspecified}: {value: number; unspecified?: number | null}) {
  const note = unspecifiedNote(unspecified);
  return (
    <div className="flex flex-col items-end">
      <span className="tabular-nums">{money(value)}</span>
      {note ? (
        <span className="text-muted-foreground text-xs font-normal whitespace-normal" title={UNSPECIFIED_HINT} data-unspecified>
          {note}
        </span>
      ) : null}
    </div>
  );
}
