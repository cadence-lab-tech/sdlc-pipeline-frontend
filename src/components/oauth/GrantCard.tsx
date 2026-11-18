import { ConfirmButton, Timestamp, Token } from "@/components/kit";
import { Badge } from "@/components/ui/badge";

import type { OAuthGrant } from "../../api/types";
import {
  NO_CLIENT_NAME,
  clientName,
  disconnectText,
  grantScopeAll,
  revokeReasonText,
} from "./rules";

// Карточка подключённого клиента. Карточки, а не таблица: имя и хост
// приходят от недоверенной стороны и бывают длинными, а таблица на 375 px
// дала бы горизонтальную прокрутку. Значения выводятся текстом и переносятся
// по символам, без обрезки.
export function GrantCard({
  grant,
  onRevoke,
}: {
  grant: OAuthGrant;
  onRevoke: (grant: OAuthGrant) => Promise<unknown>;
}) {
  const name = clientName(grant.client_name);
  const revoked = Boolean(grant.revoked_at);
  const reason = revokeReasonText(grant.revoke_reason);
  return (
    <li>
      <article
        data-oauth-grant={grant.id}
        data-oauth-grant-state={revoked ? "revoked" : "live"}
        className="bg-card grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-3 rounded-lg border p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
      >
        <div className="min-w-0 space-y-1">
          <h3 className="text-sm font-medium [overflow-wrap:anywhere]">
            {name ? (
              <bdi>{name}</bdi>
            ) : (
              <span className="text-muted-foreground italic">
                {NO_CLIENT_NAME}
              </span>
            )}
          </h3>
          <p className="font-mono text-[13px] break-all">
            {grant.redirect_host}
          </p>
        </div>
        <Badge variant="secondary" className="justify-self-end">
          {revoked ? "отозван" : "действует"}
        </Badge>
        <dl
          className={`col-span-full grid gap-3 text-sm ${revoked ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}
        >
          <Fact term="Где действует">
            {grant.project_key ? (
              <Token label={grant.project_key} />
            ) : (
              <span>{grantScopeAll}</span>
            )}
          </Fact>
          <Fact term="Подключён">
            <Timestamp value={grant.created_at} className="text-foreground" />
          </Fact>
          <Fact term="Последний запрос">
            <LastUsed value={grant.last_used_at} />
          </Fact>
          {revoked ? (
            <Fact term="Отозван">
              <Timestamp
                value={grant.revoked_at as string}
                className="text-foreground"
              />
            </Fact>
          ) : null}
        </dl>
        {revoked && reason ? (
          <p className="text-muted-foreground col-span-full text-sm [overflow-wrap:anywhere]">
            {reason}
          </p>
        ) : null}
        {!revoked ? (
          <ConfirmButton
            variant="outline"
            size="default"
            className="col-span-full h-11 w-full sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:h-8 sm:w-auto"
            triggerProps={{
              "aria-label": `Отключить: ${name ?? NO_CLIENT_NAME}`,
            }}
            title="Отключить клиент?"
            description={disconnectText(name, grant.redirect_host)}
            confirmLabel="Отключить"
            onConfirm={() => onRevoke(grant)}
          >
            Отключить
          </ConfirmButton>
        ) : null}
      </article>
    </li>
  );
}

function LastUsed({ value }: { value?: string }) {
  return value ? (
    <Timestamp value={value} format="relative" className="text-foreground" />
  ) : (
    <span>запросов не было</span>
  );
}

function Fact({
  term,
  children,
}: {
  term: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <dt className="text-muted-foreground text-xs">{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}
