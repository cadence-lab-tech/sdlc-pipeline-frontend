import {useState} from 'react';
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
import {FormLayout} from '@/components/fields';
import {DataTable} from '@/components/DataTable';
import {CodeBlock, ConfirmButton, EmptyState, Note, Timestamp, Token, type TokenColor} from '@/components/kit';

import {ApiError, api} from '../api/client';
import type {Invite, IssuedInvite} from '../api/types';
import type {Resource} from '../api/useResource';
import {Failure, Loaded} from './Feedback';

// Приглашения ссылкой (решение 0035): выдача и список у проекта и у команды.
// Экраны различаются только полями формы и колонкой «Кому», поэтому диалог и
// таблица общие. Права, срок и допустимые роли проверяет бэкенд — здесь его
// ответ только показывается.

// Ссылка собирается из адреса, с которого открыт интерфейс: по какому имени к
// нему пришли, знает браузер, а не бэкенд.
function inviteLink(token: string): string {
  return `${window.location.origin}/invite/${token}`;
}

// Диалог выдачи: сначала форма, после выдачи — ссылка. Токен живёт только в
// состоянии открытого диалога: закрыли — забыли. В хранилище браузера, в адрес
// и в список он не попадает, а в базе лежит только хеш — второй раз ссылку не
// показать, потерянную отзывают и выдают новую.
export function InviteDialog({
  title,
  description,
  issue,
  onIssued,
  children,
}: {
  title: string;
  description: string;
  // Выдача с полями вызывающего; ошибка бэкенда остаётся в диалоге.
  issue: () => Promise<IssuedInvite>;
  // Наружу уходит только «список изменился», без токена.
  onIssued: () => void;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [link, setLink] = useState<string>();
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);

  const openChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setLink(undefined);
      setError(undefined);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const issued = await issue();
      setLink(inviteLink(issued.token));
      toast.success('Приглашение выдано');
      onIssued();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={openChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          Пригласить
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {link ? (
          <>
            <Note
              tone="warning"
              title="Ссылка показывается один раз"
              description="Скопируйте её сейчас и передайте тому, кого зовёте: после закрытия окна ссылка больше не покажется. Потерялась — отзовите приглашение и выдайте новое.">
              <CodeBlock code={link} title="ссылка-приглашение" />
            </Note>
            <DialogFooter>
              <Button onClick={() => openChange(false)}>Готово</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            {error ? <Failure error={error} title="Приглашение не выдано" /> : null}
            <FormLayout>{children}</FormLayout>
            <DialogFooter>
              <Button variant="ghost" onClick={() => openChange(false)}>
                Отмена
              </Button>
              <Button disabled={busy} onClick={submit}>
                Выдать ссылку
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Список приглашений цели в порядке бэкенда (новые сверху). Ошибка списка —
// например, у мейнтейнера нет на него прав — показывается на месте списка и
// остальную страницу не роняет; кнопка выдачи при этом остаётся.
export function InvitesTable({
  invites,
  target,
  actions,
}: {
  invites: Resource<Invite[]>;
  // Колонка «Кому»: у проекта — уровень и роли, у команды — роль в команде.
  target: (invite: Invite) => React.ReactNode;
  actions?: React.ReactNode;
}) {
  const [error, setError] = useState<ApiError>();

  const revoke = async (id: string) => {
    setError(undefined);
    try {
      await api.revokeInvite(id);
      toast.success('Приглашение отозвано');
      invites.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    }
  };

  return (
    <section aria-label="Приглашения" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">Приглашения</h3>
        {actions}
      </div>
      {error ? <Failure error={error} title="Приглашение не отозвано" /> : null}
      <Loaded resource={invites}>
        {(list) => (
          <DataTable<Invite>
            data={list}
            idKey="id"
            empty={
              <EmptyState
                title="Приглашений нет"
                description="Выданное приглашение появится здесь; сама ссылка показывается один раз, при выдаче"
              />
            }
            columns={[
              {key: 'target', header: 'Кому', renderCell: target},
              {key: 'status', header: 'Статус', width: 140, renderCell: (i) => <StatusCell invite={i} />},
              {
                key: 'created_by_handle',
                header: 'Выдал',
                renderCell: (i) => <Who handle={i.created_by_handle} at={i.created_at} />,
              },
              {key: 'expires_at', header: 'Срок', width: 170, renderCell: (i) => <Timestamp value={i.expires_at} />},
              {
                key: 'accepted_by_handle',
                header: 'Принял',
                renderCell: (i) => (i.accepted_by_handle ? <Who handle={i.accepted_by_handle} at={i.accepted_at} /> : '—'),
              },
              {
                key: 'actions',
                header: '',
                width: 110,
                align: 'end',
                // Отозвать можно только ещё не принятое и не протухшее — это
                // статус протокола, а не права: права проверит бэкенд.
                renderCell: (i) =>
                  i.status === 'pending' ? (
                    <ConfirmButton
                      title="Отозвать приглашение?"
                      description={<>Ссылка, выданная {i.created_by_handle}, перестанет открываться; принять её будет нельзя</>}
                      onConfirm={() => revoke(i.id)}>
                      Отозвать
                    </ConfirmButton>
                  ) : null,
              },
            ]}
          />
        )}
      </Loaded>
    </section>
  );
}

function Who({handle, at}: {handle: string; at?: string}) {
  return (
    <div className="space-y-0.5">
      <div>{handle}</div>
      {at ? <Timestamp value={at} className="text-xs" /> : null}
    </div>
  );
}

function StatusCell({invite}: {invite: Invite}) {
  const {label, color} = inviteStatus(invite.status);
  return (
    <div className="space-y-0.5">
      <Token label={label} color={color} />
      {invite.revoked_by_handle ? (
        <p className="text-muted-foreground text-xs">отозвал {invite.revoked_by_handle}</p>
      ) : null}
    </div>
  );
}

// Подпись статуса. Статус — перечень протокола (domain.InviteStatus), а не
// данные проекта, поэтому словарь живёт рядом с таблицей. Незнакомое значение
// значит, что бэкенд новее интерфейса: показать как есть, а не прятать.
function inviteStatus(status: Invite['status']): {label: string; color: TokenColor} {
  switch (status) {
    case 'pending':
      return {label: 'выдан', color: 'blue'};
    case 'accepted':
      return {label: 'принят', color: 'green'};
    case 'expired':
      return {label: 'протух', color: 'orange'};
    case 'revoked':
      return {label: 'отозван', color: 'default'};
    default:
      return {label: String(status), color: 'default'};
  }
}
