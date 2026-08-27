import {useState} from 'react';
import {useParams} from 'react-router-dom';
import {Badge} from '@astryxdesign/core/Badge';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Divider} from '@astryxdesign/core/Divider';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutHeader,
  LayoutPanel,
  VStack,
} from '@astryxdesign/core/Layout';
import {Item} from '@astryxdesign/core/Item';
import {List} from '@astryxdesign/core/List';
import {Section} from '@astryxdesign/core/Section';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {Tab, TabList} from '@astryxdesign/core/TabList';
import {Heading, Text} from '@astryxdesign/core/Text';
import {Timestamp} from '@astryxdesign/core/Timestamp';

import {ApiError, api} from '../api/client';
import type {Artifact, StageRun, TaskDetail as TaskDetailData, TransitionOption, Workflow} from '../api/types';
import {useResource} from '../api/useResource';
import {Failure, Loading} from '../components/Feedback';
import {GateRow} from '../components/Gates';
import {ArtifactView} from '../components/ArtifactView';
import {ScopePanel} from '../components/ScopePanel';
import {SubmitArtifactDialog} from '../components/SubmitArtifactDialog';

export function TaskDetail() {
  const {taskKey = ''} = useParams();
  const task = useResource(() => api.getTask(taskKey), [taskKey]);
  const events = useResource(() => api.timeline(taskKey), [taskKey]);
  const [tab, setTab] = useState('stages');

  if (task.error) return <Section padding={6}><Failure error={task.error} /></Section>;
  if (!task.data) return <Loading />;

  const detail = task.data;
  const reload = () => {
    task.reload();
    events.reload();
  };

  return (
    <Layout
      height="fill"
      header={
        <LayoutHeader hasDivider padding={4}>
          <VStack gap={2}>
            <HStack gap={2} vAlign="center">
              <Text type="supporting" color="secondary">
                {detail.task.key}
              </Text>
              <Badge variant="neutral" label={detail.task.status_name} />
              {detail.task.priority !== 'normal' ? (
                <Badge variant="warning" label={detail.task.priority} />
              ) : null}
            </HStack>
            <Heading level={1}>{detail.task.title}</Heading>
            {detail.task.description ? (
              <Text color="secondary">{detail.task.description}</Text>
            ) : null}
          </VStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent padding={4}>
          <VStack gap={4}>
            <HStack hAlign="between" vAlign="center" gap={3}>
              <TabList value={tab} onChange={setTab} hasDivider>
                <Tab value="stages" label="Этапы и артефакты" />
                <Tab value="timeline" label="Лента" />
              </TabList>
              <SubmitArtifactDialog
                taskKey={detail.task.key}
                transitions={detail.transitions}
                onSubmitted={reload}
              />
            </HStack>
            {tab === 'stages' ? (
              <Stages detail={detail} onChanged={reload} />
            ) : (
              <Timeline taskKey={taskKey} />
            )}
          </VStack>
        </LayoutContent>
      }
      end={
        <LayoutPanel width={400} hasDivider padding={4} isScrollable label="Движение задачи">
          <VStack gap={4}>
            <Transitions detail={detail} onChanged={reload} />
            <Divider />
            <ScopePanel task={detail.task} onChanged={reload} />
          </VStack>
        </LayoutPanel>
      }
    />
  );
}

// Этапы идут попытками: повторный заход после отката — новая попытка, а не
// перезапись прежней, поэтому «аналитика делалась дважды» видно целиком.
function Stages({detail, onChanged}: {detail: TaskDetailData; onChanged: () => void}) {
  const runs = [...detail.stage_runs].sort((a, b) => b.entered_at.localeCompare(a.entered_at));

  return (
    <VStack gap={4}>
      {runs.map((run) => (
        <StageCard
          key={run.id}
          run={run}
          artifacts={detail.artifacts.filter((a) => a.stage_run_id === run.id)}
          onChanged={onChanged}
        />
      ))}
    </VStack>
  );
}

const RUN_VARIANT: Record<string, 'success' | 'warning' | 'error' | 'accent' | 'neutral'> = {
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
  artifacts,
  onChanged,
}: {
  run: StageRun;
  artifacts: Artifact[];
  onChanged: () => void;
}) {
  return (
    <Card padding={4}>
      <VStack gap={3}>
        <HStack hAlign="between" vAlign="center" gap={2}>
          <HStack gap={2} vAlign="center">
            <StatusDot variant={RUN_VARIANT[run.state] ?? 'neutral'} label={run.state} />
            <Heading level={3}>{run.status_key}</Heading>
            {run.attempt > 1 ? <Badge variant="neutral" label={`попытка ${run.attempt}`} /> : null}
          </HStack>
          <Timestamp value={run.entered_at} format="relative" color="secondary" />
        </HStack>
        {run.summary ? <Text color="secondary">{run.summary}</Text> : null}
        {artifacts.length === 0 ? (
          <Text type="supporting" color="secondary">
            Артефактов на этой попытке нет
          </Text>
        ) : (
          <List hasDividers>
            {artifacts.map((a) => (
              <ArtifactView key={a.id} artifact={a} onChanged={onChanged} />
            ))}
          </List>
        )}
      </VStack>
    </Card>
  );
}

function Transitions({detail, onChanged}: {detail: TaskDetailData; onChanged: () => void}) {
  // Определения гейтов берутся из версии цикла самой задачи, а не из активной:
  // задача доходит по той, на которой начата (решение 0016).
  const workflow = useResource(
    () => api.getWorkflowVersion(detail.task.workflow_id),
    [detail.task.workflow_id],
  );

  return (
    <VStack gap={3}>
      <Heading level={3}>Переходы</Heading>
      {detail.transitions.length === 0 ? (
        <EmptyState isCompact title="Дальше некуда" description="Задача в терминальном статусе" />
      ) : (
        detail.transitions.map((t) => (
          <TransitionCard
            key={t.key}
            taskKey={detail.task.key}
            transition={t}
            workflow={workflow.data}
            onChanged={onChanged}
          />
        ))
      )}
    </VStack>
  );
}

function TransitionCard({
  taskKey,
  transition,
  workflow,
  onChanged,
}: {
  taskKey: string;
  transition: TransitionOption;
  workflow?: Workflow;
  onChanged: () => void;
}) {
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);

  const definition = workflow?.transitions.find((t) => t.key === transition.key);

  const act = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await run();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding={3}>
      <VStack gap={3}>
        <HStack hAlign="between" vAlign="center" gap={2}>
          <VStack gap={0}>
            <Text weight="medium">{transition.name}</Text>
            <Text type="supporting" color="secondary">
              → {transition.to_status}
            </Text>
          </VStack>
          <Button
            size="sm"
            variant={transition.allowed ? 'primary' : 'secondary'}
            isDisabled={!transition.allowed || busy}
            label={transition.allowed ? 'Перевести' : 'Держат гейты'}
            onClick={() => act(() => api.execute(taskKey, transition.key))}
          />
        </HStack>
        {error ? <Failure error={error} title="Переход не выполнен" /> : null}
        {transition.gates.length > 0 ? (
          <VStack gap={3}>
            <Divider />
            {transition.gates.map((gate) => (
              <GateRow
                key={gate.gate_key}
                check={gate}
                gate={definition?.gates?.find((g) => g.key === gate.gate_key)}
                onDecide={(status, details) =>
                  act(() =>
                    api.decideGate(taskKey, transition.key, gate.gate_key, {status, details}),
                  )
                }
              />
            ))}
          </VStack>
        ) : null}
      </VStack>
    </Card>
  );
}

function Timeline({taskKey}: {taskKey: string}) {
  const events = useResource(() => api.timeline(taskKey), [taskKey]);

  if (events.error) return <Failure error={events.error} />;
  if (!events.data) return <Loading />;

  return (
    <List hasDividers>
      {events.data.map((e) => (
        <Item
          key={e.id}
          label={e.type}
          description={e.actor_handle ? `${e.actor_handle}` : undefined}
          endContent={<Timestamp value={e.created_at} format="relative" color="secondary" />}
        />
      ))}
    </List>
  );
}
