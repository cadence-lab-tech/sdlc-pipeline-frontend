import type {UsageSummary} from '../../api/types';

// Стоимость задачи (решение 0026). Прогоны без отчёта показаны отдельно:
// «неизвестно» — это не ноль, и подменять одно другим значит врать о счёте.
// Одни и те же строки стоят в правой панели и в обзоре (CLAB-286): число
// берётся из одного `detail.usage`, и расходиться им нечему.
export function UsageLines({usage, hasChildren}: {usage: UsageSummary; hasChildren: boolean}) {
  const money = (v: number) => `${v.toFixed(2)} $`;

  return (
    <>
      <dl className="space-y-1 text-sm">
        <Line label="Своя" value={money(usage.cost_usd)} />
        {hasChildren ? (
          <Line label="Вместе с дочерними" value={money(usage.subtree_cost_usd)} />
        ) : null}
        <Line label="Токенов" value={usage.tokens.toLocaleString('ru')} />
      </dl>
      {usage.silent_runs > 0 ? (
        <p className="text-muted-foreground text-xs">
          Прогонов без отчёта: {usage.silent_runs} — их стоимость неизвестна
        </p>
      ) : null}
    </>
  );
}

function Line({label, value}: {label: string; value: string}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
