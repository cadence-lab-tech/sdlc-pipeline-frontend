# Образ интерфейса: сборка Vite, затем Caddy со статикой. Адрес API в бандл
# не вморожен — клиент ходит в /v1 того же origin, а к сервису его ведёт
# внешний Caddy (backend/deploy/Caddyfile).
#
#   docker build -t sdlc-pipeline-frontend .

FROM node:24-alpine AS build
WORKDIR /app

# Манифесты отдельным слоем: правка кода не выбрасывает кэш установки.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# LICENSE из корня репозитория ложится в корень образа, /LICENSE. Файла нет —
# каталог пуст и сборка по SHA для нашего инстанса не падает; образ версии
# без лицензии не выпускает release.yml, он проверяет файл до сборки.
RUN mkdir -p /out/license && if [ -f LICENSE ]; then cp LICENSE /out/license/; fi

# Раздача статики. Caddy, а не nginx: тот же образ, что у внешнего прокси,
# и конфиг в три строки вместо блока location.
FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
COPY --from=build /out/license/ /
EXPOSE 80
