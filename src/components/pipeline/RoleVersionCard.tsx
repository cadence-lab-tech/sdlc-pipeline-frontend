// Карточка версии роли (CLAB-347): «Документы (N)» по порядку отдачи агенту и
// «Изменения против vN-1» по документам; прежние версии — строкой. Текст
// документов прежней версии подгружается по раскрытию (GET …/versions/:n):
// в списке версий его нет. Загрузка и сбой — внутри карточки, остальная
// панель работает.
import {useEffect, useMemo, useRef} from 'react';
import {BookMarked, ChevronDown, ChevronRight, FileText, Link2} from 'lucide-react';

import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Skeleton} from '@/components/ui/skeleton';
import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';
import {Markdown, Timestamp, Token} from '@/components/kit';

import type {ApiError} from '../../api/client';
import type {RoleDocument, RoleVersion} from '../../api/types';
import {Failure} from '../Feedback';
import {modelLevelLabel} from '../modelLevel';
import {DocumentDiff} from './DocumentDiff';
import {PinTokens} from './InstructionLibrary';
import {newerLabel} from './libraryRules';
import type {RoleVersionView} from './params';
import {diffVersions, shortSha, versionDocuments} from './roleDocs';

// Текст документов версии: есть, грузится или не загрузился.
export type VersionContent =
  | {state: 'loading'}
  | {state: 'error'; error: ApiError}
  | {state: 'ready'; docs: RoleDocument[]};

// Уровень показывается, только если задан: «авто» у версии — это отсутствие
// уровня, а не ещё одна метка.
function LevelToken({version}: {version: RoleVersion}) {
  return version.model_level ? (
    <span data-version-model-level={version.model_level}>
      <Token label={`уровень ${modelLevelLabel(version.model_level)}`} />
    </span>
  ) : null;
}

export function VersionRow({version, isLatest, onOpen}: {version: RoleVersion; isLatest: boolean; onOpen: () => void}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-expanded={false}
      data-role-version-row={version.version}
      className="hover:bg-accent/60 flex min-h-10 w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm">
      <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <span className="font-medium whitespace-nowrap">Версия {version.version}</span>
      {isLatest ? <Badge>актуальная</Badge> : null}
      <LevelToken version={version} />
      <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">{version.changelog ?? ''}</span>
      <Timestamp value={version.created_at} format="relative" className="shrink-0 text-xs" />
    </button>
  );
}

// 404 повтором не лечится: у такого сбоя «Повторить» нет, остаётся текст сервера.
const retryable = (error: ApiError) => error.httpStatus !== 404;

export function RoleVersionCard({
  version,
  prev,
  isLatest,
  content,
  prevContent,
  view,
  doc,
  focusHeading,
  onView,
  onDoc,
  onRetry,
  onRetryPrev,
  library,
}: {
  version: RoleVersion;
  // Предыдущая версия; нет — первая, сравнивать не с чем.
  prev?: RoleVersion;
  isLatest: boolean;
  content: VersionContent;
  prevContent?: VersionContent;
  view: RoleVersionView;
  doc?: string;
  // Только что создана: фокус на заголовке.
  focusHeading?: boolean;
  onView: (view: RoleVersionView) => void;
  onDoc: (name?: string) => void;
  onRetry: () => void;
  onRetryPrev: () => void;
  // Библиотека (CLAB-351): последние версии инструкций, переход к
  // инструкции и «В библиотеку» (только у последней версии и с правом).
  library?: DocLibrary;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusHeading) heading.current?.focus();
  }, [focusHeading]);

  const count = versionDocuments(version).length;
  const diffMode = view === 'diff' && Boolean(prev);

  return (
    <Card className="gap-3 p-4" data-role-version={version.version}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 ref={heading} tabIndex={-1} className="text-base font-semibold whitespace-nowrap outline-none">
          Версия {version.version}
        </h3>
        {isLatest ? <Badge>актуальная</Badge> : null}
        <LevelToken version={version} />
        <Timestamp value={version.created_at} format="relative" className="ml-auto text-xs" />
      </div>
      {version.changelog ? <p className="text-muted-foreground text-sm">{version.changelog}</p> : null}

      {prev ? (
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={diffMode ? 'diff' : 'docs'}
          onValueChange={(next) => next && onView(next as RoleVersionView)}
          aria-label="Что показать"
          className="max-w-full flex-wrap"
          data-role-version-view={diffMode ? 'diff' : 'docs'}>
          <ToggleGroupItem value="docs">Документы ({count})</ToggleGroupItem>
          <ToggleGroupItem value="diff">Изменения против v{prev.version}</ToggleGroupItem>
        </ToggleGroup>
      ) : (
        <p className="text-muted-foreground text-xs" data-role-version-first>
          Первая версия: сравнивать не с чем
        </p>
      )}

      {diffMode && prev ? (
        <DiffArea
          version={version}
          prev={prev}
          content={content}
          prevContent={prevContent ?? {state: 'loading'}}
          doc={doc}
          onDoc={onDoc}
          onRetry={onRetry}
          onRetryPrev={onRetryPrev}
        />
      ) : (
        <DocsArea
          version={version}
          content={content}
          doc={doc}
          onDoc={onDoc}
          onRetry={onRetry}
          library={library && {...library, onToLibrary: isLatest ? library.onToLibrary : undefined}}
        />
      )}

      <div className="space-y-1">
        <p className="text-muted-foreground text-xs">Контракт вывода</p>
        <div className="flex flex-wrap gap-1">
          {(version.output_contract ?? []).length ? (
            (version.output_contract ?? []).map((item) => (
              <Token key={item.kind} color={item.required ? 'blue' : 'default'} label={item.kind} />
            ))
          ) : (
            <span className="text-muted-foreground text-xs">—</span>
          )}
        </div>
      </div>

      {(version.input_kinds ?? []).length > 0 ? (
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">Что читает на входе</p>
          <div className="flex flex-wrap gap-1">
            {(version.input_kinds ?? []).map((kind) => (
              <Token key={kind} label={kind} />
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function DocsSkeleton({n}: {n: number}) {
  return (
    <div role="status" aria-label="Загружаем документы версии" className="space-y-1.5" data-role-version-loading>
      {Array.from({length: Math.max(1, Math.min(n, 5))}).map((_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}

export interface DocLibrary {
  latest: Map<string, number>;
  onOpenInstruction: (key: string, version: number) => void;
  onToLibrary?: (d: RoleDocument) => void;
}

function DocsArea({
  version,
  content,
  doc,
  onDoc,
  onRetry,
  library,
}: {
  version: RoleVersion;
  content: VersionContent;
  doc?: string;
  onDoc: (name?: string) => void;
  onRetry: () => void;
  library?: DocLibrary;
}) {
  if (content.state === 'loading') return <DocsSkeleton n={versionDocuments(version).length} />;
  if (content.state === 'error') {
    return (
      <Failure
        error={content.error}
        title={`Версия ${version.version} не загрузилась`}
        reload={retryable(content.error) ? onRetry : undefined}
      />
    );
  }
  return (
    <div className="space-y-1.5" data-role-documents>
      <p className="text-muted-foreground text-xs">Порядок — так документы отдаются агенту на захвате</p>
      <ol className="space-y-1.5">
        {content.docs.map((d, i) => (
          <li key={d.name}>
            <DocumentRow
              d={d}
              index={i}
              open={doc === d.name}
              onToggle={() => onDoc(doc === d.name ? undefined : d.name)}
              library={library}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

// Строка документа версии: номер, имя, тип, sha256[0:7]; по клику — текст
// разметкой. Закреплённый за библиотекой (CLAB-351) — метки «git v1» и
// «есть v2», в раскрытом — полоса «Библиотека: …» и «Открыть инструкцию»;
// обычный документ последней версии — «В библиотеку».
export function DocumentRow({
  d,
  index,
  open,
  onToggle,
  library,
}: {
  d: RoleDocument;
  index: number;
  open: boolean;
  onToggle: () => void;
  library?: DocLibrary;
}) {
  const pin = d.instruction;
  const latest = pin ? library?.latest.get(pin.key) : undefined;
  const newer = pin ? newerLabel(pin, latest) : undefined;
  return (
    <div
      className="rounded-md border"
      data-role-document={d.name}
      data-role-document-kind={d.kind}
      data-role-document-sha={shortSha(d.sha256)}
      data-doc-pin={pin ? `${pin.key}@${pin.version}` : undefined}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="hover:bg-accent/60 flex min-h-8 w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm">
        {open ? <ChevronDown className="size-4 shrink-0" aria-hidden /> : <ChevronRight className="size-4 shrink-0" aria-hidden />}
        <span className="text-muted-foreground w-4 shrink-0 text-xs tabular-nums">{index + 1}</span>
        <FileText className="text-muted-foreground size-4 shrink-0" aria-hidden />
        <span className="min-w-0 truncate font-mono text-xs font-medium" title={d.name}>
          {d.name}
        </span>
        <span className="text-muted-foreground shrink-0 text-xs">{d.kind}</span>
        <span className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1">
          {pin ? <PinTokens pin={pin} latest={latest} short /> : null}
          {d.sha256 ? (
            <span className="text-muted-foreground font-mono text-[10px]" title={d.sha256}>
              {shortSha(d.sha256)}
            </span>
          ) : null}
        </span>
      </button>
      {open ? (
        <div className="space-y-2 border-t px-3 py-2">
          {pin ? (
            <div className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-md px-2.5 py-1.5 text-xs" data-doc-pin-bar>
              <Link2 className="size-3.5 shrink-0" aria-hidden />
              <span>
                Библиотека: <span className="font-mono">{pin.key}</span> v{pin.version}
                {newer ? ` · в библиотеке ${newer}` : ''}
              </span>
              {library ? (
                <Button size="xs" variant="ghost" className="ml-auto" onClick={() => library.onOpenInstruction(pin.key, pin.version)}>
                  Открыть инструкцию
                </Button>
              ) : null}
            </div>
          ) : library?.onToLibrary ? (
            <div className="flex justify-end">
              <Button size="xs" variant="secondary" onClick={() => library.onToLibrary!(d)} data-to-library-open>
                <BookMarked /> В библиотеку
              </Button>
            </div>
          ) : null}
          <Markdown>{d.content ?? ''}</Markdown>
        </div>
      ) : null}
    </div>
  );
}

function DiffArea({
  version,
  prev,
  content,
  prevContent,
  doc,
  onDoc,
  onRetry,
  onRetryPrev,
}: {
  version: RoleVersion;
  prev: RoleVersion;
  content: VersionContent;
  prevContent: VersionContent;
  doc?: string;
  onDoc: (name?: string) => void;
  onRetry: () => void;
  onRetryPrev: () => void;
}) {
  if (content.state === 'error') {
    return (
      <Failure
        error={content.error}
        title={`Версия ${version.version} не загрузилась`}
        reload={retryable(content.error) ? onRetry : undefined}
      />
    );
  }
  if (prevContent.state === 'error') {
    return (
      <Failure
        error={prevContent.error}
        title={`Версия ${prev.version} не загрузилась: сравнивать не с чем`}
        reload={retryable(prevContent.error) ? onRetryPrev : undefined}
      />
    );
  }
  if (content.state === 'loading' || prevContent.state === 'loading') {
    return (
      <div
        role="status"
        aria-label={`Загружаем версии ${prev.version} и ${version.version} для сравнения`}
        className="space-y-2"
        data-role-diff-loading>
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }
  return <ComputedDiff prev={prevContent.docs} next={content.docs} doc={doc} onDoc={onDoc} />;
}

// Дифф считается один раз на пару загруженных версий, а не на каждую отрисовку.
function ComputedDiff({
  prev,
  next,
  doc,
  onDoc,
}: {
  prev: RoleDocument[];
  next: RoleDocument[];
  doc?: string;
  onDoc: (name?: string) => void;
}) {
  const diff = useMemo(() => diffVersions(prev, next), [prev, next]);
  return <DocumentDiff diff={diff} doc={doc} onDoc={onDoc} />;
}
