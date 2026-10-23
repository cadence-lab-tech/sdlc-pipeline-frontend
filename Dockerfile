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
# Go 1.27, Caddy 3) — решение человека отдельной задачей.
#
# Caddy собран из исходников (CLAB-234, решение 0056), а не взят из
# caddy:2-alpine как есть: upstream собирает релиз Caddy один раз и на новом
# Go его не пересобирает, поэтому исправления Go (net/http, crypto/tls) и
# golang.org/x/net до бинаря upstream не доходят. Версии Caddy и модулей —
# caddy/go.mod и caddy/go.sum, их обновляет Dependabot gomod; Go — digest
# golang:1.26-alpine, тот же, что в backend. От caddy:2-alpine остаётся
# база: Alpine, mailcap, /data, /config, CMD.

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

# Caddy из исходников. Как и статика, собирается на платформе сборщика:
# Go кросс-компилирует под $TARGETOS/$TARGETARCH без cgo, эмуляция не нужна.
FROM --platform=$BUILDPLATFORM golang:1.26-alpine@sha256:9ce231b28998b32e116927c61aa5c406183061d4f3f2d61b292c88e7f6bdf7ca AS caddy
ARG TARGETOS
ARG TARGETARCH
ENV CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH
WORKDIR /src

# go.sum проверяет суммы всех модулей: сборка не возьмёт ничего, чего нет в
# репозитории (-mod=readonly по умолчанию).
COPY caddy/go.mod caddy/go.sum ./
RUN go mod download
COPY caddy/*.go ./

# VEX образа (.github/release/openvex.json) утверждает, что пакетов
# golang.org/x/crypto/openpgp в бинаре нет (GO-2026-5932). Новая версия
# Caddy или модуля, которая их потянет, роняет сборку здесь, а не делает
# утверждение ложным молча.
RUN if go list -deps . | grep -E '^golang\.org/x/crypto/openpgp(/|$)'; then \
      echo "caddy: golang.org/x/crypto/openpgp попал в сборку — утверждение GO-2026-5932 в .github/release/openvex.json больше не верно" >&2; \
      exit 1; \
    fi
RUN go build -trimpath -ldflags "-s -w" -o /out/caddy .

# Каталоги состояния Caddy (XDG_DATA_HOME=/data, XDG_CONFIG_HOME=/config у
# базы) с владельцем-пользователем образа: финальный этап без RUN, поэтому
# владельца задаёт COPY --chown, а каталоги готовятся здесь. Сам ui в них не
# пишет (persist_config off в deploy/Caddyfile, сертификатов нет), но
# доступный на запись каталог нужен внешнему caddy на этом образе и тому,
# кто сменит конфиг образа своим.
RUN mkdir -p /out/state/data/caddy /out/state/config/caddy

# Раздача статики. Caddy, а не nginx: тот же образ, что у внешнего прокси,
# и конфиг в три строки вместо блока location. Этап выполняется под целевой
# платформой, поэтому в нём только COPY — RUN потребовал бы эмуляции. Бинарь
# из этапа caddy заменяет upstream'ный /usr/bin/caddy.
#
# Образ работает не от root (CLAB-236): числовой uid 65532, как у backend и
# у podSecurityContext чарта, — runAsNonRoot в Kubernetes проверяется только
# у числового. Слушает один непривилегированный :8080 (deploy/Caddyfile,
# CLAB-248), поэтому у бинаря нет file capability: под Pod Security
# restricted контейнеру хватает drop: [ALL] без add, а запуск с
# --cap-drop ALL и на read-only корне ничего не ломает. Внешний caddy пакета
# на этом же образе запускается от root явным user: "0:0" в compose: его
# сертификаты в томах существующих установок принадлежат root, а :80 и :443
# root слушает и без file capability.
FROM caddy:2-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f
COPY --from=caddy /out/caddy /usr/bin/caddy
COPY --from=caddy --chown=65532:65532 /out/state/ /
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
COPY --from=build /out/license/ /
USER 65532:65532
# 80, 443 и 2019 в ExposedPorts образа остаются от базы caddy:2-alpine:
# унаследованный EXPOSE не снимается. Слушает образ только :8080.
EXPOSE 8080
