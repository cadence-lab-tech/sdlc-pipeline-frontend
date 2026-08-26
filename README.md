# SDLC Pipeline — Frontend

Интерфейс системы, ведущей задачи по настраиваемому циклу разработки: доска
задач, карточка задачи с таймлайном и артефактами по этапам, редактор ролей и
редактор цикла с гейтами.

Бэкенд: [sdlc-pipeline-backend](https://github.com/stepaKaziatko/sdlc-pipeline-backend) ·
Документация по домену: [sdlc-pipeline-docs](https://github.com/stepaKaziatko/sdlc-pipeline-docs)

## Стек

Vite, React 19, TypeScript, [Astryx](https://github.com/facebook/astryx) 0.5.0
(`@astryxdesign/core` + `@astryxdesign/theme-neutral`).

Astryx требует React 19 и не нуждается в сборочных плагинах — компоненты
приезжают пре-собранными. Порядок импорта CSS важен: `reset.css` →
`astryx.css` → `theme.css`.

## Страницы

| Страница | Назначение |
|---|---|
| Projects | Список проектов, привязка GitHub-репозиториев и проектных документов |
| Board | Доска задач по статусам текущего цикла |
| TaskDetail | Таймлайн задачи, артефакты по этапам, гейты, сигналы дрейфа, апрувы |
| Roles | Редактор ролей: инструкции, входные артефакты, контракт вывода |
| WorkflowEditor | Статусы, переходы и гейты проекта |

## Статус

Фаза 0: репозиторий заведён, код ещё не написан.
