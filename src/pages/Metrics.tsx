import {useState} from 'react';
import {useParams} from 'react-router-dom';

import {Badge} from '@/components/ui/badge';
import {Card} from '@/components/ui/card';
import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';
import {DataTable} from '@/components/DataTable';
import {EmptyState, Page, PageHeader, Section} from '@/components/kit';

import {api} from '../api/client';
import type {ClosedCostMetric, CostMetric, DriftMetric, GateMetric, StatusMetric} from '../api/types';
import {useResource} from '../api/useResource';
import {Loaded} from '../components/Feedback';
import {MoneyCell} from '../components/MoneyCell';
import {
  MONEY_LABEL,
  SUBSCRIPTION_LABEL,
  UNKNOWN,
  closedSilentLine,
  dimensionLabel,
  hasReports,
  incompleteNote,
  money,
  silentCell,
} from '../components/cost';

const PERIODS = [
  {value: '7d', label: '7 дней'},
  {value: '30d', label: '30 дней'},
  {value: '90d', label: '90 дней'},
];

// Метрики цикла: где задачи застревают, какие гейты валятся, сколько дрейфа.
// Всё считает бэкенд по накопленным таблицам; страница только показывает.
// Статусы приходят из данных проекта, а не из списка в коде.
export function Metrics() {
  const {projectKey = ''} = useParams();
  const [period, setPeriod] = useState('30d');
  const metrics = useResource(() => api.metrics(projectKey, period), [projectKey, period]);

  return (
    <Page>
      <PageHeader
        title="Метрики цикла"
        actions={
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={period}
            onValueChange={(next) => next && setPeriod(next)}
            aria-label="Период">
            {PERIODS.map((p) => (
              <ToggleGroupItem key={p.value} value={p.value}>
                {p.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        }
      />

      <Loaded resource={metrics}>
        {(m) => (
          <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
              <Stat label="Создано задач" value={m.throughput.created} />
              <Stat label="Закрыто" value={m.throughput.closed} />
              <Stat label="Отменено" value={m.throughput.cancelled} />
              <Stat label="Среднее время до закрытия" value={hours(m.throughput.avg_lead_hours)} />
              <Stat label="Перепроверок" value={m.throughput.review_runs} />
              <Stat label="Из них с возвратом" value={m.throughput.review_fails} />
            </div>

            <Section
              title="По статусам"
              description="Длительность завершённых попыток этапа за период. Откаты и повторные попытки показывают, где задачи разворачиваются.">
              <DataTable<StatusMetric>
                data={m.statuses}
                idKey="status"
                empty={<EmptyState title="Ни одна попытка этапа не завершилась за период" />}
                columns={[
                  {key: 'status_name', header: 'Статус'},
                  {key: 'open_tasks', header: 'Сейчас', width: 90, align: 'end'},
                  {key: 'finished_runs', header: 'Попыток', width: 90, align: 'end'},
                  {
                    key: 'median_hours',
                    header: 'Медиана',
                    width: 110,
                    align: 'end',
                    renderCell: (row) => hours(row.median_hours),
                  },
                  {
                    key: 'avg_hours',
                    header: 'Среднее',
                    width: 110,
                    align: 'end',
                    renderCell: (row) => hours(row.avg_hours),
                  },
                  {
                    key: 'max_hours',
                    header: 'Максимум',
                    width: 110,
                    align: 'end',
                    renderCell: (row) => hours(row.max_hours),
                  },
                  {key: 'rejections', header: 'Откатов', width: 90, align: 'end'},
                  {key: 'repeated_runs', header: 'Повторных', width: 100, align: 'end'},
                  {key: 'expired_leases', header: 'Аренд истекло', width: 120, align: 'end'},
                ]}
              />
            </Section>

            <Section
              title="Гейты"
              description="Вердикты по гейтам за период. Гейт, который валится чаще других, — либо самое полезное условие цикла, либо неверно настроенное.">
              <DataTable<GateMetric>
                data={m.gates}
                idKey={(g) => `${g.transition}/${g.gate}`}
                empty={<EmptyState title="Гейты за период не прогонялись" />}
                columns={[
                  {key: 'transition', header: 'Переход'},
                  {key: 'gate_name', header: 'Гейт'},
                  {key: 'type', header: 'Тип'},
                  {key: 'passed', header: 'Прошёл', width: 90, align: 'end'},
                  {key: 'failed', header: 'Не прошёл', width: 100, align: 'end'},
                  {key: 'waived', header: 'Снят', width: 80, align: 'end'},
                  {key: 'pending', header: 'Ждёт', width: 80, align: 'end'},
                ]}
              />
            </Section>

            <Section
              title="Стоимость"
              description={
                <>
                  Что стоила работа агентов за период — по статусам, ролям и моделям. «Деньги (API)» — отчёты с оплатой
                  по API и без указанного типа; «Условно (подписка)» — цена по тарифу API за работу на подписке, сверх
                  подписки её не платят. Считается по самоотчётам: прогон без учёта — не ноль, а неизвестная стоимость,
                  и сумма в строке с такими прогонами — нижняя граница.
                </>
              }>
              <DataTable<CostMetric>
                data={m.cost}
                idKey={(c) => `${c.dimension}/${c.key}`}
                empty={<EmptyState title="О стоимости за период никто не отчитался" />}
                columns={[
                  {
                    key: 'dimension',
                    header: 'Разрез',
                    width: 90,
                    renderCell: (row) => dimensionLabel(row.dimension),
                  },
                  {key: 'key', header: 'Значение', renderCell: (row) => row.name || row.key},
                  {key: 'runs', header: 'Прогонов', width: 100, align: 'end'},
                  {
                    key: 'silent_runs',
                    header: 'Без учёта',
                    width: 130,
                    align: 'end',
                    renderCell: (row) => {
                      const cell = silentCell(row);
                      return (
                        <div className="flex flex-col items-end gap-0.5" data-silent-cell title={cell.hint}>
                          <span className="tabular-nums">{cell.text}</span>
                          {cell.incomplete ? <Badge variant="outline">учёт неполный</Badge> : null}
                        </div>
                      );
                    },
                  },
                  {
                    key: 'api_cost_usd',
                    header: MONEY_LABEL,
                    width: 200,
                    align: 'end',
                    renderCell: (row) =>
                      hasReports(row) ? (
                        <MoneyCell value={row.api_cost_usd} unspecified={row.unspecified_cost_usd} />
                      ) : (
                        UNKNOWN
                      ),
                  },
                  {
                    key: 'subscription_cost_usd',
                    header: SUBSCRIPTION_LABEL,
                    width: 150,
                    align: 'end',
                    renderCell: (row) => (hasReports(row) ? money(row.subscription_cost_usd) : UNKNOWN),
                  },
                  {
                    key: 'avg_cost_usd',
                    header: 'Средняя',
                    width: 110,
                    align: 'end',
                    renderCell: (row) => (hasReports(row) ? money(row.avg_cost_usd) : UNKNOWN),
                  },
                  {
                    key: 'tokens',
                    header: 'Токенов',
                    width: 120,
                    align: 'end',
                    renderCell: (row) => row.tokens.toLocaleString('ru'),
                  },
                ]}
              />
              <p className="text-muted-foreground text-xs">
                Средняя — по всей сообщённой стоимости прогона (деньги и условная вместе): отдельного делителя для
                денег и подписки сервер не даёт.
              </p>
            </Section>

            <Section
              title="Стоимость закрытой задачи"
              description="Закрытые за период — задачи в статусе «выполнено», без отменённых. Стоимость считается за всё время жизни задачи, у эпика — по поддереву. Строки «итого» нет: эпик и его задачи считаются каждый в своей строке, и суммы пересекаются.">
              {m.closed_cost === undefined ? (
                <EmptyState
                  title="Раздел недоступен на этой версии сервера"
                  description="Сервер не отдаёт стоимость закрытых задач: обновите его до версии интерфейса."
                />
              ) : (
                <DataTable<ClosedCostMetric>
                  data={m.closed_cost}
                  idKey="task_type"
                  empty={<EmptyState title="За период ни одна задача не закрыта" />}
                  columns={[
                    {
                      key: 'task_type',
                      header: 'Тип задачи',
                      width: 220,
                      renderCell: (row) => (
                        <div className="flex flex-col items-start gap-0.5">
                          <span>{row.task_type}</span>
                          {incompleteNote(row) ? (
                            <Badge variant="outline" className="h-auto rounded-md py-0.5 text-left whitespace-normal" data-incomplete={row.incomplete_tasks}>
                              {incompleteNote(row)}
                            </Badge>
                          ) : null}
                        </div>
                      ),
                    },
                    {key: 'closed_tasks', header: 'Закрыто', width: 90, align: 'end'},
                    {
                      key: 'api_cost_usd',
                      header: `${MONEY_LABEL}, Σ`,
                      width: 200,
                      align: 'end',
                      renderCell: (row) => <MoneyCell value={row.api_cost_usd} unspecified={row.unspecified_cost_usd} />,
                    },
                    {
                      key: 'avg_api_cost_usd',
                      header: `${MONEY_LABEL}, среднее`,
                      width: 130,
                      align: 'end',
                      renderCell: (row) => money(row.avg_api_cost_usd),
                    },
                    {
                      key: 'median_api_cost_usd',
                      header: `${MONEY_LABEL}, медиана`,
                      width: 130,
                      align: 'end',
                      renderCell: (row) => money(row.median_api_cost_usd),
                    },
                    {
                      key: 'subscription_cost_usd',
                      header: `${SUBSCRIPTION_LABEL}, Σ`,
                      width: 150,
                      align: 'end',
                      renderCell: (row) => money(row.subscription_cost_usd),
                    },
                    {
                      key: 'avg_subscription_cost_usd',
                      header: `${SUBSCRIPTION_LABEL}, среднее`,
                      width: 140,
                      align: 'end',
                      renderCell: (row) => money(row.avg_subscription_cost_usd),
                    },
                    {
                      key: 'median_subscription_cost_usd',
                      header: `${SUBSCRIPTION_LABEL}, медиана`,
                      width: 140,
                      align: 'end',
                      renderCell: (row) => money(row.median_subscription_cost_usd),
                    },
                    {
                      key: 'silent_runs',
                      header: 'Без учёта',
                      width: 150,
                      align: 'end',
                      renderCell: (row) => closedSilentLine(row),
                    },
                  ]}
                />
              )}
            </Section>

            <Section title="Дрейф">
              <DataTable<DriftMetric>
                data={m.drift}
                idKey={(d) => `${d.kind}/${d.severity}`}
                empty={<EmptyState title="Сигналов дрейфа за период не было" />}
                columns={[
                  {key: 'kind', header: 'Вид'},
                  {key: 'severity', header: 'Уровень'},
                  {key: 'open', header: 'Открыто', width: 90, align: 'end'},
                  {key: 'resolved', header: 'Разобрано', width: 100, align: 'end'},
                  {key: 'dismissed', header: 'Отклонено', width: 100, align: 'end'},
                ]}
              />
            </Section>
          </div>
        )}
      </Loaded>
    </Page>
  );
}

function Stat({label, value}: {label: string; value: number | string}) {
  return (
    <Card className="gap-1 p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{String(value)}</p>
    </Card>
  );
}

// Часы читаются, пока их меньше двух суток; дальше понятнее дни.
function hours(h: number): string {
  if (!h) return '—';
  if (h < 1) return `${Math.round(h * 60)} мин`;
  if (h < 48) return `${h.toFixed(1)} ч`;
  return `${(h / 24).toFixed(1)} д`;
}
