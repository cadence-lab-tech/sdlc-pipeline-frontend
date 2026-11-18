import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { EmptyState, Page, PageHeader } from "@/components/kit";

import { ApiError, api } from "../api/client";
import type { OAuthGrant } from "../api/types";
import { useResource } from "../api/useResource";
import { Failure, Loaded, Loading } from "../components/Feedback";
import { GrantCard } from "../components/oauth/GrantCard";
import {
  NO_CLIENT_NAME,
  clientName,
  clientsAccess,
  partitionGrants,
  revokedOpenByDefault,
} from "../components/oauth/rules";
import { docsHref } from "../components/cli";
import { useInstance } from "../hooks/useInstance";

// Подключённые клиенты человека (CLAB-482): ИИ-клиенты, которым он разрешил
// действовать от своего имени. Страница инстанса, а не проекта: выдача
// бывает без проекта, а у человека без проектов вкладок проекта нет.
export function Clients() {
  const instance = useInstance();
  const access = clientsAccess(instance);
  return (
    <Page className="max-w-4xl">
      <PageHeader
        title="Подключённые клиенты"
        description="ИИ-клиенты, которым вы разрешили действовать от вашего имени: клиент работает с вашими правами. Отключите тот, которого не узнаёте."
      />
      {access === "pending" ? <Loading /> : null}
      {access === "disabled" ? (
        <EmptyState
          title="Подключение клиентов выключено на этом инстансе"
          description="Когда администратор включит подключение, здесь появятся клиенты, которым вы разрешите доступ."
        />
      ) : null}
      {/* Список монтируется только при включённом подключении: на выключенном
          инстансе запросов к /v1/oauth/grants нет вовсе. */}
      {access === "enabled" ? <ClientList /> : null}
    </Page>
  );
}

function ClientList() {
  const grants = useResource(() => api.listOAuthGrants(), []);
  const [error, setError] = useState<ApiError>();

  const revoke = async (grant: OAuthGrant) => {
    setError(undefined);
    try {
      await api.revokeOAuthGrant(grant.id);
      toast.success(
        `Клиент «${clientName(grant.client_name) ?? NO_CLIENT_NAME}» отключён`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError("internal", String(err)));
    } finally {
      // Перечитать в любом случае: 404 значит, что список устарел.
      grants.reload();
    }
  };

  return (
    <div className="space-y-4">
      {error ? <Failure error={error} title="Не получилось отключить клиент" /> : null}
      <Loaded resource={grants}>
        {(list) => <Grants list={list} onRevoke={revoke} />}
      </Loaded>
    </div>
  );
}

function Grants({
  list,
  onRevoke,
}: {
  list: OAuthGrant[];
  onRevoke: (grant: OAuthGrant) => Promise<unknown>;
}) {
  const { live, revoked } = partitionGrants(list);
  if (list.length === 0) {
    return (
      <EmptyState
        title="Подключённых клиентов нет"
        description="Когда вы разрешите ИИ-клиенту доступ, он появится здесь. Как подключить клиент — на странице «Подключение»."
        action={
          <Button asChild variant="outline">
            <Link to={docsHref()}>Как подключить клиент</Link>
          </Button>
        }
      />
    );
  }
  return (
    <>
      {live.length > 0 ? (
        <ul className="space-y-3" data-oauth-grants="live">
          {live.map((g) => (
            <GrantCard key={g.id} grant={g} onRevoke={onRevoke} />
          ))}
        </ul>
      ) : null}
      {revoked.length > 0 ? (
        <RevokedList revoked={revoked} onRevoke={onRevoke} liveCount={live.length} />
      ) : null}
    </>
  );
}

function RevokedList({
  revoked,
  liveCount,
  onRevoke,
}: {
  revoked: OAuthGrant[];
  liveCount: number;
  onRevoke: (grant: OAuthGrant) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(revokedOpenByDefault(liveCount));
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="space-y-3">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="-ml-2">
          <ChevronRight
            className={`transition-transform ${open ? "rotate-90" : ""}`}
            aria-hidden
          />
          {open ? "Скрыть" : "Показать"} отозванные ({revoked.length})
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="space-y-3" data-oauth-grants="revoked">
          {revoked.map((g) => (
            <GrantCard key={g.id} grant={g} onRevoke={onRevoke} />
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
