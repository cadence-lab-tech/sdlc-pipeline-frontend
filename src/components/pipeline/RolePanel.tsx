// Панель роли «Пайплайна» (CLAB-346): то, что раньше было страницей ролей, —
// шапка с архивом, «Стоит на статусах», версии (последняя раскрыта, прежние
// строкой и по клику) и «Новая версия». Правка роли — новая версия, а не
// изменение прежней: пройденные этапы ссылаются на ту версию, по которой
// работали (решение 0016).
//
// Версия — набор документов (CLAB-347, решение 0068): карточка версии
// показывает документы и дифф против предыдущей (RoleVersionCard.tsx), форма
// новой версии — редактор документов (RoleVersionForm). Текст документов
// прежних версий подгружается по раскрытию и держится, пока открыта панель.
//
// Предложения версий (CLAB-384, решение 0072): участник уровня agent вместо
// «Новая версия» видит «Предложить версию», а под версиями — очередь
// предложений (RoleProposals), которую сопровождающий утверждает или
// отклоняет. Права — подсказка (proposalRules.ts), решает сервер.
import {useCallback, useEffect, useRef, useState} from 'react';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {Separator} from '@/components/ui/separator';
import {ConfirmButton, EmptyState, Note, Token} from '@/components/kit';

import {ApiError, api} from '../../api/client';
import type {Role, RoleDocument, RoleProposal, RoleUsage, RoleVersion, Workflow} from '../../api/types';
import {useResource} from '../../api/useResource';
import {Failure, Loading} from '../Feedback';
import {RoleVersionForm} from '../RoleVersionForm';
import type {RoleVersionView} from './params';
import {RoleVersionCard, VersionRow, type VersionContent} from './RoleVersionCard';
import {useLibraryLatest} from '../../hooks/useLibraryLatest';
import {useRoleRights} from '../../hooks/useRoleRights';
import {lagLine} from './libraryRules';
import {RoleProposals} from './RoleProposals';
import {roleVersionAction, type VersionAction} from './proposalRules';
import {hasContent, versionDocuments} from './roleDocs';

export function RolePanel({
  projectKey,
  roleKey,
  workflow,
  expanded,
  view = 'docs',
  doc,
  onVersion,
  onStatus,
  onChanged,
  onForm,
  canEdit = true,
  reloadKey,
  ownerTeamKey,
  onInstruction,
  onApply,
  onToLibrary,
}: {
  projectKey: string;
  roleKey: string;
  workflow?: Workflow;
  // Библиотека (CLAB-351): право правки (знает, что maintainer нет, —
  // кнопок нет), знак перечитать после действий библиотеки, переход к
  // инструкции, «Обновить…» из плашки и «В библиотеку» у документа.
  canEdit?: boolean;
  reloadKey?: unknown;
  // Команда-владелец проекта: её лид — сопровождающий (для подсказки прав).
  ownerTeamKey?: string;
  onInstruction?: (key: string, version?: number) => void;
  onApply?: (key: string, roles: string[]) => void;
  onToLibrary?: (roleKey: string, doc: RoleDocument) => void;
  // Раскрытая версия из адреса (?v=); нет — последняя.
  expanded?: number;
  // Режим карточки и выбранный документ из адреса (?view=, ?doc=).
  view?: RoleVersionView;
  doc?: string;
  // Выбор версии, режима и документа — одной записью в историю.
  onVersion: (v?: number, view?: RoleVersionView, doc?: string) => void;
  onStatus: (key: string) => void;
  onChanged: () => void;
  // Форма новой версии открыта: панель шире.
  onForm: (open: boolean) => void;
}) {
  const role = useResource(() => api.getRole(projectKey, roleKey), [projectKey, roleKey, reloadKey]);
  const libraryLatest = useLibraryLatest(projectKey, reloadKey);
  const [error, setError] = useState<ApiError>();
  const [adding, setAdding] = useState<'version' | 'proposal'>();
  const [justCreated, setJustCreated] = useState<number>();
  const [focusProposal, setFocusProposal] = useState<{id: string; decided?: boolean}>();
  const contents = useVersionContents(projectKey, roleKey);
  const rights = useRoleRights(projectKey, ownerTeamKey);
  // Очередь предложений: один запрос на роль, фильтр «Ожидают / Все» — на клиенте.
  const proposals = useResource(() => api.listRoleProposals(projectKey, roleKey), [projectKey, roleKey]);

  const versions = role.data?.versions ?? [];
  const latest = versions[0];
  const open = versions.find((v) => v.version === expanded) ?? latest;
  const openIndex = open ? versions.indexOf(open) : -1;
  const prev = openIndex >= 0 ? versions[openIndex + 1] : undefined;
  const latestFull = role.data?.latest_version;
  const diffMode = view === 'diff' && Boolean(prev);

  // Текст раскрытой версии, а в режиме «Изменения» — и предыдущей.
  const contentOf = (v?: RoleVersion) => (v ? contents.get(v, latestFull) : undefined);
  const openContent = contentOf(open);
  const prevContent = diffMode ? contentOf(prev) : undefined;
  const {ensure} = contents;
  useEffect(() => {
    if (open) ensure(open, latestFull);
    if (diffMode && prev) ensure(prev, latestFull);
    // Предложения сравниваются с последней версией, раскрыта она или нет.
    if (latest) ensure(latest, latestFull);
  }, [open, prev, diffMode, latest, latestFull, ensure]);

  if (role.error) return <div className="p-4"><Failure error={role.error} reload={role.reload} /></div>;
  if (!role.data) return <Loading />;

  const {role: head, used_on: usedOn} = role.data;

  const archive = async (archived: boolean) => {
    setError(undefined);
    try {
      await (archived ? api.archiveRole(projectKey, roleKey) : api.restoreRole(projectKey, roleKey));
      toast.success(archived ? `Роль ${roleKey} в архиве` : `Роль ${roleKey} возвращена из архива`);
      role.reload();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    }
  };

  const setForm = (value?: 'version' | 'proposal') => {
    setAdding(value);
    onForm(Boolean(value));
  };

  const versionAction = roleVersionAction(rights, head.key, {
    archived: Boolean(head.archived_at),
    hasVersions: versions.length > 0,
  });

  // Очередь и роль читаются заново: утверждение заводит версию, а любое
  // решение меняет состояние остальных предложений.
  const reloadAll = () => {
    proposals.reload();
    role.reload();
    onChanged();
  };

  // Версия в адресе — только не последняя: последняя раскрыта и без v.
  const vParam = (v: RoleVersion) => (v.id === latest?.id ? undefined : v.version);

  return (
    <div className="space-y-5 p-4" data-role-panel={head.key}>
      <RoleHeader
        role={head}
        onArchive={() => archive(true)}
        onRestore={() => archive(false)}
        action={versionAction.action}
        actionNote={versionAction.note}
        onNewVersion={() => setForm('version')}
        onPropose={() => setForm('proposal')}
      />
      {error ? <ArchiveError error={error} workflow={workflow} onStatus={onStatus} /> : null}

      {(head.instruction_lag ?? []).length && !head.archived_at ? (
        <div data-role-lag-banner>
          <Note tone="warning" title="В библиотеке есть новее">
            <ul className="space-y-1.5">
              {(head.instruction_lag ?? []).map((l) => (
                <li key={l.key} className="flex flex-wrap items-center gap-2" data-lag-row={l.key}>
                  <span className="font-mono text-xs">{l.key}</span>
                  <span className="text-xs opacity-90">{lagLine(l)}</span>
                  {onInstruction ? (
                    <Button size="xs" variant="secondary" className="ml-auto" onClick={() => onInstruction(l.key)}>
                      Открыть инструкцию
                    </Button>
                  ) : null}
                  {canEdit && onApply ? (
                    <Button size="xs" onClick={() => onApply(l.key, [head.key])} data-lag-apply>
                      Обновить…
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </Note>
        </div>
      ) : null}

      <Usage usage={usedOn} workflow={workflow} onStatus={onStatus} />

      {adding ? (
        <NewVersionForm
          mode={adding}
          projectKey={projectKey}
          roleKey={roleKey}
          base={latestFull ?? latest}
          library={{latest: libraryLatest, onOpenInstruction: onInstruction ? (k, v) => onInstruction(k, v) : undefined}}
          onCancel={() => setForm(undefined)}
          onProposed={(proposal) => {
            // Версии не прибавилось: перечитывается только очередь, фокус —
            // на строке нового предложения.
            setForm(undefined);
            setFocusProposal({id: proposal.id});
            proposals.reload();
          }}
          onCreated={(created) => {
            setForm(undefined);
            setJustCreated(created?.version);
            role.reload();
            onChanged();
            // После сохранения раскрыта новая, последняя версия в режиме
            // «Изменения» против той, копией которой была форма.
            onVersion(undefined, 'diff');
          }}
        />
      ) : null}

      <RoleProposals
        projectKey={projectKey}
        roleKey={roleKey}
        roleName={head.name}
        proposals={proposals}
        latest={latestFull ?? latest}
        latestContent={latest ? contentOf(latest) ?? {state: 'loading'} : {state: 'loading'}}
        onRetryLatest={() => latest && contents.retry(latest)}
        rights={rights}
        focus={focusProposal}
        onFocused={() => setFocusProposal(undefined)}
        onReload={reloadAll}
        onApproved={(p: RoleProposal) => {
          // После утверждения раскрыта новая версия в режиме «Изменения».
          setJustCreated(p.result_version);
          reloadAll();
          onVersion(undefined, 'diff');
        }}
        onClosed={(p: RoleProposal) => {
          setFocusProposal({id: p.id, decided: true});
          reloadAll();
        }}
        onOpenVersion={(n) => onVersion(n === latest?.version ? undefined : n, 'diff')}
      />

      <Separator />

      {versions.length === 0 ? (
        <EmptyState title="Версий нет" description="Документы роли задаются версией: «Новая версия»" />
      ) : (
        <div className="space-y-2">
          {versions.map((v) =>
            v.id === open?.id && openContent ? (
              <RoleVersionCard
                key={v.id}
                version={v}
                prev={prev}
                isLatest={v.id === latest?.id}
                content={openContent}
                prevContent={prevContent}
                view={diffMode ? 'diff' : 'docs'}
                doc={doc}
                focusHeading={justCreated === v.version}
                onView={(next) => onVersion(vParam(v), next, undefined)}
                onDoc={(name) => onVersion(vParam(v), diffMode ? 'diff' : 'docs', name)}
                onRetry={() => contents.retry(v)}
                onRetryPrev={() => prev && contents.retry(prev)}
                library={
                  onInstruction
                    ? {
                        latest: libraryLatest,
                        onOpenInstruction: (k, n) => onInstruction(k, n),
                        onToLibrary: canEdit && onToLibrary ? (d) => onToLibrary(head.key, d) : undefined,
                      }
                    : undefined
                }
              />
            ) : (
              <VersionRow
                key={v.id}
                version={v}
                isLatest={v.id === latest?.id}
                onOpen={() => onVersion(vParam(v), undefined, undefined)}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

// Текст документов версии без запроса: из самой версии (ответ прежнего
// backend, где один main.md несёт instructions) или из latest_version.
function knownContent(v: RoleVersion, latest?: RoleVersion) {
  const docs = versionDocuments(v);
  if (hasContent(docs)) return docs;
  if (latest && latest.version === v.version) {
    const full = versionDocuments(latest);
    if (hasContent(full)) return full;
  }
  return undefined;
}

// Текст документов версий роли. Чего нет в ответе роли, подгружается GET
// …/versions/:n по требованию и держится в пределах панели: версия
// иммутабельна, её текст не меняется.
function useVersionContents(projectKey: string, roleKey: string) {
  const [loaded, setLoaded] = useState<Record<number, VersionContent>>({});
  const requested = useRef(new Set<number>());

  const load = useCallback(
    (n: number) => {
      requested.current.add(n);
      setLoaded((m) => ({...m, [n]: {state: 'loading'}}));
      api
        .getRoleVersion(projectKey, roleKey, n)
        .then((v) => setLoaded((m) => ({...m, [n]: {state: 'ready', docs: versionDocuments(v)}})))
        .catch((err) =>
          setLoaded((m) => ({
            ...m,
            [n]: {state: 'error', error: err instanceof ApiError ? err : new ApiError('internal', String(err))},
          })),
        );
    },
    [projectKey, roleKey],
  );

  const get = (v: RoleVersion, latest?: RoleVersion): VersionContent => {
    const docs = knownContent(v, latest);
    if (docs) return {state: 'ready', docs};
    return loaded[v.version] ?? {state: 'loading'};
  };

  // Запросить, если текста нет и запрос ещё не уходил.
  const ensure = useCallback(
    (v: RoleVersion, latest?: RoleVersion) => {
      if (knownContent(v, latest) || requested.current.has(v.version)) return;
      load(v.version);
    },
    [load],
  );

  const retry = (v: RoleVersion) => load(v.version);

  return {get, ensure, retry};
}

export function RoleHeader({
  role,
  onArchive,
  onRestore,
  onNewVersion,
  onPropose,
  action = 'create',
  actionNote,
}: {
  role: Role;
  onArchive: () => Promise<void>;
  onRestore: () => Promise<void>;
  onNewVersion: () => void;
  onPropose?: () => void;
  // Что стоит на месте правки версии: «Новая версия», «Предложить версию»
  // или ничего (proposalRules.roleVersionAction).
  action?: VersionAction;
  actionNote?: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold break-words">{role.name}</h2>
          {role.archived_at ? <Token label="в архиве" /> : null}
        </div>
        <p className="text-muted-foreground text-xs">
          <span className="font-mono">{role.key}</span>
          {role.summary ? ` · ${role.summary}` : ''}
        </p>
      </div>
      <div className="flex gap-2">
        {/* Возврат из архива обратим — подтверждения не просит. */}
        {role.archived_at ? (
          <Button size="sm" variant="secondary" onClick={() => void onRestore()}>
            Вернуть из архива
          </Button>
        ) : (
          <ConfirmButton
            variant="secondary"
            size="sm"
            title="Отправить роль в архив?"
            description={`Роль ${role.name} (${role.key}) пропадёт из выбора ролей у статусов`}
            onConfirm={onArchive}>
            В архив
          </ConfirmButton>
        )}
        {action === 'create' ? (
          <Button size="sm" onClick={onNewVersion} data-role-action="create">
            Новая версия
          </Button>
        ) : action === 'propose' ? (
          <Button size="sm" onClick={onPropose} data-role-action="propose">
            Предложить версию
          </Button>
        ) : null}
      </div>
      {actionNote ? (
        <p className="text-muted-foreground basis-full text-xs" data-role-action-note>
          {actionNote}
        </p>
      ) : null}
    </div>
  );
}

// Новая версия — форма с документами копией последней версии. Свойства не
// меняются: CLAB-307 подставит сюда своё сохранение.
export function NewVersionForm({
  projectKey,
  roleKey,
  base,
  library,
  onCancel,
  onCreated,
  mode = 'version',
  onProposed,
}: {
  projectKey: string;
  roleKey: string;
  base?: RoleVersion;
  library?: {latest: Map<string, number>; onOpenInstruction?: (key: string, version: number) => void};
  onCancel: () => void;
  onCreated: (created?: RoleVersion) => void;
  mode?: 'version' | 'proposal';
  onProposed?: (proposal: RoleProposal) => void;
}) {
  return (
    <div data-new-version={mode === 'version' ? '' : undefined} data-new-proposal={mode === 'proposal' ? '' : undefined}>
      <RoleVersionForm
        mode={mode}
        onProposed={onProposed}
        projectKey={projectKey}
        roleKey={roleKey}
        base={base}
        library={library}
        onCancel={onCancel}
        onCreated={(_, created) => onCreated(created)}
      />
    </div>
  );
}

// Роль, стоящую на статусе активного цикла, архивировать нельзя: статус
// остался бы без исполнителя. Бэкенд возвращает конфликт со списком мест;
// место на этом цикле — кнопка, выбирает статус.
function ArchiveError({
  error,
  workflow,
  onStatus,
}: {
  error: ApiError;
  workflow?: Workflow;
  onStatus: (key: string) => void;
}) {
  const usedOn = (error.details as {used_on?: RoleUsage[]} | undefined)?.used_on ?? [];
  return (
    <Note tone="error" title="Роль не заархивирована" description={error.message}>
      {usedOn.length ? (
        <div className="flex flex-wrap gap-1">
          {usedOn.map((u, i) =>
            u.workflow_id === workflow?.id ? (
              <button key={i} type="button" onClick={() => onStatus(u.status_key)}>
                <Token label={`${u.status_key} (${u.workflow_state})`} />
              </button>
            ) : (
              <Token key={i} label={`${u.status_key} (${u.workflow_state})`} />
            ),
          )}
        </div>
      ) : null}
    </Note>
  );
}

// Где роль стоит: синий — активный цикл, обычный — черновик или выведенная;
// статус этого цикла назван именем и выбирается кликом.
function Usage({
  usage,
  workflow,
  onStatus,
}: {
  usage: RoleUsage[];
  workflow?: Workflow;
  onStatus: (key: string) => void;
}) {
  if (usage.length === 0) {
    return <p className="text-muted-foreground text-sm">Роль не стоит ни на одном статусе</p>;
  }
  const names = new Map((workflow?.statuses ?? []).map((s) => [s.key, s.name]));
  return (
    <div className="space-y-1" data-role-usage>
      <p className="text-muted-foreground text-xs">Стоит на статусах</p>
      <div className="flex flex-wrap gap-1">
        {usage.map((u, i) => {
          const here = u.workflow_id === workflow?.id;
          const label = `${here ? (names.get(u.status_key) ?? u.status_key) : u.status_key}${u.is_primary ? '' : ' · перепроверка'}${u.workflow_state === 'draft' ? ' · черновик' : ''}`;
          const token = <Token color={u.workflow_state === 'active' ? 'blue' : 'default'} label={label} />;
          return here ? (
            <button
              key={i}
              type="button"
              onClick={() => onStatus(u.status_key)}
              data-role-usage-status={u.status_key}
              data-role-usage-state={u.workflow_state}>
              {token}
            </button>
          ) : (
            <span key={i} data-role-usage-status={u.status_key} data-role-usage-state={u.workflow_state}>
              {token}
            </span>
          );
        })}
      </div>
    </div>
  );
}
