import {useState} from 'react';
import {useParams} from 'react-router-dom';

import {Card} from '@/components/ui/card';
import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';
import {DataTable} from '@/components/DataTable';
import {EmptyState, Page, PageHeader, Section} from '@/components/kit';

import {api} from '../api/client';
import type {CostMetric, DriftMetric, GateMetric, StatusMetric} from '../api/types';
import {useResource} from '../api/useResource';
import {Loaded} from '../components/Feedback';

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
              description="Что стоила работа агентов за период — по статусам, ролям и моделям. Считается по самоотчётам: прогон, о котором не отчитались, стоит «неизвестно», а не ноль, и такие прогоны показаны отдельным счётчиком.">
              <DataTable<CostMetric>
                data={m.cost}
                idKey={(c) => `${c.dimension}/${c.key}`}
                empty={<EmptyState title="О стоимости за период никто не отчитался" />}
                columns={[
                  {key: 'dimension', header: 'Разрез', width: 90},
                  {key: 'key', header: 'Значение', renderCell: (row) => row.name || row.key},
                  {key: 'runs', header: 'Прогонов', width: 100, align: 'end'},
                  {key: 'silent_runs', header: 'Без отчёта', width: 110, align: 'end'},
                  {
                    key: 'cost_usd',
                    header: 'Стоимость',
                    width: 110,
                    align: 'end',
                    renderCell: (row) => money(row.cost_usd),
                  },
                  {
                    key: 'avg_cost_usd',
                    header: 'Средняя',
                    width: 110,
                    align: 'end',
                    renderCell: (row) => money(row.avg_cost_usd),
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

// Доллары с двумя знаками: суммы тут маленькие, и округление до целого
// превратило бы разницу между моделями в ноль.
function money(v: number): string {
  if (!v) return '—';
  return `${v.toFixed(v < 1 ? 3 : 2)} $`;
}

// Часы читаются, пока их меньше двух суток; дальше понятнее дни.
function hours(h: number): string {
  if (!h) return '—';
  if (h < 1) return `${Math.round(h * 60)} мин`;
  if (h < 48) return `${h.toFixed(1)} ч`;
  return `${(h / 24).toFixed(1)} д`;
}
