import {useEffect, useState} from 'react';

import {ApiError, api, type FileContent} from '../api/client';
import type {UUID} from '../api/types';

const toError = (err: unknown) => (err instanceof ApiError ? err : new ApiError('internal', String(err)));

// Содержимое, которое плитка уже запросила: на время её жизни, а не страницы.
// Открыли модалку, закрыли, открыли снова — запроса нет, и крупный артефакт
// из внешнего хранилища не тянется дважды. Живой опрос карточки плитку не
// пересоздаёт (ключ — id артефакта), поэтому и он запросов не добавляет.
// Кэшируется обещание, а не результат: два одновременных чтения (StrictMode,
// быстрый повтор) делят один запрос. Неудавшееся обещание из кэша уходит —
// повтор должен сходить в сеть заново.
export class ContentCache {
  private texts = new Map<UUID, Promise<string>>();
  private files = new Map<UUID, Promise<FileContent>>();

  text(id: UUID): Promise<string> {
    return this.cached(this.texts, id, () => api.artifactContent(id));
  }

  file(id: UUID): Promise<FileContent> {
    return this.cached(this.files, id, () => api.artifactFile(id));
  }

  private cached<T>(map: Map<UUID, Promise<T>>, id: UUID, load: () => Promise<T>): Promise<T> {
    let p = map.get(id);
    if (!p) {
      p = load();
      map.set(id, p);
      p.catch(() => map.delete(id));
    }
    return p;
  }
}

// Текст артефакта для модалки: грузится при открытии (монтировании), а не при
// показе плиток. Состояние принадлежит id — при смене версии прежний текст не
// показывается.
export function useCachedText(cache: ContentCache, id: UUID, enabled: boolean) {
  const [state, setState] = useState<{id: UUID; text?: string; error?: ApiError}>();
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    cache.text(id).then(
      (text) => live && setState({id, text}),
      (err) => live && setState({id, error: toError(err)}),
    );
    return () => {
      live = false;
    };
  }, [cache, id, enabled]);
  return state?.id === id ? state : undefined;
}
