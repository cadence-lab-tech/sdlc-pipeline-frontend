import {ChevronDown} from 'lucide-react';

import {cn} from '@/lib/utils';
import {Badge} from '@/components/ui/badge';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible';

import {useCollapsed} from '../../hooks/useCollapsed';

// Второстепенная секция правой панели: сворачивается по клику на заголовок, и
// свёрнутость переживает перезагрузку. Заголовок остаётся <h2> — по тексту
// раздел ищут и программы чтения с экрана, и сквозные сценарии.
export function CollapsibleSection({
  name,
  title,
  count,
  children,
}: {
  // Ключ, под которым запоминается свёрнутость. Один на все карточки.
  name: string;
  title: React.ReactNode;
  // Счётчик в заголовке: при нуле его нет — пустая цифра только шумит.
  count?: number;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useCollapsed(name);

  return (
    <Collapsible open={!collapsed} onOpenChange={(open) => setCollapsed(!open)}>
      <h2 className="text-base font-semibold">
        <CollapsibleTrigger className="hover:text-foreground/80 flex w-full items-center gap-2 text-left transition-colors">
          {title}
          {count ? <Badge variant="secondary">{count}</Badge> : null}
          <ChevronDown
            className={cn('text-muted-foreground ml-auto size-4 transition-transform', collapsed && '-rotate-90')}
          />
        </CollapsibleTrigger>
      </h2>
      <CollapsibleContent className="space-y-3 pt-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}
