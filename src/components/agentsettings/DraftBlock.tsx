import {useState} from 'react';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {Selector, TextArea} from '@/components/fields';
import {CodeBlock, Note} from '@/components/kit';

import {ApiError, api} from '../../api/client';
import type {AgentSettingsListItem, AgentSettingsView} from '../../api/types';
import type {Resource} from '../../api/useResource';
import {Failure, Loading} from '../Feedback';
import {DiffPanel} from './DiffView';
import {DenyNote, DraftEditor, type Notice} from './DraftEditor';
import {VersionView} from './VersionView';
import {
  canonicalDocument,
  createBody,
  denyReason,
  errorPath,
  normalizeView,
  type CreateFrom,
  type Doc,
} from './rules';

// Блок «Черновик» (design.spec §4): форма заведения, редактор или, без права,
// просмотр. Состояния чтения — каждый блок падает отдельно.

export interface Orphan {
  doc: Doc;
  changelog: string;
}

export function DraftBlock({
  projectKey,
  canEdit,
  active,
  versions,
  draftItem,
  draft,
  notice,
  orphan,
  onNotice,
  onOrphan,
  onReload,
  onCreated,
  onActivated,
  onDiscarded,
  onDirtyChange,
}: {
  projectKey: string;
  canEdit: boolean;
  active: AgentSettingsView | null;
  versions: Resource<AgentSettingsListItem[]>;
  draftItem: AgentSettingsListItem | undefined;
  draft: Resource<AgentSettingsView | undefined>;
  notice: Notice | null;
  orphan: Orphan | null;
  onNotice: (n: Notice | null) => void;
  onOrphan: (o: Orphan | null) => void;
  onReload: () => void;
  onCreated: () => void;
  onActivated: () => void;
  onDiscarded: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  let body: React.ReactNode;
  if (versions.error) {
    body = (
      <div className="space-y-2">
        <p className="text-muted-foreground text-sm">Черновик не определён: список версий не загрузился</p>
        <Failure error={versions.error} title="История версий не загрузилась" reload={versions.reload} />
      </div>
    );
  } else if (!versions.data) {
    body = <Loading label="Загрузка черновика" />;
  } else if (draftItem) {
    if (draft.error) {
      body = <Failure error={draft.error} title="Черновик не загрузился" reload={draft.reload} />;
    } else if (!draft.data) {
      body = <Loading label="Загрузка черновика" />;
    } else if (canEdit) {
      body = (
        <DraftEditor
          projectKey={projectKey}
          server={draft.data}
          active={active}
          onReload={onReload}
          onNotice={onNotice}
          onOrphan={onOrphan}
          onActivated={onActivated}
          onDiscarded={onDiscarded}
          onDirtyChange={onDirtyChange}
        />
      );
    } else {
      body = <DraftReadOnly draft={draft.data} active={active} />;
    }
  } else if (canEdit) {
    body = (
      <CreateForm
        projectKey={projectKey}
        hasActive={active !== null}
        onCreated={() => {
          onOrphan(null);
          onCreated();
        }}
        onReload={onReload}
      />
    );
  } else {
    body = <p className="text-muted-foreground text-sm">Черновика нет.</p>;
  }

  return (
    <div className="space-y-3" data-block="draft">
      {draftItem ? null : (
        <h3 id="agent-settings-draft-title" tabIndex={-1} className="text-sm font-semibold outline-none">
          Черновик
        </h3>
      )}
      {notice ? (
        <Note tone={notice.tone} title={notice.title} description={notice.description}>
          <Button type="button" variant="ghost" size="sm" onClick={() => onNotice(null)}>
            Закрыть
          </Button>
        </Note>
      ) : null}
      {orphan && canEdit ? (
        <Note
          tone="warning"
          title="Черновик удалён в другом месте"
          description="Ваши правки не сохранены. Скопируйте их ниже или заведите черновик с этими правками.">
          <CodeBlock code={canonicalDocument(orphan.doc)} language="json" title="document.json" maxHeight={240} />
          <div className="flex flex-wrap gap-2">
            <OrphanRestore projectKey={projectKey} orphan={orphan} onCreated={() => {
              onOrphan(null);
              onCreated();
            }} />
            <Button type="button" variant="ghost" size="sm" onClick={() => onOrphan(null)}>
              Закрыть
            </Button>
          </div>
        </Note>
      ) : null}
      {body}
    </div>
  );
}

function OrphanRestore({
  projectKey,
  orphan,
  onCreated,
}: {
  projectKey: string;
  orphan: Orphan;
  onCreated: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError>();
  const restore = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const view = await api.agentSettingsCreateDraft(projectKey, {
        document: orphan.doc,
        changelog: orphan.changelog.trim() === '' ? undefined : orphan.changelog,
      });
      toast.success(`Черновик версии ${view.version} заведён`);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button type="button" size="sm" disabled={busy} onClick={() => void restore()}>
        Завести черновик из этих правок
      </Button>
      {error ? <Failure error={error} /> : null}
    </>
  );
}

// Без права: просмотр вместо полей (design.spec §3.2).
function DraftReadOnly({draft, active}: {draft: AgentSettingsView; active: AgentSettingsView | null}) {
  return (
    <Card className="gap-3 p-4" data-draft="readonly">
      <h3 id="agent-settings-draft-title" tabIndex={-1} className="text-sm font-semibold outline-none">
        Черновик · версия {draft.version}
      </h3>
      <Tabs defaultValue="content">
        <TabsList>
          <TabsTrigger value="content">Содержимое</TabsTrigger>
          <TabsTrigger value="diff">Разница с активной</TabsTrigger>
        </TabsList>
        <TabsContent value="content" className="pt-2">
          <VersionView view={draft} />
        </TabsContent>
        <TabsContent value="diff" className="pt-2">
          <DiffPanel active={active} other={draft} kind="draft" />
        </TabsContent>
      </Tabs>
    </Card>
  );
}

// Черновика нет: «Основа» (копия — только при активной версии), changelog,
// «Завести черновик». 409 — не ошибка: черновик уже есть, раздел перечитывается.
function CreateForm({
  projectKey,
  hasActive,
  onCreated,
  onReload,
}: {
  projectKey: string;
  hasActive: boolean;
  onCreated: () => void;
  onReload: () => void;
}) {
  const [from, setFrom] = useState<CreateFrom>('active');
  const [changelog, setChangelog] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string>();
  const [other, setOther] = useState<ApiError>();
  const [deny, setDeny] = useState<{message: string; reason: string | undefined}>();
  const effective: CreateFrom = hasActive ? from : 'empty';

  const create = async () => {
    setBusy(true);
    setFieldError(undefined);
    setOther(undefined);
    setDeny(undefined);
    try {
      const view = normalizeView(await api.agentSettingsCreateDraft(projectKey, createBody(effective, changelog)));
      toast.success(`Черновик версии ${view.version} заведён`);
      onCreated();
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError('internal', String(err));
      if (e.code === 'conflict') {
        toast.info('Черновик уже был заведён — показан он');
        onReload();
      } else if (e.code === 'invalid_input' && errorPath(e.details) === 'changelog') {
        setFieldError(e.message);
      } else if (e.code === 'forbidden') {
        setDeny({message: e.message, reason: denyReason(e.details)});
      } else {
        setOther(e);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="gap-3 p-4" data-draft="create">
      <h4 className="text-sm font-medium">Завести черновик</h4>
      <Selector
        label="Основа"
        value={effective}
        isDisabled={busy || !hasActive}
        dataPath="create.from"
        options={
          hasActive
            ? [
                {value: 'active', label: 'Копией активной'},
                {value: 'empty', label: 'Пустым'},
              ]
            : [{value: 'empty', label: 'Пустым'}]
        }
        onChange={(v) => setFrom(v as CreateFrom)}
      />
      <TextArea
        label="Changelog (необязательно)"
        rows={3}
        placeholder="Что меняется и почему"
        value={changelog}
        isDisabled={busy}
        dataPath="changelog"
        error={fieldError}
        onChange={(v) => {
          setChangelog(v);
          setFieldError(undefined);
        }}
      />
      <div>
        <Button type="button" data-action="create" disabled={busy} onClick={() => void create()}>
          Завести черновик
        </Button>
      </div>
      {deny ? <DenyNote message={deny.message} reason={deny.reason} /> : null}
      {other ? <Failure error={other} /> : null}
    </Card>
  );
}
