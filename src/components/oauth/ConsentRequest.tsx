import { Plug, TriangleAlert } from "lucide-react";

import { Note, Timestamp } from "@/components/kit";

import type { OAuthConsent } from "../../api/types";
import { NO_CLIENT_NAME, clientName } from "./rules";

// Шапка страницы согласия: знак, заголовок и инстанс, к которому выдаётся
// доступ. Знак тот же по форме, что у /login/cli.
export function ConsentHeader() {
  return (
    <div className="flex items-center gap-3">
      <div className="bg-primary text-primary-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
        <Plug className="size-5" aria-hidden />
      </div>
      <div className="grid min-w-0 leading-tight">
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">
          Подключение клиента
        </h1>
        <span className="text-muted-foreground text-xs [overflow-wrap:anywhere]">
          доступ к {window.location.host}
        </span>
      </div>
    </div>
  );
}

// Что просит клиент. Имя и хосты приходят от недоверенной стороны: выводятся
// только текстом, без разметки, ссылок и обрезки — обрезка скрыла бы подмену.
// Главный признак — хост адреса возврата, он крупнее и заголовка, и имени.
export function ConsentRequest({
  consent,
  showDeadline,
}: {
  consent: OAuthConsent;
  showDeadline: boolean;
}) {
  const name = clientName(consent.client_name);
  const who = `${consent.principal.kind}:${consent.principal.handle}`;
  const project = consent.project_key
    ? consent.project_name
      ? `${consent.project_name} · ${consent.project_key}`
      : consent.project_key
    : "все ваши проекты";
  return (
    <div className="space-y-4" data-oauth-request>
      <div className="space-y-1">
        <p className="text-muted-foreground text-xs">Клиент называет себя:</p>
        {name ? (
          <p
            data-oauth-client-name
            className="text-base font-medium [overflow-wrap:anywhere]"
          >
            <bdi>{name}</bdi>
          </p>
        ) : (
          <p
            data-oauth-client-name
            className="text-muted-foreground text-base italic"
          >
            {NO_CLIENT_NAME}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-muted-foreground text-xs">Код доступа получит:</p>
        <div className="bg-muted rounded-md border px-3 py-2">
          <p
            data-oauth-host
            className="text-foreground font-mono text-xl font-semibold break-all sm:text-2xl"
          >
            {consent.redirect_host}
          </p>
        </div>
        <p className="text-muted-foreground text-xs">
          Сверьте адрес. Название клиент выбирает сам, и его легко подделать.
          Показан только хост — без порта и пути.
        </p>
        {consent.document_host ? (
          <p className="text-muted-foreground text-xs">
            Описание клиента загружено с:{" "}
            <span
              data-oauth-document-host
              className="text-foreground font-mono text-[13px] break-all"
            >
              {consent.document_host}
            </span>
          </p>
        ) : null}
      </div>

      {consent.loopback ? (
        <div data-oauth-loopback>
          <Note
            tone="warning"
            title={
              <span className="flex items-start gap-2">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                Код получит программа на этом устройстве
              </span>
            }
            description="Адрес возврата — локальный. Подтверждайте, только если вы сами запустили этого клиента на своём компьютере."
          />
        </div>
      ) : null}

      <dl className="space-y-2 rounded-lg border p-3 text-sm">
        <Fact term="Вы вошли как">{who}</Fact>
        <Fact term="Права">
          клиент сможет делать всё, что можете вы: ваши проекты, роли и уровни
          доступа
        </Fact>
        <Fact term="Проект">{project}</Fact>
      </dl>

      {showDeadline ? (
        <p className="text-muted-foreground text-xs">
          Запрос действует до{" "}
          <Timestamp value={consent.expires_at} format="time" className="text-xs" />
          .
        </p>
      ) : null}
    </div>
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
    <div className="grid gap-0.5 sm:grid-cols-[7rem_1fr] sm:gap-4">
      <dt className="text-muted-foreground text-xs sm:pt-0.5">{term}</dt>
      <dd className="[overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}
