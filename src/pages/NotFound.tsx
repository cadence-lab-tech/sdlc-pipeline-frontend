import {Link} from 'react-router-dom';

import {Button} from '@/components/ui/button';
import {EmptyState, Page} from '@/components/kit';

// Адрес, которого нет в приложении (CLAB-357). Старые /p/:key/roles и
// /p/:key/workflow попадают сюда же: перенаправлений нет (решение 0068 §7,
// решение человека 2026-11-02). Страница стоит в оболочке, поэтому меню на
// месте, а выйти можно по ссылке на проекты.
export function NotFound() {
  return (
    <Page>
      <div data-not-found>
        <EmptyState
          title="Страница не найдена"
          description="Такого адреса в приложении нет. Возможно, ссылка устарела или в ней опечатка."
          action={
            <Button asChild variant="outline">
              <Link to="/projects">К проектам</Link>
            </Button>
          }
        />
      </div>
    </Page>
  );
}
