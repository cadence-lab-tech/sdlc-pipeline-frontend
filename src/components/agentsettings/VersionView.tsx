import {Card} from '@/components/ui/card';
import {DataTable} from '@/components/DataTable';
import {Note, StatusDot, Timestamp, Token} from '@/components/kit';
import {cn} from '@/lib/utils';

import type {AgentSettingsView} from '../../api/types';
import {
  KNOWN_AGENTS,
  LEVELS,
  PRICE_FIELDS,
  PRICE_LABELS,
  PRICE_UNIT,
  agentNames,
  agentOf,
  isObject,
  levelOf,
  modelsOf,
  priceRows,
  shortSha,
  stateLabel,
  stateVariant,
} from './rules';

// Вид версии настройки агентов — один для действующей, для черновика читающего
// и для панели истории (design.spec §3.3). Ни одна часть не падает от
// пропущенных или лишних полей: неизвестное просто не показывается.

export function VersionHeader({view}: {view: AgentSettingsView}) {
  return (
    <div className="space-y-1.5" data-state={view.state} data-version={view.version}>
      <div className="flex flex-wrap items-center gap-2">
        <Token label={`Версия ${view.version}`} />
        <span title={`Состояние: ${view.state}`}>
          <StatusDot variant={stateVariant(view.state)} label={stateLabel(view.state)} />
        </span>
        <span className="text-muted-foreground font-mono text-xs" title={view.sha256}>
          sha256 {shortSha(view.sha256)}
        </span>
      </div>
      <div className="text-muted-foreground space-y-0.5 text-sm">
        {view.activated_at ? (
          <p data-line="activated">
            Активирована <Timestamp value={view.activated_at} />
            {view.activated_by ? ` · ${view.activated_by}` : ''}
          </p>
        ) : null}
        {view.created_at ? (
          <p data-line="created">
            Заведена <Timestamp value={view.created_at} />
            {view.created_by ? ` · ${view.created_by}` : ''}
          </p>
        ) : null}
        <p data-line="changelog">Changelog: {view.changelog ? view.changelog : '—'}</p>
      </div>
      <Warnings warnings={view.warnings} />
    </div>
  );
}

export function Warnings({warnings}: {warnings: string[]}) {
  if (warnings.length === 0) return null;
  return (
    <Note tone="warning" title={`Предупреждения сервера (${warnings.length})`}>
      <ul className="list-disc space-y-0.5 pl-5" data-warnings>
        {warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </Note>
  );
}

type LevelRow = {level: string; model: string | undefined; effort: string | undefined};

function AgentCard({name, agent}: {name: string; agent: Record<string, unknown>}) {
  const models = modelsOf(agent);
  const rows: LevelRow[] = LEVELS.map((level) => {
    const l = levelOf(agent, level);
    return {
      level,
      model: typeof l.model === 'string' ? l.model : undefined,
      effort: typeof l.effort === 'string' ? l.effort : undefined,
    };
  });
  const custom = !(KNOWN_AGENTS as readonly string[]).includes(name);
  return (
    <Card className="gap-3 p-4" data-agent={name}>
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-mono text-sm font-semibold">{name}</h4>
        {custom ? <Token label="свой агент" /> : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-sm" data-models>
        <span className="text-muted-foreground">Доступные модели:</span>
        {models === undefined ? (
          <span className="text-muted-foreground">не ограничены</span>
        ) : models.length === 0 ? (
          <span className="text-muted-foreground">список пуст</span>
        ) : (
          models.map((m, i) => <Token key={`${i}:${m}`} label={<span className="font-mono break-all">{m}</span>} />)
        )}
      </div>
      <DataTable<LevelRow>
        idKey="level"
        data={rows}
        columns={[
          {key: 'level', header: 'Уровень', renderCell: (r) => <span className="font-mono">{r.level}</span>},
          {
            key: 'model',
            header: 'Модель',
            renderCell: (r) =>
              r.model ? (
                <span className="font-mono break-all">{r.model}</span>
              ) : (
                <span className="text-muted-foreground italic">не задан: берётся таблица привязки</span>
              ),
          },
          {key: 'effort', header: 'Усилие', renderCell: (r) => r.effort ?? '—'},
        ]}
      />
    </Card>
  );
}

function Pricing({document}: {document: Record<string, unknown>}) {
  const pricing = document.pricing;
  if (!isObject(pricing)) {
    return (
      <p className="text-muted-foreground text-sm" data-pricing="none">
        Прайс не задан: суммы считаются так, как их сообщил агент.
      </p>
    );
  }
  const rows = priceRows(document);
  const asOf = typeof pricing.as_of === 'string' ? pricing.as_of : '—';
  return (
    <Card className="gap-3 p-4" data-pricing="set">
      <p className="text-sm font-medium">
        Прайс на {asOf} · {PRICE_UNIT}
      </p>
      <DataTable
        idKey="id"
        data={rows}
        empty={<p className="text-muted-foreground text-sm">В прайсе нет моделей</p>}
        columns={[
          {key: 'id', header: 'Модель', renderCell: (r) => <span className="font-mono break-all">{r.id}</span>},
          ...PRICE_FIELDS.map((f) => ({
            key: f,
            header: PRICE_LABELS[f],
            renderCell: (r: ReturnType<typeof priceRows>[number]) => r[f] === '' ? '—' : r[f],
          })),
        ]}
      />
    </Card>
  );
}

export function VersionBody({view}: {view: AgentSettingsView}) {
  const document = view.document as Record<string, unknown>;
  const names = agentNames(document).sort();
  return (
    <div className="space-y-3">
      {Object.keys(document).length === 0 ? (
        <p className="text-muted-foreground text-sm">Версия пустая: для агентов это то же, что «настройки нет».</p>
      ) : null}
      {names.length === 0 ? (
        <p className="text-muted-foreground text-sm" data-agents="none">
          Агентов нет
        </p>
      ) : (
        names.map((n) => <AgentCard key={n} name={n} agent={agentOf(document, n)} />)
      )}
      <Pricing document={document} />
    </div>
  );
}

export function VersionView({view, className}: {view: AgentSettingsView; className?: string}) {
  return (
    <div className={cn('space-y-3', className)}>
      <VersionHeader view={view} />
      <VersionBody view={view} />
    </div>
  );
}
