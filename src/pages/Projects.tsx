import {Link} from 'react-router-dom';
import {ChevronRight} from 'lucide-react';

import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {EmptyState, Page, PageHeader, Token} from '@/components/kit';

import {api} from '../api/client';
import {useResource} from '../api/useResource';
import {Loaded} from '../components/Feedback';

export function Projects() {
  const projects = useResource(() => api.listProjects(), []);

  return (
    <Page>
      <PageHeader title="Проекты" description="Каждый проект настраивает свой цикл, роли и область по репозиториям." />
      <Loaded resource={projects}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState
              title="Проектов пока нет"
              description="Проект заводит цикл, роли и задачи. Создайте первый через API."
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((p) => (
                <ProjectCard key={p.id} projectKey={p.key} name={p.name} description={p.description} />
              ))}
            </div>
          )
        }
      </Loaded>
    </Page>
  );
}

function ProjectCard({
  projectKey,
  name,
  description,
}: {
  projectKey: string;
  name: string;
  description?: string;
}) {
  const detail = useResource(() => api.getProject(projectKey), [projectKey]);

  return (
    <Card className="hover:border-foreground/20 transition-colors">
      <CardHeader>
        <CardTitle>
          <Link to={`/p/${projectKey}/board`} className="flex items-center gap-1 hover:underline">
            {name}
            <ChevronRight className="size-4 opacity-50" />
          </Link>
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        <div className="col-start-2 row-span-2 row-start-1 self-start justify-self-end">
          <Token label={projectKey} />
        </div>
      </CardHeader>
      <CardContent>
        {detail.data ? (
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs">Репозитории в области проекта</p>
            {detail.data.repositories.map((r) => (
              <p key={r.id} className="font-mono text-xs">
                {r.owner}/{r.name}
                {r.role_hint ? <span className="text-muted-foreground"> · {r.role_hint}</span> : null}
              </p>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
