import {useState} from 'react';

import {Button} from '@/components/ui/button';
import {Page, PageHeader} from '@/components/kit';

import {api} from '../api/client';
import {AuditLog} from '../components/AuditLog';

// Журнал инстанса (CLAB-210): записи без проекта — команды, принципалы,
// токены без проекта, подтверждение входа CLI. Ручка открыта только
// администратору системы; пункт меню стоит по тому же правилу, что
// «Принципалы», а прямой заход не-администратора показывает отказ сервера.
export function InstanceAudit() {
  const [version, setVersion] = useState(0);
  return (
    <Page>
      <PageHeader
        title="Журнал"
        description="Действия уровня инстанса: команды, принципалы, токены без проекта, вход CLI. Журналы проектов — в настройках каждого проекта, журнал задачи — во вкладке её карточки."
        actions={
          <Button variant="outline" size="sm" onClick={() => setVersion((v) => v + 1)}>
            Обновить
          </Button>
        }
      />
      <AuditLog load={(cursor) => api.instanceAudit(cursor)} deps={['instance-audit']} version={version} />
    </Page>
  );
}
