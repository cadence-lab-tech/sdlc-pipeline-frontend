// Панель роли «Пайплайна» (CLAB-346): то, что раньше было страницей ролей, —
// шапка с архивом, «Стоит на статусах», версии (последняя раскрыта, прежние
// строкой и по клику) и «Новая версия». Правка инструкции — новая версия, а
// не изменение прежней: пройденные этапы ссылаются на ту версию, по которой
// работали (решение 0016).
//
// Граница с CLAB-347: панель собрана из RoleHeader, RoleVersionCard и
// NewVersionForm; 347 заменит два последних документами и диффом, не трогая
// холст, адрес и обзор.
import {useState} from 'react';
import {ChevronRight} from 'lucide-react';
import {toast} from 'sonner';

import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Separator} from '@/components/ui/separator';
import {ConfirmButton, EmptyState, Markdown, Note, Timestamp, Token} from '@/components/kit';

import {ApiError, api} from '../../api/client';
import type {Role, RoleUsage, RoleVersion, Workflow} from '../../api/types';
import {useResource} from '../../api/useResource';
import {Failure, Loading} from '../Feedback';
import {RoleVersionForm} from '../RoleVersionForm';
import {modelLevelLabel} from '../modelLevel';

export function RolePanel({
  projectKey,
  roleKey,
  workflow,
  expanded,
  onVersion,
  onStatus,
  onChanged,
  onForm,
}: {
  projectKey: string;
  roleKey: string;
  workflow?: Workflow;
  // Раскрытая версия из адреса (?v=); нет — последняя.
  expanded?: number;
  onVersion: (v?: number) => void;
  onStatus: (key: string) => void;
  onChanged: () => void;
  // Форма новой версии открыта: панель шире.
  onForm: (open: boolean) => void;
}) {
  const role = useResource(() => api.getRole(projectKey, roleKey), [projectKey, roleKey]);
  const [error, setError] = useState<ApiError>();
  const [adding, setAdding] = useState(false);

  if (role.error) return <div className="p-4"><Failure error={role.error} reload={role.reload} /></div>;
  if (!role.data) return <Loading />;

  const {role: head, versions = [], used_on: usedOn} = role.data;
  const latest = versions[0];
  const open = versions.find((v) => v.version === expanded) ?? latest;

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

  const setForm = (value: boolean) => {
    setAdding(value);
    onForm(value);
  };

  return (
    <div className="space-y-5 p-4" data-role-panel={head.key}>
      <RoleHeader
        role={head}
        onArchive={() => archive(true)}
        onRestore={() => archive(false)}
        onNewVersion={() => setForm(true)}
      />
      {error ? <ArchiveError error={error} workflow={workflow} onStatus={onStatus} /> : null}

      <Usage usage={usedOn} workflow={workflow} onStatus={onStatus} />

      {adding ? (
        <NewVersionForm
          projectKey={projectKey}
          roleKey={roleKey}
          base={latest}
          onCancel={() => setForm(false)}
          onCreated={() => {
            setForm(false);
            role.reload();
            onChanged();
            // После сохранения раскрыта новая, последняя версия.
            onVersion(undefined);
          }}
        />
      ) : null}

      <Separator />

      {versions.length === 0 ? (
        <EmptyState title="Версий нет" description="Инструкция роли задаётся версией: «Новая версия»" />
      ) : (
        <div className="space-y-2">
          {versions.map((v) =>
            v.id === open?.id ? (
              <RoleVersionCard key={v.id} version={v} isLatest={v.id === latest?.id} />
            ) : (
              <VersionRow
                key={v.id}
                version={v}
                isLatest={v.id === latest?.id}
                onOpen={() => onVersion(v.id === latest?.id ? undefined : v.version)}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function RoleHeader({
  role,
  onArchive,
  onRestore,
  onNewVersion,
}: {
  role: Role;
  onArchive: () => Promise<void>;
  onRestore: () => Promise<void>;
  onNewVersion: () => void;
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
        <Button size="sm" onClick={onNewVersion}>
          Новая версия
        </Button>
      </div>
    </div>
  );
}

// Новая версия — нынешняя форма версии роли как есть. CLAB-347 заменит её
// формой с документами.
export function NewVersionForm({
  projectKey,
  roleKey,
  base,
  onCancel,
  onCreated,
}: {
  projectKey: string;
  roleKey: string;
  base?: RoleVersion;
  onCancel: () => void;
  onCreated: () => void;
}) {
  return (
    <div data-new-version>
      <RoleVersionForm projectKey={projectKey} roleKey={roleKey} base={base} onCancel={onCancel} onCreated={onCreated} />
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

// Уровень показывается, только если задан: «авто» у версии — это отсутствие
// уровня, а не ещё одна метка.
function LevelToken({version}: {version: RoleVersion}) {
  return version.model_level ? (
    <span data-version-model-level={version.model_level}>
      <Token label={`уровень ${modelLevelLabel(version.model_level)}`} />
    </span>
  ) : null;
}

function VersionRow({version, isLatest, onOpen}: {version: RoleVersion; isLatest: boolean; onOpen: () => void}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-expanded={false}
      data-role-version-row={version.version}
      className="hover:bg-accent/60 flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm">
      <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <span className="font-medium whitespace-nowrap">Версия {version.version}</span>
      {isLatest ? <Badge>актуальная</Badge> : null}
      <LevelToken version={version} />
      <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">{version.changelog ?? ''}</span>
      <Timestamp value={version.created_at} format="relative" className="shrink-0 text-xs" />
    </button>
  );
}

export function RoleVersionCard({version, isLatest}: {version: RoleVersion; isLatest: boolean}) {
  return (
    <Card className="gap-3 p-4" data-role-version={version.version}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold whitespace-nowrap">Версия {version.version}</h3>
        {isLatest ? <Badge>актуальная</Badge> : null}
        <LevelToken version={version} />
        <Timestamp value={version.created_at} format="relative" className="ml-auto text-xs" />
      </div>
      {version.changelog ? <p className="text-muted-foreground text-sm">{version.changelog}</p> : null}

      {/* Инструкция роли — разметка: её пишут списками и заголовками, а читает
          человек, сверяя с тем, что сдал агент. */}
      <Markdown>{version.instructions}</Markdown>

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
