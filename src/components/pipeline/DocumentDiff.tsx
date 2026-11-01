// «Изменения против vN-1» (CLAB-347): сводка и документы версии по
// категориям — изменённые с построчным диффом, добавленные, убранные,
// неизменённые одной строкой. Правила — roleDocs.ts, здесь только разметка.
import {useEffect, useRef, useState} from 'react';
import {ChevronDown, ChevronRight, FileText} from 'lucide-react';

import {cn} from '@/lib/utils';
import {Note, Token} from '@/components/kit';

import {
  DOC_CHANGE_LABEL,
  FOLD_CHUNK,
  MOVED_LABEL,
  type DiffLine,
  type DocChange,
  type DocDiff,
  type VersionDiff,
  diffSummary,
  foldLabel,
  foldLines,
  formatCount,
  kindChangeLabel,
  pinChangeLabel,
} from './roleDocs';

const CHANGE_COLOR: Record<DocChange, 'default' | 'green' | 'orange' | 'red'> = {
  changed: 'orange',
  added: 'green',
  removed: 'red',
  same: 'default',
};

export function DocumentDiff({
  diff,
  doc,
  onDoc,
}: {
  diff: VersionDiff;
  // Документ из адреса: раскрыт и прокручен к себе.
  doc?: string;
  onDoc: (name?: string) => void;
}) {
  return (
    <div className="space-y-2" data-role-diff>
      <p className="text-sm" data-role-diff-summary>
        {diffSummary(diff.counts)}
      </p>
      {diff.unchanged ? <p className="text-muted-foreground text-sm">Изменений в документах нет</p> : null}
      {diff.docs.map((d) => (
        <DiffEntry key={`${d.change}:${d.name}`} d={d} selected={doc === d.name} onDoc={onDoc} />
      ))}
    </div>
  );
}

// Один документ диффа — его же берёт панель инструкции библиотеки
// (CLAB-351): дифф версий инструкции — тот же компонент на один документ.
export function DiffEntry({d, selected = false, onDoc}: {d: DocDiff; selected?: boolean; onDoc?: (name?: string) => void}) {
  return d.change === 'same' ? <SameDoc d={d} /> : <ChangedDoc d={d} selected={selected} onDoc={onDoc ?? (() => undefined)} />;
}

// Смена привязки к библиотеке — синяя метка; привязка не текст.
function PinMark({d}: {d: DocDiff}) {
  return d.pinChange ? (
    <span data-diff-mark="pin">
      <Token color="blue" label={pinChangeLabel(d.pinChange)} />
    </span>
  ) : null;
}

function SameDoc({d}: {d: DocDiff}) {
  return (
    <div
      className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-dashed px-2.5 py-1.5 text-xs"
      data-diff-doc={d.name}
      data-diff-change="same">
      <FileText className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 truncate font-mono" title={d.name}>
        {d.name}
      </span>
      <span className="ml-auto flex flex-wrap items-center gap-1">
        {d.kindChange ? (
          <span data-diff-mark="kind">
            <Token color="blue" label={kindChangeLabel(d.kindChange)} />
          </span>
        ) : null}
        {d.moved ? (
          <span data-diff-mark="moved">
            <Token color="blue" label={MOVED_LABEL} />
          </span>
        ) : null}
        <PinMark d={d} />
        <Token label={DOC_CHANGE_LABEL.same} />
      </span>
    </div>
  );
}

function ChangedDoc({d, selected, onDoc}: {d: DocDiff; selected: boolean; onDoc: (name?: string) => void}) {
  // Изменённые раскрыты сразу: ради них дифф и открывают.
  // Документ из адреса раскрыт всегда.
  const [local, setLocal] = useState(d.change === 'changed');
  const open = selected || local;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({block: 'nearest'});
  }, [selected]);

  const toggle = () => {
    const next = !open;
    setLocal(next);
    onDoc(next ? d.name : undefined);
  };

  return (
    <div ref={ref} className="rounded-md border" data-diff-doc={d.name} data-diff-change={d.change}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="hover:bg-accent/60 flex min-h-8 w-full flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-1.5 text-left text-sm">
        {open ? <ChevronDown className="size-4 shrink-0" aria-hidden /> : <ChevronRight className="size-4 shrink-0" aria-hidden />}
        <span className="min-w-0 truncate font-mono text-xs font-medium" title={d.name}>
          {d.name}
        </span>
        <Token color={CHANGE_COLOR[d.change]} label={DOC_CHANGE_LABEL[d.change]} />
        {d.kindChange ? <Token color="blue" label={kindChangeLabel(d.kindChange)} /> : null}
        <PinMark d={d} />
        {d.tooBig ? (
          <span data-diff-too-big>
            <Token color="orange" label="слишком велик для построчного сравнения" />
          </span>
        ) : null}
        <span className="ml-auto font-mono text-xs" data-diff-counts>
          <span className="text-emerald-700 dark:text-emerald-300">+{formatCount(d.plus)}</span>{' '}
          <span className="text-red-700 dark:text-red-300">−{formatCount(d.minus)}</span>
        </span>
      </button>
      {open && d.tooBig ? (
        <div className="border-t p-2.5">
          <Note
            tone="warning"
            title="Построчное сравнение не строилось"
            description="Документ слишком велик: общие начало и конец срезаны, всё между ними считается изменённым, поэтому числа — границы, а не точный счёт. Оба текста читаются на вкладке «Документы»."
          />
        </div>
      ) : null}
      {open && d.lines ? <Lines lines={d.lines} /> : null}
    </div>
  );
}

function Lines({lines}: {lines: DiffLine[]}) {
  const rows = foldLines(lines);
  // Сколько строк раскрыто у каждого свёрнутого куска (по его месту в rows).
  const [shown, setShown] = useState<Record<number, number>>({});
  return (
    <div className="border-t py-1 font-mono text-xs leading-5" data-diff-lines>
      {rows.map((row, i) => {
        if (row.type === 'line') return <Line key={i} line={row.line} />;
        const open = shown[i] ?? 0;
        const left = row.lines.length - open;
        return (
          <div key={i}>
            {row.lines.slice(0, open).map((line, j) => (
              <Line key={j} line={line} />
            ))}
            {left > 0 ? (
              <button
                type="button"
                data-diff-fold={left}
                onClick={() => setShown({...shown, [i]: open + FOLD_CHUNK})}
                className="text-muted-foreground bg-muted/40 hover:bg-muted block min-h-6 w-full px-3 py-0.5 text-left">
                {foldLabel(left)}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function Line({line}: {line: DiffLine}) {
  return (
    <div
      data-diff-line={line.op === '+' ? 'added' : line.op === '-' ? 'removed' : 'same'}
      className={cn(
        'px-3 break-words whitespace-pre-wrap',
        line.op === '+' && 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
        line.op === '-' && 'bg-red-500/10 text-red-800 line-through decoration-red-500/40 dark:text-red-200',
      )}>
      <span className="mr-2 inline-block w-3 select-none" aria-hidden>
        {line.op === '+' ? '+' : line.op === '-' ? '−' : ''}
      </span>
      <span className="sr-only">{line.op === '+' ? 'добавлено: ' : line.op === '-' ? 'убрано: ' : ''}</span>
      {line.text || ' '}
    </div>
  );
}
