import {useEffect, useState} from 'react';
import {ChevronRight} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible';
import {Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle} from '@/components/ui/sheet';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {DataTable} from '@/components/DataTable';
import {EmptyState, Note, StatusDot, Timestamp, Token} from '@/components/kit';
import {cn} from '@/lib/utils';

import {ApiError, api} from '../../api/client';
import type {AgentSettingsListItem, AgentSettingsView} from '../../api/types';
import type {Resource} from '../../api/useResource';
import {useResource} from '../../api/useResource';
import {Failure, Loading} from '../Feedback';
import {DiffPanel} from './DiffView';
import {VersionView} from './VersionView';
import {normalizeView, shortSha, sortVersions, stateLabel, stateVariant} from './rules';

// История версий (design.spec §8): сворачиваемый список и просмотр любой
// версии в боковой панели. Редактор панель не трогает.

const FIRST = 10;

function who(by: string | null, at: string | null) {
  if (!at) return '—';
  return (
    <span>
      {by ? `${by} · ` : ''}
      <Timestamp value={at} format="relative" />
    </span>
  );
}

export function History({
  projectKey,
  versions,
  active,
}: {
  projectKey: string;
  versions: Resource<AgentSettingsListItem[]>;
  active: AgentSettingsView | null;
}) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const [opened, setOpened] = useState<number>();
  const list = sortVersions(versions.data ?? []);
  const shown = all ? list : list.slice(0, FIRST);

  return (
    <div data-block="history">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" aria-expanded={open} className="-ml-2">
            <ChevronRight className={cn('transition-transform', open && 'rotate-90')} />
            История версий{versions.data ? ` (${list.length})` : ''}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 pt-2">
          {versions.error ? (
            <Failure error={versions.error} title="История версий не загрузилась" reload={versions.reload} />
          ) : !versions.data ? (
            <Loading label="Загрузка истории версий" />
          ) : (
            <>
              <DataTable<AgentSettingsListItem>
                idKey="version"
                data={shown}
                empty={<EmptyState title="Версий пока нет" />}
                onRowClick={(r) => setOpened(r.version)}
                columns={[
                  {key: 'version', header: 'Версия', renderCell: (r) => <Token label={`v${r.version}`} />},
                  {
                    key: 'state',
                    header: 'Состояние',
                    renderCell: (r) => (
                      <span data-state={r.state} title={`Состояние: ${r.state}`}>
                        <StatusDot variant={stateVariant(r.state)} label={stateLabel(r.state)} />
                      </span>
                    ),
                  },
                  {
                    key: 'changelog',
                    header: 'Changelog',
                    renderCell: (r) => (
                      <span className="line-clamp-2 max-w-xs break-words" title={r.changelog ?? undefined}>
                        {r.changelog || '—'}
                      </span>
                    ),
                  },
                  {key: 'created', header: 'Заведена', renderCell: (r) => who(r.created_by, r.created_at)},
                  {key: 'activated', header: 'Активирована', renderCell: (r) => who(r.activated_by, r.activated_at)},
                  {
                    key: 'sha',
                    header: 'sha256',
                    renderCell: (r) => (
                      <span className="font-mono text-xs" title={r.sha256}>
                        {shortSha(r.sha256)}
                      </span>
                    ),
                  },
                  {
                    key: 'open',
                    header: '',
                    renderCell: (r) => (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`Открыть версию ${r.version}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpened(r.version);
                        }}>
                        Открыть
                      </Button>
                    ),
                  },
                ]}
              />
              {!all && list.length > FIRST ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setAll(true)}>
                  Показать все ({list.length})
                </Button>
              ) : null}
            </>
          )}
        </CollapsibleContent>
      </Collapsible>
      <VersionSheet
        projectKey={projectKey}
        version={opened}
        active={active}
        onClose={() => setOpened(undefined)}
        onMissing={versions.reload}
      />
    </div>
  );
}

function VersionSheet({
  projectKey,
  version,
  active,
  onClose,
  onMissing,
}: {
  projectKey: string;
  version: number | undefined;
  active: AgentSettingsView | null;
  onClose: () => void;
  onMissing: () => void;
}) {
  return (
    <Sheet open={version !== undefined} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto p-4 sm:max-w-2xl" data-version-sheet>
        {version !== undefined ? (
          <SheetBody projectKey={projectKey} version={version} active={active} onMissing={onMissing} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function SheetBody({
  projectKey,
  version,
  active,
  onMissing,
}: {
  projectKey: string;
  version: number;
  active: AgentSettingsView | null;
  onMissing: () => void;
}) {
  const view = useResource(
    () =>
      api.agentSettingsVersion(projectKey, version).then(normalizeView),
    [projectKey, version],
  );
  const missing = view.error?.code === 'not_found';
  // Версии нет (удалена черновиком в другом месте): список перечитывается.
  useEffect(() => {
    if (missing) onMissing();
    // onMissing — перезапрос списка, новый на каждый рендер родителя.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing]);
  return (
    <>
      <SheetHeader>
        <SheetTitle>Версия {version}</SheetTitle>
        <SheetDescription>{view.data ? stateLabel(view.data.state) : 'Загрузка'}</SheetDescription>
      </SheetHeader>
      {view.error && !missing ? (
        <Failure error={view.error as ApiError} title="Версия не загрузилась" reload={view.reload} />
      ) : missing ? (
        <Note tone="warning" title="Такой версии нет" description="Список истории перечитан." />
      ) : !view.data ? (
        <Loading />
      ) : (
        <Tabs defaultValue="content">
          <TabsList>
            <TabsTrigger value="content">Содержимое</TabsTrigger>
            {view.data.state === 'active' ? null : <TabsTrigger value="diff">Разница с активной</TabsTrigger>}
          </TabsList>
          <TabsContent value="content" className="pt-2">
            <VersionView view={view.data} />
          </TabsContent>
          {view.data.state === 'active' ? null : (
            <TabsContent value="diff" className="pt-2">
              <DiffPanel active={active} other={view.data} kind="version" />
            </TabsContent>
          )}
          {view.data.state === 'active' ? (
            <p className="text-muted-foreground text-sm">Это действующая версия</p>
          ) : null}
        </Tabs>
      )}
    </>
  );
}
