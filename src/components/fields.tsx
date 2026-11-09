import {useId, useState} from 'react';
import {Check, ChevronsUpDown, X} from 'lucide-react';

import {cn} from '@/lib/utils';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList} from '@/components/ui/command';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {Switch as SwitchPrimitive} from '@/components/ui/switch';
import {Textarea} from '@/components/ui/textarea';

// Поля формы поверх компонентов shadcn. Единственное, что здесь важно
// соблюдать, — связка label[for] с id контрола: по ней поле находят и
// программы чтения с экрана, и сквозные сценарии.

export type Option = {value: string; label: string};

export function FormLayout({className, children}: {className?: string; children: React.ReactNode}) {
  return <div className={cn('space-y-4', className)}>{children}</div>;
}

function Field({
  id,
  label,
  description,
  isRequired,
  isLabelHidden,
  error,
  dataPath,
  children,
}: {
  id: string;
  label?: string;
  description?: React.ReactNode;
  isRequired?: boolean;
  isLabelHidden?: boolean;
  // Отказ сервера по этому полю: текст под полем, связан с контролом через
  // aria-describedby (id — errorId(id)). dataPath — опора сценариев.
  error?: string;
  dataPath?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      {label ? (
        // Скрытая подпись остаётся в разметке: по ней поле находят программы
        // чтения с экрана и сквозные сценарии.
        <Label htmlFor={id} className={cn(isLabelHidden && 'sr-only')}>
          {label}
          {isRequired ? <span className="text-muted-foreground"> *</span> : null}
        </Label>
      ) : null}
      {children}
      {description ? <p className="text-muted-foreground text-xs">{description}</p> : null}
      {error ? (
        <p id={errorId(id)} data-path={dataPath} className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// id подписи ошибки поля: контрол ссылается на него через aria-describedby.
function errorId(id: string): string {
  return `${id}-error`;
}

export function TextInput({
  label,
  description,
  value,
  onChange,
  onEnter,
  type = 'text',
  placeholder,
  isRequired,
  isDisabled,
  isLabelHidden,
  isInvalid,
  error,
  dataPath,
  inputMode,
  id: fixedId,
  className,
}: {
  label?: string;
  description?: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  onEnter?: () => void;
  type?: string;
  placeholder?: string;
  isRequired?: boolean;
  isDisabled?: boolean;
  isLabelHidden?: boolean;
  // Поле названо в отказе сервера: aria-invalid и красная рамка.
  isInvalid?: boolean;
  // Текст отказа под полем; задан — поле и так помечено недопустимым.
  error?: string;
  // Серверный путь поля (data-path на контроле и на подписи ошибки).
  dataPath?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  // Постоянный id — опора сценариев (#role-doc-name); по умолчанию useId.
  id?: string;
  className?: string;
}) {
  const autoId = useId();
  const id = fixedId ?? autoId;
  return (
    <Field
      id={id}
      label={label}
      description={description}
      isRequired={isRequired}
      isLabelHidden={isLabelHidden}
      error={error}
      dataPath={dataPath}>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={isDisabled}
        inputMode={inputMode}
        data-path={dataPath}
        aria-invalid={isInvalid || Boolean(error) || undefined}
        aria-describedby={error ? errorId(id) : undefined}
        className={className}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onEnter ? (e) => e.key === 'Enter' && onEnter() : undefined}
      />
    </Field>
  );
}

export function TextArea({
  label,
  description,
  value,
  onChange,
  rows = 4,
  placeholder,
  isRequired,
  isDisabled,
  isInvalid,
  error,
  dataPath,
  id: fixedId,
  className,
}: {
  label?: string;
  description?: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  isRequired?: boolean;
  isDisabled?: boolean;
  isInvalid?: boolean;
  error?: string;
  dataPath?: string;
  id?: string;
  className?: string;
}) {
  const autoId = useId();
  const id = fixedId ?? autoId;
  return (
    <Field
      id={id}
      label={label}
      description={description}
      isRequired={isRequired}
      error={error}
      dataPath={dataPath}>
      <Textarea
        id={id}
        rows={rows}
        className={className}
        disabled={isDisabled}
        data-path={dataPath}
        spellCheck={dataPath === undefined ? undefined : false}
        aria-invalid={isInvalid || Boolean(error) || undefined}
        aria-describedby={error ? errorId(id) : undefined}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

// Выбор файла: настоящий input type=file с подписью label[for]. Выбранный
// файл поле не хранит — им владеет форма.
export function FileInput({
  label,
  description,
  onChange,
  isRequired,
  isDisabled,
}: {
  label?: string;
  description?: string;
  onChange: (file: File | undefined) => void;
  isRequired?: boolean;
  isDisabled?: boolean;
}) {
  const id = useId();
  return (
    <Field id={id} label={label} description={description} isRequired={isRequired}>
      <Input id={id} type="file" disabled={isDisabled} onChange={(e) => onChange(e.target.files?.[0])} />
    </Field>
  );
}

// NumberInput отдаёт undefined на пустом поле: «не задано» и «ноль» — разные
// значения, и свойство задачи это различает.
export function NumberInput({
  label,
  description,
  value,
  onChange,
}: {
  label?: string;
  description?: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}) {
  const id = useId();
  return (
    <Field id={id} label={label} description={description}>
      <Input
        id={id}
        type="number"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    </Field>
  );
}

export function Selector({
  label,
  description,
  options,
  value,
  onChange,
  placeholder = 'Выберите',
  isDisabled,
  hasClear,
  isRequired,
  isLabelHidden,
  error,
  dataPath,
}: {
  label?: string;
  description?: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  isDisabled?: boolean;
  hasClear?: boolean;
  isRequired?: boolean;
  isLabelHidden?: boolean;
  error?: string;
  dataPath?: string;
}) {
  const id = useId();
  return (
    <Field
      id={id}
      label={label}
      description={description}
      isRequired={isRequired}
      isLabelHidden={isLabelHidden}
      error={error}
      dataPath={dataPath}>
      <div className="flex items-center gap-1">
        <Select value={value} onValueChange={onChange} disabled={isDisabled}>
          <SelectTrigger
            id={id}
            className="w-full"
            data-path={dataPath}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId(id) : undefined}>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasClear && value ? (
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => onChange('')} aria-label="Очистить">
            <X />
          </Button>
        ) : null}
      </div>
    </Field>
  );
}

// MultiSelector — список с галочками в поповере. Выбранное показывается
// жетонами: список репозиториев или ролей бывает длинным, и в одну строку
// он не помещается.
export function MultiSelector({
  label,
  description,
  options,
  value,
  onChange,
  placeholder = 'Выберите',
}: {
  label?: string;
  description?: string;
  options: Option[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  return (
    <Field id={id} label={label} description={description}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="h-auto min-h-9 w-full justify-between font-normal">
            <span className="flex flex-wrap gap-1">
              {value.length === 0 ? (
                <span className="text-muted-foreground">{placeholder}</span>
              ) : (
                value.map((v) => (
                  <Badge key={v} variant="secondary" className="font-normal">
                    {options.find((o) => o.value === v)?.label ?? v}
                  </Badge>
                ))
              )}
            </span>
            <ChevronsUpDown className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
          <Command>
            <CommandInput placeholder="Поиск" />
            <CommandList>
              <CommandEmpty>Ничего не найдено</CommandEmpty>
              <CommandGroup>
                {options.map((o) => (
                  <CommandItem key={o.value} value={o.label} onSelect={() => toggle(o.value)}>
                    <Check className={cn(value.includes(o.value) ? 'opacity-100' : 'opacity-0')} />
                    {o.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </Field>
  );
}

export function Switch({
  label,
  description,
  value,
  onChange,
  isDisabled = false,
  ...data
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  isDisabled?: boolean;
} & {[key: `data-${string}`]: string | number | undefined}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <SwitchPrimitive
        id={id}
        checked={value}
        onCheckedChange={onChange}
        disabled={isDisabled}
        className="mt-0.5"
        {...data}
      />
      <div className="space-y-0.5">
        <Label htmlFor={id}>{label}</Label>
        {description ? <p className="text-muted-foreground text-xs">{description}</p> : null}
      </div>
    </div>
  );
}
