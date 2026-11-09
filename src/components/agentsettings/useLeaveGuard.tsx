import {useEffect, useRef, useState} from 'react';
import {useNavigate} from 'react-router-dom';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// Предупреждение об уходе со страницы с несохранёнными правками (design.spec
// §5.6). Приложение на BrowserRouter, useBlocker требует data router, поэтому:
//  - закрытие и перезагрузка вкладки, внешняя навигация — beforeunload;
//  - переход по внутренним ссылкам — перехват клика по <a href="/…"> в
//    capture-фазе на document, пока есть правки.
// Кнопку «Назад» браузера внутри приложения перехватить нельзя: черновик на
// сервере цел, правки с последнего «Сохранить» теряются. Буфер нигде не
// хранится (в нём может быть секрет).

// Внутренняя ли ссылка, по которой стоит спросить: путь приложения, не новая
// вкладка, без модификаторов и скачивания.
export function internalHref(a: HTMLAnchorElement, ev: MouseEvent): string | undefined {
  if (ev.defaultPrevented || ev.button !== 0) return undefined;
  if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return undefined;
  if (a.target && a.target !== '_self') return undefined;
  if (a.hasAttribute('download')) return undefined;
  const href = a.getAttribute('href');
  if (!href || !href.startsWith('/') || href.startsWith('//')) return undefined;
  return href;
}

export function useLeaveGuard(active: boolean): React.ReactNode {
  const navigate = useNavigate();
  const [pending, setPending] = useState<string>();
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const onClick = (e: MouseEvent) => {
      if (!activeRef.current) return;
      const a = (e.target as Element | null)?.closest?.('a');
      if (!a) return;
      const href = internalHref(a as HTMLAnchorElement, e);
      if (!href) return;
      e.preventDefault();
      e.stopPropagation();
      setPending(href);
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [active]);

  return (
    <AlertDialog open={pending !== undefined} onOpenChange={(o) => !o && setPending(undefined)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Уйти без сохранения?</AlertDialogTitle>
          <AlertDialogDescription>Несохранённые правки черновика агентов пропадут.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Остаться</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              const to = pending;
              setPending(undefined);
              if (to) navigate(to);
            }}>
            Уйти
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
