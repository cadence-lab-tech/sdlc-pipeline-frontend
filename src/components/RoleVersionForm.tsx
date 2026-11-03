import {useEffect, useId, useRef, useState} from 'react';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Switch, TextInput} from '@/components/fields';
import {Note, Spinner} from '@/components/kit';

import {ApiError, api} from '../api/client';
import type {OutputContractItem, RoleProposal, RoleVersion} from '../api/types';
import {Failure} from './Feedback';
import {ModelLevelToggle} from './ModelLevelToggle';
import {DocumentEditor} from './pipeline/DocumentEditor';
import {
  type RoleDraft,
  countsLabel,
  draftCounts,
  draftFromVersion,
  failedDocumentId,
  newRoleDraft,
  pinnedCount,
  versionBody,
} from './pipeline/roleDocs';

// Новая версия роли заводится копией предыдущей: правка — это почти всегда
// «то же самое, но точнее», а не текст с нуля. Версия — набор документов
// (CLAB-347, решение 0068): форма правит документы редактором и шлёт один
// POST …/versions с documents, без instructions.
//
// Без roleKey форма заводит роль целиком (CLAB-346, «Завести роль»): ключ,
// название и описание плюс первая версия тем же редактором с одним пустым
// main.md — одним запросом POST …/roles с version.documents.
//
// Режим proposal (CLAB-384, решение 0072): участник уровня agent не заводит
// версию, а предлагает её. Те же поля и тот же редактор, «Что изменилось»
// обязательно, запрос — POST …/proposals; версию заведёт сопровождающий,
// утвердив предложение.
//
// Серверные правила форма не повторяет: пустое содержимое и дубль имени
// отклонит сервер, его сообщение показывается дословно, а названный в нём
// документ подсвечивается.
export function RoleVersionForm({
  projectKey,
  roleKey,
  base,
  onCreated,
  onCancel,
  library,
  mode = 'version',
  onProposed,
}: {
  projectKey: string;
  roleKey?: string;
  // Библиотека инструкций для редактора документов (CLAB-351).
  library?: {latest: Map<string, number>; onOpenInstruction?: (key: string, version: number) => void};
  // Версия, копией которой строится форма; нужна с текстом документов.
  base?: RoleVersion;
  onCreated: (roleKey: string, created?: RoleVersion) => void;
  onCancel: () => void;
  // proposal — «Предложение новой версии»; нужен roleKey.
  mode?: 'version' | 'proposal';
  onProposed?: (proposal: RoleProposal) => void;
}) {
  const isProposal = mode === 'proposal' && Boolean(roleKey);
  const isNewRole = !roleKey;
  const [newKey, setNewKey] = useState('');
  const [newName, setNewName] = useState('');
  const [newSummary, setNewSummary] = useState('');
  const [draft, setDraft] = useState<RoleDraft>(() => (isNewRole ? newRoleDraft() : draftFromVersion(base)));
  const [selected, setSelected] = useState<number | undefined>(() => draft.docs[0]?.id);
  const [flagged, setFlagged] = useState<number>();
  const levelLabel = useId();
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);
  // «Что изменилось» подсвечивается после потери фокуса пустым или попытки
  // отправить, не при открытии.
  const [changelogTouched, setChangelogTouched] = useState(false);
  const failure = useRef<HTMLDivElement>(null);

  const patch = (p: Partial<RoleDraft>) => setDraft((d) => ({...d, ...p}));
  const counts = draftCounts(draft.docs);

  // Отказ: фокус на сообщении, на узком экране — прокрутка к нему.
  useEffect(() => {
    if (!error) return;
    failure.current?.focus();
    failure.current?.scrollIntoView?.({block: 'nearest'});
  }, [error]);

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    setFlagged(undefined);
    const sent = draft.docs;
    try {
      const version = versionBody(draft, base);
      if (roleKey && isProposal) {
        const proposal = await api.proposeRoleVersion(projectKey, roleKey, {
          ...version,
          changelog: draft.changelog.trim(),
        });
        toast.success('Предложение отправлено: версию заведёт сопровождающий после утверждения');
        onProposed?.(proposal);
      } else if (roleKey) {
        const created = await api.createRoleVersion(projectKey, roleKey, version);
        toast.success(`Версия ${created.version} роли ${roleKey} создана`);
        onCreated(roleKey, created);
      } else {
        const key = newKey.trim();
        await api.createRole(projectKey, {
          key,
          name: newName.trim(),
          summary: newSummary.trim() || undefined,
          version,
        });
        toast.success(`Роль ${key} создана`);
        onCreated(key);
      }
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError('internal', String(err));
      // Документ, названный в сообщении («документ N (…)»), — номер среди
      // отправленных: выбрать и подсветить.
      const id = failedDocumentId(e.message, sent);
      setFlagged(id);
      if (id !== undefined) setSelected(id);
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="@container gap-4 overflow-visible p-4" data-new-role={isNewRole ? '' : undefined}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-base font-semibold">
          {isNewRole
            ? 'Новая роль'
            : isProposal
              ? `Предложение новой версии ${base ? `после v${base.version}` : ''}`
              : `Новая версия ${base ? `после v${base.version}` : ''}`}
        </h3>
        {isNewRole ? null : (
          <p className="text-muted-foreground text-xs" aria-live="polite" data-form-counter>
            {countsLabel(counts, pinnedCount(draft.docs))}
          </p>
        )}
      </div>
      {isProposal ? (
        <Note
          title={`Версия не заведётся сразу: её утвердит сопровождающий. Пока предложение не решено, прогоны идут по v${base?.version ?? ''}.`}
        />
      ) : null}
      {error ? (
        <div ref={failure} tabIndex={-1} role="alert" className="space-y-1.5 outline-none" data-form-failure>
          <Failure
            error={error}
            title={isNewRole ? 'Роль не заведена' : isProposal ? 'Предложение не отправлено' : 'Версия не создана'}
          />
          <p className="text-muted-foreground text-xs">
            {isProposal
              ? 'Введённое осталось в форме: исправьте и отправьте ещё раз.'
              : 'Введённое осталось в форме: исправьте и сохраните ещё раз.'}
          </p>
        </div>
      ) : null}
      {isNewRole ? (
        <div className="space-y-4">
          <TextInput
            label="Ключ"
            description="Латиницей: по нему роль стоит на статусах и приходит в связке"
            value={newKey}
            onChange={setNewKey}
            isRequired
          />
          <TextInput label="Название" value={newName} onChange={setNewName} isRequired />
          <TextInput label="Описание" value={newSummary} onChange={setNewSummary} />
        </div>
      ) : null}

      <DocumentEditor
        docs={draft.docs}
        onDocs={(docs) => patch({docs})}
        selected={selected}
        onSelect={setSelected}
        flagged={flagged}
        onFlagCleared={() => setFlagged(undefined)}
        baseVersion={base?.version}
        focusFirst={!isNewRole}
        library={library ? {projectKey, ...library} : undefined}
      />

      <div className="grid gap-4 @[600px]:grid-cols-2">
        {/* Потерю фокуса ловит обёртка: focusout всплывает от поля. */}
        <div onBlur={() => isProposal && setChangelogTouched(true)} data-proposal-changelog={isProposal ? '' : undefined}>
          <TextInput
            label="Что изменилось"
            description={isProposal ? 'Нужно: что и зачем меняется' : undefined}
            value={draft.changelog}
            onChange={(changelog) => patch({changelog})}
            isRequired={isProposal}
            isInvalid={isProposal && changelogTouched && !draft.changelog.trim()}
          />
        </div>
        <TextInput
          label="Что читает на входе"
          description="Виды артефактов через запятую"
          value={draft.inputKinds}
          onChange={(inputKinds) => patch({inputKinds})}
        />
      </div>
      <div className="space-y-1.5">
        <p id={levelLabel} className="text-sm font-medium">
          Уровень модели
        </p>
        <ModelLevelToggle value={draft.modelLevel} onChange={(modelLevel) => patch({modelLevel})} labelledBy={levelLabel} />
        <p className="text-muted-foreground text-xs">Уровень роли по умолчанию: его перекрывают уровень задачи и этапа</p>
      </div>

      <ContractEditor items={draft.contract} onChange={(contract) => patch({contract})} />

      {/* Подвал липкий: на узком экране «Сохранить» иначе уезжает за экран. */}
      <div className="bg-card sticky bottom-0 z-10 -mx-4 -mb-4 flex justify-end gap-2 rounded-b-xl border-t px-4 py-3" data-form-footer>
        <Button variant="ghost" onClick={onCancel}>
          Отмена
        </Button>
        <Button
          disabled={busy || (isNewRole && (!newKey.trim() || !newName.trim())) || (isProposal && !draft.changelog.trim())}
          onClick={() => {
            if (isProposal && !draft.changelog.trim()) {
              setChangelogTouched(true);
              return;
            }
            void submit();
          }}>
          {busy ? (
            <>
              <Spinner /> {isProposal ? 'Отправляем…' : 'Сохраняем…'}
            </>
          ) : isNewRole ? (
            'Завести роль'
          ) : isProposal ? (
            'Отправить предложение'
          ) : (
            'Сохранить версию'
          )}
        </Button>
      </div>
    </Card>
  );
}

// Вид артефакта (kind) — то, на что ссылается гейт artifacts_required, поэтому
// пункт контракта без него бессмыслен, и бэкенд такой не принимает.
function ContractEditor({
  items,
  onChange,
}: {
  items: OutputContractItem[];
  onChange: (items: OutputContractItem[]) => void;
}) {
  const patch = (index: number, next: Partial<OutputContractItem>) =>
    onChange(items.map((item, i) => (i === index ? {...item, ...next} : item)));

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Контракт вывода</p>
      {items.map((item, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
          <div className="w-55 max-w-full">
            <TextInput label="Вид" value={item.kind} onChange={(kind) => patch(i, {kind})} isRequired />
          </div>
          <div className="w-55 max-w-full">
            <TextInput label="Название" value={item.title ?? ''} onChange={(title) => patch(i, {title})} />
          </div>
          <div className="w-35 max-w-full">
            <TextInput label="Формат" value={item.format ?? ''} onChange={(format) => patch(i, {format})} />
          </div>
          <div className="pb-2">
            <Switch
              label="Обязателен"
              value={item.required ?? false}
              onChange={(required) => patch(i, {required})}
            />
          </div>
          <Button variant="ghost" size="sm" onClick={() => onChange(items.filter((_, j) => j !== i))}>
            Убрать
          </Button>
        </div>
      ))}
      <Button
        variant="secondary"
        size="sm"
        onClick={() => onChange([...items, {kind: '', format: 'markdown', required: true}])}>
        Добавить артефакт
      </Button>
    </div>
  );
}
