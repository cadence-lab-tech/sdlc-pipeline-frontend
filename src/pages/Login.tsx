import {useEffect, useState} from 'react';
import {useLocation, useNavigate} from 'react-router-dom';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Center} from '@astryxdesign/core/Center';
import {Divider} from '@astryxdesign/core/Divider';
import {FormLayout} from '@astryxdesign/core/FormLayout';
import {VStack} from '@astryxdesign/core/Layout';
import {Heading, Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';

import {ApiError, api, setCurrentToken} from '../api/client';
import type {OIDCSettings, Session} from '../api/types';
import {useResource} from '../api/useResource';

// Вход: токеном (решение 0021) или через корпоративного провайдера
// (решение 0027). Второго транспорта провайдер не заводит — обмен ID-токена
// на сессию отдаёт обычный токен с коротким сроком, и дальше всё работает как
// прежде. Код авторизации забирается с PKCE: клиент публичный, секрета у
// браузера нет и быть не может.
export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const settings = useResource(() => api.oidcSettings(), []);
  const [error, setError] = useState<ApiError>();

  const from = (location.state as {from?: string} | null)?.from ?? '/projects';

  return (
    <Center padding={8}>
      <Card padding={6} width={440}>
        <VStack gap={4}>
          <Heading level={1}>Вход</Heading>
          {error ? <Banner status="error" title="Войти не удалось" description={error.message} /> : null}
          {settings.data?.enabled ? (
            <>
              <Provider settings={settings.data} from={from} onError={setError} />
              <Divider label="или" />
            </>
          ) : null}
          <ByToken from={from} onError={setError} navigate={navigate} />
        </VStack>
      </Card>
    </Center>
  );
}

// ── провайдер ───────────────────────────────────────────────────────────────

const VERIFIER_KEY = 'sdlc.oidc.verifier';
const STATE_KEY = 'sdlc.oidc.state';
const RETURN_KEY = 'sdlc.oidc.from';

function randomString(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const raw = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(digest);
}

// Адрес возврата один на все входы: провайдер сверяет его со списком
// разрешённых, и подставлять туда произвольный путь нельзя.
function redirectURI(): string {
  return `${window.location.origin}/login`;
}

function Provider({
  settings,
  from,
  onError,
}: {
  settings: OIDCSettings;
  from: string;
  onError: (err: ApiError) => void;
}) {
  const navigate = useNavigate();
  // Возвращаемся от провайдера с кодом — значит, ждём: состояние выводится из
  // адреса при первом рендере, а не выставляется эффектом. Иначе первый кадр
  // показывал бы готовую кнопку входа, который уже идёт.
  const [busy, setBusy] = useState(() => new URLSearchParams(window.location.search).has('code'));

  // Возврат от провайдера: в адресе код авторизации либо отказ. Обмен идёт
  // один раз — код одноразовый, и повторный рендер не должен его тратить.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('code') && !params.has('error')) return;
    const back = sessionStorage.getItem(RETURN_KEY) ?? from;

    finishLogin(settings, params)
      .then((session) => {
        setCurrentToken(session.token);
        navigate(back, {replace: true});
      })
      .catch((err: unknown) =>
        onError(err instanceof ApiError ? err : new ApiError('internal', String(err))),
      )
      .finally(() => setBusy(false));
    // Обмен выполняется один раз на возврат, а не на каждый рендер формы.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async () => {
    setBusy(true);
    try {
      const verifier = randomString();
      const state = randomString();
      sessionStorage.setItem(VERIFIER_KEY, verifier);
      sessionStorage.setItem(STATE_KEY, state);
      sessionStorage.setItem(RETURN_KEY, from);
      const query = new URLSearchParams({
        response_type: 'code',
        client_id: settings.client_id ?? '',
        redirect_uri: redirectURI(),
        scope: settings.scopes ?? 'openid profile email',
        state,
        // nonce привязывает ID-токен к этому входу; провайдер вернёт его
        // внутри токена, а подпись проверит бэкенд.
        nonce: randomString(),
        code_challenge: await challengeOf(verifier),
        code_challenge_method: 'S256',
      });
      window.location.assign(`${settings.authorization_endpoint}?${query}`);
    } catch (err) {
      setBusy(false);
      onError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    }
  };

  return (
    <VStack gap={3}>
      <Text color="secondary">
        Вход через {settings.issuer}. Команды подтягиваются из групп провайдера при каждом входе.
      </Text>
      <Button
        variant="primary"
        label={busy ? 'Ждём провайдера…' : 'Войти через провайдера'}
        isDisabled={busy}
        onClick={start}
      />
    </VStack>
  );
}

// finishLogin разбирает возврат от провайдера и доводит вход до сессии.
// Одноразовые данные входа стираются сразу, а код и state убираются из адреса:
// перезагрузка страницы не должна пытаться потратить их второй раз.
async function finishLogin(settings: OIDCSettings, params: URLSearchParams): Promise<Session> {
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  const expected = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(RETURN_KEY);
  window.history.replaceState(null, '', redirectURI());

  const denied = params.get('error');
  if (denied) {
    throw new ApiError('unauthenticated', params.get('error_description') ?? denied);
  }
  const code = params.get('code');
  // state сверяется всегда: ответ, пришедший не на наш запрос, — это чужой
  // вход, а не наш.
  if (!code || !verifier || params.get('state') !== expected) {
    throw new ApiError('unauthenticated', 'ответ провайдера не относится к этому входу');
  }
  return api.oidcLogin(await exchange(settings, code, verifier));
}

// exchange меняет код авторизации на ID-токен у самого провайдера: клиент
// публичный, поэтому подтверждением служит code_verifier, а не секрет.
// Дальше ID-токен уходит на бэкенд, и подпись проверяет он — браузеру верить
// на слово в вопросе «кто пришёл» нельзя.
async function exchange(settings: OIDCSettings, code: string, verifier: string): Promise<string> {
  const res = await fetch(settings.token_endpoint ?? '', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectURI(),
      client_id: settings.client_id ?? '',
      code_verifier: verifier,
    }),
  });
  const body = (await res.json()) as {id_token?: string; error?: string; error_description?: string};
  if (!res.ok || !body.id_token) {
    throw new ApiError(
      'unauthenticated',
      body.error_description ?? body.error ?? `провайдер отказал со статусом ${res.status}`,
    );
  }
  return body.id_token;
}

// ── токен ───────────────────────────────────────────────────────────────────

function ByToken({
  from,
  onError,
  navigate,
}: {
  from: string;
  onError: (err: ApiError) => void;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const [token, setToken] = useState('');
  const [checking, setChecking] = useState(false);

  const submit = async () => {
    setChecking(true);
    setCurrentToken(token.trim());
    try {
      await api.me();
      navigate(from, {replace: true});
    } catch (err) {
      setCurrentToken(null);
      onError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    } finally {
      setChecking(false);
    }
  };

  return (
    <VStack gap={3}>
      <Text color="secondary">
        Или предъявите токен доступа. Его выдаёт администратор проекта в настройках или командой
        «sdlc token create».
      </Text>
      <FormLayout>
        <TextInput
          label="Токен"
          type="password"
          value={token}
          onChange={setToken}
          onEnter={submit}
          isRequired
        />
      </FormLayout>
      <Button
        label={checking ? 'Проверяем…' : 'Войти'}
        onClick={submit}
        isDisabled={checking || token.trim() === ''}
      />
    </VStack>
  );
}
