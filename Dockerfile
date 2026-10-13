# Образ интерфейса: сборка Vite, затем Caddy со статикой. Адрес API в бандл
# не вморожен — клиент ходит в /v1 того же origin, а к сервису его ведёт
# внешний Caddy (backend/deploy/Caddyfile).
#
#   docker build -t sdlc-pipeline-frontend .
#
# Образ версии выходит под linux/amd64 и linux/arm64 (release.yml). Статика
# от архитектуры не зависит, поэтому этап сборки закреплён за платформой
# сборщика ($BUILDPLATFORM): npm ci и Vite идут один раз, на раннере, а не
# под QEMU для каждой целевой платформы (QEMU в CI нет — сборка бы упала).
# Обычный `docker build` (deploy.yml) ничего не замечает.

FROM --platform=$BUILDPLATFORM node:24-alpine AS build
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
# и конфиг в три строки вместо блока location. Этап выполняется под целевой
# платформой, поэтому в нём только COPY — RUN потребовал бы эмуляции.
FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
COPY --from=build /out/license/ /
EXPOSE 80
