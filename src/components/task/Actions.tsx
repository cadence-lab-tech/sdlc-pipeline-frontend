import {useState} from 'react';
import {ChevronDown} from 'lucide-react';

import {cn} from '@/lib/utils';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible';
import {EmptyState, Section} from '@/components/kit';

import {ApiError, api} from '../../api/client';
import type {GateCheck, TaskDetail, TransitionOption, Workflow} from '../../api/types';
import {useResource} from '../../api/useResource';
import {Failure} from '../Feedback';
import {GateRow} from '../Gates';

// «Действия» — первый блок панели: он отвечает на вопрос «что можно сделать с
// задачей сейчас». Вердикт по каждому гейту считает бэкенд, здесь он только
// показан; счётчик держащих — подсчёт уже полученных статусов, а не своя
// проверка перехода.
export function Actions({detail, onChanged}: {detail: TaskDetail; onChanged: () => void}) {
  // Определения гейтов берутся из версии цикла самой задачи, а не из активной:
  // задача доходит по той, на которой начата (решение 0016).
  const workflow = useResource(
    () => api.getWorkflowVersion(detail.task.workflow_id),
    [detail.task.workflow_id],
  );

  return (
    <Section title="Действия">
      {detail.transitions.length === 0 ? (
        <EmptyState title="Дальше некуда" description="Задача в терминальном статусе" />
      ) : (
        <div className="space-y-2">
          {detail.transitions.map((t) => (
            <TransitionRow
              key={t.key}
              taskKey={detail.task.key}
              transition={t}
              workflow={workflow.data}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

// Гейт держит переход, пока он блокирующий и ещё не разрешился в пользу
// перехода. skipped — «не про эту задачу», он не держит.
function isHolding(gate: GateCheck): boolean {
  return gate.blocking && gate.status !== 'passed' && gate.status !== 'waived' && gate.status !== 'skipped';
}

function TransitionRow({
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
  // Раскрытие списка гейтов не запоминается: это разовый вопрос «а что держит»,
  // а не настройка вида. Состояние переживает перезапрос карточки на живой
  // аренде — компонент не пересоздаётся, ключ у него от перехода.
  const [open, setOpen] = useState(false);

  const definition = workflow?.transitions.find((t) => t.key === transition.key);
  const holding = transition.gates.filter(isHolding);
  // Ждать апрува — самый частый случай простоя, и ради него раскрывать список
  // не нужно: решение принимается прямо отсюда.
  const approval = holding.length === 1 && holding[0].type === 'human_approval' ? holding[0] : undefined;

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

  const decide = (gateKey: string) => (status: string, details?: unknown) =>
    act(() => api.decideGate(taskKey, transition.key, gateKey, {status, details}));

  return (
    <Card className="gap-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{transition.name}</p>
          <p className="text-muted-foreground truncate text-xs">→ {transition.to_status}</p>
        </div>
        <Button
          size="sm"
          variant={transition.allowed ? 'default' : 'secondary'}
          disabled={!transition.allowed || busy}
          onClick={() => act(() => api.execute(taskKey, transition.key))}>
          {transition.allowed ? 'Перевести' : 'Держат гейты'}
        </Button>
      </div>

      {error ? <Failure error={error} title="Переход не выполнен" /> : null}

      {transition.gates.length > 0 ? (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1.5 text-left text-xs transition-colors">
            {holding.length > 0
              ? `держат ${holding.length} из ${transition.gates.length}`
              : `гейты пройдены: ${transition.gates.length}`}
            <ChevronDown className={cn('size-3.5 transition-transform', !open && '-rotate-90')} />
          </CollapsibleTrigger>
          {approval && !open ? (
            <div className="pt-2">
              <GateRow
                check={approval}
                gate={definition?.gates?.find((g) => g.key === approval.gate_key)}
                onDecide={decide(approval.gate_key)}
              />
            </div>
          ) : null}
          <CollapsibleContent className="space-y-3 pt-3">
            {transition.gates.map((gate) => (
              <GateRow
                key={gate.gate_key}
                check={gate}
                gate={definition?.gates?.find((g) => g.key === gate.gate_key)}
                onDecide={decide(gate.gate_key)}
              />
            ))}
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </Card>
  );
}
