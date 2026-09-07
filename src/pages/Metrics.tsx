import {useState} from 'react';
import {useParams} from 'react-router-dom';
import {Card} from '@astryxdesign/core/Card';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Grid} from '@astryxdesign/core/Grid';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {Section} from '@astryxdesign/core/Section';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {Table, pixel, proportional} from '@astryxdesign/core/Table';
import {Heading, Text} from '@astryxdesign/core/Text';

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
    <Section padding={6}>
      <VStack gap={5}>
        <HStack hAlign="between" vAlign="center">
          <Heading level={1}>Метрики цикла</Heading>
          <SegmentedControl label="Период" value={period} onChange={setPeriod} size="sm">
            {PERIODS.map((p) => (
              <SegmentedControlItem key={p.value} value={p.value} label={p.label} />
            ))}
          </SegmentedControl>
        </HStack>

        <Loaded resource={metrics}>
          {(m) => (
            <VStack gap={5}>
              <Grid columns={{minWidth: 180}} gap={3}>
                <Stat label="Создано задач" value={m.throughput.created} />
                <Stat label="Закрыто" value={m.throughput.closed} />
                <Stat label="Отменено" value={m.throughput.cancelled} />
                <Stat label="Среднее время до закрытия" value={hours(m.throughput.avg_lead_hours)} />
                <Stat label="Перепроверок" value={m.throughput.review_runs} />
                <Stat label="Из них с возвратом" value={m.throughput.review_fails} />
              </Grid>

              <VStack gap={2}>
                <Heading level={2}>По статусам</Heading>
                <Text type="supporting" color="secondary">
                  Длительность завершённых попыток этапа за период. Откаты и повторные попытки
                  показывают, где задачи разворачиваются.
                </Text>
                {m.statuses.length === 0 ? (
                  <EmptyState title="Ни одна попытка этапа не завершилась за период" />
                ) : (
                  <Table<StatusMetric & Record<string, unknown>>
                    data={m.statuses as (StatusMetric & Record<string, unknown>)[]}
                    idKey="status"
                    density="compact"
                    columns={[
                      {key: 'status_name', header: 'Статус', width: proportional(2)},
                      {key: 'open_tasks', header: 'Сейчас', width: pixel(90), align: 'end'},
                      {key: 'finished_runs', header: 'Попыток', width: pixel(90), align: 'end'},
                      {
                        key: 'median_hours',
                        header: 'Медиана',
                        width: pixel(110),
                        align: 'end',
                        renderCell: (row) => hours(row.median_hours),
                      },
                      {
                        key: 'avg_hours',
                        header: 'Среднее',
                        width: pixel(110),
                        align: 'end',
                        renderCell: (row) => hours(row.avg_hours),
                      },
                      {
                        key: 'max_hours',
                        header: 'Максимум',
                        width: pixel(110),
                        align: 'end',
                        renderCell: (row) => hours(row.max_hours),
                      },
                      {key: 'rejections', header: 'Откатов', width: pixel(90), align: 'end'},
                      {key: 'repeated_runs', header: 'Повторных', width: pixel(100), align: 'end'},
                      {key: 'expired_leases', header: 'Аренд истекло', width: pixel(120), align: 'end'},
                    ]}
                  />
                )}
              </VStack>

              <VStack gap={2}>
                <Heading level={2}>Гейты</Heading>
                <Text type="supporting" color="secondary">
                  Вердикты по гейтам за период. Гейт, который валится чаще других, — либо самое
                  полезное условие цикла, либо неверно настроенное.
                </Text>
                {m.gates.length === 0 ? (
                  <EmptyState title="Гейты за период не прогонялись" />
                ) : (
                  <Table<GateMetric & Record<string, unknown>>
                    data={m.gates as (GateMetric & Record<string, unknown>)[]}
                    idKey={(g) => `${g.transition}/${g.gate}`}
                    density="compact"
                    columns={[
                      {key: 'transition', header: 'Переход', width: proportional(1)},
                      {key: 'gate_name', header: 'Гейт', width: proportional(2)},
                      {key: 'type', header: 'Тип', width: proportional(1)},
                      {key: 'passed', header: 'Прошёл', width: pixel(90), align: 'end'},
                      {key: 'failed', header: 'Не прошёл', width: pixel(100), align: 'end'},
                      {key: 'waived', header: 'Снят', width: pixel(80), align: 'end'},
                      {key: 'pending', header: 'Ждёт', width: pixel(80), align: 'end'},
                    ]}
                  />
                )}
              </VStack>

              <VStack gap={2}>
                <Heading level={2}>Стоимость</Heading>
                <Text type="supporting" color="secondary">
                  Что стоила работа агентов за период — по статусам, ролям и моделям. Считается по
                  самоотчётам: прогон, о котором не отчитались, стоит «неизвестно», а не ноль,
                  и такие прогоны показаны отдельным счётчиком.
                </Text>
                {m.cost.length === 0 ? (
                  <EmptyState title="О стоимости за период никто не отчитался" />
                ) : (
                  <Table<CostMetric & Record<string, unknown>>
                    data={m.cost as (CostMetric & Record<string, unknown>)[]}
                    idKey={(c) => `${c.dimension}/${c.key}`}
                    density="compact"
                    columns={[
                      {key: 'dimension', header: 'Разрез', width: pixel(90)},
                      {
                        key: 'key',
                        header: 'Значение',
                        width: proportional(2),
                        renderCell: (row) => row.name || row.key,
                      },
                      {key: 'runs', header: 'Прогонов', width: pixel(100), align: 'end'},
                      {
                        key: 'silent_runs',
                        header: 'Без отчёта',
                        width: pixel(110),
                        align: 'end',
                      },
                      {
                        key: 'cost_usd',
                        header: 'Стоимость',
                        width: pixel(110),
                        align: 'end',
                        renderCell: (row) => money(row.cost_usd),
                      },
                      {
                        key: 'avg_cost_usd',
                        header: 'Средняя',
                        width: pixel(110),
                        align: 'end',
                        renderCell: (row) => money(row.avg_cost_usd),
                      },
                      {
                        key: 'tokens',
                        header: 'Токенов',
                        width: pixel(120),
                        align: 'end',
                        renderCell: (row) => row.tokens.toLocaleString('ru'),
                      },
                    ]}
                  />
                )}
              </VStack>

              <VStack gap={2}>
                <Heading level={2}>Дрейф</Heading>
                {m.drift.length === 0 ? (
                  <EmptyState title="Сигналов дрейфа за период не было" />
                ) : (
                  <Table<DriftMetric & Record<string, unknown>>
                    data={m.drift as (DriftMetric & Record<string, unknown>)[]}
                    idKey={(d) => `${d.kind}/${d.severity}`}
                    density="compact"
                    columns={[
                      {key: 'kind', header: 'Вид', width: proportional(1)},
                      {key: 'severity', header: 'Уровень', width: proportional(1)},
                      {key: 'open', header: 'Открыто', width: pixel(90), align: 'end'},
                      {key: 'resolved', header: 'Разобрано', width: pixel(100), align: 'end'},
                      {key: 'dismissed', header: 'Отклонено', width: pixel(100), align: 'end'},
                    ]}
                  />
                )}
              </VStack>
            </VStack>
          )}
        </Loaded>
      </VStack>
    </Section>
  );
}

function Stat({label, value}: {label: string; value: number | string}) {
  return (
    <Card padding={3}>
      <VStack gap={1}>
        <Text type="supporting" color="secondary">
          {label}
        </Text>
        <Heading level={3}>{String(value)}</Heading>
      </VStack>
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
