import {useState} from 'react';
import {ChevronRight} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible';
import {CodeBlock, Markdown, Token} from '@/components/kit';

import {ApiError, api} from '../api/client';
import type {Artifact} from '../api/types';
import {Failure} from './Feedback';

// Артефакт иммутабелен: правка — новая версия через supersedes_id. Поэтому
// здесь нет редактирования, только чтение и апрув.
export function ArtifactView({artifact, onChanged}: {artifact: Artifact; onChanged: () => void}) {
  const [content, setContent] = useState<string>();
  const [error, setError] = useState<ApiError>();

  // Содержимое подтягивается на первом раскрытии: крупные артефакты лежат во
  // внешнем хранилище, и тянуть их для всего списка сразу незачем.
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
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Token label={`v${artifact.version}`} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{artifact.title}</p>
            <p className="text-muted-foreground text-xs">{artifact.kind}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-muted-foreground text-xs">{artifact.status}</span>
          {artifact.approved_by ? null : (
            <Button size="sm" variant="secondary" onClick={approve}>
              Принять
            </Button>
          )}
        </div>
      </div>
      {error ? <Failure error={error} title="Артефакт не открылся" /> : null}
      <Collapsible onOpenChange={load}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="group -ml-2">
            <ChevronRight className="transition-transform group-data-[state=open]:rotate-90" />
            Содержимое
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          {content === undefined ? (
            <p className="text-muted-foreground text-sm">Загрузка…</p>
          ) : artifact.format === 'markdown' ? (
            <Markdown>{content}</Markdown>
          ) : (
            <CodeBlock code={content} language={artifact.format} />
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
