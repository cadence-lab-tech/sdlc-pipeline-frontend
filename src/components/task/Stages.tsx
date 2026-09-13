import {ChevronDown} from 'lucide-react';

import {Badge} from '@/components/ui/badge';
import {Card} from '@/components/ui/card';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible';
import {StatusDot, Timestamp, Token, type DotVariant} from '@/components/kit';

import type {Artifact, StageRun, TaskDetail} from '../../api/types';
import {ArtifactView} from '../ArtifactView';
import {isLeaseLive} from './lease';

// Этапы идут попытками: повторный заход после отката — новая попытка, а не
// перезапись прежней, поэтому «аналитика делалась дважды» видно целиком. Но
// раскрыта только последняя: у задачи, вернувшейся с тестирования, три
// развёрнутых прогона подряд читать невозможно.
//
// Перепроверка ролью-ревьюером — не отдельный этап, а вложенный прогон того же
// (решение 0017), поэтому она показана внутри своего родителя: пока она идёт,
// родительский прогон стоит в gating и работать в нём некому.
export function Stages({detail, onChanged}: {detail: TaskDetail; onChanged: () => void}) {
  const nested = new Map<string, StageRun[]>();
  for (const run of detail.stage_runs) {
    if (!run.parent_run_id) continue;
    const list = nested.get(run.parent_run_id);
    if (list) list.push(run);
    else nested.set(run.parent_run_id, [run]);
  }

  const runs = detail.stage_runs
    .filter((r) => !r.parent_run_id)
    .sort((a, b) => b.entered_at.localeCompare(a.entered_at));

  // Номер попытки показывается там, где статус проходился не один раз: иначе
  // в свёрнутом списке стоят две одинаковые строки, и какая из них первая —
  // непонятно. У статуса, пройденного единожды, номер только шумит.
  const attempts = new Map<string, number>();
  for (const run of runs) attempts.set(run.status_key, (attempts.get(run.status_key) ?? 0) + 1);

  return (
    <div className="space-y-4">
      {runs.map((run, index) => (
        <StageCard
          key={run.id}
          run={run}
          isLatest={index === 0}
          showAttempt={run.attempt > 1 || (attempts.get(run.status_key) ?? 1) > 1}
          reviews={(nested.get(run.id) ?? []).sort((a, b) => a.entered_at.localeCompare(b.entered_at))}
          artifacts={detail.artifacts.filter((a) => a.stage_run_id === run.id)}
          allArtifacts={detail.artifacts}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}

const RUN_VARIANT: Record<string, DotVariant> = {
  passed: 'success',
  failed: 'error',
  abandoned: 'neutral',
  pending: 'neutral',
  claimed: 'accent',
  in_progress: 'accent',
  submitted: 'warning',
  gating: 'warning',
};

function StageCard({
  run,
  isLatest,
  showAttempt,
  reviews,
  artifacts,
  allArtifacts,
  onChanged,
}: {
  run: StageRun;
  isLatest: boolean;
  showAttempt: boolean;
  reviews: StageRun[];
  artifacts: Artifact[];
  allArtifacts: Artifact[];
  onChanged: () => void;
}) {
  return (
    <Card className="gap-3 p-4">
      {/* Атрибут data-stage-run оформления не несёт — это опора для сквозных
          сценариев: по нему они находят прогон и видят, раскрыт ли он. */}
      <Collapsible defaultOpen={isLatest} data-stage-run={run.status_key}>
        <h3 className="text-base font-semibold">
          <CollapsibleTrigger className="group hover:text-foreground/80 flex w-full items-center gap-2 text-left transition-colors">
            <StatusDot variant={RUN_VARIANT[run.state] ?? 'neutral'} label={run.state} />
            <span>{run.status_key}</span>
            {run.role_key ? <Token label={run.role_key} /> : null}
            {showAttempt ? <Badge variant="secondary">попытка {run.attempt}</Badge> : null}
            <Timestamp value={run.entered_at} format="relative" className="ml-auto text-xs" />
            <ChevronDown className="text-muted-foreground size-4 -rotate-90 transition-transform group-data-[state=open]:rotate-0" />
          </CollapsibleTrigger>
        </h3>
        <CollapsibleContent className="space-y-3 pt-3">
          <Lease run={run} />
          {run.summary ? <p className="text-muted-foreground text-sm">{run.summary}</p> : null}
          {artifacts.length === 0 ? (
            <p className="text-muted-foreground text-sm">Артефактов на этой попытке нет</p>
          ) : (
            <div className="space-y-2">
              {artifacts.map((a) => (
                <ArtifactView key={a.id} artifact={a} onChanged={onChanged} />
              ))}
            </div>
          )}
          {reviews.length > 0 ? (
            <div className="space-y-2 border-l-2 pl-3">
              <p className="text-muted-foreground text-xs">Перепроверка</p>
              {reviews.map((review) => (
                <ReviewRun
                  key={review.id}
                  run={review}
                  artifacts={allArtifacts.filter((a) => a.stage_run_id === review.id)}
                  onChanged={onChanged}
                />
              ))}
            </div>
          ) : null}
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

// Вложенный прогон перепроверки: своя роль, своя аренда, свой вердикт.
function ReviewRun({
  run,
  artifacts,
  onChanged,
}: {
  run: StageRun;
  artifacts: Artifact[];
  onChanged: () => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusDot variant={RUN_VARIANT[run.state] ?? 'neutral'} label={run.state} />
          {run.role_key ? <Token label={run.role_key} /> : null}
          {run.outcome ? <Badge variant="secondary">{run.outcome}</Badge> : null}
        </div>
        <Timestamp value={run.entered_at} format="relative" />
      </div>
      <Lease run={run} />
      {run.summary ? <p className="text-muted-foreground text-sm">{run.summary}</p> : null}
      {artifacts.map((a) => (
        <ArtifactView key={a.id} artifact={a} onChanged={onChanged} />
      ))}
    </div>
  );
}

// Аренда: кто забрал прогон, когда подавал признаки жизни и сколько ей
// осталось. Истёкшую аренду подметает воркер, но до тех пор она видна как
// истёкшая, а не как пустая: разница объясняет, почему задачу никто не берёт.
function Lease({run}: {run: StageRun}) {
  if (!run.claimed_by_handle) return null;
  const live = isLeaseLive(run);
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className="inline-flex items-center gap-1.5">
        <StatusDot variant={live ? 'accent' : 'neutral'} />
        {live ? 'в работе у' : 'аренда истекла у'} {run.claimed_by_handle}
      </span>
      {run.lease_expires_at ? (
        <span>
          аренда {live ? 'истекает' : 'истекла'}{' '}
          <Timestamp value={run.lease_expires_at} format="relative" className="text-xs" />
        </span>
      ) : null}
      {run.heartbeat_at ? (
        <span>
          подал признаки жизни <Timestamp value={run.heartbeat_at} format="relative" className="text-xs" />
        </span>
      ) : null}
    </div>
  );
}
