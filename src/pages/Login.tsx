import {useState} from 'react';
import {useLocation, useNavigate} from 'react-router-dom';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Center} from '@astryxdesign/core/Center';
import {FormLayout} from '@astryxdesign/core/FormLayout';
import {VStack} from '@astryxdesign/core/Layout';
import {Heading, Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';

import {ApiError, api, setCurrentToken} from '../api/client';

// Вход по токену (решение 0021). Токен выдаёт администратор проекта через
// «Настройки» или CLI; форма только проверяет его запросом /auth/me и
// запоминает в браузере. Пароля у системы нет: один механизм для людей,
// агентов и CI.
export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [token, setToken] = useState('');
  const [error, setError] = useState<ApiError>();
  const [checking, setChecking] = useState(false);

  const from = (location.state as {from?: string} | null)?.from ?? '/projects';

  const submit = async () => {
    setChecking(true);
    setError(undefined);
    setCurrentToken(token.trim());
    try {
      await api.me();
      navigate(from, {replace: true});
    } catch (err) {
      setCurrentToken(null);
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    } finally {
      setChecking(false);
    }
  };

  return (
    <Center padding={8}>
      <Card padding={6} width={440}>
        <VStack gap={4}>
          <Heading level={1}>Вход</Heading>
          <Text color="secondary">
            Предъявите токен доступа. Его выдаёт администратор проекта в настройках или командой
            «sdlc token create».
          </Text>
          {error ? <Banner status="error" title="Токен не принят" description={error.message} /> : null}
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
            variant="primary"
            label={checking ? 'Проверяем…' : 'Войти'}
            onClick={submit}
            isDisabled={checking || token.trim() === ''}
          />
        </VStack>
      </Card>
    </Center>
  );
}
