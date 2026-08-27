import {Card} from '@astryxdesign/core/Card';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Grid} from '@astryxdesign/core/Grid';
import {Item} from '@astryxdesign/core/Item';
import {Section} from '@astryxdesign/core/Section';
import {Text, Heading} from '@astryxdesign/core/Text';
import {Token} from '@astryxdesign/core/Token';
import {VStack} from '@astryxdesign/core/Stack';

import {api} from '../api/client';
import {useResource} from '../api/useResource';
import {Loaded} from '../components/Feedback';

export function Projects() {
  const projects = useResource(() => api.listProjects(), []);

  return (
    <Section padding={6}>
      <VStack gap={4}>
        <Heading level={1}>Проекты</Heading>
        <Loaded resource={projects}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState
                title="Проектов пока нет"
                description="Проект заводит цикл, роли и задачи. Создайте первый через API."
              />
            ) : (
              <Grid columns={{minWidth: 320}} gap={4}>
                {list.map((p) => (
                  <ProjectCard key={p.id} projectKey={p.key} name={p.name} description={p.description} />
                ))}
              </Grid>
            )
          }
        </Loaded>
      </VStack>
    </Section>
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
    <Card padding={4}>
      <VStack gap={3}>
        <Item
          href={`/p/${projectKey}/board`}
          label={name}
          description={description}
          endContent={<Token label={projectKey} size="sm" />}
        />
        {detail.data ? (
          <VStack gap={1}>
            <Text type="supporting" color="secondary">
              Репозитории в области проекта
            </Text>
            {detail.data.repositories.map((r) => (
              <Text key={r.id} type="supporting">
                {r.owner}/{r.name}
                {r.role_hint ? ` · ${r.role_hint}` : ''}
              </Text>
            ))}
          </VStack>
        ) : null}
      </VStack>
    </Card>
  );
}
