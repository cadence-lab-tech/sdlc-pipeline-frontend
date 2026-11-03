import {api} from '../api/client';
import {useResource} from '../api/useResource';
import {computeRights, rightsNeedTeams, type RoleRights} from '../components/pipeline/proposalRules';

// Права человека на роли проекта (CLAB-384, решение 0072) — подсказка
// интерфейса для кнопок «Новая версия», «Предложить версию», «Утвердить»,
// «Отклонить…» и «Отозвать…»; решает сервер. Правила — computeRights; здесь
// только загрузка того, что им нужно: кто я и, если прямого права нет,
// состав команд проекта (образец — useTaskLevelEditable).
//
// undefined — права не известны: кто я не загрузился, режим header или нужный
// состав команд не пришёл. Интерфейс тогда показывает прежние кнопки.
export function useRoleRights(projectKey: string, ownerTeamKey?: string): RoleRights | undefined {
  const me = useResource(() => api.me(), []);
  const needTeams = Boolean(projectKey) && rightsNeedTeams(me.data, projectKey, ownerTeamKey);
  const teams = useResource(
    () => (needTeams ? api.listProjectTeams(projectKey) : Promise.resolve(undefined)),
    [projectKey, needTeams],
  );
  return computeRights({
    me: me.data,
    projectKey,
    ownerTeamKey,
    projectTeams: needTeams ? teams.data : undefined,
  });
}
