import {useEffect, useState} from 'react';
import {Navigate, Route, Routes, useLocation, useNavigate, useParams} from 'react-router-dom';
import {BrowserRouter} from 'react-router-dom';
import {AppShell} from '@astryxdesign/core/AppShell';
import {Button} from '@astryxdesign/core/Button';
import {LinkProvider} from '@astryxdesign/core/Link';
import {Icon} from '@astryxdesign/core/Icon';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {NavIcon} from '@astryxdesign/core/NavIcon';
import {Section} from '@astryxdesign/core/Section';
import {SideNav, SideNavHeading, SideNavItem, SideNavSection} from '@astryxdesign/core/SideNav';
import {Text} from '@astryxdesign/core/Text';

import {ApiError, UNAUTHENTICATED_EVENT, api, currentToken, setCurrentToken} from './api/client';
import type {Me} from './api/types';
import {Loading} from './components/Feedback';
import {RouterLink} from './router';
import {Principals, Teams} from './pages/Admin';
import {Board} from './pages/Board';
import {Login} from './pages/Login';
import {Metrics} from './pages/Metrics';
import {Projects} from './pages/Projects';
import {Roles} from './pages/Roles';
import {Settings} from './pages/Settings';
import {TaskDetail} from './pages/TaskDetail';
import {WorkflowEditor} from './pages/WorkflowEditor';

export function App() {
  return (
    <BrowserRouter>
      <LinkProvider component={RouterLink}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Navigate to="/projects" replace />} />
          <Route path="/projects" element={<Shell page="projects"><Projects /></Shell>} />
          <Route path="/teams" element={<Shell page="teams"><Teams /></Shell>} />
          <Route path="/principals" element={<Shell page="principals"><Principals /></Shell>} />
          <Route path="/p/:projectKey" element={<Navigate to="board" replace />} />
          <Route path="/p/:projectKey/board" element={<Shell page="board"><Board /></Shell>} />
          <Route path="/p/:projectKey/roles" element={<Shell page="roles"><Roles /></Shell>} />
          <Route path="/p/:projectKey/workflow" element={<Shell page="workflow"><WorkflowEditor /></Shell>} />
          <Route path="/p/:projectKey/metrics" element={<Shell page="metrics"><Metrics /></Shell>} />
          <Route path="/p/:projectKey/settings" element={<Shell page="settings"><Settings /></Shell>} />
          <Route path="/p/:projectKey/tasks/:taskKey" element={<Shell page="board"><TaskDetail /></Shell>} />
        </Routes>
      </LinkProvider>
    </BrowserRouter>
  );
}

type Page =
  | 'projects'
  | 'teams'
  | 'principals'
  | 'board'
  | 'roles'
  | 'workflow'
  | 'metrics'
  | 'settings';

// Shell спрашивает бэкенд, кто мы, и в режиме токенов без действующего токена
// уводит на вход. В режиме header формы входа нет: актор назван заголовком,
// и проверять там нечего.
function Shell({page, children}: {page: Page; children: React.ReactNode}) {
  const {projectKey} = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [me, setMe] = useState<Me>();
  const [failed, setFailed] = useState<ApiError>();

  useEffect(() => {
    let live = true;
    api.me().then(
      (who) => live && setMe(who),
      (err: unknown) => {
        if (!live) return;
        if (err instanceof ApiError && err.code === 'unauthenticated') {
          navigate('/login', {replace: true, state: {from: location.pathname}});
          return;
        }
        setFailed(err instanceof ApiError ? err : new ApiError('internal', String(err)));
      },
    );
    return () => {
      live = false;
    };
    // Проверка идёт один раз на монтирование оболочки, а не на каждую смену пути.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Любой 401 посреди работы — токен отозван или истёк — возвращает на вход.
  useEffect(() => {
    const onUnauthenticated = () => {
      setCurrentToken(null);
      navigate('/login', {replace: true, state: {from: location.pathname}});
    };
    window.addEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated);
    return () => window.removeEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated);
  }, [navigate, location.pathname]);

  // Выход отзывает сессию на бэкенде: забыть токен в браузере мало — тот же
  // токен остался бы действующим. Отказ игнорируем: не отозвалась сессия —
  // уводить со страницы всё равно нужно.
  const logout = async () => {
    try {
      await api.logout();
    } catch {
      // токен мог протухнуть сам — тогда отзывать уже нечего
    }
    setCurrentToken(null);
    navigate('/login', {replace: true});
  };

  return (
    <AppShell
      contentPadding={0}
      sideNav={
        <SideNav
          aria-label="Разделы"
          header={
            <SideNavHeading
              icon={<NavIcon icon={<Icon icon="wrench" />} />}
              heading="SDLC Pipeline"
              headingHref="/projects"
            />
          }>
          <SideNavSection title="Всё" isHeaderHidden>
            <SideNavItem
              label="Проекты"
              icon="viewColumns"
              href="/projects"
              isSelected={page === 'projects'}
            />
            {/* Команды живут над проектами: уровень доступа сразу в несколько,
                владение и бюджет (решение 0027). */}
            <SideNavItem
              label="Команды"
              icon="info"
              href="/teams"
              isSelected={page === 'teams'}
            />
            {me?.principal.is_admin ? (
              <SideNavItem
                label="Принципалы"
                icon="info"
                href="/principals"
                isSelected={page === 'principals'}
              />
            ) : null}
          </SideNavSection>
          {projectKey ? (
            <SideNavSection title={projectKey}>
              <SideNavItem
                label="Доска"
                icon="viewColumns"
                href={`/p/${projectKey}/board`}
                isSelected={page === 'board'}
              />
              <SideNavItem
                label="Роли"
                icon="info"
                href={`/p/${projectKey}/roles`}
                isSelected={page === 'roles'}
              />
              <SideNavItem
                label="Цикл"
                icon="wrench"
                href={`/p/${projectKey}/workflow`}
                isSelected={page === 'workflow'}
              />
              <SideNavItem
                label="Метрики"
                icon="info"
                href={`/p/${projectKey}/metrics`}
                isSelected={page === 'metrics'}
              />
              <SideNavItem
                label="Настройки"
                icon="wrench"
                href={`/p/${projectKey}/settings`}
                isSelected={page === 'settings'}
              />
            </SideNavSection>
          ) : null}
          {me ? (
            <SideNavSection title="Вы">
              <Section padding={3} variant="transparent">
                <VStack gap={2}>
                  <Text type="supporting">
                    {me.principal.kind}:{me.principal.handle}
                    {me.principal.is_admin ? ' · администратор' : ''}
                  </Text>
                  {me.teams.length > 0 ? (
                    <Text type="supporting" color="secondary">
                      команды: {me.teams.map((t) => t.team_key).join(', ')}
                    </Text>
                  ) : null}
                  <Text type="supporting" color="secondary">
                    {me.mode === 'token' ? 'вход по токену' : 'режим отладки: актор из заголовка'}
                  </Text>
                  {me.mode === 'token' || currentToken() ? (
                    <HStack>
                      <Button size="sm" variant="ghost" label="Выйти" onClick={logout} />
                    </HStack>
                  ) : null}
                </VStack>
              </Section>
            </SideNavSection>
          ) : null}
        </SideNav>
      }>
      {failed ? (
        <Section padding={6}>
          <Text color="secondary">Сервис недоступен: {failed.message}</Text>
        </Section>
      ) : me ? (
        children
      ) : (
        <Loading />
      )}
    </AppShell>
  );
}
