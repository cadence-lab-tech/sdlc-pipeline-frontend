import type {UsageSummary} from '../../api/types';
import {MONEY_LABEL, SUBSCRIPTION_LABEL, UNSPECIFIED_HINT, money, unspecifiedNote} from '../cost';

// Стоимость задачи (решения 0026 и 0062, CLAB-223). Деньги (API) и условная
// стоимость (подписка) — раздельно, общей суммой не складываются: условную
// стоимость сверх подписки не платят. Часть денег без признака оплаты
// подписана. Прогоны без учёта — отдельная строка: сумма при них — нижняя
// граница, а не точная цифра. Одни и те же строки стоят в правой панели и в
// обзоре (CLAB-286): число берётся из одного `detail.usage`, и расходиться им
// нечему. Всё — из ответа как есть, на клиенте ничего не пересчитывается.
export function UsageLines({usage, hasChildren}: {usage: UsageSummary; hasChildren: boolean}) {
  return (
    <div className="space-y-2 text-sm" data-usage-lines>
      <Group
        name="own"
        title="Своя"
        api={usage.api_cost_usd}
        unspecified={usage.unspecified_cost_usd}
        subscription={usage.subscription_cost_usd}
      />
      {hasChildren ? (
        <Group
          name="subtree"
          title="Вместе с дочерними"
          api={usage.subtree_api_cost_usd}
          unspecified={usage.subtree_unspecified_cost_usd}
          subscription={usage.subtree_subscription_cost_usd}
        />
      ) : null}
      <Line label="Токенов" value={usage.tokens.toLocaleString('ru')} />
      {usage.silent_runs > 0 ? (
        <p className="text-muted-foreground text-xs" data-usage-incomplete={usage.silent_runs}>
          Учёт неполный: прогонов без учёта {usage.silent_runs}
          {hasChildren ? ' (вместе с дочерними)' : ''} — стоимость не меньше показанной
        </p>
      ) : null}
    </div>
  );
}

function Group({
  name,
  title,
  api,
  unspecified,
  subscription,
}: {
  name: string;
  title: string;
  api: number;
  unspecified: number;
  subscription: number;
}) {
  const note = unspecifiedNote(unspecified);
  return (
    <dl className="space-y-1" data-usage-group={name}>
      <dt className="font-medium">{title}</dt>
      <dd className="space-y-1 pl-3">
        <Line label={MONEY_LABEL} value={money(api)} name={`${name}.api`} />
        {note ? (
          <p className="text-muted-foreground text-xs" title={UNSPECIFIED_HINT} data-usage-unspecified={name}>
            {note}
          </p>
        ) : null}
        <Line label={SUBSCRIPTION_LABEL} value={money(subscription)} name={`${name}.subscription`} />
      </dd>
    </dl>
  );
}

function Line({label, value, name}: {label: string; value: string; name?: string}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3" data-usage-line={name}>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
