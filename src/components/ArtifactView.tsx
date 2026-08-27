import {useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {Collapsible} from '@astryxdesign/core/Collapsible';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {Item} from '@astryxdesign/core/Item';
import {Markdown} from '@astryxdesign/core/Markdown';
import {CodeBlock} from '@astryxdesign/core/CodeBlock';
import {Text} from '@astryxdesign/core/Text';
import {Token} from '@astryxdesign/core/Token';

import {ApiError, api} from '../api/client';
import type {Artifact} from '../api/types';
import {Failure} from './Feedback';

// Артефакт иммутабелен: правка — новая версия через supersedes_id. Поэтому
// здесь нет редактирования, только чтение и апрув.
export function ArtifactView({artifact, onChanged}: {artifact: Artifact; onChanged: () => void}) {
  const [content, setContent] = useState<string>();
  const [error, setError] = useState<ApiError>();

  const load = async (isOpen: boolean) => {
    if (!isOpen || content !== undefined) return;
    try {
      setContent(await api.artifactContent(artifact.id));
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    }
  };

  const approve = async () => {
    try {
      await api.approveArtifact(artifact.id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    }
  };

  return (
    <VStack gap={2}>
      <Item
        label={artifact.title}
        description={artifact.kind}
        startContent={<Token size="sm" label={`v${artifact.version}`} />}
        endContent={
          <HStack gap={2} vAlign="center">
            <Text type="supporting" color="secondary">
              {artifact.status}
            </Text>
            {artifact.approved_by ? null : (
              <Button size="sm" variant="secondary" label="Принять" onClick={approve} />
            )}
          </HStack>
        }
      />
      {error ? <Failure error={error} title="Артефакт не открылся" /> : null}
      <Collapsible trigger="Содержимое" onOpenChange={load}>
        {content === undefined ? (
          <Text type="supporting" color="secondary">
            Загрузка…
          </Text>
        ) : artifact.format === 'markdown' ? (
          <Markdown>{content}</Markdown>
        ) : (
          <CodeBlock code={content} language={artifact.format} hasCopyButton />
        )}
      </Collapsible>
    </VStack>
  );
}
