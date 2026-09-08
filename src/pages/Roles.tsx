import {useState} from 'react';
import {useParams} from 'react-router-dom';

import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Separator} from '@/components/ui/separator';
import {Switch} from '@/components/fields';
import {EmptyState, Note, Row, Timestamp, Token} from '@/components/kit';

import {ApiError, api} from '../api/client';
import type {Role, RoleUsage, RoleVersion} from '../api/types';
import {useResource} from '../api/useResource';
import {Failure, Loading} from '../components/Feedback';
import {RoleVersionForm} from '../components/RoleVersionForm';

// Редактор ролей. Правка инструкции — новая версия, а не изменение прежней:
// пройденные этапы ссылаются на ту версию, по которой работали (решение 0016).
export function Roles() {
  const {projectKey = ''} = useParams();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [picked, setPicked] = useState<string>();
  const roles = useResource(
    () => api.listRoles(projectKey, includeArchived),
    [projectKey, includeArchived],
  );

  if (roles.error) return <Failure error={roles.error} />;
  if (!roles.data) return <Loading />;

  // Выбранная роль вычисляется, а не досылается эффектом: пока никого не
  // выбрали, открыта первая в списке.
  const selected = picked ?? roles.data[0]?.key;

  return (
    <div className="flex min-h-[calc(100svh-3.5rem)]">
      <aside className="w-75 shrink-0 border-r">
        <div className="space-y-2 border-b p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Роли</h2>
            <Badge variant="secondary">{roles.data.length}</Badge>
          </div>
          <Switch label="Показать архивные" value={includeArchived} onChange={setIncludeArchived} />
        </div>
        <div className="divide-border divide-y">
          {roles.data.map((role) => (
            <RoleRow
              key={role.id}
              role={role}
              isSelected={role.key === selected}
              onSelect={() => setPicked(role.key)}
            />
          ))}
        </div>
      </aside>
      <div className="min-w-0 flex-1 p-4">
        {selected ? (
          <RoleDetail projectKey={projectKey} roleKey={selected} onChanged={roles.reload} />
        ) : (
          <EmptyState title="Роли нет" description="Заведите роль, чтобы поставить её на статус" />
        )}
      </div>
    </div>
  );
}

function RoleRow({
  role,
  isSelected,
  onSelect,
}: {
  role: Role;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <Row
      isSelected={isSelected}
      onClick={onSelect}
      end={
        role.archived_at ? (
          <Token label="в архиве" />
        ) : role.latest_version ? (
          <span className="text-muted-foreground text-xs">v{role.latest_version}</span>
        ) : null
      }>
      <p className="truncate font-medium">{role.name}</p>
      <p className="text-muted-foreground truncate text-xs">{role.key}</p>
    </Row>
  );
}

function RoleDetail({
  projectKey,
  roleKey,
  onChanged,
}: {
  projectKey: string;
  roleKey: string;
  onChanged: () => void;
}) {
  const role = useResource(() => api.getRole(projectKey, roleKey), [projectKey, roleKey]);
  const [error, setError] = useState<ApiError>();
  const [adding, setAdding] = useState(false);

  if (role.error) return <Failure error={role.error} />;
  if (!role.data) return <Loading />;

  const {role: head, versions = [], used_on: usedOn} = role.data;
  const latest = versions[0];

  const archive = async (archived: boolean) => {
    setError(undefined);
    try {
      await (archived ? api.archiveRole(projectKey, roleKey) : api.restoreRole(projectKey, roleKey));
      role.reload();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{head.name}</h1>
          <p className="text-muted-foreground text-sm">{head.summary}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => archive(!head.archived_at)}>
            {head.archived_at ? 'Вернуть из архива' : 'В архив'}
          </Button>
          <Button onClick={() => setAdding(true)}>Новая версия</Button>
        </div>
      </div>

      {error ? <ArchiveError error={error} /> : null}

      <Usage usage={usedOn} />

      {adding ? (
        <RoleVersionForm
          projectKey={projectKey}
          roleKey={roleKey}
          base={latest}
          onCancel={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            role.reload();
            onChanged();
          }}
        />
      ) : null}

      <Separator />

      {versions.length === 0 ? (
        <EmptyState title="Версий нет" description="Инструкция роли задаётся версией" />
      ) : (
        <div className="space-y-4">
          {versions.map((v) => (
            <VersionCard key={v.id} version={v} isLatest={v.id === latest?.id} />
          ))}
        </div>
      )}
    </div>
  );
}

// Роль, стоящую на статусе активного цикла, архивировать нельзя: статус
// остался бы без исполнителя. Бэкенд возвращает конфликт со списком мест.
function ArchiveError({error}: {error: ApiError}) {
  const usedOn = (error.details as {used_on?: RoleUsage[]} | undefined)?.used_on ?? [];

  return (
    <Note tone="error" title="Роль не заархивирована" description={error.message}>
      {usedOn.length ? (
        <div className="flex flex-wrap gap-1">
          {usedOn.map((u, i) => (
            <Token key={i} label={`${u.status_key} (${u.workflow_state})`} />
          ))}
        </div>
      ) : null}
    </Note>
  );
}

function Usage({usage}: {usage: RoleUsage[]}) {
  if (usage.length === 0) {
    return <p className="text-muted-foreground text-sm">Роль не стоит ни на одном статусе</p>;
  }
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs">Стоит на статусах</p>
      <div className="flex flex-wrap gap-1">
        {usage.map((u, i) => (
          <Token
            key={i}
            color={u.workflow_state === 'active' ? 'blue' : 'default'}
            label={`${u.status_key}${u.is_primary ? ' · исполнитель' : ''}`}
          />
        ))}
      </div>
    </div>
  );
}

function VersionCard({version, isLatest}: {version: RoleVersion; isLatest: boolean}) {
  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold">Версия {version.version}</h3>
          {isLatest ? <Badge>актуальная</Badge> : null}
        </div>
        <Timestamp value={version.created_at} format="relative" />
      </div>
      {version.changelog ? <p className="text-muted-foreground text-sm">{version.changelog}</p> : null}

      <p className="text-sm whitespace-pre-wrap">{version.instructions}</p>

      <div className="space-y-1">
        <p className="text-muted-foreground text-xs">Контракт вывода</p>
        <div className="flex flex-wrap gap-1">
          {(version.output_contract ?? []).map((item) => (
            <Token key={item.kind} color={item.required ? 'blue' : 'default'} label={item.kind} />
          ))}
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
