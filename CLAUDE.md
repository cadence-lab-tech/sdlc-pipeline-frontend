# CLAUDE.md — sdlc-pipeline-frontend

Интерфейс SDLC Pipeline: доска задач, карточка задачи с таймлайном и артефактами
по этапам, редакторы ролей и цикла.

## Прежде чем писать код

Домен описан в [sdlc-pipeline-docs](https://github.com/stepaKaziatko/sdlc-pipeline-docs), локально — соседняя
директория `../docs/`:

- `../docs/ARCHITECTURE.md` — что такое задача, этап, гейт, роль, дрейф
- `../docs/decisions/README.md` — принятые решения

API отдаёт [backend](https://github.com/stepaKaziatko/sdlc-pipeline-backend); контракт данных совпадает со
схемой в `../backend/migrations/`.

## Стек

Vite, React 19, TypeScript, [Astryx](https://github.com/facebook/astryx) 0.5.0
(`@astryxdesign/core` + `@astryxdesign/theme-neutral`)
([решение 0014](../docs/decisions/0014-astryx-ui.md)).

## Astryx — как работать

**Не гадать по именам компонентов.** У библиотеки есть CLI, отдающий полную
документацию:

```bash
npx @astryxdesign/cli component --list      # все компоненты
npx @astryxdesign/cli component Table       # props, варианты, примеры, темизация
npx @astryxdesign/cli template --list       # готовые шаблоны страниц
npx @astryxdesign/cli template dashboard    # исходник шаблона целиком
npx @astryxdesign/cli docs tokens           # токены: отступы, цвета, радиусы, типографика
```

Индекс компонентов дописан в конец этого файла командой `npx @astryxdesign/cli init`.

**Страницу начинать с шаблона**, а не собирать из примитивов: `template --list`
покрывает дашборды, настройки, формы и страницы деталей — ровно то, что нужно
здесь.

**StyleX здесь не компилируется** — сборочных плагинов нет. Поэтому
`stylex.create()` из шаблонов не переносить: своё оформление задаётся пропсами
компонента, а если их не хватает — `style` с токенами
(`var(--spacing-*)`, `var(--color-*)`), без сырых пикселей и цветов.
Исключение — структурные размеры вроде ширины колонки.

**Порядок импорта CSS значим** — он отражает каскад слоёв:

```css
@import '@astryxdesign/core/reset.css';      /* @layer reset */
@import '@astryxdesign/core/astryx.css';     /* @layer astryx-base */
@import '@astryxdesign/theme-neutral/theme.css'; /* @layer astryx-theme */
```

Для Vite сборочные плагины не нужны — компоненты приезжают пре-собранными,
StyleX уже скомпилирован. React 19 обязателен.

## Структура

```
src/
  api/         типы по схеме БД, клиент REST, useResource
  components/  общие блоки: гейты, карточка задачи, диалоги, форма свойств
  pages/       Projects, Board, TaskDetail, Roles, WorkflowEditor, Metrics, Settings, Login
  App.tsx      AppShell, боковая навигация, роутинг
e2e/           сквозные проверки в headless-Chrome поверх живого бэкенда
```

| Страница | Назначение |
|---|---|
| Projects | Проекты и репозитории в их области |
| Board | Доска задач по статусам действующего цикла, переключение типа задач, фильтр по эпику, создание задачи |
| TaskDetail | Этапы с артефактами, вердикт гейтов, переходы, нарезка эпика, стоимость, связи, область, лента |
| Roles | Роли и их версии: инструкция, вход, контракт вывода, где роль стоит |
| WorkflowEditor | Версии цикла: черновик, статусы, переходы, гейты, активация |
| Metrics | Длительность статусов, вердикты гейтов, дрейф, стоимость по статусам, ролям и моделям, пропускная способность за период |
| Settings | Участники и их уровни, токены доступа, экспорт и импорт связки правил |
| Login | Вход по токену (режим `SDLC_AUTH_MODE=token`); в режиме header не показывается |

## Конвенции кода

- **Пустые массивы бэкенд опускает** (`omitempty`), поэтому ответы
  нормализуются в `api/client.ts` — один раз на весь клиент. Компонент, который
  сам помнит про «а вдруг поля нет», рано или поздно про это забудет и уронит
  страницу целиком.
- **Данные не кэшируются.** Задачу двигают агенты с других машин; показать
  сохранённый ответ вместо текущего хуже, чем сходить в сеть. При перезапросе
  тех же данных прежний ответ остаётся на экране, чтобы страница не схлопывалась
  в спиннер после каждого действия.
- **Сообщение об ошибке показывается как есть.** Оно уже написано для человека,
  а код ошибки общий у REST и MCP — ветвиться нужно по коду, не по тексту.
- **Категория статуса и вид перехода — перечни схемы**, по ним выбирать
  оформление можно. Ключ статуса и ключ роли придумывает проект — по ним нельзя.
- **Токен живёт в `localStorage` (`sdlc.token`) и добавляется в `api/client.ts`**
  ко всем запросам. Без токена клиент шлёт `X-SDLC-Actor` — это работает только
  в режиме header. Любой 401 поднимает событие `UNAUTHENTICATED_EVENT`, и
  оболочка уводит на `/login`; страницы про аутентификацию не знают. Права
  проверяет бэкенд: 403 показывается как обычная ошибка, кнопки по уровню
  участника не прячутся ([решение 0021](../docs/decisions/0021-token-auth-and-project-members.md)).

## Что нельзя делать

- **Хардкодить статусы и роли.** Они кастомные на каждый проект и приходят из
  API. Никаких списков `['analysis', 'development', …]` в коде и никаких цветов,
  привязанных к именам статусов — цвет лежит в `workflow_statuses.color`.
- **Считать набор гейтов фиксированным.** Типов десять, конфиг у каждого свой;
  UI рендерит по типу, а не по позиции.
- **Считать, что цикл в проекте один.** Активных циклов столько, сколько типов
  задач, и доска показывает один из них ([решение 0024](../docs/decisions/0024-epic-as-task-with-own-workflow.md)).
  Тип берётся из `active_workflows`, а не из списка в коде: `task` и `epic` —
  данные проекта, а не перечисление фронтенда.
- **Показывать «нет отчёта» как ноль.** Прогон, о котором агент не отчитался,
  стоит «неизвестно»; в карточке и метриках такие прогоны считаются отдельно
  ([решение 0026](../docs/decisions/0026-usage-per-stage-run.md)), и сложить их
  с настоящими нулями значит соврать о счёте.
- **Дублировать доменные правила.** Проверку «можно ли перейти» делает бэкенд;
  фронтенд показывает результат `check_gates`, а не считает его сам.
- **Считать задачу однорепозиторной.** У задачи есть свойства
  (`tasks.properties`) и область по репозиториям (`task_repositories`). Карточка
  рендерит форму свойств по определениям из API (`task_property_defs`), а не по
  захардкоженному списку полей, и показывает область как набор репозиториев —
  для мультирепозиторной задачи их несколько, с PR и сигналами дрейфа на каждый.
- **Двигать задачу перетаскиванием карточки.** Колонка — это статус, а между
  статусами задачу переводит именованный переход со своими гейтами; в одну и ту
  же колонку ведут разные переходы («сдать» и «вернуть»), и у них разный смысл.
- **Раскладывать задачи по доске по `status_id`.** Задача, начатая на прежней
  версии цикла, доходит по ней, и у её статуса другой идентификатор — раскладка
  идёт по `status_key`. Задача со статусом, которого в действующей версии уже
  нет, попадает в отдельную колонку, а не пропадает.
- **Править активный цикл.** Редактируется только черновик; активная версия
  открыта на чтение, и это видно на экране.

## Проверки

`npm run typecheck`, `npm run lint`, `npm run build` и `npm run e2e`.

Сквозные проверки (`e2e/`) кликают настоящими кнопками в headless-Chrome поверх
поднятого бэкенда: экраны показывают вердикт гейтов и состояние цикла, и
подменять их заглушками — значит проверять заглушки. Порядок сценариев значим:
`workflow.mjs` активирует новую версию цикла, а `epic.mjs` рассчитывает на
демонстрационный эпик с тремя нетронутыми детьми. База поднимается заново
(`cd ../backend && make reset && make up`) — сиды не идемпотентны.

## Статус

Фазы 1, 4 и 5 закрыты: доска с переключением типа задач и фильтром по эпику,
карточка задачи с нарезкой, стоимостью и связями, редактор ролей и цикла, вход
по токену, участники и токены проекта, перенос связки правил, метрики цикла
вместе со стоимостью.

Не сделано: аренды и живой прогресс агента, вложенные прогоны перепроверки
(фаза 2), сигналы дрейфа в карточке и на доске, состояние индекса и поиск
(фаза 3) — REST всё это уже отдаёт. Из фазы 5 в интерфейсе нет назначения
исполнителя (ручка `PUT /tasks/{key}/assignee` есть, кнопки нет) и правки
типов задач у черновика цикла.

<!-- ASTRYX:START -->
Astryx v0.5.0 · 163 components
CLI: run every command as `npx astryx <cmd>` (shown below as `astryx ...`).

SETUP (once, in your app entry e.g. main.tsx) — without these, components render unstyled:
  import "@astryxdesign/core/reset.css";
  import "@astryxdesign/core/astryx.css";

WORKFLOW — discover, don't guess. Before writing UI:
1. `astryx build "<idea>"` — START HERE: returns a kit (closest [page] + [block]s + [component]s). No args = full playbook.
2. `astryx template <name> [--skeleton]` — scaffold the [page]/[block]s it named, or study their layout. Templates are reference code.
3. `astryx component <Name>` — props + examples for every component you use.

RULES:
- No <div> — components do all layout/spacing, page frame included.
- Frame first: read `astryx docs layout` before writing any page or screen — page frame, region widths, breakpoint behavior.
- Dense data = rows (Table, List/Item), never Card-wrapped list items; Card is for standalone widgets. Status = StatusDot/Token; Badge = counts only.
- Custom styling: component props first; else style/className with tokens — var(--color-*|--spacing-*|--radius-*). No raw hex/px. (No StyleX/Tailwind compiler here — don't use xstyle/utility classes.)
- Tokens for every value (`astryx docs tokens`). Brand/accent belongs in the theme (`astryx theme list` / `theme add <slug>`, or `astryx theme template` for a custom one) — never override --color-* in :root.
- SELF-CHECK before you finish: re-read the file and replace any raw <div>/<span> layout, imported .css/@apply, or hardcoded value (#hex, 16px) with the component or a token (var(--color-*|--spacing-*|…)). If unsure a component/prop exists, run `astryx component <Name>` / `astryx search "<thing>"`; don't hand-roll CSS.

MORE CLI:
  search "<query>"   find any component / hook / doc / template / block
  component --list   163 components by category
  template --list    page + block recipes
  docs <topic>       browser-support, cli-integrations, color, elevation, getting-started, icons, illustrations, internationalization, layout, migration, motion, principles, shape, spacing, styling-libraries, styling, theme, tokens, typography, working-with-ai
  swizzle <Name>     eject component source for deep customization
  upgrade --apply    run after any @astryxdesign/core bump
<!-- ASTRYX:END -->
