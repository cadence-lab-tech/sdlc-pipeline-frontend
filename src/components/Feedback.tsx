import {Banner} from '@astryxdesign/core/Banner';
import {Center} from '@astryxdesign/core/Center';
import {Spinner} from '@astryxdesign/core/Spinner';

import type {ApiError} from '../api/client';
import type {Resource} from '../api/useResource';

export function Loading({label = 'Загрузка'}: {label?: string}) {
  return (
    <Center padding={8}>
      <Spinner size="lg" label={label} />
    </Center>
  );
}

// Сообщение бэкенда показывается как есть: оно уже написано для человека, а
// код ошибки общий у REST и MCP, так что разбирать текст не нужно.
export function Failure({error, title = 'Не получилось'}: {error: ApiError; title?: string}) {
  return <Banner status="error" title={title} description={error.message} />;
}

// Ресурс отрисовывается только когда он загружен: до этого спиннер, при
// ошибке — баннер. Иначе каждая страница пишет одно и то же трижды.
export function Loaded<T>({resource, children}: {resource: Resource<T>; children: (data: T) => React.ReactNode}) {
  if (resource.error) return <Failure error={resource.error} />;
  if (!resource.data) return <Loading />;
  return <>{children(resource.data)}</>;
}
