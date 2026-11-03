import {useCallback, useState} from 'react';

import {readBacklogSize, writeBacklogSize, type BacklogSize} from '../components/overview/zones';

// Число строк блока «Приоритетные из бэклога» (CLAB-366): настройка вида по
// проекту, как свёрнутость секций (useCollapsed), но под своим ключом.
// Правила чтения и записи — в zones.ts, где их проверяют без браузера.
export function useBacklogSize(projectKey: string): [BacklogSize, (size: BacklogSize) => void] {
  const [state, setState] = useState(() => ({projectKey, size: readBacklogSize(() => window.localStorage, projectKey)}));

  // Другой проект — своё значение.
  let current = state;
  if (state.projectKey !== projectKey) {
    current = {projectKey, size: readBacklogSize(() => window.localStorage, projectKey)};
    setState(current);
  }

  const set = useCallback(
    (size: BacklogSize) => {
      writeBacklogSize(() => window.localStorage, projectKey, size);
      setState({projectKey, size});
    },
    [projectKey],
  );
  return [current.size, set];
}
