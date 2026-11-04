// Перетаскивание строк «Бэклога» (CLAB-403, эпик CLAB-368, design.spec §5.3,
// §10) на @dnd-kit: у каждой группы — верхнего уровня и раскрытого эпика —
// свой DndContext и SortableContext, поэтому строка не может встать в чужую
// группу. Правила (тело запроса, порядок, зона броска, тексты) — rules.ts без
// React; здесь только склейка с библиотекой: датчики, зона броска, тексты
// диктора, ручка и копия строки под курсором.
import {useMemo, useRef, useState, type CSSProperties, type ReactNode} from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type Modifier,
} from '@dnd-kit/core';
import {SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy} from '@dnd-kit/sortable';
import {GripVertical} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';

import {DRAG_INSTRUCTIONS, DRAG_SENSORS, HANDLE_TITLE, dragTexts, handleLabel, insideZone} from './rules';

// Строку тянут только по вертикали.
const verticalAxis: Modifier = ({transform}) => ({...transform, x: 0});
const MODIFIERS = [verticalAxis];
const MEASURING = {droppable: {strategy: MeasuringStrategy.Always}};

const NESTED = '[data-backlog-children]';
const ROW = '[data-task-key]';

// Зона броска: для детей эпика — блок эпика, для верхнего уровня — весь
// список, кроме блоков раскрытых эпиков (бросок на блок эпика — вне группы).
// Указатель вне зоны — места нет, строка вернётся без запроса. Внутри зоны
// место ближайшее; пока указатель над самой строкой — её место, иначе у
// раскрытого эпика, чья высота вместе с детьми, «центр» уехал бы далеко от
// заголовка. С клавиатуры указателя нет — ближайший центр.
function groupCollision(zone: () => HTMLElement | null): CollisionDetection {
  return (args) => {
    const p = args.pointerCoordinates;
    const z = zone();
    if (p && z) {
      if (!insideZone(p, z.getBoundingClientRect())) return [];
      for (const n of Array.from(z.querySelectorAll(NESTED))) {
        if (insideZone(p, n.getBoundingClientRect())) return [];
      }
      // Места строк — без сдвига, который соседям дала сортировка: иначе
      // под указателем оказывалась бы уже не та строка, что до сдвига.
      for (const c of args.droppableContainers) {
        const rect = args.droppableRects.get(c.id);
        const row = c.node.current?.querySelector<HTMLElement>(ROW);
        if (rect && row && insideZone(p, {left: rect.left, right: rect.right, top: rect.top, bottom: rect.top + row.offsetHeight})) {
          return closestCenter({...args, droppableContainers: [c]});
        }
      }
    }
    return closestCenter(args);
  };
}

// Группа строк: контексты перетаскивания, зона броска, копия строки под
// курсором и объявления диктора. Бросок отдаёт наверх ключи — что куда
// решает страница (запрос, откат, фокус). enabled: false — строки без
// перетаскивания (наблюдатель): контекстов нет, ручек нет.
export function GroupDnd({
  keys,
  enabled,
  zone,
  onStart,
  onEnd,
  overlay,
  children,
}: {
  keys: string[];
  enabled: boolean;
  // Зона броска; функция устойчива между отрисовками.
  zone: () => HTMLElement | null;
  onStart: (key: string) => void;
  // over — строка, на которую бросили; null — бросок вне группы или отмена.
  onEnd: (key: string, over: string | null) => void;
  overlay: (key: string) => ReactNode;
  children: ReactNode;
}) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, {activationConstraint: DRAG_SENSORS.mouse}),
    useSensor(TouchSensor, {activationConstraint: DRAG_SENSORS.touch}),
    useSensor(KeyboardSensor, {coordinateGetter: sortableKeyboardCoordinates}),
  );
  const collision = useMemo(() => groupCollision(zone), [zone]);
  const justPicked = useRef(false);

  if (!enabled) return <>{children}</>;

  const place = (id: string | number) => keys.indexOf(String(id)) + 1;
  const total = keys.length;
  // Сразу после «Взята…» библиотека объявляет «над собой» — тем же местом.
  // Обе фразы ложатся в одну область за один кадр, и слышна была бы только
  // вторая, поэтому первую «над собой» пропускаем.
  const announcements: Announcements = {
    onDragStart: ({active}) => {
      justPicked.current = true;
      return dragTexts.picked(String(active.id), place(active.id), total);
    },
    onDragOver: ({active, over}) => {
      const first = justPicked.current;
      justPicked.current = false;
      if (!over || (first && over.id === active.id)) return undefined;
      return dragTexts.over(String(active.id), place(over.id), total);
    },
    onDragEnd: ({active, over}) =>
      over ? dragTexts.dropped(String(active.id), place(over.id), total) : dragTexts.cancelled(String(active.id)),
    onDragCancel: ({active}) => dragTexts.cancelled(String(active.id)),
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      modifiers={MODIFIERS}
      measuring={MEASURING}
      accessibility={{announcements, screenReaderInstructions: {draggable: DRAG_INSTRUCTIONS}}}
      onDragStart={({active}) => {
        setActiveKey(String(active.id));
        onStart(String(active.id));
      }}
      onDragEnd={({active, over}) => {
        setActiveKey(null);
        onEnd(String(active.id), over ? String(over.id) : null);
      }}
      onDragCancel={({active}) => {
        setActiveKey(null);
        onEnd(String(active.id), null);
      }}>
      <SortableContext items={keys} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
      <DragOverlay>
        {activeKey ? (
          <div
            inert
            aria-hidden
            className="bg-background ring-ring cursor-grabbing -rotate-[0.4deg] rounded-lg shadow-lg ring-1"
            data-backlog-overlay={activeKey}>
            {overlay(activeKey)}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

// Строка как элемент перетаскиваемого списка: `<li>` со сдвигом и
// пунктирной рамкой на месте поднятой строки (содержимое прозрачно, а не
// скрыто: у скрытого элемента браузер отбирает фокус, а он нужен ручке); ручку (или null, если её нет)
// получает содержимое.
export function SortableItem({
  rowKey,
  enabled,
  busy,
  children,
}: {
  rowKey: string;
  // Ручка есть: редактор, в группе две строки и больше.
  enabled: boolean;
  // Строка ждёт ответа: не берётся снова, но остаётся местом для броска.
  busy: boolean;
  children: (handle: ReactNode) => ReactNode;
}) {
  const {setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging} = useSortable({
    id: rowKey,
    disabled: enabled ? {draggable: busy, droppable: false} : true,
    transition: reducedMotion() ? null : {duration: 150, easing: 'ease'},
  });
  const style: CSSProperties = {
    transform: transform ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` : undefined,
    transition: transition ?? undefined,
  };
  const handle = enabled ? (
    <Button
      ref={setActivatorNodeRef}
      type="button"
      variant="ghost"
      size="icon-xs"
      // touch-action: none — только на ручке: прокрутка пальцем по остальной
      // строке остаётся прокруткой (design.spec §5.3).
      className="cursor-grab touch-none max-sm:size-8 aria-disabled:cursor-default aria-disabled:opacity-60"
      {...attributes}
      {...listeners}
      aria-roledescription="перетаскиваемая задача"
      aria-disabled={busy || attributes['aria-disabled'] || undefined}
      aria-label={handleLabel(rowKey)}
      title={HANDLE_TITLE}
      data-row-control="handle"
      data-backlog-handle>
      <GripVertical aria-hidden />
    </Button>
  ) : null;
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(isDragging && 'outline-border rounded-lg outline-1 outline-dashed [&>*]:opacity-0')}>
      {children(handle)}
    </li>
  );
}

// Копия строки под курсором и место ручки в строке-копии.
export function OverlayGrip() {
  return (
    <span aria-hidden className="text-muted-foreground flex size-6 items-center justify-center max-sm:size-8">
      <GripVertical className="size-4" />
    </span>
  );
}

// Пустое место ручки: ключи группы стоят ровно.
export function HandleGap() {
  return <span aria-hidden className={cn('block size-6 max-sm:size-8')} />;
}
