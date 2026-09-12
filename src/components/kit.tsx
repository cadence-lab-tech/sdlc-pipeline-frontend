import {useState} from 'react';
import {Check, Copy, Loader2} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import {cn} from '@/lib/utils';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';

// Мелочь, которой в shadcn нет: пустые состояния, метки-жетоны, точки статуса,
// время, блок кода и разметка. Всё остальное берётся из components/ui.

// ── раскладка ───────────────────────────────────────────────────────────────

export function Page({className, children}: {className?: string; children: React.ReactNode}) {
  return <div className={cn('mx-auto w-full max-w-7xl p-6', className)}>{children}</div>;
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

// Section — заголовок с действиями и телом. Заголовок остаётся <h2>: e2e и
// программы чтения с экрана ищут раздел по тексту, а не по классу.
export function Section({
  title,
  description,
  actions,
  className,
  children,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn('space-y-3', className)}>
      {title || actions ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-0.5">
            {title ? <h2 className="text-base font-semibold">{title}</h2> : null}
            {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

// Row — строка списка: плотная, кликабельная, с местом слева и справа.
export function Row({
  onClick,
  isSelected,
  start,
  end,
  className,
  children,
}: {
  onClick?: () => void;
  isSelected?: boolean;
  start?: React.ReactNode;
  end?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 px-3 py-2 text-left text-sm',
        onClick && 'hover:bg-accent/60 cursor-pointer transition-colors',
        isSelected && 'bg-accent',
        className,
      )}>
      {start}
      <div className="min-w-0 flex-1">{children}</div>
      {end ? <div className="flex shrink-0 items-center gap-2">{end}</div> : null}
    </Tag>
  );
}

export function RowList({className, children}: {className?: string; children: React.ReactNode}) {
  return (
    <div className={cn('divide-border overflow-hidden rounded-lg border divide-y', className)}>
      {children}
    </div>
  );
}

// ── состояния ───────────────────────────────────────────────────────────────

export function EmptyState({
  title,
  description,
  action,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {description ? <p className="text-muted-foreground max-w-md text-sm">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

// Note — сообщение в рамке с оттенком по смыслу. Оттенков четыре, и они
// отражают исход, а не важность: успех, предупреждение, отказ, пояснение.
export type NoteTone = 'info' | 'success' | 'warning' | 'error';

const NOTE: Record<NoteTone, string> = {
  info: '',
  success: 'border-emerald-500/40 text-emerald-800 dark:text-emerald-200',
  warning: 'border-amber-500/40 text-amber-800 dark:text-amber-200',
  error: 'border-red-500/40 text-red-800 dark:text-red-200',
};

export function Note({
  tone = 'info',
  title,
  description,
  children,
}: {
  tone?: NoteTone;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn('space-y-2 rounded-lg border p-3 text-sm', NOTE[tone])}>
      <p className="font-medium">{title}</p>
      {description ? <p className="opacity-90">{description}</p> : null}
      {children}
    </div>
  );
}

export function Spinner({className}: {className?: string}) {
  return <Loader2 className={cn('size-4 animate-spin', className)} />;
}

// ── метки ───────────────────────────────────────────────────────────────────

export type DotVariant = 'success' | 'warning' | 'error' | 'accent' | 'neutral';

const DOT: Record<DotVariant, string> = {
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  error: 'bg-red-500',
  accent: 'bg-blue-500',
  neutral: 'bg-muted-foreground',
};

export function StatusDot({variant = 'neutral', label}: {variant?: DotVariant; label?: React.ReactNode}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className={cn('size-2 shrink-0 rounded-full', DOT[variant])} />
      {label}
    </span>
  );
}

export type TokenColor = 'default' | 'blue' | 'orange' | 'green' | 'red';

const TOKEN: Record<TokenColor, string> = {
  default: '',
  blue: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  orange: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  green: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  red: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
};

// Token — короткая метка: ключ, версия, признак. Не кнопка и не ссылка.
export function Token({
  label,
  color = 'default',
  className,
}: {
  label: React.ReactNode;
  color?: TokenColor;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn('font-normal', TOKEN[color], className)}>
      {label}
    </Badge>
  );
}

// ── время ───────────────────────────────────────────────────────────────────

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000],
  ['month', 2592000],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
];

const relative = new Intl.RelativeTimeFormat('ru', {numeric: 'auto'});
const absolute = new Intl.DateTimeFormat('ru', {dateStyle: 'medium', timeStyle: 'short'});
// Только часы и минуты: там, где дата уже сказана заголовком дня, повторять её
// в каждой строке незачем.
const clock = new Intl.DateTimeFormat('ru', {timeStyle: 'short'});

function formatRelative(iso: string): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return relative.format(Math.round(seconds), 'second');
}

// Timestamp всегда показывает точное время в подсказке: относительное удобно
// читать, но спорить по нему о порядке событий нельзя.
export function Timestamp({
  value,
  format = 'absolute',
  className,
}: {
  value: string;
  format?: 'absolute' | 'relative' | 'time';
  className?: string;
}) {
  const date = new Date(value);
  const exact = absolute.format(date);
  return (
    <time dateTime={value} title={exact} className={cn('text-muted-foreground text-sm', className)}>
      {format === 'relative' ? formatRelative(value) : format === 'time' ? clock.format(date) : exact}
    </time>
  );
}

// ── содержимое ──────────────────────────────────────────────────────────────

export function CodeBlock({
  code,
  language = 'plaintext',
  title,
  maxHeight,
}: {
  code: string;
  language?: string;
  title?: string;
  maxHeight?: number;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="bg-muted/50 flex items-center justify-between gap-2 border-b px-3 py-1.5">
        <span className="text-muted-foreground font-mono text-xs">{title ?? language}</span>
        <Button size="icon-sm" variant="ghost" onClick={copy} aria-label="Скопировать">
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
      {/* Класс code-block оформления не несёт — это опора для сквозных
          сценариев: по нему они находят блок кода на экране. */}
      <pre
        className="code-block overflow-auto p-3 text-xs leading-relaxed"
        data-language={language}
        style={maxHeight ? {maxHeight} : undefined}>
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  );
}

// Разметка артефактов, постановки задач и инструкций ролей. Сырой HTML не
// включается (никакого rehype-raw): текст пишут агенты, и исполнять его в
// чужом браузере незачем — react-markdown экранирует его сам.
export function Markdown({children, className}: {children: string; className?: string}) {
  return (
    <div className={cn('prose-sdlc text-sm', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{a: MarkdownLink}}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

// Ссылка наружу открывается в новой вкладке и с noopener: без него открытая
// страница получает доступ к window.opener. Ссылки внутрь приложения ведут
// себя обычно — уводить из текущей вкладки на свои же экраны не нужно.
function MarkdownLink({href, children, ...rest}: React.ComponentProps<'a'>) {
  const external = Boolean(href && /^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith(window.location.origin));
  return (
    <a href={href} {...rest} {...(external ? {target: '_blank', rel: 'noopener noreferrer'} : {})}>
      {children}
    </a>
  );
}
