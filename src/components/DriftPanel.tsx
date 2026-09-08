import {useState} from 'react';

import {Button} from '@/components/ui/button';
import {Separator} from '@/components/ui/separator';
import {Note, Section, StatusDot, Timestamp, Token, type DotVariant} from '@/components/kit';

import {ApiError, api} from '../api/client';
import type {DriftSignal} from '../api/types';
import {useResource} from '../api/useResource';
import {Failure} from './Feedback';

// Дрейф кодовой базы: код под задачей уехал, пока над ней работали. Сигнал
// держит гейт drift_clear, но решение принимает человек или агент — движок
// сам задачу назад не двигает.
//
// Серьёзность — перечень схемы (drift_signals.severity), по ней выбирать вид
// можно; вид сигнала придумывает детектор, по нему — нет.
const SEVERITY: Record<string, DotVariant> = {
  high: 'error',
  medium: 'warning',
  low: 'neutral',
};

// Виды сигнала — перечень схемы (drift_signals.kind): база задачи сдвинулась
// или две задачи объявили одну зону изменений.
const KIND_LABEL: Record<string, string> = {
  baseline_drift: 'база задачи сдвинулась',
  task_overlap: 'пересечение с другой задачей',
};

export function DriftPanel({taskKey}: {taskKey: string}) {
  const drift = useResource(() => api.taskDrift(taskKey), [taskKey]);
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);

  // resolved и dismissed — разные вещи, и разница видна в метриках: первое
  // значит «разобрались», второе — «сигнал не про нас».
  const resolve = async (id: string, resolution: 'resolved' | 'dismissed') => {
    setBusy(true);
    setError(undefined);
    try {
      await api.resolveDrift(id, resolution);
      drift.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    } finally {
      setBusy(false);
    }
  };

  if (drift.error) return <Failure error={drift.error} title="Дрейф не прочитан" />;
  if (!drift.data) return null;

  const {baselines, signals} = drift.data;
  if (baselines.length === 0 && signals.length === 0) return null;

  return (
    <>
      <Separator />
      <Section title="Дрейф кодовой базы">
        {error ? <Failure error={error} title="Сигнал не разобран" /> : null}

        {baselines.length > 0 ? (
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs">База задачи</p>
            {baselines.map((b) => (
              <p key={`${b.repository}/${b.branch}`} className="font-mono text-xs">
                {b.repository} · {b.branch} · {b.commit.slice(0, 8)}
              </p>
            ))}
          </div>
        ) : null}

        {signals.length === 0 ? (
          <p className="text-muted-foreground text-sm">Открытых расхождений нет</p>
        ) : (
          signals.map((signal) => (
            <SignalCard key={signal.id} signal={signal} busy={busy} onResolve={resolve} />
          ))
        )}
      </Section>
    </>
  );
}

function SignalCard({
  signal,
  busy,
  onResolve,
}: {
  signal: DriftSignal;
  busy: boolean;
  onResolve: (id: string, resolution: 'resolved' | 'dismissed') => void;
}) {
  const paths = overlapPaths(signal.overlap);

  return (
    <Note
      tone={signal.severity === 'high' ? 'error' : signal.severity === 'medium' ? 'warning' : 'info'}
      title={
        <span className="inline-flex items-center gap-2">
          <StatusDot variant={SEVERITY[signal.severity] ?? 'neutral'} label={signal.severity} />
          {KIND_LABEL[signal.kind] ?? signal.kind}
        </span>
      }>
      <div className="space-y-2">
        {signal.repository ? <p className="font-mono text-xs">{signal.repository}</p> : null}
        {signal.from_commit && signal.to_commit ? (
          <p className="font-mono text-xs">
            {signal.from_commit.slice(0, 8)} → {signal.to_commit.slice(0, 8)}
          </p>
        ) : null}
        {signal.related_task ? (
          <p className="text-xs">Пересечение с задачей {signal.related_task}</p>
        ) : null}
        {paths.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {paths.slice(0, 8).map((path) => (
              <Token key={path} label={path} />
            ))}
            {paths.length > 8 ? <span className="text-xs">и ещё {paths.length - 8}</span> : null}
          </div>
        ) : null}
        <Timestamp value={signal.detected_at} format="relative" className="text-xs" />
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => onResolve(signal.id, 'resolved')}>
            Разобрано
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => onResolve(signal.id, 'dismissed')}>
            Не про нас
          </Button>
        </div>
      </div>
    </Note>
  );
}

// Пересечение детектор кладёт как есть; интерфейс достаёт из него пути и
// символы и не делает вид, что знает остальное.
function overlapPaths(overlap: unknown): string[] {
  if (!overlap || typeof overlap !== 'object') return [];
  const value = (overlap as {paths?: unknown}).paths;
  return Array.isArray(value) ? value.filter((p): p is string => typeof p === 'string') : [];
}
