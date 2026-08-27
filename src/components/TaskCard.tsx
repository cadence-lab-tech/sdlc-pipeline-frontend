import {Card} from '@astryxdesign/core/Card';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {Text} from '@astryxdesign/core/Text';
import {Token} from '@astryxdesign/core/Token';

import type {Task} from '../api/types';

const PRIORITY_COLOR: Record<string, 'red' | 'orange' | 'gray'> = {
  urgent: 'red',
  high: 'orange',
  low: 'gray',
};

// Карточка задачи на доске. Область задачи — набор репозиториев, а не один:
// у мультирепозиторной задачи их несколько (решение 0015).
export function TaskCard({
  task,
  isOnOldWorkflow = false,
}: {
  task: Task;
  isOnOldWorkflow?: boolean;
}) {
  const multiRepo = task.properties.multi_repo === true;

  return (
    <Card padding={3}>
      <VStack gap={2}>
        <HStack hAlign="between" vAlign="center" gap={2}>
          <Text type="supporting" color="secondary" hasTabularNumbers>
            {task.key}
          </Text>
          {task.priority !== 'normal' ? (
            <Token
              size="sm"
              label={task.priority}
              color={PRIORITY_COLOR[task.priority] ?? 'gray'}
            />
          ) : null}
        </HStack>
        <Text weight="medium" maxLines={3}>
          {task.title}
        </Text>
        <HStack gap={1} wrap="wrap">
          {task.repositories.map((r) => (
            <Token key={r.repository_id} size="sm" label={r.name} />
          ))}
          {multiRepo ? <Token size="sm" label="мультирепо" color="blue" /> : null}
          {isOnOldWorkflow ? <Token size="sm" label="прежняя версия цикла" color="orange" /> : null}
        </HStack>
        {task.labels.length > 0 ? (
          <HStack gap={1} wrap="wrap">
            {task.labels.map((l) => (
              <Text key={l} type="supporting" color="secondary">
                #{l}
              </Text>
            ))}
          </HStack>
        ) : null}
      </VStack>
    </Card>
  );
}
