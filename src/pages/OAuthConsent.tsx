import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Note, Spinner } from "@/components/kit";

import {
  ApiError,
  api,
  setCurrentToken,
} from "../api/client";
import type { OAuthConsent as Consent } from "../api/types";
import { Failure, Loading } from "../components/Feedback";
import {
  ConsentHeader,
  ConsentRequest,
} from "../components/oauth/ConsentRequest";
import {
  consentActions,
  consentFailed,
  consentLoaded,
  decideFailed,
  safeRedirect,
  type ConsentState,
} from "../components/oauth/rules";

// Страница согласия на подключение клиента (CLAB-482, решение 0079). Сюда
// ведёт authorize сервера авторизации: человек видит, кому выдаёт доступ и с
// чьими правами, и разрешает или отклоняет. Вне оболочки, по образцу
// /login/cli: без входа — сначала вход, потом возврат на тот же адрес.
//
// Все решения «что показать» — в components/oauth/rules.ts по коду ответа.
// Адрес возврата из ответа на решение выводится только в href ссылки
// «Вернуться в приложение»; переход — заменой записи истории.

// Через сколько после перехода предложить ссылку, если страница не закрылась.
const STALE_AFTER_MS = 4000;

type Phase = { kind: "loading" } | ConsentState;

type Sent = { allow: boolean; href: string | null };

const toApiError = (err: unknown) =>
  err instanceof ApiError ? err : new ApiError("internal", String(err));

export function OAuthConsent() {
  const { requestId = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [consent, setConsent] = useState<Consent>();
  const [sending, setSending] = useState<"allow" | "deny">();
  const [sendError, setSendError] = useState<ApiError>();
  const [sent, setSent] = useState<Sent>();
  const [stale, setStale] = useState(false);
  // Один POST на запрос: флаг в обработчике, а не только disabled после
  // перерисовки — двойной клик успевает до неё.
  const posting = useRef(false);

  const toLogin = useCallback(() => {
    navigate("/login", {
      replace: true,
      state: { from: location.pathname + location.search },
    });
  }, [navigate, location.pathname, location.search]);

  // Запрос и вход: сначала «кто я», потом сам запрос. isLive — страница ещё
  // на месте и запрос не устарел.
  const fetchRequest = useCallback(
    (isLive: () => boolean) => {
      api
        .me()
        .then(() => api.oauthRequest(requestId))
        .then(
          (res) => {
            if (!isLive()) return;
            setConsent(res);
            setPhase(consentLoaded(res));
          },
          (err: unknown) => {
            if (!isLive()) return;
            const state = consentFailed(toApiError(err));
            if (state.kind === "login") toLogin();
            setPhase(state);
          },
        );
    },
    [requestId, toLogin],
  );

  useEffect(() => {
    let live = true;
    fetchRequest(() => live);
    return () => {
      live = false;
    };
  }, [fetchRequest]);

  const reload = () => {
    setPhase({ kind: "loading" });
    setConsent(undefined);
    fetchRequest(() => true);
  };

  // Ссылка «Вернуться в приложение» — если переход не унёс страницу.
  useEffect(() => {
    if (!sent?.href) return;
    const t = setTimeout(() => setStale(true), STALE_AFTER_MS);
    return () => clearTimeout(t);
  }, [sent]);

  const decide = async (allow: boolean) => {
    if (posting.current) return;
    posting.current = true;
    setSending(allow ? "allow" : "deny");
    setSendError(undefined);
    try {
      const res = await api.decideOAuthRequest(requestId, allow);
      const href = safeRedirect(res.redirect_uri);
      setSent({ allow, href });
      if (href) window.location.replace(href);
      // posting остаётся поднятым: решение принято, второго POST не будет.
    } catch (err) {
      const e = toApiError(err);
      const next = decideFailed(e);
      posting.current = false;
      setSending(undefined);
      if (next.kind === "login") {
        toLogin();
        return;
      }
      if (next.kind === "failed") {
        // Запрос остался нерешённым: ошибка над кнопками, повтор тем же нажатием.
        setSendError(e);
        return;
      }
      setPhase(next);
    }
  };

  const switchAccount = async () => {
    try {
      await api.logout();
    } catch {
      // токен мог погаснуть сам — отзывать нечего
    }
    setCurrentToken(null);
    toLogin();
  };

  const actions = consentActions(phase.kind);
  const busy = sending !== undefined;

  return (
    <div className="flex min-h-svh items-center justify-center p-4 sm:p-8">
      <Card
        className="w-full max-w-110 gap-4 p-4 sm:p-6"
        aria-busy={busy || undefined}
      >
        <ConsentHeader />
        {sent ? (
          <Returning sent={sent} stale={stale} />
        ) : (
          <>
            {phase.kind === "loading" || phase.kind === "login" ? (
              <Loading label="Загружаем запрос" />
            ) : null}
            {consent &&
            (phase.kind === "ready" || phase.kind === "blocked") ? (
              <ConsentRequest
                consent={consent}
                showDeadline={phase.kind === "ready"}
              />
            ) : null}
            <Problem phase={phase} reload={reload} />
            {sendError ? (
              <div className="space-y-1">
                <Failure error={sendError} title="Решение не отправлено" />
                <p className="text-muted-foreground text-xs">
                  Запрос остался нерешённым: нажмите кнопку ещё раз.
                </p>
              </div>
            ) : null}
            {actions !== "none" ? (
              <div className="flex flex-col gap-2">
                {actions === "both" ? (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      className="h-11 w-full sm:flex-1"
                      disabled={busy || phase.kind !== "ready"}
                      onClick={() => void decide(true)}
                    >
                      {sending === "allow" ? (
                        <>
                          <Spinner /> Разрешаем…
                        </>
                      ) : (
                        "Разрешить"
                      )}
                    </Button>
                    <Button
                      className="h-11 w-full sm:flex-1"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void decide(false)}
                    >
                      {sending === "deny" ? (
                        <>
                          <Spinner /> Отклоняем…
                        </>
                      ) : (
                        "Отклонить"
                      )}
                    </Button>
                  </div>
                ) : null}
                <Button
                  className="text-muted-foreground h-11 w-full"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void switchAccount()}
                >
                  Войти другой учётной записью
                </Button>
              </div>
            ) : null}
          </>
        )}
      </Card>
    </div>
  );
}

// Сообщение о состоянии запроса: что не так и что делать.
function Problem({ phase, reload }: { phase: Phase; reload: () => void }) {
  switch (phase.kind) {
    case "blocked":
    case "forbidden":
      return (
        <div role="alert">
          <Note tone="error" title="Подключить с этой учётной записью нельзя">
            <p className="opacity-90">{phase.message}</p>
            {phase.kind === "blocked" ? (
              <p className="opacity-90">
                Отклоните запрос или войдите другой учётной записью.
              </p>
            ) : null}
          </Note>
        </div>
      );
    case "expired":
      return (
        <div role="status">
          <Note
            tone="warning"
            title="Запрос устарел"
            description="Время на подтверждение вышло. Вернитесь в приложение и начните подключение заново."
          />
        </div>
      );
    case "decided":
      return (
        <div role="status">
          <Note
            title="Запрос уже обработан"
            description="Вернитесь в приложение: если вы разрешили подключение, оно уже завершилось. Иначе начните подключение там заново."
          />
        </div>
      );
    case "notfound":
      return (
        <div role="status">
          <Note
            tone="warning"
            title="Запрос не найден"
            description="Ссылка неверна или устарела, либо подключение клиентов выключено на этом инстансе. Вернитесь в приложение и начните подключение заново."
          />
        </div>
      );
    case "failed":
      return (
        <Failure
          error={new ApiError("internal", phase.message)}
          title="Не получилось загрузить запрос"
          reload={reload}
        />
      );
    default:
      return null;
  }
}

// Решение принято: возвращаем человека в приложение. Адрес возврата здесь не
// показывается — только ссылка, если переход не сработал.
function Returning({ sent, stale }: { sent: Sent; stale: boolean }) {
  if (!sent.href) {
    return (
      <div role="alert">
        <Note
          tone="error"
          title="Адрес возврата недопустим"
          description="Решение отправлено, но мы не переходим на этот адрес. Закройте страницу и начните подключение в клиенте заново."
        />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <Loading
        label={
          sent.allow
            ? "Возвращаем вас в приложение…"
            : "Отказ отправлен, возвращаем вас в приложение…"
        }
      />
      {stale ? (
        <div className="space-y-2 text-center">
          <p className="text-muted-foreground text-sm">
            Приложение не открылось?
          </p>
          <Button asChild variant="outline" className="h-11 w-full">
            <a href={sent.href} rel="noreferrer">
              Вернуться в приложение
            </a>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
