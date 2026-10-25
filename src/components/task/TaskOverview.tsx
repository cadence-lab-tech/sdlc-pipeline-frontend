import {useEffect, useRef, useState} from 'react';
import {Link} from 'react-router-dom';
import {ChevronDown} from 'lucide-react';

import {cn} from '@/lib/utils';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible';
import {Progress} from '@/components/ui/progress';
import {Markdown, Row, RowList, StatusDot, Timestamp, Token} from '@/components/kit';

import {api} from '../../api/client';
import type {TaskDetail, TaskEvent, Workflow} from '../../api/types';
import type {Resource} from '../../api/useResource';
import {AuditLog} from '../AuditLog';
import {closedChildren, holding} from './holding';
import {Timeline} from './Timeline';
import {UsageLines} from './Usage';

// Обзор задачи (CLAB-286) — то, что видно под схемой цикла, пока этап не
// выбран: описание, что держит задачу, нарезка эпика, общая стоимость и
// свёрнутые лента с журналом. «Действия» остаются в правой панели: обзор
// отвечает «что держит», а не «что сделать».
export function Overview({
  detail,
  workflow,
  events,
  auditVersion,
}: {
  detail: TaskDetail;
  workflow?: Workflow;
  events: Resource<TaskEvent[]>;
  // Знак перезапроса журнала: меняется с карточкой и опросом живой аренды.
  auditVersion: number;
}) {
  const {task} = detail;

  return (
    // data-overview и data-overview-block — опоры сквозных сценариев,
    // оформления не несут.
    <div className="space-y-6" data-overview>
      {task.description ? (
        <section className="space-y-2" data-overview-block="description">
          <h2 className="text-base font-semibold">Описание</h2>
          <Description text={task.description} />
        </section>
      ) : null}

      <Holding detail={detail} workflow={workflow} />

      {detail.children.length > 0 ? <Children detail={detail} /> : null}

      <section className="space-y-2" data-overview-block="usage">
        <h2 className="text-base font-semibold">Стоимость задачи</h2>
        <Card className="gap-2 p-3">
          <UsageLines usage={detail.usage} hasChildren={detail.children.length > 0} />
        </Card>
      </section>

      <div className="space-y-3 border-t pt-4">
        {/* Свёрнутость секций живёт в состоянии компонента: общего ключа в
            localStorage у них нет, а содержимое монтируется при раскрытии —
            журнал не ходит на сервер, пока его не открыли. */}
        <OverviewSection name="timeline" title="Лента">
          <Timeline events={events} />
        </OverviewSection>
        <OverviewSection name="audit" title="Журнал">
          <AuditLog
            load={(cursor) => api.taskAudit(task.key, cursor)}
            deps={['task-audit', task.key]}
            version={auditVersion}
          />
        </OverviewSection>
      </div>
    </div>
  );
}

function OverviewSection({name, title, children}: {name: string; title: string; children: React.ReactNode}) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen} data-overview-section={name}>
      <h2 className="text-base font-semibold">
        <CollapsibleTrigger className="hover:text-foreground/80 focus-visible:ring-ring/50 focus-visible:border-ring flex w-full items-center gap-2 rounded-md text-left outline-none transition-colors focus-visible:ring-[3px]">
          {title}
          <ChevronDown
            className={cn('text-muted-foreground ml-auto size-4 transition-transform', !open && '-rotate-90')}
            aria-hidden
          />
        </CollapsibleTrigger>
      </h2>
      <CollapsibleContent className="pt-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

// «Что держит»: статус, исполнитель, гейты переходов вперёд, которые ещё не
// пройдены. Вердикты считает бэкенд (`detail.transitions`) — те же, что в
// «Действиях» справа.
function Holding({detail, workflow}: {detail: TaskDetail; workflow?: Workflow}) {
  const {task} = detail;
  const state = holding(detail, workflow?.statuses);
  const {executor} = state;

  return (
    <section className="space-y-2" data-overview-block="holding">
      <h2 className="text-base font-semibold">Что держит</h2>
      <Card className="gap-3 p-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Статус</span>
          <Badge variant="secondary" data-holding-status={task.status_key}>
            {task.status_name}
          </Badge>
          {state.awaitsApproval ? (
            <Badge variant="outline" data-holding-approval>
              ждёт апрува
            </Badge>
          ) : null}
        </div>

        {executor ? (
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
            data-holding-executor={executor.handle}
            data-lease={executor.live ? 'live' : 'expired'}>
            <span className="inline-flex items-center gap-1.5">
              <StatusDot variant={executor.live ? 'accent' : 'neutral'} />
              {executor.live ? 'в работе у' : 'аренда истекла у'} {executor.handle}
            </span>
            {executor.roleKey ? (
              <Token
                label={executor.roleVersion ? `${executor.roleKey} v${executor.roleVersion}` : executor.roleKey}
              />
            ) : null}
            {executor.leaseExpiresAt ? (
              <span className="text-muted-foreground text-xs">
                {executor.live ? 'аренда до' : 'аренда истекла'}{' '}
                <Timestamp value={executor.leaseExpiresAt} className="text-xs" />
              </span>
            ) : null}
          </div>
        ) : null}

        {state.reviewRole ? (
          <p className="text-sm" data-holding-review>
            идёт перепроверка: {state.reviewRole}
          </p>
        ) : null}

        {state.closed ? (
          <p className="text-muted-foreground text-sm" data-holding-closed>
            задача закрыта
          </p>
        ) : state.gates.length === 0 ? (
          <p className="text-muted-foreground text-sm" data-holding-none>
            ничего не держит
          </p>
        ) : (
          <ul className="space-y-1.5" aria-label="Держащие гейты">
            {state.gates.map((gate) => (
              <li
                key={`${gate.transitionKey}/${gate.gateKey}`}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
                data-holding-gate={gate.gateKey}
                data-holding-transition={gate.transitionKey}>
                <StatusDot variant={gate.status === 'failed' ? 'error' : 'warning'} />
                <span className="font-medium">{gate.gateName}</span>
                <Token label={gate.type} />
                <span className="text-muted-foreground text-xs">переход {gate.transitionName}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

// Постановка задачи — разметка, а не подпись под заголовком: её пишет человек
// или аналитик списками и кодом. Длинная сворачивается, чтобы остальной обзор
// не уезжал за экран; раскрытие — разовое действие, а не настройка, поэтому
// нигде не запоминается.
const DESCRIPTION_COLLAPSED_PX = 260;

function Description({text}: {text: string}) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Сворачивать нужно только то, что не поместилось: у короткой постановки
  // кнопки «Показать целиком» быть не должно, а длина в символах этого не
  // показывает — решает высота отрисованной разметки. Меряется на каждой новой
  // постановке: её правят прямо в карточке, и мерка от прежнего текста соврала бы.
  useEffect(() => {
    const node = box.current;
    if (node) setOverflows(node.scrollHeight > DESCRIPTION_COLLAPSED_PX + 8);
  }, [text]);

  return (
    <div className="space-y-1">
      <div
        ref={box}
        className={cn('overflow-hidden', !expanded && overflows && 'mask-b-from-80%')}
        style={expanded || !overflows ? undefined : {maxHeight: DESCRIPTION_COLLAPSED_PX}}>
        <Markdown>{text}</Markdown>
      </div>
      {overflows ? (
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Свернуть' : 'Показать целиком'}
        </Button>
      ) : null}
    </div>
  );
}

// Нарезка эпика: дочерние задачи со своими статусами. Порядок между ними
// держат связи blocks и гейт dependencies_closed, а не эта таблица.
function Children({detail}: {detail: TaskDetail}) {
  const {closed, total, percent} = closedChildren(detail.children);

  return (
    <section className="space-y-3" data-overview-block="children">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">Дочерние задачи</h2>
        <Badge variant="secondary">
          закрыто {closed} из {total}
        </Badge>
      </div>
      <Progress value={percent} />
      <RowList>
        {detail.children.map((child) => (
          <Link
            key={child.id}
            to={`/p/${child.project_key}/tasks/${child.key}`}
            className="block"
            data-child={child.key}>
            <Row end={<Badge variant="secondary">{child.status_name}</Badge>}>
              <p className="truncate font-medium">
                {child.key} · {child.title}
              </p>
              {child.assignee_handle ? (
                <p className="text-muted-foreground truncate text-xs">
                  исполнитель: {child.assignee_handle}
                </p>
              ) : null}
            </Row>
          </Link>
        ))}
      </RowList>
    </section>
  );
}
