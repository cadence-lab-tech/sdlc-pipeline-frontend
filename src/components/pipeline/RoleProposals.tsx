// Секция «Предложения» панели роли (CLAB-384, решение 0072): очередь
// предложений версий — строки с состоянием и раскрытая карточка с диффом
// против последней версии и решением. Правила — proposalRules.ts без React;
// права здесь — подсказка (решает сервер, его отказ показывается как есть).
import {useEffect, useId, useMemo, useRef, useState} from 'react';
import {ChevronDown, ChevronRight} from 'lucide-react';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {Skeleton} from '@/components/ui/skeleton';
import {ToggleGroup, ToggleGroupItem} from '@/components/ui/toggle-group';
import {ConfirmButton, EmptyState, Note, Timestamp, Token} from '@/components/kit';

import {ApiError, api} from '../../api/client';
import type {RoleDocument, RoleProposal, RoleVersion} from '../../api/types';
import {useResource, type Resource} from '../../api/useResource';
import {Failure} from '../Feedback';
import {DocumentDiff} from './DocumentDiff';
import {ProposalNoteDialog} from './ProposalNoteDialog';
import {DocumentRow, type VersionContent} from './RoleVersionCard';
import {diffVersions, versionDocuments} from './roleDocs';
import {
  APPROVE_BLOCKED,
  PAGE_SIZE,
  type ProposalFilter,
  type RoleRights,
  authorLabel,
  canDecide,
  canWithdraw,
  filterProposals,
  isStale,
  otherChanges,
  pageProposals,
  proposalLabel,
  proposalNumbers,
  sectionTitle,
  staleHint,
  staleTitle,
} from './proposalRules';

const asApiError = (err: unknown) => (err instanceof ApiError ? err : new ApiError('internal', String(err)));

// Решение гонки: 409 — предложение уже решено или база устарела, список надо
// перечитать, прежнее состояние на экране лжёт.
const isRace = (err: ApiError) => err.code === 'conflict' || err.code === 'stale_role_base';

export function RoleProposals({
  projectKey,
  roleKey,
  roleName,
  proposals,
  latest,
  latestContent,
  onRetryLatest,
  rights,
  focus,
  onFocused,
  onReload,
  onApproved,
  onClosed,
  onOpenVersion,
}: {
  projectKey: string;
  roleKey: string;
  roleName: string;
  // Один запрос списка на роль держит панель: после подачи и действий она же
  // его перечитывает.
  proposals: Resource<RoleProposal[]>;
  // Последняя версия роли (номер, вход, контракт, уровень) и её документы.
  latest?: RoleVersion;
  latestContent: VersionContent;
  onRetryLatest: () => void;
  rights?: RoleRights;
  // Строка, на заголовок которой перевести фокус (после подачи, отклонения,
  // отзыва). decided — предложение только что решено: ждём, пока очередь
  // покажет новое состояние.
  focus?: {id: string; decided?: boolean};
  onFocused: () => void;
  // Перечитать очередь и роль.
  onReload: () => void;
  onApproved: (proposal: RoleProposal) => void;
  onClosed: (proposal: RoleProposal) => void;
  onOpenVersion: (version: number) => void;
}) {
  const [filter, setFilter] = useState<ProposalFilter>('pending');
  const [extra, setExtra] = useState(0);
  const [openId, setOpenId] = useState<string>();
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const headingId = useId();

  const all = proposals.data;
  const numbers = useMemo(() => proposalNumbers(all ?? []), [all]);
  const rows = useMemo(() => filterProposals(all ?? [], filter), [all, filter]);
  const page = pageProposals(rows, filter, extra);
  const pendingCount = (all ?? []).filter((p) => p.state === 'pending').length;

  // Фокус на заголовок строки. Решённое предложение в «Ожидают» из списка
  // выпадает, поэтому, когда очередь показала новое состояние, фильтр
  // переключается на «Все», а строка за пределами первой страницы
  // подгружается. Подстройка — прямо при отрисовке (состояние этого же
  // компонента), сам фокус — после неё, в эффекте.
  const [adjusted, setAdjusted] = useState<typeof focus>();
  if (focus && focus !== adjusted && all) {
    const target = all.find((p) => p.id === focus.id);
    if (target && !(focus.decided && target.state === 'pending')) {
      setAdjusted(focus);
      if (filter === 'pending' && target.state !== 'pending') setFilter('all');
      const at = filterProposals(all, 'all').findIndex((p) => p.id === focus.id);
      if ((filter === 'all' || target.state !== 'pending') && at >= PAGE_SIZE + extra) setExtra(at + 1 - PAGE_SIZE);
    }
  }
  useEffect(() => {
    if (!focus || adjusted !== focus) return;
    const el = rowRefs.current.get(focus.id);
    if (el) {
      el.focus();
      el.scrollIntoView?.({block: 'nearest'});
      onFocused();
    }
  }, [focus, adjusted, rows, onFocused]);

  let body: React.ReactNode;
  if (proposals.error && !all) {
    body = <Failure error={proposals.error} title="Предложения не загрузились" reload={proposals.reload} />;
  } else if (!all) {
    body = (
      <div role="status" aria-label="Загружаем предложения">
        <Skeleton className="h-10 w-full" />
      </div>
    );
  } else if (all.length === 0) {
    body = (
      <EmptyState
        title="Предложений нет"
        description="Участник уровня agent предлагает версию своей роли, сопровождающий её утверждает"
      />
    );
  } else if (rows.length === 0) {
    body = (
      <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm" data-proposals-empty>
        Ожидающих нет
        <Button size="xs" variant="link" onClick={() => setFilter('all')}>
          Показать все ({all.length})
        </Button>
      </p>
    );
  } else {
    body = (
      <div className="space-y-2">
        {page.rows.map((p) => {
          const n = numbers.get(p.id) ?? 0;
          const open = openId === p.id;
          return (
            <ProposalItem
              key={p.id}
              projectKey={projectKey}
              roleKey={roleKey}
              roleName={roleName}
              proposal={p}
              number={n}
              open={open}
              onToggle={() => setOpenId(open ? undefined : p.id)}
              rowRef={(el) => {
                if (el) rowRefs.current.set(p.id, el);
                else rowRefs.current.delete(p.id);
              }}
              latest={latest}
              latestContent={latestContent}
              onRetryLatest={onRetryLatest}
              rights={rights}
              onReload={onReload}
              onApproved={onApproved}
              onClosed={onClosed}
              onOpenVersion={onOpenVersion}
            />
          );
        })}
        {page.rest > 0 ? (
          <Button variant="secondary" size="sm" onClick={() => setExtra((e) => e + PAGE_SIZE)} data-proposals-more>
            Показать ещё ({page.rest})
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <section className="space-y-2" aria-labelledby={headingId} data-role-proposals>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="text-base font-semibold">
          {sectionTitle(all ? (filter === 'pending' ? pendingCount : all.length) : undefined)}
        </h3>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={filter}
          // Повторный клик снимает выбор: игнорируем, фильтр всегда задан.
          onValueChange={(next) => {
            if (next) {
              setFilter(next as ProposalFilter);
              setExtra(0);
            }
          }}
          aria-label="Какие предложения показать"
          data-proposals-filter={filter}>
          <ToggleGroupItem value="pending">Ожидают</ToggleGroupItem>
          <ToggleGroupItem value="all">Все</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {body}
    </section>
  );
}

function ProposalItem({
  projectKey,
  roleKey,
  roleName,
  proposal: p,
  number,
  open,
  onToggle,
  rowRef,
  latest,
  latestContent,
  onRetryLatest,
  rights,
  onReload,
  onApproved,
  onClosed,
  onOpenVersion,
}: {
  projectKey: string;
  roleKey: string;
  roleName: string;
  proposal: RoleProposal;
  number: number;
  open: boolean;
  onToggle: () => void;
  rowRef: (el: HTMLButtonElement | null) => void;
  latest?: RoleVersion;
  latestContent: VersionContent;
  onRetryLatest: () => void;
  rights?: RoleRights;
  onReload: () => void;
  onApproved: (proposal: RoleProposal) => void;
  onClosed: (proposal: RoleProposal) => void;
  onOpenVersion: (version: number) => void;
}) {
  const cardId = useId();
  const latestNumber = latest?.version;
  const stale = isStale(p, latestNumber);
  const {label, color} = proposalLabel(p, latestNumber);
  const author = authorLabel(p, rights);

  return (
    <div
      className="rounded-lg border"
      data-proposal={p.id}
      data-proposal-number={number}
      data-proposal-state={p.state}
      data-proposal-label={label}
      data-proposal-stale={stale ? '' : undefined}>
      <button
        type="button"
        ref={rowRef}
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={cardId}
        className="hover:bg-accent/60 flex min-h-10 w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg px-3 py-2 text-left text-sm">
        {open ? (
          <ChevronDown className="size-4 shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="size-4 shrink-0" aria-hidden />
        )}
        <span className="font-medium whitespace-nowrap">#{number}</span>
        <Token color={color} label={label} />
        <span className="text-muted-foreground min-w-0 basis-40 flex-1 truncate text-xs" title={`${author} · от v${p.base_version} · ${p.changelog}`}>
          {author} · от v{p.base_version} · {p.changelog}
        </span>
        <Timestamp value={p.created_at} format="relative" className="shrink-0 text-xs" />
      </button>
      {open ? (
        <div id={cardId} className="space-y-3 border-t px-3 py-3">
          <ProposalCard
            projectKey={projectKey}
            roleKey={roleKey}
            roleName={roleName}
            proposal={p}
            number={number}
            stale={stale}
            latest={latest}
            latestContent={latestContent}
            onRetryLatest={onRetryLatest}
            rights={rights}
            onReload={onReload}
            onApproved={onApproved}
            onClosed={onClosed}
            onOpenVersion={onOpenVersion}
          />
        </div>
      ) : null}
    </div>
  );
}

function ProposalCard({
  projectKey,
  roleKey,
  roleName,
  proposal: p,
  number,
  stale,
  latest,
  latestContent,
  onRetryLatest,
  rights,
  onReload,
  onApproved,
  onClosed,
  onOpenVersion,
}: {
  projectKey: string;
  roleKey: string;
  roleName: string;
  proposal: RoleProposal;
  number: number;
  stale: boolean;
  latest?: RoleVersion;
  latestContent: VersionContent;
  onRetryLatest: () => void;
  rights?: RoleRights;
  onReload: () => void;
  onApproved: (proposal: RoleProposal) => void;
  onClosed: (proposal: RoleProposal) => void;
  onOpenVersion: (version: number) => void;
}) {
  // Содержимое документов — отдельным запросом; состояние в ключе: решили в
  // другом месте — карточка читается заново.
  const detail = useResource(
    () => api.getRoleProposal(projectKey, roleKey, p.id),
    [projectKey, roleKey, p.id, p.state],
  );
  const [view, setView] = useState<'diff' | 'docs'>(latest ? 'diff' : 'docs');
  const [doc, setDoc] = useState<string>();
  const [actionError, setActionError] = useState<ApiError>();
  const blockedId = useId();

  const latestNumber = latest?.version;
  const author = authorLabel(p, rights);
  const pending = p.state === 'pending';
  const mayDecide = pending && canDecide(rights);
  const mayWithdraw = pending && canWithdraw(rights, p);

  const approve = async () => {
    setActionError(undefined);
    try {
      const done = await api.approveRoleProposal(projectKey, roleKey, p.id);
      toast.success(`Версия v${done.result_version ?? (latestNumber ?? 0) + 1} заведена из предложения #${number}`);
      onApproved(done);
    } catch (err) {
      // Подтверждение закрывается, а сообщение остаётся над кнопками.
      setActionError(asApiError(err));
      onReload();
    }
  };

  const close = (kind: 'reject' | 'withdraw') => async (note: string) => {
    try {
      const done: RoleProposal =
        kind === 'reject'
          ? await api.rejectRoleProposal(projectKey, roleKey, p.id, note)
          : await api.withdrawRoleProposal(projectKey, roleKey, p.id, note);
      toast.success(kind === 'reject' ? `Предложение #${number} отклонено` : `Предложение #${number} отозвано`);
      return done;
    } catch (err) {
      const e = asApiError(err);
      if (isRace(e)) onReload();
      throw e;
    }
  };

  const docs: RoleDocument[] = detail.data ? versionDocuments(detail.data) : [];
  const other = detail.data && latest ? otherChanges(detail.data, latest) : [];

  return (
    <div className="space-y-3" data-proposal-card={p.id}>
      <div className="space-y-1">
        <p className="text-muted-foreground text-xs">
          Автор: {author} · подано от v{p.base_version}
          {latestNumber !== undefined && p.base_version === latestNumber ? ' (последняя)' : ''} ·{' '}
          <Timestamp value={p.created_at} className="text-xs" />
        </p>
        <p className="text-sm break-words whitespace-pre-wrap">{p.changelog}</p>
      </div>

      {p.decided_by_handle || p.decided_at ? (
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs">
            Решил: {p.decided_by_handle ?? '—'}
            {p.decided_at ? (
              <>
                {' · '}
                <Timestamp value={p.decided_at} className="text-xs" />
              </>
            ) : null}
          </p>
          {p.decision_note ? (
            p.state === 'withdrawn' ? (
              <p className="text-sm break-words whitespace-pre-wrap" data-proposal-note>
                Заметка: {p.decision_note}
              </p>
            ) : (
              <div data-proposal-note>
                <Note title="Заметка автору">
                  <p className="break-words whitespace-pre-wrap">{p.decision_note}</p>
                </Note>
              </div>
            )
          ) : null}
          {p.state === 'approved' && p.result_version ? (
            <Button size="xs" variant="link" onClick={() => onOpenVersion(p.result_version!)} data-proposal-result>
              Заведена версия v{p.result_version}
            </Button>
          ) : null}
        </div>
      ) : null}

      {stale && latestNumber !== undefined ? (
        <div data-proposal-stale-note>
          <Note tone="warning" title={staleTitle(p.base_version, latestNumber)} description={staleHint(latestNumber)} />
        </div>
      ) : null}

      {detail.error ? (
        <div className="space-y-2">
          <Failure
            error={detail.error}
            title="Предложение не загрузилось"
            reload={detail.error.httpStatus === 404 ? undefined : detail.reload}
          />
          {detail.error.httpStatus === 404 ? (
            <Button size="sm" variant="secondary" onClick={onReload}>
              Обновить список
            </Button>
          ) : null}
        </div>
      ) : !detail.data ? (
        <div role="status" aria-label="Загружаем предложение" className="space-y-1.5">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : (
        <>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={view}
            onValueChange={(next) => {
              if (next) {
                setView(next as 'diff' | 'docs');
                setDoc(undefined);
              }
            }}
            aria-label="Что показать"
            className="max-w-full flex-wrap"
            data-proposal-view={view}>
            {latestNumber !== undefined ? (
              <ToggleGroupItem value="diff">Изменения против v{latestNumber}</ToggleGroupItem>
            ) : null}
            <ToggleGroupItem value="docs">Документы ({docs.length})</ToggleGroupItem>
          </ToggleGroup>

          {view === 'diff' && latestNumber !== undefined ? (
            <>
              {p.base_version < latestNumber ? (
                <p className="text-muted-foreground text-xs">
                  Сравнение с последней версией (v{latestNumber}), а не с базой предложения
                </p>
              ) : null}
              <ProposalDiff
                latestNumber={latestNumber}
                latestContent={latestContent}
                docs={docs}
                doc={doc}
                onDoc={setDoc}
                onRetryLatest={onRetryLatest}
              />
            </>
          ) : (
            <ol className="space-y-1.5" data-proposal-documents>
              {docs.map((d, i) => (
                <li key={d.name}>
                  <DocumentRow
                    d={d}
                    index={i}
                    open={doc === d.name}
                    onToggle={() => setDoc(doc === d.name ? undefined : d.name)}
                  />
                </li>
              ))}
            </ol>
          )}

          {other.length > 0 ? (
            <div className="space-y-1" data-proposal-other>
              <p className="text-muted-foreground text-xs">Прочее</p>
              <div className="flex flex-wrap gap-1">
                {other.map((o) => (
                  <Token key={o} label={o} />
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}

      {actionError ? (
        <div role="alert" data-proposal-action-failure>
          <Failure error={actionError} title="Предложение не утверждено" />
        </div>
      ) : null}

      {mayDecide || mayWithdraw ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-2" data-proposal-actions>
            {mayDecide ? (
              <ConfirmButton
                variant="default"
                confirmVariant="default"
                size="sm"
                title={`Утвердить предложение #${number}?`}
                description={`Будет заведена версия v${(latestNumber ?? 0) + 1} роли ${roleName} (${roleKey}). Новые прогоны пойдут по ней сразу; начатые останутся на своих версиях.`}
                confirmLabel="Утвердить"
                disabled={stale}
                triggerProps={{
                  'data-proposal-action': 'approve',
                  'aria-describedby': stale ? blockedId : undefined,
                }}
                onConfirm={approve}>
                Утвердить
              </ConfirmButton>
            ) : null}
            {mayDecide ? (
              <ProposalNoteDialog
                kind="reject"
                number={number}
                author={p.created_by_handle}
                variant={stale ? 'default' : 'secondary'}
                onSubmit={async (note) => void (await close('reject')(note))}
                onClosed={() => onClosed(p)}
              />
            ) : null}
            {mayWithdraw ? (
              <ProposalNoteDialog
                kind="withdraw"
                number={number}
                author={p.created_by_handle}
                variant="ghost"
                onSubmit={async (note) => void (await close('withdraw')(note))}
                onClosed={() => onClosed(p)}
              />
            ) : null}
          </div>
          {mayDecide && stale ? (
            <p id={blockedId} className="text-muted-foreground text-xs">
              {APPROVE_BLOCKED}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// Дифф против последней версии роли: считается один раз на пару загруженных
// наборов документов.
function ProposalDiff({
  latestNumber,
  latestContent,
  docs,
  doc,
  onDoc,
  onRetryLatest,
}: {
  latestNumber: number;
  latestContent: VersionContent;
  docs: RoleDocument[];
  doc?: string;
  onDoc: (name?: string) => void;
  onRetryLatest: () => void;
}) {
  const base = latestContent.state === 'ready' ? latestContent.docs : undefined;
  const diff = useMemo(() => (base ? diffVersions(base, docs) : undefined), [base, docs]);
  if (latestContent.state === 'error') {
    return (
      <Failure
        error={latestContent.error}
        title={`Версия ${latestNumber} не загрузилась: сравнивать не с чем`}
        reload={latestContent.error.httpStatus === 404 ? undefined : onRetryLatest}
      />
    );
  }
  if (!diff) {
    return (
      <div role="status" aria-label={`Загружаем версию ${latestNumber} для сравнения`} className="space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }
  return <DocumentDiff diff={diff} doc={doc} onDoc={onDoc} />;
}
