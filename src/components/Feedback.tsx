import {AlertCircle} from 'lucide-react';

import {Alert, AlertDescription, AlertTitle} from '@/components/ui/alert';
import {Button} from '@/components/ui/button';
import {Spinner} from '@/components/kit';

import type {ApiError} from '../api/client';
import type {Resource} from '../api/useResource';

// role="status" объявляет загрузку программам чтения с экрана: aria-live у
// этой роли подразумевается, отдельно его ставить не нужно.
export function Loading({label = 'Загрузка'}: {label?: string}) {
  return (
    <div role="status" className="text-muted-foreground flex items-center justify-center gap-2 p-8 text-sm">
      <Spinner />
      {label}
    </div>
  );
}

// Сообщение бэкенда показывается как есть: оно уже написано для человека, а
// код ошибки общий у REST и MCP, так что разбирать текст не нужно.
//
// reload передаётся только для ошибок загрузки ресурса — тогда есть кнопка
// «Повторить». У ошибок действий (форма, диалог) повтор — это повторный клик
// по той же кнопке, и здесь они кнопки не получают.
export function Failure({
  error,
  title = 'Не получилось',
  reload,
}: {
  error: ApiError;
  title?: string;
  reload?: () => void;
}) {
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        {error.message}
        {reload ? (
          <div className="mt-2">
            <Button variant="outline" size="sm" onClick={reload}>
              Повторить
            </Button>
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

// Ресурс отрисовывается только когда он загружен: до этого спиннер, при
// ошибке — баннер с повтором. Иначе каждая страница пишет одно и то же трижды.
export function Loaded<T>({resource, children}: {resource: Resource<T>; children: (data: T) => React.ReactNode}) {
  if (resource.error) return <Failure error={resource.error} reload={resource.reload} />;
  if (!resource.data) return <Loading />;
  return <>{children(resource.data)}</>;
}
