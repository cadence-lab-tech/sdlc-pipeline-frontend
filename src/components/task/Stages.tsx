import {useId, useState} from 'react';
import {Link} from 'react-router-dom';
import {ChevronDown, X} from 'lucide-react';

import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible';
import {StatusDot, Timestamp, Token, type DotVariant} from '@/components/kit';

import {ApiError, api} from '../../api/client';
import type {Artifact, ModelLevel, StageRun, Status, TaskDetail, TaskEvent, Workflow} from '../../api/types';
import type {Resource} from '../../api/useResource';
import {ArtifactView} from '../ArtifactView';
import {Failure, Loading} from '../Feedback';
import {GateVerdictRow} from '../Gates';
import {ModelLevelToggle} from '../ModelLevelToggle';
import {runModelLine} from '../modelLevel';
import {isLeaseLive} from './lease';
import {
  exitLabel,
  hasExecutor,
  returnedFrom,
  returnedTo,
  roleWithVersion,
  runArtifacts,
  runCostLine,
  stageAttempts,
  stageExits,
  stageLevelPatch,
  stageRoles,
  stageTotal,
  stageTotalLine,
  type ReturnNote,
  type StageAttempt,
} from './stagePanel';
import {Timeline} from './Timeline';

// Этапы идут попытками: повторный заход после отката — новая попытка, а не
// перезапись прежней, поэтому «аналитика делалась дважды» видно целиком. Но
// раскрыта только последняя: у задачи, вернувшейся с тестирования, три
// развёрнутых прогона подряд читать невозможно.
//
// Перепроверка ролью-ревьюером — не отдельный этап, а вложенный прогон того же
// (решение 0017), поэтому она показана внутри своего родителя: пока она идёт,
// родительский прогон стоит в gating и работать в нём некому.
//
// Выбранный на схеме цикла статус (`?stage=`) показывает панель этапа
// (CLAB-285): попытки статуса с гейтами, возвратами и стоимостью, события
// этапа и его уровень. Без выбора карточка рисует обзор (CLAB-286), а не
// этот компонент.
export function Stages({
  detail,
  stage,
  workflow,
  stageEvents,
  levelEditable,
  onClearStage,
  onChanged,
}: {
  detail: TaskDetail;
  // Выбранный статус — ключ из версии цикла задачи.
  stage: string;
  workflow?: Workflow;
  // Лента выбранного статуса (`timeline?status=`): её держит страница, чтобы
  // перезапрашивать вместе с карточкой и опросом живой аренды.
  stageEvents?: Resource<TaskEvent[]>;
  levelEditable?: boolean;
  onClearStage?: () => void;
  onChanged: () => void;
}) {
  return (
    <StagePanel
      detail={detail}
      stage={stage}
      workflow={workflow}
      events={stageEvents}
      levelEditable={levelEditable ?? true}
      onClear={onClearStage}
      onChanged={onChanged}
    />
  );
}

// ── панель выбранного этапа ──────────────────────────────────────────────────

function StagePanel({
  detail,
  stage,
  workflow,
  events,
  levelEditable,
  onClear,
  onChanged,
}: {
  detail: TaskDetail;
  stage: string;
  workflow?: Workflow;
  events?: Resource<TaskEvent[]>;
  levelEditable: boolean;
  onClear?: () => void;
  onChanged: () => void;
}) {
  const statuses = workflow?.statuses;
  const status = statuses?.find((s) => s.key === stage);
  const attempts = stageAttempts(detail.stage_runs, stage);
  const total = stageTotal(attempts);
  const roles = stageRoles(status);

  return (
    // data-stage-panel и data-stage-filter оформления не несут — это опоры
    // сквозных сценариев: по ним они видят, какой этап открыт.
    <section className="space-y-4" data-stage-panel={stage} data-stage-filter={stage}>
      <Card className="gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {/* Цвет статуса — данные проекта, поэтому через style; без цвета —
              токен темы. */}
          <span
            className={status?.color ? 'size-3 shrink-0 rounded-full' : 'bg-muted-foreground size-3 shrink-0 rounded-full'}
            style={status?.color ? {backgroundColor: status.color} : undefined}
            aria-hidden
          />
          <h2 className="text-lg font-semibold">{status?.name ?? stage}</h2>
          <Token label={stage} />
          {attempts.length > 0 ? (
            <Badge variant="secondary" data-stage-attempts={attempts.length}>
              попыток: {attempts.length}
            </Badge>
          ) : null}
          {onClear ? (
            <Button variant="ghost" size="sm" className="ml-auto" onClick={onClear}>
              <X />
              К обзору
            </Button>
          ) : null}
        </div>
        {status?.description ? <p className="text-muted-foreground text-sm">{status.description}</p> : null}
        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="text-muted-foreground">Роль этапа</dt>
          <dd className="flex flex-wrap gap-1" data-stage-roles>
            {roles.length === 0 ? (
              <span className="text-muted-foreground">без роли-исполнителя</span>
            ) : (
              roles.map((r) => <Token key={r.role_id} label={r.is_primary || roles.length === 1 ? r.role_name : `${r.role_name} · вспомогательная`} />)
            )}
          </dd>
          {hasExecutor(status) ? (
            <>
              <dt className="text-muted-foreground">Уровень этапа</dt>
              <dd>
                <StageModelLevel task={detail.task} stage={stage} editable={levelEditable} onChanged={onChanged} />
              </dd>
            </>
          ) : null}
          {attempts.length > 0 ? (
            <>
              <dt className="text-muted-foreground">Стоимость</dt>
              <dd data-stage-total={total.reported} data-stage-silent={total.silent}>
                <span className="tabular-nums">{stageTotalLine(total)}</span>
                {total.silent > 0 ? (
                  <span className="text-muted-foreground block text-xs">
                    прогонов без отчёта: {total.silent} — их стоимость неизвестна
                  </span>
                ) : null}
              </dd>
            </>
          ) : null}
        </dl>
      </Card>

      {attempts.length === 0 ? (
        <NotStarted workflow={workflow} stage={stage} />
      ) : (
        attempts.map((attempt, index) => (
          <StageCard
            key={attempt.run.id}
            run={attempt.run}
            isLatest={index === 0}
            showAttempt={attempts.length > 1 || attempt.run.attempt > 1}
            reviews={attempt.reviews}
            artifacts={runArtifacts(detail.artifacts, attempt.run.id)}
            allArtifacts={detail.artifacts}
            onChanged={onChanged}
            panel={{attempt, runs: detail.stage_runs, artifacts: detail.artifacts, statuses}}
          />
        ))
      )}

      <StageEvents events={events} />
    </section>
  );
}

// Этап, который задача ещё не проходила: роль статуса и гейты выхода по
// версии цикла задачи — что здесь будет и что держит переход дальше.
function NotStarted({workflow, stage}: {workflow?: Workflow; stage: string}) {
  const exits = stageExits(workflow, stage);
  return (
    <Card className="gap-3 p-4" data-stage-unstarted={stage}>
      <p className="text-sm font-medium">Этап ещё не начинался</p>
      {exits.length === 0 ? (
        <p className="text-muted-foreground text-sm">Переходов из этого статуса нет — он конечный.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-muted-foreground text-xs">Выход из этапа по версии цикла задачи</p>
          {exits.map(({transition, to, gates}) => (
            <div key={transition.id} className="space-y-1.5" data-stage-exit={transition.key}>
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{transition.name}</span>
                <span className="text-muted-foreground text-xs">
                  {transition.key} → {to?.name ?? '—'}
                </span>
                {transition.kind === 'reject' ? <Badge variant="outline">возврат</Badge> : null}
              </p>
              {gates.length === 0 ? (
                <p className="text-muted-foreground text-xs">без гейтов</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {gates.map((g) => (
                    <span key={g.id} className="inline-flex items-center gap-1 text-xs" data-stage-exit-gate={g.key}>
                      <Token label={`${g.name} · ${g.type}`} />
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// События статуса — тем же видом строки, что в ленте задачи. Ошибка ленты не
// гасит панель: повтор — в этом блоке.
function StageEvents({events}: {events?: Resource<TaskEvent[]>}) {
  return (
    <section className="space-y-2" data-stage-events>
      <h3 className="text-base font-semibold">События этапа</h3>
      {!events ? null : events.error ? (
        <Failure error={events.error} reload={events.reload} title="События этапа не загрузились" />
      ) : !events.data ? (
        <Loading />
      ) : events.data.length === 0 ? (
        <p className="text-muted-foreground text-sm">Событий нет</p>
      ) : (
        <Timeline events={events} />
      )}
    </section>
  );
}

// Уровень модели этапа (решение 0060): пишет stage_settings задачи, и его
// берёт следующий захват этого статуса. Положение — то, что отдал сервер.
function StageModelLevel({
  task,
  stage,
  editable,
  onChanged,
}: {
  task: TaskDetail['task'];
  stage: string;
  editable: boolean;
  onChanged: () => void;
}) {
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);
  const labelId = useId();

  const change = async (level: ModelLevel | null) => {
    setBusy(true);
    setError(undefined);
    try {
      await api.updateTask(task.key, stageLevelPatch(stage, level));
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5" data-stage-model-level={stage}>
      <span id={labelId} className="sr-only">
        Уровень модели этапа
      </span>
      <ModelLevelToggle
        value={task.stage_settings[stage]?.model_level}
        onChange={change}
        disabled={!editable}
        busy={busy}
        labelledBy={labelId}
        title={editable ? undefined : 'Уровень этапа меняет сопровождающий проекта'}
      />
      {error ? <Failure error={error} title="Уровень этапа не изменён" /> : null}
    </div>
  );
}

// ── попытка ──────────────────────────────────────────────────────────────────

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

// Что попытке нужно в панели этапа сверх списка: она сама с перепроверками,
// все прогоны и артефакты задачи (возврат ссылается на соседний этап) и
// статусы версии — для имён.
interface PanelContext {
  attempt: StageAttempt;
  runs: StageRun[];
  artifacts: Artifact[];
  statuses?: Status[];
}

function StageCard({
  run,
  isLatest,
  showAttempt,
  reviews,
  artifacts,
  allArtifacts,
  onChanged,
  panel,
}: {
  run: StageRun;
  isLatest: boolean;
  showAttempt: boolean;
  reviews: StageRun[];
  artifacts: Artifact[];
  allArtifacts: Artifact[];
  onChanged: () => void;
  panel: PanelContext;
}) {
  const role = roleWithVersion(run);
  return (
    <Card className="gap-3 p-4">
      {/* Атрибут data-stage-run оформления не несёт — это опора для сквозных
          сценариев: по нему они находят прогон и видят, раскрыт ли он. */}
      <Collapsible defaultOpen={isLatest} data-stage-run={run.status_key} data-run-id={run.id}>
        <h3 className="text-base font-semibold">
          <CollapsibleTrigger className="group hover:text-foreground/80 flex w-full flex-wrap items-center gap-2 text-left transition-colors">
            <StatusDot variant={RUN_VARIANT[run.state] ?? 'neutral'} label={run.state} />
            <span>{run.status_key}</span>
            {role ? <Token label={role} /> : null}
            {showAttempt ? <Badge variant="secondary">попытка {run.attempt}</Badge> : null}
            {run.outcome ? <Badge variant="outline">{run.outcome}</Badge> : null}
            <Timestamp value={run.entered_at} format="relative" className="ml-auto text-xs" />
            <ChevronDown className="text-muted-foreground size-4 -rotate-90 transition-transform group-data-[state=open]:rotate-0" />
          </CollapsibleTrigger>
        </h3>
        <CollapsibleContent className="space-y-3 pt-3">
          <AttemptHead run={run} panel={panel} />
          <Lease run={run} />
          <RunModel run={run} />
          <RunCost run={run} />
          {run.summary ? <p className="text-muted-foreground text-sm">{run.summary}</p> : null}
          {artifacts.length === 0 ? (
            <p className="text-muted-foreground text-sm">Артефактов на этой попытке нет</p>
          ) : (
            <div className="space-y-2">
              {artifacts.map((a) => (
                <div key={a.id} id={artifactAnchor(a.id)} className="scroll-mt-20">
                  <ArtifactView artifact={a} onChanged={onChanged} />
                </div>
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
                  artifacts={runArtifacts(allArtifacts, review.id)}
                  onChanged={onChanged}
                />
              ))}
            </div>
          ) : null}
          <RunGates run={run} />
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

const artifactAnchor = (id: string) => `artifact-${id}`;

// Шапка попытки в панели: кто, когда, чем кончилась и откуда пришла.
function AttemptHead({run, panel}: {run: StageRun; panel: PanelContext}) {
  const from = returnedFrom(run, panel.runs, panel.artifacts, panel.statuses);
  const to = returnedTo(run, panel.artifacts, panel.statuses);
  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs" data-attempt-meta>
        <dt className="text-muted-foreground">Исполнитель</dt>
        <dd>{run.claimed_by_handle ?? '—'}</dd>
        <dt className="text-muted-foreground">Роль</dt>
        <dd>{roleWithVersion(run) || '—'}</dd>
        <dt className="text-muted-foreground">Вход</dt>
        <dd>
          <Timestamp value={run.entered_at} className="text-xs" />
        </dd>
        <dt className="text-muted-foreground">Захват</dt>
        <dd>{run.claimed_at ? <Timestamp value={run.claimed_at} className="text-xs" /> : '—'}</dd>
        <dt className="text-muted-foreground">Завершение</dt>
        <dd>{run.finished_at ? <Timestamp value={run.finished_at} className="text-xs" /> : '—'}</dd>
      </dl>
      {from ? <ReturnLine note={from} side="from" /> : null}
      {to ? (
        <ReturnLine note={to} side="to" />
      ) : run.exit ? (
        <p className="text-sm" data-attempt-exit={run.exit.kind}>
          {exitLabel(run.exit, panel.statuses)}
          {run.exit.by_handle ? <span className="text-muted-foreground"> · {run.exit.by_handle}</span> : null}{' '}
          <Timestamp value={run.exit.at} format="relative" className="text-xs" />
          {run.exit.comment ? <span className="text-muted-foreground block text-xs">{run.exit.comment}</span> : null}
        </p>
      ) : null}
    </div>
  );
}

// Строка возврата: «вернула в …» у попытки, закрытой возвратом, и «вернулась
// с …» у попытки, начатой им. Комментарий — как записан в переходе; описание
// проблемы — ссылкой: на свой артефакт в этой попытке или на панель этапа,
// который вернул.
function ReturnLine({note, side}: {note: ReturnNote; side: 'from' | 'to'}) {
  return (
    <div className="border-destructive/60 border-l-2 pl-3 text-sm" data-return={side}>
      <p className="font-medium">{note.text}</p>
      {note.comment ? (
        <p className="text-muted-foreground text-sm whitespace-pre-wrap" data-return-comment>
          {note.comment}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-x-3 text-xs">
        {note.problemReport && side === 'to' ? (
          <a href={`#${artifactAnchor(note.problemReport.id)}`} className="underline underline-offset-4" data-return-problem>
            {note.problemReport.title || note.problemReport.kind}
          </a>
        ) : null}
        {note.statusKey ? (
          <Link to={{search: `?stage=${encodeURIComponent(note.statusKey)}`}} className="underline underline-offset-4" data-return-stage={note.statusKey}>
            {side === 'from' && note.problemReport
              ? `${note.problemReport.title || note.problemReport.kind} — на этапе «${note.statusName}»`
              : `к этапу «${note.statusName}»`}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

// Вердикты гейтов на выходе попытки — как их записал движок. Записей нет
// (прогон идёт или гейтов не было) — так и сказано, без пересчёта.
function RunGates({run}: {run: StageRun}) {
  return (
    <div className="space-y-1.5" data-gate-results={run.gate_results.length}>
      <p className="text-muted-foreground text-xs">Гейты</p>
      {run.gate_results.length === 0 ? (
        <p className="text-muted-foreground text-sm">гейты не проверялись</p>
      ) : (
        run.gate_results.map((v) => <GateVerdictRow key={`${v.transition_key}:${v.gate_key}`} verdict={v} />)
      )}
    </div>
  );
}

// Стоимость прогона: деньги и токены; без отчёта — «нет данных», не ноль.
function RunCost({run}: {run: StageRun}) {
  return (
    <p className="text-muted-foreground text-xs tabular-nums" data-run-cost={run.usage?.reported ? 'reported' : 'silent'}>
      стоимость: {runCostLine(run)}
    </p>
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
  const role = roleWithVersion(run);
  return (
    <div className="space-y-2 rounded-lg border p-3" data-review-run={run.id}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusDot variant={RUN_VARIANT[run.state] ?? 'neutral'} label={run.state} />
          {role ? <Token label={role} /> : null}
          {run.outcome ? <Badge variant="secondary">{run.outcome}</Badge> : null}
        </div>
        <Timestamp value={run.entered_at} format="relative" />
      </div>
      <Lease run={run} />
      <RunModel run={run} />
      <RunCost run={run} />
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

// Что рекомендовали прогону и на чём он работал — одной строкой под арендой.
// Правила строки — runModelLine; источник уровня здесь не показывается, а
// стоимость и токены — отдельной строкой в панели этапа (RunCost).
function RunModel({run}: {run: StageRun}) {
  const line = runModelLine(run);
  if (!line) return null;
  // data-run-model — опора сквозных сценариев, оформления не несёт.
  return (
    <p className="text-muted-foreground text-xs" data-run-model={run.id}>
      {line}
    </p>
  );
}
