import { TerminalSquare } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormLayout, TextInput } from "@/components/fields";
import { Note } from "@/components/kit";

import { ApiError, api } from "../api/client";
import type { CLILoginRequest, Me } from "../api/types";
import { Failure, Loading } from "../components/Feedback";

// Подтверждение входа CLI (решение 0032). Сюда приводит «clab auth login»:
// адрес с кодом открывается в браузере, где человек уже вошёл. Страница
// показывает, что именно просит доступ, и по кнопке выдаёт этой машине
// долгоживущий токен от имени вошедшего. Без входа — сначала обычный вход,
// потом возврат сюда же с тем же кодом.
export const CLI_LOGIN_PATH = "/login/cli";

export function CLILogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const initial = new URLSearchParams(location.search).get("code") ?? "";
  const [code, setCode] = useState(initial);
  const [me, setMe] = useState<Me>();
  const [request, setRequest] = useState<CLILoginRequest>();
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);

  const fail = (err: unknown) =>
    setError(
      err instanceof ApiError ? err : new ApiError("internal", String(err)),
    );

  const lookup = async (value: string) => {
    setError(undefined);
    setBusy(true);
    try {
      const res = await api.cliLoginRequest(value.trim());
      setRequest(res.request);
      setStatus(res.status);
    } catch (err) {
      setRequest(undefined);
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const decide = async (approve: boolean) => {
    if (!request) return;
    setError(undefined);
    setBusy(true);
    try {
      const res = await api.decideCLILogin(request.user_code, approve);
      setRequest(res.request);
      setStatus(res.status);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  // Кто подтверждает: без входа — на страницу входа и обратно с кодом.
  useEffect(() => {
    let live = true;
    api.me().then(
      (who) => {
        if (!live) return;
        setMe(who);
        // Код из адреса проверяется сразу; набранный руками — по кнопке.
        if (initial) void lookup(initial);
      },
      (err: unknown) => {
        if (!live) return;
        if (err instanceof ApiError && err.code === "unauthenticated") {
          navigate("/login", {
            replace: true,
            state: { from: location.pathname + location.search },
          });
          return;
        }
        fail(err);
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-svh items-center justify-center p-8">
      <Card className="w-full max-w-110 gap-4 p-6">
        <div className="flex items-center gap-3">
          <div className="bg-primary text-primary-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
            <TerminalSquare className="size-5" />
          </div>
          <div className="grid leading-tight">
            <h1 className="text-2xl font-semibold tracking-tight">Вход clab</h1>
            <span className="text-muted-foreground text-xs">
              подтверждение с этой учётной записи
            </span>
          </div>
        </div>
        {!me ? <Loading label="Проверяем вход" /> : null}
        {error ? <Failure error={error} title="Не получилось" /> : null}
        {me && !request ? (
          <>
            <p className="text-muted-foreground text-sm">
              Введите код, который показал <code>clab auth login</code>. Сверьте
              его с терминалом: так вы подтверждаете именно свою машину.
            </p>
            <FormLayout>
              <TextInput
                label="Код"
                value={code}
                onChange={setCode}
                onEnter={() => void lookup(code)}
                placeholder="XXXX-XXXX"
                isRequired
              />
            </FormLayout>
            <Button
              className="w-full"
              disabled={busy || code.trim() === ""}
              onClick={() => void lookup(code)}
            >
              {busy ? "Ищем…" : "Продолжить"}
            </Button>
          </>
        ) : null}
        {me && request ? (
          <Decision
            me={me}
            request={request}
            status={status ?? "pending"}
            busy={busy}
            onDecide={decide}
          />
        ) : null}
      </Card>
    </div>
  );
}

function Decision({
  me,
  request,
  status,
  busy,
  onDecide,
}: {
  me: Me;
  request: CLILoginRequest;
  status: string;
  busy: boolean;
  onDecide: (approve: boolean) => void;
}) {
  const who = `${me.principal.kind}:${me.principal.handle}`;
  const term =
    request.token_days > 0 ? `на ${request.token_days} дн.` : "бессрочный";

  if (status === "approved" || status === "consumed") {
    return (
      <Note tone="success" title="Готово: вернитесь в терминал">
        Машина «{request.label}» получила токен {term} от имени {who}. Отозвать
        его можно в настройках проекта в списке токенов или командой «clab auth
        logout».
      </Note>
    );
  }
  if (status === "denied") {
    return (
      <Note tone="warning" title="Вход отклонён">
        clab на той стороне увидит отказ и завершится.
      </Note>
    );
  }
  if (status === "expired") {
    return (
      <Note tone="warning" title="Код устарел">
        Запустите «clab auth login» заново и подтвердите новый код.
      </Note>
    );
  }
  return (
    <div className="space-y-3">
      <div className="rounded-lg border p-3 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-muted-foreground">Код</span>
          <span className="font-mono text-lg font-semibold tracking-widest">
            {request.user_code}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-muted-foreground">Просит</span>
          <span>{request.label}</span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-muted-foreground">Токен</span>
          <span>
            {term}, от имени {who}
          </span>
        </div>
      </div>
      <p className="text-muted-foreground text-sm">
        Токен даст той машине те же права, что у вас: ваши проекты, роли и
        уровни доступа. Если код в терминале другой — отклоните.
      </p>
      <div className="flex gap-2">
        <Button
          className="flex-1"
          disabled={busy}
          onClick={() => onDecide(true)}
        >
          Разрешить
        </Button>
        <Button
          className="flex-1"
          variant="outline"
          disabled={busy}
          onClick={() => onDecide(false)}
        >
          Отклонить
        </Button>
      </div>
    </div>
  );
}
