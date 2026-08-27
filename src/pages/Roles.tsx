import {useState} from 'react';
import {useParams} from 'react-router-dom';
import {Badge} from '@astryxdesign/core/Badge';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Divider} from '@astryxdesign/core/Divider';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutHeader,
  LayoutPanel,
  VStack,
} from '@astryxdesign/core/Layout';
import {Item} from '@astryxdesign/core/Item';
import {List} from '@astryxdesign/core/List';
import {Switch} from '@astryxdesign/core/Switch';
import {Heading, Text} from '@astryxdesign/core/Text';
import {Timestamp} from '@astryxdesign/core/Timestamp';
import {Token} from '@astryxdesign/core/Token';

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
    <Layout
      height="fill"
      start={
        <LayoutPanel width={300} hasDivider padding={0} isScrollable label="Роли">
          <Layout
            height="fill"
            header={
              <LayoutHeader hasDivider padding={3}>
                <VStack gap={2}>
                  <HStack hAlign="between" vAlign="center">
                    <Heading level={2}>Роли</Heading>
                    <Badge variant="neutral" label={String(roles.data.length)} />
                  </HStack>
                  <Switch
                    size="sm"
                    label="Показать архивные"
                    value={includeArchived}
                    onChange={setIncludeArchived}
                  />
                </VStack>
              </LayoutHeader>
            }
            content={
              <LayoutContent padding={0}>
                <List hasDividers>
                  {roles.data.map((role) => (
                    <RoleRow
                      key={role.id}
                      role={role}
                      isSelected={role.key === selected}
                      onSelect={() => setPicked(role.key)}
                    />
                  ))}
                </List>
              </LayoutContent>
            }
          />
        </LayoutPanel>
      }
      content={
        <LayoutContent padding={4}>
          {selected ? (
            <RoleDetail projectKey={projectKey} roleKey={selected} onChanged={roles.reload} />
          ) : (
            <EmptyState title="Роли нет" description="Заведите роль, чтобы поставить её на статус" />
          )}
        </LayoutContent>
      }
    />
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
    <Item
      label={role.name}
      description={role.key}
      isSelected={isSelected}
      onClick={onSelect}
      endContent={
        role.archived_at ? (
          <Token size="sm" label="в архиве" />
        ) : role.latest_version ? (
          <Text type="supporting" color="secondary">
            v{role.latest_version}
          </Text>
        ) : null
      }
    />
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
    <VStack gap={4}>
      <HStack hAlign="between" vAlign="center" gap={3}>
        <VStack gap={1}>
          <Heading level={1}>{head.name}</Heading>
          <Text color="secondary">{head.summary}</Text>
        </VStack>
        <HStack gap={2}>
          <Button
            variant="secondary"
            label={head.archived_at ? 'Вернуть из архива' : 'В архив'}
            onClick={() => archive(!head.archived_at)}
          />
          <Button variant="primary" label="Новая версия" onClick={() => setAdding(true)} />
        </HStack>
      </HStack>

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

      <Divider />

      {versions.length === 0 ? (
        <EmptyState title="Версий нет" description="Инструкция роли задаётся версией" />
      ) : (
        <VStack gap={4}>
          {versions.map((v) => (
            <VersionCard key={v.id} version={v} isLatest={v.id === latest?.id} />
          ))}
        </VStack>
      )}
    </VStack>
  );
}

// Роль, стоящую на статусе активного цикла, архивировать нельзя: статус
// остался бы без исполнителя. Бэкенд возвращает конфликт со списком мест.
function ArchiveError({error}: {error: ApiError}) {
  const usedOn = (error.details as {used_on?: RoleUsage[]} | undefined)?.used_on ?? [];

  return (
    <Banner
      status="error"
      collapsible={false}
      title="Роль не заархивирована"
      description={error.message}>
      {usedOn.length ? (
        <HStack gap={1} wrap="wrap">
          {usedOn.map((u, i) => (
            <Token key={i} size="sm" label={`${u.status_key} (${u.workflow_state})`} />
          ))}
        </HStack>
      ) : null}
    </Banner>
  );
}

function Usage({usage}: {usage: RoleUsage[]}) {
  if (usage.length === 0) {
    return (
      <Text type="supporting" color="secondary">
        Роль не стоит ни на одном статусе
      </Text>
    );
  }
  return (
    <VStack gap={1}>
      <Text type="supporting" color="secondary">
        Стоит на статусах
      </Text>
      <HStack gap={1} wrap="wrap">
        {usage.map((u, i) => (
          <Token
            key={i}
            size="sm"
            color={u.workflow_state === 'active' ? 'blue' : 'gray'}
            label={`${u.status_key}${u.is_primary ? ' · исполнитель' : ''}`}
          />
        ))}
      </HStack>
    </VStack>
  );
}

function VersionCard({version, isLatest}: {version: RoleVersion; isLatest: boolean}) {
  return (
    <Card padding={4}>
      <VStack gap={3}>
        <HStack hAlign="between" vAlign="center" gap={2}>
          <HStack gap={2} vAlign="center">
            <Heading level={3}>Версия {version.version}</Heading>
            {isLatest ? <Badge variant="success" label="актуальная" /> : null}
          </HStack>
          <Timestamp value={version.created_at} format="relative" color="secondary" />
        </HStack>
        {version.changelog ? <Text color="secondary">{version.changelog}</Text> : null}

        <Text style={{whiteSpace: 'pre-wrap'}}>{version.instructions}</Text>

        <VStack gap={2}>
          <Text type="supporting" color="secondary">
            Контракт вывода
          </Text>
          <HStack gap={1} wrap="wrap">
            {(version.output_contract ?? []).map((item) => (
              <Token
                key={item.kind}
                size="sm"
                color={item.required ? 'blue' : 'gray'}
                label={item.kind}
              />
            ))}
          </HStack>
        </VStack>

        {(version.input_kinds ?? []).length > 0 ? (
          <VStack gap={2}>
            <Text type="supporting" color="secondary">
              Что читает на входе
            </Text>
            <HStack gap={1} wrap="wrap">
              {(version.input_kinds ?? []).map((kind) => (
                <Token key={kind} size="sm" label={kind} />
              ))}
            </HStack>
          </VStack>
        ) : null}
      </VStack>
    </Card>
  );
}
