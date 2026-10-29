import {useState} from 'react';

import {Button} from '@/components/ui/button';

import {ApiError, api} from '../api/client';
import type {Artifact, StageRun} from '../api/types';
import {Failure} from './Feedback';
import {FileTile, type HistoryState} from './FileTile';
import {versionHistory} from './task/attachmentRules';
import {artifactAnchor, artifactItem, canApprove, type FileItem} from './task/fileItem';

const toError = (err: unknown) => (err instanceof ApiError ? err : new ApiError('internal', String(err)));

// Плитка артефакта этапа (CLAB-308). Артефакт иммутабелен: правка — новая
// версия через supersedes_id. Поэтому здесь нет редактирования, только
// чтение, копирование, скачивание и апрув — всё это в модалке, на плитке
// остаётся отметка «принят».
//
// Содержимое плитка не запрашивает: оно тянется при открытии модалки, потому
// что крупные артефакты лежат во внешнем хранилище. История прежних версий
// тоже запрашивается при открытии, и только у артефакта, который сам
// заменил прежний (supersedes_id): у первой версии прежних нет.
export function ArtifactTile({
  artifact,
  runs,
  taskKey,
  onChanged,
}: {
  artifact: Artifact;
  // Прогоны карточки: роль плитки берётся из прогона артефакта, в том числе
  // у прежних версий в истории.
  runs: StageRun[];
  taskKey: string;
  onChanged: () => void;
}) {
  const [history, setHistory] = useState<FileItem[]>([]);
  const [historyState, setHistoryState] = useState<HistoryState>();
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);
  // Принятие ушло, а карточка ещё не перезапрошена: кнопка не должна висеть.
  const [accepted, setAccepted] = useState(false);

  const item = artifactItem(artifact, runs);

  const loadHistory = async () => {
    if (!artifact.supersedes_id) return;
    setHistoryState({loading: true});
    try {
      const all = await api.listArtifacts(taskKey, {includeSuperseded: true});
      setHistory(versionHistory(all, artifact.id).map((a) => artifactItem(a, runs)));
      setHistoryState(undefined);
    } catch (err) {
      setHistoryState({error: toError(err)});
    }
  };

  const approve = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.approveArtifact(artifact.id);
      setAccepted(true);
      onChanged();
    } catch (err) {
      setError(toError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FileTile
      item={accepted ? {...item, approved: true} : item}
      history={history}
      historyState={historyState}
      attrs={{'data-artifact': artifact.id}}
      anchorId={artifactAnchor(artifact.id)}
      onOpenChange={(open) => {
        if (open) void loadHistory();
        else setError(undefined);
      }}
      actions={({item: shown, current}) =>
        canApprove(shown, current) && !accepted ? (
          <Button size="sm" variant="secondary" onClick={approve} disabled={busy}>
            Принять
          </Button>
        ) : null
      }
      notice={error ? <Failure error={error} title="Артефакт не принят" /> : null}
    />
  );
}
