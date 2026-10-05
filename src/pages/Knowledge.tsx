import {useState} from 'react';
import {useParams} from 'react-router-dom';

import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {MultiSelector, TextInput} from '@/components/fields';
import {DataTable} from '@/components/DataTable';
import {EmptyState, Markdown, Note, Page, PageHeader, Section, Timestamp, Token} from '@/components/kit';

import {api} from '../api/client';
import type {IndexStatusRow, SearchHit} from '../api/types';
import {useResource} from '../api/useResource';
import {Loaded} from '../components/Feedback';
import {failureSource, runState} from '../components/health';

// Что известно проекту: гибридный поиск по коду, артефактам и документам плюс
// состояние индекса, из которого он читает. Тем же поиском пользуется агент
// через MCP-тул sdlc_search_context — экран показывает ровно то, что увидит он.

const SCOPES = [
  {value: 'code', label: 'код'},
  {value: 'artifacts', label: 'артефакты задач'},
  {value: 'documents', label: 'документы проекта'},
];

export function Knowledge() {
  const {projectKey = ''} = useParams();

  return (
    <Page>
      <PageHeader
        title="Поиск"
        description="Гибридный поиск по знанию проекта: вектор находит смысл, полнотекст — точное имя функции или ключ конфига."
      />
      <div className="space-y-6">
        <Search projectKey={projectKey} />
        <IndexState projectKey={projectKey} />
      </div>
    </Page>
  );
}

function Search({projectKey}: {projectKey: string}) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<string[]>([]);
  // Запрос уходит по кнопке, а не на каждую букву: поиск считает эмбеддинг,
  // и дёргать его посимвольно — платить за каждое нажатие.
  const [applied, setApplied] = useState<{query: string; scope: string[]}>();

  const submit = () => {
    if (query.trim() === '') return;
    setApplied({query: query.trim(), scope});
  };

  return (
    <Section title="Запрос">
      <Card className="gap-3 p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <TextInput
            label="Что ищем"
            description="вопрос словами или имя символа"
            value={query}
            onChange={setQuery}
            onEnter={submit}
          />
          <MultiSelector
            label="Где искать"
            description="пусто — по коду, артефактам и документам сразу"
            options={SCOPES}
            value={scope}
            onChange={setScope}
            placeholder="везде"
          />
        </div>
        <div>
          <Button onClick={submit} disabled={query.trim() === ''}>
            Найти
          </Button>
        </div>
      </Card>

      {applied ? (
        <Results
          key={`${applied.query}/${applied.scope.join(',')}`}
          projectKey={projectKey}
          query={applied.query}
          scope={applied.scope}
        />
      ) : null}
    </Section>
  );
}

// Выдача живёт отдельным компонентом: он монтируется на каждый новый запрос,
// и прежние находки не остаются на экране под новым вопросом.
function Results({
  projectKey,
  query,
  scope,
}: {
  projectKey: string;
  query: string;
  scope: string[];
}) {
  const results = useResource(() => api.search(projectKey, {query, scope}), [projectKey, query, scope]);

  return (
    <Loaded resource={results}>
      {(found) => (
        <div className="space-y-3">
          {found.mode === 'text' ? (
            <Note
              tone="warning"
              title="Поиск идёт только полнотекстом"
              description="Провайдер эмбеддингов выключен или недоступен: запрос «как тут устроено X» найдёт заметно меньше, чем при гибридном режиме."
            />
          ) : null}
          {found.results.length === 0 ? (
            <EmptyState
              title="Ничего не нашлось"
              description="Проверьте состояние индекса ниже: репозиторий мог ещё не индексироваться."
            />
          ) : (
            found.results.map((hit, i) => <Hit key={`${hit.scope}-${i}`} hit={hit} />)
          )}
        </div>
      )}
    </Loaded>
  );
}

const SCOPE_LABEL: Record<string, string> = {
  code: 'код',
  artifacts: 'артефакт',
  documents: 'документ',
};

function Hit({hit}: {hit: SearchHit}) {
  return (
    <Card className="gap-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{SCOPE_LABEL[hit.scope] ?? hit.scope}</Badge>
          <span className="font-mono text-xs">{where(hit)}</span>
          {hit.symbol_fqn ? <Token label={hit.symbol_fqn} color="blue" /> : null}
          {hit.task ? <Token label={hit.task} /> : null}
        </div>
        {/* Ранг слияния, а не расстояние: гибридный поиск складывает две
            выдачи по позициям, и абсолютное число тут ничего не значит. */}
        <span className="text-muted-foreground text-xs tabular-nums">{hit.score.toFixed(3)}</span>
      </div>
      {hit.title ? <p className="text-sm font-medium">{hit.title}</p> : null}
      {/* Попадание по коду остаётся кодом, а попадание по артефакту или
          документу — это текст, написанный разметкой, и читается он разметкой. */}
      {hit.scope === 'code' ? (
        <pre className="bg-muted/40 max-h-60 overflow-auto rounded-md p-2 font-mono text-xs whitespace-pre-wrap">
          {hit.text}
        </pre>
      ) : (
        <div className="bg-muted/40 max-h-60 overflow-auto rounded-md p-2">
          <Markdown>{hit.text}</Markdown>
        </div>
      )}
    </Card>
  );
}

// Где находка: у кода это файл со строками, у артефакта — задача и этап,
// у документа — его название.
function where(hit: SearchHit): string {
  if (hit.path) {
    const lines = hit.start_line ? `:${hit.start_line}-${hit.end_line}` : '';
    return `${hit.repository ? `${hit.repository} · ` : ''}${hit.path}${lines}`;
  }
  if (hit.stage) return `${hit.stage}${hit.kind ? ` · ${hit.kind}` : ''}`;
  return hit.kind ?? hit.match;
}

// Состояние индекса — по последнему прогону на репозиторий. Отношение
// «переиспользовано» к «проиндексировано» показывает, во что обошлась
// инкрементальность: там, где меняются десятки файлов из тысяч, разница на два
// порядка (решение 0018).
function IndexState({projectKey}: {projectKey: string}) {
  const status = useResource(() => api.indexStatus(projectKey), [projectKey]);

  return (
    <Section
      title="Состояние индекса"
      description="По последнему прогону индексации на репозиторий. Прогон ставит в очередь вебхук GitHub, в сеть ходит воркер.">
      <Loaded resource={status}>
        {(rows) => (
          <DataTable<IndexStatusRow>
            data={rows}
            idKey="repository"
            empty={
              <EmptyState
                title="Индексировать нечего"
                description="В области проекта нет репозиториев с включённой индексацией"
              />
            }
            columns={[
              {
                key: 'repository',
                header: 'Репозиторий',
                // Причина нечитаемости стоит в самой строке, а не в подсказке
                // бейджа: по подсказке её однажды не заметили (CLAB-79).
                renderCell: (r) =>
                  r.failure ? (
                    <div className="min-w-80 space-y-1 whitespace-normal" data-unreadable={r.repository}>
                      <div>{r.repository}</div>
                      <p className="text-destructive text-xs">
                        не читается с <Timestamp value={r.failure.since} className="text-xs text-inherit" /> —{' '}
                        {failureSource(r.failure.source)}
                      </p>
                      <p className="text-muted-foreground text-xs break-words">{r.failure.error}</p>
                      <p className="text-muted-foreground text-xs">
                        {r.last_indexed_at ? (
                          <>
                            индекс собран <Timestamp value={r.last_indexed_at} format="relative" className="text-xs" />
                          </>
                        ) : (
                          'индекс ещё не собирался'
                        )}
                      </p>
                    </div>
                  ) : (
                    r.repository
                  ),
              },
              {
                key: 'branch',
                header: 'Ветка',
                width: 140,
                // Ветка последнего прогона; пока прогонов не было — те, за
                // которыми репозиторий обещано следить.
                renderCell: (r) => r.branch ?? branches(r.watch_branches),
              },
              {
                key: 'commit',
                header: 'Коммит',
                width: 110,
                renderCell: (r) => (r.commit ? r.commit.slice(0, 8) : '—'),
              },
              {
                key: 'state',
                header: 'Прогон',
                width: 130,
                renderCell: (r) => <RunState row={r} />,
              },
              {
                key: 'files',
                header: 'Файлов',
                width: 150,
                align: 'end',
                renderCell: (r) => counted(r.files_indexed, r.files_reused),
              },
              {
                key: 'chunks',
                header: 'Кусков',
                width: 150,
                align: 'end',
                renderCell: (r) => counted(r.chunks_indexed, r.chunks_reused),
              },
              {
                key: 'chunks_embedded',
                header: 'Эмбеддингов',
                width: 130,
                align: 'end',
                renderCell: (r) => (r.chunks_embedded ?? 0).toLocaleString('ru'),
              },
              {
                key: 'finished_at',
                header: 'Когда',
                width: 160,
                renderCell: (r) =>
                  r.finished_at ?? r.last_indexed_at ? (
                    <Timestamp value={(r.finished_at ?? r.last_indexed_at)!} format="relative" />
                  ) : (
                    '—'
                  ),
              },
            ]}
          />
        )}
      </Loaded>
    </Section>
  );
}

function RunState({row}: {row: IndexStatusRow}) {
  const state = runState(row);
  return (
    <span className="inline-flex items-center gap-1" title={state.title}>
      <Badge variant={state.variant}>{state.label}</Badge>
    </span>
  );
}

function branches(list?: string[]): string {
  return list && list.length > 0 ? list.join(', ') : '—';
}

// «Проиндексировано / переиспользовано»: второе число — то, за что не платили
// заново.
function counted(indexed?: number, reused?: number): string {
  if (indexed == null && reused == null) return '—';
  return `${(indexed ?? 0).toLocaleString('ru')} / ${(reused ?? 0).toLocaleString('ru')}`;
}
