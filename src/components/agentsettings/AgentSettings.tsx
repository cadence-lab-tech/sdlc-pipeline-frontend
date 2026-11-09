import {useEffect, useRef, useState} from 'react';
import {RefreshCw} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {EmptyState, Note, Section} from '@/components/kit';

import {api} from '../../api/client';
import type {Me} from '../../api/types';
import {useResource} from '../../api/useResource';
import {needsProjectTeams} from '../modelLevel';
import {Failure, Loading} from '../Feedback';
import {DraftBlock, type Orphan} from './DraftBlock';
import type {Notice} from './DraftEditor';
import {History} from './History';
import {VersionView} from './VersionView';
import {useLeaveGuard} from './useLeaveGuard';
import {
  DEFAULT_BINDINGS,
  READ_ONLY_TITLE,
  activeOf,
  canEditAgentSettings,
  draftOf,
  isHuman,
  normalizeView,
  readOnlyText,
} from './rules';

// Раздел «Агенты и модели» в настройках проекта (CLAB-429, решение 0077):
// действующая версия настройки агентов, черновик с проверкой и активацией,
// история версий. Подключается в Settings.tsx одной строкой.

const DESCRIPTION =
  'Какие модели доступны команде по агентам, какая модель и усилие стоят на уровнях low, medium и high и по какому прайсу считаются суммы. Версии идут по цепочке: черновик, активна, снята. Идущие прогоны остаются на своей версии настройки, новые захваты берут активную.';

export function AgentSettings({projectKey, me}: {projectKey: string; me: Me | undefined}) {
  const active = useResource(() => api.agentSettings(projectKey), [projectKey]);
  const versions = useResource(() => api.agentSettingsVersions(projectKey), [projectKey]);
  const draftItem = draftOf(versions.data);
  const draftNo = draftItem?.version;
  const draft = useResource(
    () => (draftNo ? api.agentSettingsVersion(projectKey, draftNo).then(normalizeView) : Promise.resolve(undefined)),
    [projectKey, draftNo],
  );

  // Право — подсказка интерфейса, решает сервер; состав команд проекта нужен,
  // только если прямого права нет.
  const needTeams = Boolean(me) && isHuman(me) && me?.mode !== 'header' && needsProjectTeams(me, projectKey);
  const teams = useResource(
    () => (needTeams ? api.listProjectTeams(projectKey) : Promise.resolve(undefined)),
    [projectKey, needTeams],
  );
  const canEdit = canEditAgentSettings({me, projectKey, projectTeams: needTeams ? teams.data : undefined});

  const [notice, setNotice] = useState<Notice | null>(null);
  const [orphan, setOrphan] = useState<Orphan | null>(null);
  const [dirty, setDirty] = useState(false);
  const guard = useLeaveGuard(dirty);

  // Фокус после действия: заголовок нужного блока, когда чтение закончилось.
  const pendingFocus = useRef<string | null>(null);
  const loading = active.loading || versions.loading || draft.loading;
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id || loading) return;
    const el = document.getElementById(id) ?? document.querySelector<HTMLElement>(`[data-path="${id}"]`);
    if (el) {
      el.focus();
      pendingFocus.current = null;
    }
  });

  const reload = () => {
    active.reload();
    versions.reload();
    draft.reload();
  };

  const oldServer = active.error?.code === 'not_found' && isAbsent(active.error.details);
  const activeView = active.data ? activeOf(active.data) : null;

  let body: React.ReactNode;
  if (oldServer) {
    body = (
      <Note
        tone="warning"
        title="Сервер не знает настройки агентов"
        description="Обновите сервер до версии, в которой есть настройка агентов проекта. Остальные разделы страницы работают.">
        <Button type="button" variant="outline" size="sm" onClick={reload}>
          Проверить снова
        </Button>
      </Note>
    );
  } else if (active.error) {
    body = <Failure error={active.error} title="Настройка агентов не загрузилась" reload={active.reload} />;
  } else if (!active.data) {
    body = <Loading label="Загрузка настройки агентов" />;
  } else {
    body = (
      <>
        {canEdit ? null : (
          <Note tone="info" title={READ_ONLY_TITLE} description={readOnlyText(isHuman(me))} />
        )}
        <div className="space-y-3" data-block="active">
          <h3 id="agent-settings-active-title" tabIndex={-1} className="text-sm font-semibold outline-none">
            Действующая версия
          </h3>
          {activeView ? (
            <Card className="gap-3 p-4" data-active-version={activeView.version}>
              <VersionView view={activeView} />
            </Card>
          ) : (
            <Card className="gap-3 p-4" data-active-version="none">
              <EmptyState
                title="Настройки агентов нет"
                description="Пока нет активной версии, агенты берут таблицу привязки по умолчанию, а суммы считаются так, как их сообщил агент."
              />
              <ul className="list-disc space-y-0.5 pl-5 text-sm" data-defaults>
                {DEFAULT_BINDINGS.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <DraftBlock
          projectKey={projectKey}
          canEdit={canEdit}
          active={activeView}
          versions={versions}
          draftItem={draftItem}
          draft={draft}
          notice={notice}
          orphan={orphan}
          onNotice={setNotice}
          onOrphan={setOrphan}
          onReload={reload}
          onCreated={() => {
            setNotice(null);
            pendingFocus.current = 'agent-settings-draft-title';
            reload();
          }}
          onActivated={() => {
            setNotice(null);
            pendingFocus.current = 'agent-settings-active-title';
            reload();
          }}
          onDiscarded={() => {
            setNotice(null);
            pendingFocus.current = 'create.from';
            reload();
          }}
          onDirtyChange={setDirty}
        />
        <History projectKey={projectKey} versions={versions} active={activeView} />
      </>
    );
  }

  return (
    <div id="agent-settings">
      <Section
        title="Агенты и модели"
        description={DESCRIPTION}
        actions={
          <Button type="button" variant="outline" size="sm" onClick={reload} aria-label="Обновить настройку агентов">
            <RefreshCw /> Обновить
          </Button>
        }>
        {body}
      </Section>
      {guard}
    </div>
  );
}

// 404 маршрута у сервера без ручек клиент помечает agentSettings: false.
function isAbsent(details: unknown): boolean {
  return typeof details === 'object' && details !== null && (details as {agentSettings?: unknown}).agentSettings === false;
}
