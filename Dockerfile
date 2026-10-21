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
#
# Базовые образы закреплены по digest (CLAB-203, решение 0051): тег — для
# человека, Docker тянет по digest, поэтому сборка локально, в CI и в релизе
# идёт на одной базе. Digest внутри той же линии тега раз в неделю обновляет
# Dependabot (.github/dependabot.yml) отдельным PR; смена линии (Node 26,
# Caddy 3) — решение человека отдельной задачей.

FROM --platform=$BUILDPLATFORM node:24-alpine@sha256:6a1c190e17215d844926b0677f4bf87273ff7d5e54db06d3b5b5863ab0b09a3d AS build
# SBOM образа (release.yml, sbom: true) по умолчанию описывает только
# финальный этап — Caddy со статикой, без npm-зависимостей, из которых
# собран бандл. Флаг просит BuildKit просканировать и этот этап: в SBOM
# попадают пакеты из package-lock.json (CLAB-130). На обычную сборку без
# --sbom не влияет.
ARG BUILDKIT_SBOM_SCAN_STAGE=true
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
FROM caddy:2-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
COPY --from=build /out/license/ /
EXPOSE 80
