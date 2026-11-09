import {Note} from '@/components/kit';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/ui/table';
import {cn} from '@/lib/utils';

import type {AgentSettingsView} from '../../api/types';
import {DIFF_SIGNS, DIFF_WORDS, diffDocuments, formatValue, summaryText, type DiffOp} from './rules';

// Разница документов по путям (design.spec §4.5, §8). Знак и слово всегда
// рядом, цвет второстепенен; значения считаются по сохранённым на сервере
// документам, поэтому ещё не отправленное (в том числе похожее на секрет) сюда
// не попадает.

const SIGN_COLOR: Record<DiffOp, string> = {
  '+': 'text-emerald-700 dark:text-emerald-300',
  '~': 'text-amber-700 dark:text-amber-300',
  '-': 'text-red-700 dark:text-red-300',
};

export type DiffKind = 'draft' | 'version';

export function DiffPanel({
  active,
  other,
  kind,
  unsavedNote,
}: {
  // Действующая версия; null — активной нет.
  active: AgentSettingsView | null;
  // Сравниваемая: сохранённый черновик или версия из истории.
  other: AgentSettingsView;
  kind: DiffKind;
  // Над списком: «Показана разница сохранённого черновика…».
  unsavedNote?: boolean;
}) {
  const rows = diffDocuments(active?.document ?? {}, other.document);
  const left = active ? `Активная v${active.version}` : 'Активная';
  const right = kind === 'draft' ? `Черновик v${other.version}` : `Версия ${other.version}`;
  const subject = kind === 'draft' ? 'черновике' : 'версии';
  return (
    <div className="space-y-3" data-diff data-diff-kind={kind}>
      {unsavedNote ? (
        <Note title="Показана разница сохранённого черновика. Несохранённые правки в неё не входят." />
      ) : null}
      {active === null ? <Note title="Активной версии нет: всё содержимое новое" /> : null}
      <p className="text-sm font-medium" data-diff-summary>
        {summaryText(rows)}
      </p>
      <p className="text-muted-foreground text-xs">
        + есть в {subject}, нет в активной · ~ значение отличается · − есть в активной, нет в {subject}
      </p>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm" data-diff-empty>
          Нет отличий в документе.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Знак</TableHead>
                <TableHead>Путь</TableHead>
                <TableHead>{left}</TableHead>
                <TableHead>{right}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={`${r.op}:${r.path}`} data-diff-op={r.op} data-diff-path={r.path}>
                  <TableCell>
                    <span className={cn('font-mono font-semibold', SIGN_COLOR[r.op])} aria-label={DIFF_WORDS[r.op]}>
                      {DIFF_SIGNS[r.op]}
                    </span>
                    <span className="text-muted-foreground ml-1.5 text-xs">{DIFF_WORDS[r.op]}</span>
                  </TableCell>
                  <TableCell className="font-mono text-xs break-all">{r.path}</TableCell>
                  <TableCell className="font-mono text-xs break-all">
                    {r.op === '+' ? '—' : formatValue(r.before)}
                  </TableCell>
                  <TableCell className="font-mono text-xs break-all">
                    {r.op === '-' ? '—' : formatValue(r.after)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <div className="text-muted-foreground space-y-0.5 text-xs">
        <p>Changelog {kind === 'draft' ? 'черновика' : 'версии'}: {other.changelog || '—'}</p>
        {active ? <p>Changelog активной: {active.changelog || '—'}</p> : null}
      </div>
    </div>
  );
}
