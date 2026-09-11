#!/usr/bin/env bash
# Сквозные проверки интерфейса поверх живого бэкенда.
#
# Порядок сценариев значим: workflow.mjs активирует новую версию цикла, после
# чего прежние сценарии шли бы уже по другому циклу. База поднимается заново,
# потому что сиды не идемпотентны.
set -euo pipefail

API=${SDLC_API_URL:-http://localhost:8088}
UI=${SDLC_UI_URL:-http://localhost:5173}
PORT=${SDLC_CDP_PORT:-9333}
CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
PROFILE=$(mktemp -d)

"$CHROME" --headless --disable-gpu --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE" about:blank >/dev/null 2>&1 &
CHROME_PID=$!
trap 'kill $CHROME_PID 2>/dev/null || true; wait $CHROME_PID 2>/dev/null || true; rm -rf "$PROFILE"' EXIT

for _ in $(seq 1 30); do
  curl -sf "http://127.0.0.1:$PORT/json/version" >/dev/null && break
  sleep 1
done

node e2e/board.mjs
# Задача должна стоять на статусе с гейтами, иначе сценарий карточки бессмыслен.
curl -s -X POST "$API/v1/tasks/SDLC-1/transitions/start" \
  -H 'Content-Type: application/json' -H 'X-SDLC-Actor: e2e' -d '{}' >/dev/null
node e2e/task.mjs
# Аренду берёт настоящий агент: экран показывает то, что лежит на прогоне
# аналитики SDLC-1, и подделывать это в браузере нечем.
curl -s -X POST "$API/v1/tasks/SDLC-1/claim" \
  -H 'Content-Type: application/json' -H 'X-SDLC-Actor: agent:analyst-bot' \
  -d '{"role":"analyst"}' >/dev/null
node e2e/knowledge.mjs
node e2e/epic.mjs
node e2e/roles.mjs
node e2e/settings.mjs
# Команды заводятся до правки цикла: сценарий цикла активирует новую версию,
# после чего прежние экраны идут уже по другому циклу.
# Участник e2e-lead должен существовать до добавления в состав: человек по
# хэндлу не заводится (решение 0033), а актор заголовка — заводится.
curl -s "$API/v1/projects" -H 'X-SDLC-Actor: e2e-lead' >/dev/null
node e2e/admin.mjs
node e2e/workflow.mjs
# Приглашения — последними: приём добавляет участников в SDLC, и прежним
# сценариям их видеть незачем. Второй человек — актор заголовка.
node e2e/invite.mjs
