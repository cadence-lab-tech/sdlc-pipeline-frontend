import {api} from '../api/client';
import {useResource} from '../api/useResource';
import {canEditTaskLevel, needsProjectTeams} from '../components/modelLevel';

// Может ли человек двигать уровень модели задачи и её этапов (решение 0060)
// — подсказка интерфейса для ползунков «Деталей» и панели этапа. Правила —
// canEditTaskLevel; здесь только загрузка того, что им нужно: кто я и, если
// прямого права нет, состав команд проекта. Хук один на карточку: страница
// зовёт его один раз и раздаёт ответ обоим ползункам, поэтому кто я и
// команды проекта не грузятся дважды.
//
// Пока ничего не известно (кто я не загрузился, ключа проекта ещё нет) —
// «можно»: решает сервер, и отказ покажется у ползунка.
export function useTaskLevelEditable(projectKey: string, ownerTeamKey: string | undefined): boolean {
  const me = useResource(() => api.me(), []);
  // Состав команд проекта нужен, только если прямого права нет: в режиме
  // header и у администратора системы лишнего запроса карточка не делает.
  const needTeams = Boolean(projectKey) && needsProjectTeams(me.data, projectKey, ownerTeamKey);
  const teams = useResource(
    () => (needTeams ? api.listProjectTeams(projectKey) : Promise.resolve(undefined)),
    [projectKey, needTeams],
  );
  return canEditTaskLevel({
    me: me.data,
    projectKey,
    ownerTeamKey,
    projectTeams: needTeams ? teams.data : undefined,
  });
}
