import {Navigate, Route, Routes, useParams} from 'react-router-dom';
import {BrowserRouter} from 'react-router-dom';
import {AppShell} from '@astryxdesign/core/AppShell';
import {LinkProvider} from '@astryxdesign/core/Link';
import {Icon} from '@astryxdesign/core/Icon';
import {NavIcon} from '@astryxdesign/core/NavIcon';
import {SideNav, SideNavHeading, SideNavItem, SideNavSection} from '@astryxdesign/core/SideNav';

import {RouterLink} from './router';
import {Board} from './pages/Board';
import {Projects} from './pages/Projects';
import {Roles} from './pages/Roles';
import {TaskDetail} from './pages/TaskDetail';
import {WorkflowEditor} from './pages/WorkflowEditor';

export function App() {
  return (
    <BrowserRouter>
      <LinkProvider component={RouterLink}>
        <Routes>
          <Route path="/" element={<Navigate to="/projects" replace />} />
          <Route path="/projects" element={<Shell page="projects"><Projects /></Shell>} />
          <Route path="/p/:projectKey" element={<Navigate to="board" replace />} />
          <Route path="/p/:projectKey/board" element={<Shell page="board"><Board /></Shell>} />
          <Route path="/p/:projectKey/roles" element={<Shell page="roles"><Roles /></Shell>} />
          <Route path="/p/:projectKey/workflow" element={<Shell page="workflow"><WorkflowEditor /></Shell>} />
          <Route path="/p/:projectKey/tasks/:taskKey" element={<Shell page="board"><TaskDetail /></Shell>} />
        </Routes>
      </LinkProvider>
    </BrowserRouter>
  );
}

type Page = 'projects' | 'board' | 'roles' | 'workflow';

function Shell({page, children}: {page: Page; children: React.ReactNode}) {
  const {projectKey} = useParams();

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
            </SideNavSection>
          ) : null}
        </SideNav>
      }>
      {children}
    </AppShell>
  );
}
