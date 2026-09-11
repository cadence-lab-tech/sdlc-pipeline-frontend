import { UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Note, Timestamp } from "@/components/kit";

import { ApiError, api } from "../api/client";
import type {
  AcceptedInvite,
  Invite as InviteData,
  InviteTargetKind,
  Me,
  TeamRole,
} from "../api/types";
import { Failure, Loading } from "../components/Feedback";

// Приём приглашения ссылкой (решение 0035). Страница живёт вне оболочки, как
// подтверждение входа CLI: у только что вошедшего нет ни одного проекта, и
// показывать ему боковое меню нечего. Без входа — на вход и обратно на ту же
// ссылку. Токен уходит бэкенду только в теле запроса и нигде не хранится.
export const INVITE_PATH = "/invite/:token";

const KIND_LABEL: Record<InviteTargetKind, string> = {
  team: "организация",
  project: "проект",
};

const TEAM_ROLE_LABEL: Record<TeamRole, string> = {
  member: "участник",
  lead: "лид",
};

// Куда вести после приёма: проект открывается доской, организация — на
// странице команд, где она сразу выбрана.
function targetPath(kind: InviteTargetKind, key: string): string {
  return kind === "project"
    ? `/p/${encodeURIComponent(key)}`
    : `/teams?team=${encodeURIComponent(key)}`;
}

function inviteTarget(invite: InviteData): { kind: InviteTargetKind; key: string } {
  return {
    kind: invite.target_kind,
    key:
      (invite.target_kind === "project" ? invite.project_key : invite.team_key) ??
      "",
  };
}

const asApiError = (err: unknown) =>
  err instanceof ApiError ? err : new ApiError("internal", String(err));

// Ошибка приёма: окончательная убирает кнопку, временная предлагает повтор.
interface AcceptFailure {
  error: ApiError;
  retry: boolean;
}

export function Invite() {
  const navigate = useNavigate();
  const location = useLocation();
  const { token = "" } = useParams();
  const [me, setMe] = useState<Me>();
  const [invite, setInvite] = useState<InviteData>();
  const [loadError, setLoadError] = useState<ApiError>();
  const [acceptError, setAcceptError] = useState<AcceptFailure>();
  const [already, setAlready] = useState<AcceptedInvite>();
  const [busy, setBusy] = useState(false);

  const toLogin = () =>
    navigate("/login", { replace: true, state: { from: location.pathname } });

  const lookup = async () => {
    try {
      setInvite(await api.lookupInvite(token));
      setLoadError(undefined);
    } catch (err) {
      const e = asApiError(err);
      if (e.code === "unauthenticated") {
        toLogin();
        return;
      }
      setLoadError(e);
    }
  };

  const accept = async () => {
    setAcceptError(undefined);
    setBusy(true);
    try {
      const res = await api.acceptInvite(token);
      if (res.already_member) {
        // Участие не менялось: пометку после перехода показать негде, поэтому
        // человек читает её здесь и уходит по кнопке сам.
        setAlready(res);
        setInvite(res.invite);
        return;
      }
      navigate(targetPath(res.target.kind, res.target.key), { replace: true });
    } catch (err) {
      const e = asApiError(err);
      switch (e.code) {
        case "unauthenticated":
          toLogin();
          return;
        case "conflict":
          // Пока карточка была открыта, приглашение приняли, отозвали или оно
          // протухло: перечитать, чтобы карточка показала новый статус.
          setAcceptError({ error: e, retry: false });
          await lookup();
          return;
        case "not_found":
          setAcceptError({ error: e, retry: false });
          return;
        default:
          // Квота организации, сбой сервиса или сети: приглашение остаётся
          // выданным, и повтор на этой же странице может пройти.
          setAcceptError({ error: e, retry: true });
      }
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    let live = true;
    api.me().then(
      (who) => {
        if (!live) return;
        setMe(who);
        void lookup();
      },
      (err: unknown) => {
        if (!live) return;
        const e = asApiError(err);
        if (e.code === "unauthenticated") {
          toLogin();
          return;
        }
        setLoadError(e);
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="flex min-h-svh items-center justify-center p-8">
      <Card className="w-full max-w-110 gap-4 p-6">
        <div className="flex items-center gap-3">
          <div className="bg-primary text-primary-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
            <UserPlus className="size-5" />
          </div>
          <div className="grid leading-tight">
            <h1 className="text-2xl font-semibold tracking-tight">
              Приглашение
            </h1>
            <span className="text-muted-foreground text-xs">
              {me
                ? `примете как ${me.principal.kind}:${me.principal.handle}`
                : "в организацию или проект"}
            </span>
          </div>
        </div>
        {loadError ? (
          <Failure error={loadError} title="Приглашение не открыть" />
        ) : !invite ? (
          <Loading label="Открываем приглашение" />
        ) : (
          <>
            <Details invite={invite} />
            {acceptError ? (
              <Failure error={acceptError.error} title="Не получилось принять" />
            ) : null}
            {already ? (
              <AlreadyMember
                accepted={already}
                onOpen={() =>
                  navigate(targetPath(already.target.kind, already.target.key), {
                    replace: true,
                  })
                }
              />
            ) : invite.status === "pending" ? (
              acceptError && !acceptError.retry ? null : (
                <Button
                  className="w-full"
                  disabled={busy}
                  onClick={() => void accept()}
                >
                  {busy ? "Принимаем…" : acceptError ? "Повторить" : "Принять"}
                </Button>
              )
            ) : (
              <Closed invite={invite} me={me} />
            )}
          </>
        )}
      </Card>
    </div>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="min-w-0 text-right break-words">{children}</span>
    </div>
  );
}

// Что даёт участие — до согласия (Б1). Уровень и роль в команде — перечни
// схемы; ключи ролей специалистов придумывает проект, они показываются как есть.
function Details({ invite }: { invite: InviteData }) {
  const { key } = inviteTarget(invite);
  return (
    <div className="space-y-1 rounded-lg border p-3 text-sm">
      <Line label="Куда">{KIND_LABEL[invite.target_kind]}</Line>
      <Line label="Название">
        {invite.target_name}{" "}
        <span className="text-muted-foreground font-mono text-xs">{key}</span>
      </Line>
      <Line label="Зовёт">{invite.created_by_handle}</Line>
      {invite.target_kind === "team" ? (
        <Line label="Роль">
          {invite.team_role ? TEAM_ROLE_LABEL[invite.team_role] : "—"}
        </Line>
      ) : (
        <>
          <Line label="Уровень">{invite.level ?? "—"}</Line>
          <Line label="Роли">
            {invite.role_keys === null
              ? "любые"
              : invite.role_keys.length === 0
                ? "ни одной"
                : invite.role_keys.join(", ")}
          </Line>
        </>
      )}
      <Line label="Действует до">
        <Timestamp value={invite.expires_at} className="text-foreground" />
      </Line>
    </div>
  );
}

// Закрытое приглашение: кнопки нет, текст по статусу из просмотра — сообщение
// бэкенд пишет только в ответе на приём.
function Closed({ invite, me }: { invite: InviteData; me?: Me }) {
  if (invite.status === "accepted") {
    const target = inviteTarget(invite);
    if (me && invite.accepted_by_handle === me.principal.handle) {
      return (
        <Note tone="success" title="Вы уже приняли это приглашение">
          <p>
            {invite.accepted_at ? (
              <>
                Принято <Timestamp value={invite.accepted_at} />.{" "}
              </>
            ) : null}
            <Link
              className="text-primary underline underline-offset-4"
              to={targetPath(target.kind, target.key)}
            >
              Открыть «{invite.target_name}»
            </Link>
          </p>
        </Note>
      );
    }
    return (
      <Note tone="warning" title="Приглашение уже принято">
        {invite.accepted_at ? (
          <p>
            Принято <Timestamp value={invite.accepted_at} />. Ссылка
            одноразовая — попросите новую.
          </p>
        ) : null}
      </Note>
    );
  }
  if (invite.status === "revoked") {
    return (
      <Note tone="warning" title="Приглашение отозвано">
        {invite.revoked_at ? (
          <p>
            Отозвано <Timestamp value={invite.revoked_at} />. Попросите новую
            ссылку.
          </p>
        ) : null}
      </Note>
    );
  }
  return (
    <Note tone="warning" title="Срок приглашения истёк">
      <p>
        Действовало до <Timestamp value={invite.expires_at} />. Попросите новую
        ссылку.
      </p>
    </Note>
  );
}

function AlreadyMember({
  accepted,
  onOpen,
}: {
  accepted: AcceptedInvite;
  onOpen: () => void;
}) {
  return (
    <div className="space-y-3">
      <Note tone="info" title={`Вы уже участник «${accepted.target.name}»`}>
        <p>Уровень и роли не менялись: ссылка не меняет существующее участие.</p>
      </Note>
      <Button className="w-full" onClick={onOpen}>
        Открыть
      </Button>
    </div>
  );
}
