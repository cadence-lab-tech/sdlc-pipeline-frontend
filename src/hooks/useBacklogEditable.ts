import {useCallback} from 'react';

import {api} from '../api/client';
import {useResource} from '../api/useResource';
import {canEditBacklog, needsTeams} from '../components/backlog/rules';

// Может ли человек двигать порядок бэклога и менять приоритет в строке
// (решение 0075, design.spec CLAB-368 §5.5) — подсказка интерфейса, решает
// сервер. Правила — canEditBacklog; здесь загрузка того, что им нужно: кто я
// и, если прямого права нет, состав команд проекта. recheck — перечитать оба
// после отказа 403: страница переходит в вид без правки, если права нет.
export function useBacklogEditable(
  projectKey: string,
  ownerTeamKey: string | undefined,
): {editable: boolean; recheck: () => void} {
  const me = useResource(() => api.me(), [projectKey]);
  const needTeams = Boolean(projectKey) && needsTeams(me.data, projectKey, ownerTeamKey);
  const teams = useResource(
    () => (needTeams ? api.listProjectTeams(projectKey) : Promise.resolve(undefined)),
    [projectKey, needTeams],
  );
  const reloadMe = me.reload;
  const reloadTeams = teams.reload;
  const recheck = useCallback(() => {
    reloadMe();
    reloadTeams();
  }, [reloadMe, reloadTeams]);
  return {
    editable: canEditBacklog({
      me: me.data,
      projectKey,
      ownerTeamKey,
      projectTeams: needTeams ? teams.data : undefined,
    }),
    recheck,
  };
}
