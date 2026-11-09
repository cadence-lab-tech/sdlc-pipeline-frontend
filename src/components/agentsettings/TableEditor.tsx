import {useState} from 'react';
import {Plus, Trash2, X} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Selector, TextInput} from '@/components/fields';
import {Token} from '@/components/kit';

import {
  KNOWN_AGENTS,
  LEVELS,
  P,
  PRICE_FIELDS,
  PRICE_LABELS,
  PRICE_UNIT,
  addAgent,
  agentNames,
  agentOf,
  duplicateIds,
  emptyPriceRow,
  emptyPricing,
  isObject,
  levelOf,
  modelsOf,
  pricingFrom,
  priceRows,
  removeAgent,
  setAsOf,
  setLevelField,
  setModels,
  setPricing,
  type Doc,
  type PriceField,
  type PriceRow,
} from './rules';

// Вкладка «Таблица» (design.spec §4.3): линза над разобранным документом.
// Таблица пишет по пути в документ, поля, которых она не показывает, остаются
// как есть. Проверяет только сервер: числа, даты и формы имён уходят как
// набрано, а его отказ приходит `errorAt(путь)` и кладётся к полю.

const UNSET = '__unset__';
const CUSTOM = '__custom__';

export interface TableEditorProps {
  doc: Doc;
  disabled: boolean;
  // Документ меняется; touched — серверный путь поля, чья ошибка снимается.
  onChange: (next: Doc, touched?: string) => void;
  errorAt: (path: string) => string | undefined;
  // Дубль id модели в прайсе: целостность самого редактора.
  onDuplicates: (has: boolean) => void;
}

export function TableEditor({doc, disabled, onChange, errorAt, onDuplicates}: TableEditorProps) {
  const names = agentNames(doc);
  return (
    <div className="space-y-3" data-editor="table">
      {names.length === 0 ? (
        <p className="text-muted-foreground text-sm">Агентов нет: добавьте агента ниже.</p>
      ) : null}
      {names.map((name) => (
        <AgentEditor key={name} name={name} doc={doc} disabled={disabled} onChange={onChange} errorAt={errorAt} />
      ))}
      <AddAgent doc={doc} disabled={disabled} onChange={onChange} />
      <PricingEditor
        doc={doc}
        disabled={disabled}
        onChange={onChange}
        errorAt={errorAt}
        onDuplicates={onDuplicates}
      />
    </div>
  );
}

// ── агенты ──────────────────────────────────────────────────────────────────

function AgentEditor({
  name,
  doc,
  disabled,
  onChange,
  errorAt,
}: {
  name: string;
  doc: Doc;
  disabled: boolean;
  onChange: TableEditorProps['onChange'];
  errorAt: TableEditorProps['errorAt'];
}) {
  const agent = agentOf(doc, name);
  const models = modelsOf(agent);
  const listed = (models ?? []).filter((m) => m !== '');
  const custom = !(KNOWN_AGENTS as readonly string[]).includes(name);

  const setList = (next: string[], touched?: string) => onChange(setModels(doc, name, next), touched);

  return (
    <Card className="gap-3 p-4" data-agent={name}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h4 tabIndex={-1} className="font-mono text-sm font-semibold outline-none" data-path={P.agent(name)}>
            {name}
          </h4>
          {custom ? <Token label="свой агент" /> : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={`Удалить агента ${name}`}
          onClick={() => onChange(removeAgent(doc, name), P.agent(name))}>
          <Trash2 />
        </Button>
      </div>
      {errorAt(P.agent(name)) ? (
        <p data-path={P.agent(name)} className="text-destructive text-xs">
          {errorAt(P.agent(name))}
        </p>
      ) : null}

      <div className="space-y-2">
        <h5 className="text-sm font-medium">Доступные модели</h5>
        {models === undefined || models.length === 0 ? (
          <p className="text-muted-foreground text-xs">Список пуст: доступны любые модели</p>
        ) : null}
        {(models ?? []).map((m, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="flex-1">
              <TextInput
                label={`Модель ${i + 1} агента ${name}`}
                isLabelHidden
                value={m}
                isDisabled={disabled}
                dataPath={P.model(name, i)}
                error={errorAt(P.model(name, i))}
                placeholder="полный id модели"
                onChange={(v) => setList((models ?? []).map((x, j) => (j === i ? v : x)), P.model(name, i))}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              aria-label={`Убрать модель ${i + 1} агента ${name}`}
              onClick={() => setList((models ?? []).filter((_, j) => j !== i), P.model(name, i))}>
              <X />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => setList([...(models ?? []), ''])}>
          <Plus /> Добавить модель
        </Button>
      </div>

      <div className="space-y-2">
        <h5 className="text-sm font-medium">Уровни</h5>
        {LEVELS.map((level) => {
          const entry = levelOf(agent, level);
          const model = typeof entry.model === 'string' ? entry.model : '';
          const effort = typeof entry.effort === 'string' ? entry.effort : '';
          return (
            <div
              key={level}
              className="grid grid-cols-1 items-start gap-2 sm:grid-cols-[5rem_1fr_10rem]"
              data-level={level}>
              <span className="font-mono text-sm sm:pt-1.5">{level}</span>
              {listed.length > 0 ? (
                <Selector
                  label={`Модель уровня ${level} агента ${name}`}
                  isLabelHidden
                  value={model === '' ? UNSET : model}
                  isDisabled={disabled}
                  dataPath={P.levelModel(name, level)}
                  error={errorAt(P.levelModel(name, level))}
                  options={[
                    {value: UNSET, label: '— не задан —'},
                    ...(model !== '' && !listed.includes(model)
                      ? [{value: model, label: `${model} (нет в списке)`}]
                      : []),
                    ...[...new Set(listed)].map((m) => ({value: m, label: m})),
                  ]}
                  onChange={(v) =>
                    onChange(setLevelField(doc, name, level, 'model', v === UNSET ? '' : v), P.levelModel(name, level))
                  }
                />
              ) : (
                <TextInput
                  label={`Модель уровня ${level} агента ${name}`}
                  isLabelHidden
                  value={model}
                  isDisabled={disabled}
                  dataPath={P.levelModel(name, level)}
                  error={errorAt(P.levelModel(name, level))}
                  placeholder="полный id модели"
                  onChange={(v) => onChange(setLevelField(doc, name, level, 'model', v), P.levelModel(name, level))}
                />
              )}
              <TextInput
                label={`Усилие уровня ${level} агента ${name}`}
                isLabelHidden
                value={effort}
                isDisabled={disabled}
                dataPath={P.levelEffort(name, level)}
                error={errorAt(P.levelEffort(name, level))}
                placeholder="например, high"
                onChange={(v) => onChange(setLevelField(doc, name, level, 'effort', v), P.levelEffort(name, level))}
              />
            </div>
          );
        })}
        <p className="text-muted-foreground text-xs">
          Уровень без модели не задан: агент возьмёт таблицу привязки по умолчанию.
        </p>
      </div>
    </Card>
  );
}

function AddAgent({
  doc,
  disabled,
  onChange,
}: {
  doc: Doc;
  disabled: boolean;
  onChange: TableEditorProps['onChange'];
}) {
  const present = new Set(agentNames(doc));
  const options = [
    ...KNOWN_AGENTS.filter((a) => !present.has(a)).map((a) => ({value: a, label: a})),
    {value: CUSTOM, label: 'Свой агент…'},
  ];
  const [kind, setKind] = useState<string>(options[0].value);
  const [custom, setCustom] = useState('');
  const [clash, setClash] = useState(false);
  // Выбранный пункт мог уйти из списка (агента добавили): тогда первый.
  const effective = options.some((o) => o.value === kind) ? kind : options[0].value;
  const name = effective === CUSTOM ? custom : effective;

  const add = () => {
    if (name === '') return;
    if (present.has(name)) {
      setClash(true);
      return;
    }
    setClash(false);
    setCustom('');
    onChange(addAgent(doc, name));
  };

  return (
    <Card className="gap-3 p-4" data-editor-add="agent">
      <h5 className="text-sm font-medium">Добавить агента</h5>
      <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[12rem_1fr_auto]">
        <Selector
          label="Агент"
          value={effective}
          options={options}
          isDisabled={disabled}
          onChange={(v) => {
            setKind(v);
            setClash(false);
          }}
        />
        {effective === CUSTOM ? (
          <TextInput
            label="Имя агента"
            value={custom}
            isDisabled={disabled}
            description="Строчная латиница, цифры, _ и -, до 32 символов"
            error={clash ? 'Такой агент уже есть' : undefined}
            onChange={(v) => {
              setCustom(v);
              setClash(false);
            }}
            onEnter={add}
          />
        ) : (
          <span />
        )}
        <div>
          <Button type="button" variant="secondary" disabled={disabled || name === ''} onClick={add}>
            <Plus /> Добавить агента
          </Button>
        </div>
      </div>
      {effective !== CUSTOM && clash ? <p className="text-destructive text-xs">Такой агент уже есть</p> : null}
    </Card>
  );
}

// ── прайс ───────────────────────────────────────────────────────────────────

function PricingEditor({
  doc,
  disabled,
  onChange,
  errorAt,
  onDuplicates,
}: {
  doc: Doc;
  disabled: boolean;
  onChange: TableEditorProps['onChange'];
  errorAt: TableEditorProps['errorAt'];
  onDuplicates: (has: boolean) => void;
}) {
  // Ряды — своё состояние редактора: см. PriceRow. Заново они строятся из
  // документа, когда редактор монтируется (вкладка, сброс, серверный черновик).
  const [rows, setRows] = useState<PriceRow[]>(() => priceRows(doc));
  const pricing = isObject(doc.pricing) ? doc.pricing : undefined;

  const commit = (next: PriceRow[], touched?: string) => {
    setRows(next);
    onDuplicates(duplicateIds(next).size > 0);
    onChange(setPricing(doc, pricingFrom(pricing, next)), touched);
  };

  if (!pricing) {
    return (
      <Card className="gap-3 p-4" data-editor-pricing="none">
        <h5 className="text-sm font-medium">Прайс</h5>
        <p className="text-muted-foreground text-sm">Прайс не задан: суммы считаются так, как их сообщил агент.</p>
        <div>
          <Button
            type="button"
            variant="secondary"
            disabled={disabled}
            onClick={() => {
              setRows([]);
              onChange(setPricing(doc, emptyPricing()));
            }}>
            Добавить прайс
          </Button>
        </div>
      </Card>
    );
  }

  const dups = duplicateIds(rows);
  const asOf = typeof pricing.as_of === 'string' ? pricing.as_of : '';
  const patch = (uid: string, change: Partial<PriceRow>, touched?: string) =>
    commit(rows.map((r) => (r.uid === uid ? {...r, ...change} : r)), touched);

  return (
    <Card className="gap-3 p-4" data-editor-pricing="set">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 className="text-sm font-medium">Прайс · {PRICE_UNIT}</h5>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => {
            setRows([]);
            onDuplicates(false);
            onChange(setPricing(doc, undefined));
          }}>
          Убрать прайс
        </Button>
      </div>
      <div className="max-w-xs">
        <TextInput
          label="Дата прайса (as_of)"
          value={asOf}
          isDisabled={disabled}
          placeholder="ГГГГ-ММ-ДД"
          description="На какой день верны цены"
          dataPath={P.asOf}
          error={errorAt(P.asOf)}
          onChange={(v) => onChange(setAsOf(doc, v), P.asOf)}
        />
      </div>
      {rows.map((r, i) => (
        <div key={r.uid} className="grid grid-cols-2 items-start gap-2 lg:grid-cols-[1.6fr_repeat(4,1fr)_auto]" data-price-row={r.id}>
          <div className="col-span-2 lg:col-span-1">
            <TextInput
              label={`Id модели ${i + 1}`}
              isLabelHidden={i > 0}
              value={r.id}
              isDisabled={disabled}
              placeholder="полный id модели"
              dataPath={P.priceModel(r.id)}
              error={dups.has(r.id) ? 'Такой id уже есть в прайсе' : errorAt(P.priceModel(r.id))}
              onChange={(v) => patch(r.uid, {id: v}, P.priceModel(r.id))}
            />
          </div>
          {PRICE_FIELDS.map((f) => (
            <PriceInput
              key={f}
              label={`${PRICE_LABELS[f]} ${r.id || i + 1}`}
              visibleLabel={PRICE_LABELS[f]}
              showLabel={i === 0}
              value={r[f]}
              disabled={disabled}
              path={P.price(r.id, f)}
              error={errorAt(P.price(r.id, f))}
              onChange={(v) => patch(r.uid, {[f]: v} as Partial<PriceRow>, P.price(r.id, f))}
              field={f}
            />
          ))}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            className={i === 0 ? 'mt-6' : undefined}
            aria-label={`Убрать модель ${r.id || i + 1} из прайса`}
            onClick={() => commit(rows.filter((x) => x.uid !== r.uid), P.priceModel(r.id))}>
            <X />
          </Button>
        </div>
      ))}
      {rows.length === 0 ? <p className="text-muted-foreground text-xs">В прайсе нет моделей</p> : null}
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => commit([...rows, emptyPriceRow()])}>
          <Plus /> Добавить модель в прайс
        </Button>
      </div>
    </Card>
  );
}

function PriceInput({
  label,
  visibleLabel,
  showLabel,
  value,
  disabled,
  path,
  error,
  onChange,
  field,
}: {
  label: string;
  visibleLabel: string;
  showLabel: boolean;
  value: string;
  disabled: boolean;
  path: string;
  error: string | undefined;
  onChange: (v: string) => void;
  field: PriceField;
}) {
  return (
    <div data-price-field={field}>
      <TextInput
        // У первой строки подпись столбца видна, у остальных — только для
        // программ чтения; в aria-label попадает id модели.
        label={showLabel ? visibleLabel : label}
        isLabelHidden={!showLabel}
        value={value}
        isDisabled={disabled}
        inputMode="decimal"
        dataPath={path}
        error={error}
        onChange={onChange}
      />
    </div>
  );
}
