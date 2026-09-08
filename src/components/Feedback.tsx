import {AlertCircle} from 'lucide-react';

import {Alert, AlertDescription, AlertTitle} from '@/components/ui/alert';
import {Spinner} from '@/components/kit';

import type {ApiError} from '../api/client';
import type {Resource} from '../api/useResource';

export function Loading({label = 'Загрузка'}: {label?: string}) {
  return (
    <div className="text-muted-foreground flex items-center justify-center gap-2 p-8 text-sm">
      <Spinner />
      {label}
    </div>
  );
}

// Сообщение бэкенда показывается как есть: оно уже написано для человека, а
// код ошибки общий у REST и MCP, так что разбирать текст не нужно.
export function Failure({error, title = 'Не получилось'}: {error: ApiError; title?: string}) {
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{error.message}</AlertDescription>
    </Alert>
  );
}

// Ресурс отрисовывается только когда он загружен: до этого спиннер, при
// ошибке — баннер. Иначе каждая страница пишет одно и то же трижды.
export function Loaded<T>({resource, children}: {resource: Resource<T>; children: (data: T) => React.ReactNode}) {
  if (resource.error) return <Failure error={resource.error} />;
  if (!resource.data) return <Loading />;
  return <>{children(resource.data)}</>;
}
