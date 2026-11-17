import {useEffect, useRef, useState} from 'react';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {FormLayout, MultiSelector, NumberInput, TextInput} from '@/components/fields';
import {CodeBlock, Note} from '@/components/kit';

import {ApiError, api} from '../../api/client';
import type {Role} from '../../api/types';
import type {Resource} from '../../api/useResource';
import {Failure} from '../Feedback';
import {roleOptions} from './options';

// Выдача токена проекта (CLAB-39). Диалог в двух состояниях: форма и показ
// выданного токена. Токен приходит один раз, в базе лежит хеш, поэтому он
// живёт только в состоянии открытого диалога — не в localStorage и
// sessionStorage, не в адресе, не в списке, не в тосте. В показе закрывает
// только «Готово»: ни Esc, ни клик мимо, ни крестик (его в этом состоянии
// нет) — случайно закрытый токен показать второй раз нечем. Пока идёт запрос,
// диалог тоже не закрывается: токен, который уже некому показать, — худший
// исход. InviteDialog для приглашений не трогается.
export function IssueTokenDialog({
  projectKey,
  roles,
  onIssued,
}: {
  projectKey: string;
  roles: Resource<Role[]>;
  // Наружу уходит только «список изменился», без токена.
  onIssued: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{name: string; token: string}>();

  const close = () => {
    setIssued(undefined);
    setOpen(false);
  };
  const shown = issued !== undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && (busy || shown)) return;
        setOpen(next);
      }}>
      <DialogTrigger asChild>
        <Button size="sm">Выдать токен</Button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-[560px]"
        showCloseButton={!shown}
        onEscapeKeyDown={(e) => (busy || shown) && e.preventDefault()}
        onPointerDownOutside={(e) => (busy || shown) && e.preventDefault()}
        onInteractOutside={(e) => (busy || shown) && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{issued ? `Токен «${issued.name}» выдан` : 'Выдать токен'}</DialogTitle>
          <DialogDescription>
            {issued ? 'Выданный токен показан ниже.' : `Токен действует в проекте ${projectKey}. Показывается один раз.`}
          </DialogDescription>
        </DialogHeader>
        {issued ? (
          <>
            <Shown token={issued.token} />
            <DialogFooter>
              <Button type="button" onClick={close}>
                Готово
              </Button>
            </DialogFooter>
          </>
        ) : (
          <IssueForm
            projectKey={projectKey}
            roles={roles}
            busy={busy}
            setBusy={setBusy}
            onIssued={(name, token) => {
              setIssued({name, token});
              onIssued();
            }}
            onCancel={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// Блок показа: role="status" объявляет предупреждение, фокус уходит на него —
// форма с кнопкой «Выдать» исчезла, и без этого фокус терялся бы на body.
function Shown({token}: {token: string}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div ref={ref} role="status" tabIndex={-1} className="outline-none" data-token-shown="">
      <Note
        tone="warning"
        title="Токен показывается один раз"
        description="Скопируйте его сейчас: после закрытия окна токен больше не покажется, в базе лежит только хеш. Потерялся — отзовите токен и выдайте новый.">
        <CodeBlock code={token} title="токен" />
      </Note>
    </div>
  );
}

function IssueForm({
  projectKey,
  roles,
  busy,
  setBusy,
  onIssued,
  onCancel,
}: {
  projectKey: string;
  roles: Resource<Role[]>;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onIssued: (name: string, token: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [principal, setPrincipal] = useState('');
  const [roleKeys, setRoleKeys] = useState<string[]>([]);
  const [days, setDays] = useState<number>();
  const [error, setError] = useState<ApiError>();

  // Список ролей не загрузился: сузить токен нельзя, а молча выдать его на
  // любые роли вместо задуманного хуже отказа.
  const rolesFailed = roles.error !== undefined;

  const submit = async () => {
    const label = name.trim();
    if (label === '' || busy || rolesFailed) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await api.issueToken({
        name: label,
        principal: principal.trim() || undefined,
        project: projectKey,
        role_keys: roleKeys,
        expires_in_days: days,
      });
      toast.success(`Токен ${label} выдан`);
      setBusy(false);
      onIssued(label, res.token);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}>
      {error ? <Failure error={error} title="Токен не выдан" /> : null}
      {roles.error ? <Failure error={roles.error} title="Роли проекта не загрузились" reload={roles.reload} /> : null}
      <FormLayout>
        <TextInput
          label="Имя"
          description="по нему токен потом отзывают"
          value={name}
          onChange={setName}
          isRequired
        />
        <TextInput
          label="Кому"
          description="пусто — себе; agent:reviewer-bot — агенту (нужен уровень admin в проекте)"
          value={principal}
          onChange={setPrincipal}
        />
        <MultiSelector
          label="Роли специалистов"
          description="агент с этим токеном сможет забирать только их этапы; пусто — любые"
          options={roleOptions(roles.data ?? [])}
          value={roleKeys}
          onChange={setRoleKeys}
          placeholder="Любые роли"
        />
        <NumberInput label="Срок в днях" description="пусто — бессрочно" value={days} onChange={setDays} />
      </FormLayout>
      <DialogFooter>
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          Отмена
        </Button>
        <Button type="submit" disabled={busy || rolesFailed || name.trim() === ''}>
          Выдать
        </Button>
      </DialogFooter>
    </form>
  );
}
