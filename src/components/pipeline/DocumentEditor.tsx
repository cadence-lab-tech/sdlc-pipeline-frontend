// Редактор документов версии роли (CLAB-347): список слева, карточка
// выбранного документа справа; уже 600 px по ширине самого контейнера —
// столбцом, список над карточкой. Один и тот же для «Новой версии» и
// «Завести роль». Операции и отметки — roleDocs.ts; до сохранения всё
// обратимо, кроме убирания нового документа с текстом (подтверждение).
import {useEffect, useState} from 'react';
import {ArrowDown, ArrowUp, Info, Plus, Undo2} from 'lucide-react';

import {cn} from '@/lib/utils';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Selector, TextArea, TextInput} from '@/components/fields';
import {ConfirmButton, Token} from '@/components/kit';

import {
  type DraftDoc,
  type DraftMark,
  addDoc,
  canMove,
  customBaseKind,
  draftMark,
  editDoc,
  kindOptions,
  moveDoc,
  neighbourAfterRemoval,
  removalNeedsConfirm,
  removeDoc,
  restoreDoc,
  rowNumbers,
} from './roleDocs';

// Опоры фокуса: id стабильны, чтобы фокус переезжал за документом.
export const DOC_NAME_ID = 'role-doc-name';
const rowId = (id: number) => `role-doc-row-${id}`;
const moveId = (id: number, dir: -1 | 1) => `role-doc-${dir < 0 ? 'up' : 'down'}-${id}`;
const RESTORE_ID = 'role-doc-restore';

const MARK_TOKEN: Record<DraftMark, {label: string; color: 'green' | 'orange' | 'red'} | undefined> = {
  same: undefined,
  changed: {label: 'изменён', color: 'orange'},
  added: {label: 'новый', color: 'green'},
  renamed: {label: 'новый', color: 'green'},
  removed: {label: 'убран', color: 'red'},
};

export function DocumentEditor({
  docs,
  onDocs,
  selected,
  onSelect,
  flagged,
  onFlagCleared,
  baseVersion,
  focusFirst,
}: {
  docs: DraftDoc[];
  onDocs: (docs: DraftDoc[]) => void;
  selected?: number;
  onSelect: (id: number) => void;
  // Документ, названный в отказе сервера: строка и «Имя» подсвечены.
  flagged?: number;
  // Человек поправил названный документ — подсветка снимается.
  onFlagCleared: () => void;
  // Номер версии, на которой построена форма (у «Завести роль» нет).
  baseVersion?: number;
  // При открытии формы фокус — в «Имя» первого документа.
  focusFirst?: boolean;
}) {
  const current = docs.find((d) => d.id === selected) ?? docs.find((d) => !d.removed) ?? docs[0];
  const numbers = rowNumbers(docs);
  const live = docs.filter((d) => !d.removed);

  // Куда перевести фокус после следующей отрисовки; n — чтобы повторная
  // просьба о том же поле тоже срабатывала.
  const [focus, setFocus] = useState<{id: string; n: number} | undefined>(
    focusFirst ? {id: DOC_NAME_ID, n: 0} : undefined,
  );
  const focusOn = (id: string) => setFocus((f) => ({id, n: (f?.n ?? 0) + 1}));
  useEffect(() => {
    if (!focus) return;
    const el = document.getElementById(focus.id);
    if (el && !(el instanceof HTMLButtonElement && el.disabled)) el.focus();
  }, [focus]);

  const patch = (id: number, p: Partial<Pick<DraftDoc, 'name' | 'kind' | 'content'>>) => {
    if (id === flagged) onFlagCleared();
    onDocs(editDoc(docs, id, p));
  };
  const add = () => {
    const r = addDoc(docs);
    onDocs(r.docs);
    onSelect(r.id);
    focusOn(DOC_NAME_ID);
  };
  const remove = (d: DraftDoc) => {
    if (d.id === flagged) onFlagCleared();
    const next = removeDoc(docs, d.id);
    onDocs(next);
    if (d.base) {
      // Выбор остаётся на убранной строке: «Вернуть документ» там же, где
      // была «Убрать документ».
      onSelect(d.id);
      focusOn(RESTORE_ID);
    } else {
      const near = neighbourAfterRemoval(docs, next, d.id);
      if (near !== undefined) {
        onSelect(near);
        focusOn(rowId(near));
      }
    }
  };
  const restore = (d: DraftDoc) => {
    onDocs(restoreDoc(docs, d.id));
    onSelect(d.id);
    focusOn(DOC_NAME_ID);
  };
  const move = (d: DraftDoc, dir: -1 | 1) => {
    const next = moveDoc(docs, d.id, dir);
    onDocs(next);
    // Фокус следует за документом; на краю — на соседнюю кнопку порядка.
    focusOn(canMove(next, d.id, dir) ? moveId(d.id, dir) : moveId(d.id, dir < 0 ? 1 : -1));
  };

  const customKind = current ? customBaseKind(current) : undefined;
  const mark = current ? draftMark(current) : undefined;

  return (
    <div className="@container" data-doc-editor>
      <div className="grid gap-4 @[600px]:grid-cols-[260px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-2">
          <div>
            <p className="text-sm font-medium">Документы</p>
            <p className="text-muted-foreground text-xs">Порядок — порядок отдачи агенту</p>
          </div>
          {live.length === 0 ? (
            <p className="text-muted-foreground rounded-md border border-dashed px-3 py-2 text-xs" data-doc-empty>
              Документов нет: добавьте документ или верните убранный
            </p>
          ) : null}
          <ol className="space-y-1" aria-label="Документы версии">
            {docs.map((d, i) => {
              const m = draftMark(d);
              const token = MARK_TOKEN[m];
              const bad = flagged === d.id;
              const isCurrent = d.id === current?.id;
              return (
                <li key={d.id}>
                  <div
                    className={cn(
                      'flex min-h-11 items-center gap-1 rounded-md border px-2 py-1 text-xs @[600px]:min-h-9',
                      isCurrent && 'border-primary bg-accent',
                      d.removed && 'border-dashed opacity-70',
                      bad && 'border-destructive bg-destructive/10 ring-destructive/30 ring-2',
                    )}
                    data-doc-row={d.name}
                    data-doc-mark={m}
                    aria-invalid={bad || undefined}>
                    <button
                      type="button"
                      id={rowId(d.id)}
                      className="flex min-h-8 min-w-0 flex-1 items-center gap-1.5 text-left"
                      onClick={() => onSelect(d.id)}
                      aria-current={isCurrent || undefined}
                      aria-invalid={bad || undefined}>
                      <span className="text-muted-foreground w-4 shrink-0 tabular-nums" data-doc-number>
                        {numbers[i]}
                      </span>
                      <span className="min-w-0">
                        <span className={cn('block truncate font-mono', d.removed && 'line-through')} title={d.name}>
                          {d.name || '—'}
                        </span>
                        {m === 'renamed' ? (
                          <span className="text-muted-foreground block truncate text-[10px]" data-doc-was>
                            было {d.base?.name}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    {token ? <Token color={token.color} label={token.label} className="h-4 px-1 text-[10px]" /> : null}
                    {d.removed ? (
                      <Button size="xs" variant="ghost" className="@max-[600px]:h-8" onClick={() => restore(d)}>
                        Вернуть
                      </Button>
                    ) : (
                      <>
                        <Button
                          id={moveId(d.id, -1)}
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Поднять ${d.name}`}
                          disabled={!canMove(docs, d.id, -1)}
                          onClick={() => move(d, -1)}
                          className="@max-[600px]:size-8">
                          <ArrowUp />
                        </Button>
                        <Button
                          id={moveId(d.id, 1)}
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Опустить ${d.name}`}
                          disabled={!canMove(docs, d.id, 1)}
                          onClick={() => move(d, 1)}
                          className="@max-[600px]:size-8">
                          <ArrowDown />
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          <Button size="sm" variant="secondary" className="w-full @max-[600px]:h-10" onClick={add}>
            <Plus /> Добавить документ
          </Button>
        </div>

        {current ? (
          current.removed ? (
            <Card className="gap-3 border-dashed p-4" data-doc-card-removed={current.name}>
              <p className="text-sm font-medium">
                Документ <span className="font-mono">{current.name}</span> убран из новой версии
              </p>
              <p className="text-muted-foreground text-xs">
                {baseVersion ? `В версии ${baseVersion} он остаётся. ` : ''}Пока версия не сохранена, документ можно вернуть
                вместе с правками.
              </p>
              <div>
                <Button id={RESTORE_ID} size="sm" variant="secondary" onClick={() => restore(current)}>
                  <Undo2 /> Вернуть документ
                </Button>
              </div>
            </Card>
          ) : (
            <Card className="min-w-0 gap-3 p-3" data-doc-card={current.name}>
              <div className="grid gap-3 @sm:grid-cols-[minmax(0,1fr)_170px]">
                <TextInput
                  id={DOC_NAME_ID}
                  label="Имя"
                  value={current.name}
                  onChange={(name) => patch(current.id, {name})}
                  isInvalid={flagged === current.id}
                  className="font-mono"
                  description={
                    mark === 'renamed' ? (
                      <span className="flex gap-1.5" data-rename-hint>
                        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                        <span>
                          Переименование — это «убран + добавлен»: в изменениях версии будут два документа,{' '}
                          <span className="font-mono">{current.base?.name}</span> и{' '}
                          <span className="font-mono">{current.name || '…'}</span>
                        </span>
                      </span>
                    ) : (
                      'Имя файла: строчные латинские буквы, цифры, «.», «_», «-», на конце .md'
                    )
                  }
                />
                <Selector
                  label="Тип"
                  description={
                    customKind
                      ? `Тип «${customKind}» задан в версии ${baseVersion ?? ''} и сохранится, если его не менять`
                      : undefined
                  }
                  options={kindOptions(current).map((k) => ({value: k, label: k}))}
                  value={current.kind}
                  onChange={(kind) => kind && patch(current.id, {kind})}
                />
              </div>
              <TextArea
                id="role-doc-content"
                label="Содержимое"
                description="Текст документа в markdown"
                value={current.content}
                onChange={(content) => patch(current.id, {content})}
                rows={10}
                className="min-h-48 font-mono text-xs break-words"
              />
              <div className="flex justify-end">
                {removalNeedsConfirm(current) ? (
                  <ConfirmButton
                    title="Убрать новый документ?"
                    description={`${current.name} ещё не сохранён: его текст пропадёт, вернуть документ будет нельзя`}
                    confirmLabel="Убрать документ"
                    onConfirm={() => remove(current)}>
                    Убрать документ
                  </ConfirmButton>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => remove(current)}>
                    Убрать документ
                  </Button>
                )}
              </div>
            </Card>
          )
        ) : null}
      </div>
    </div>
  );
}
