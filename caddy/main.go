// Caddy образа интерфейса, собранный из исходников (CLAB-234, решение 0056).
//
// Набор модулей — modules/standard официального дистрибутива без одного
// пакета, caddypki/acmeserver (директива acme_server, CLAB-374): он единственный
// принимает по сети JWK, JWE и JOSE JSON и тянет go-jose/v3, у которого нет
// исправленной версии (GHSA-mgcc-cww5-fp2q, GHSA-4w3g-jfj2-cw2q,
// GHSA-vvm8-gf78-28g4). Ни Caddyfile образа, ни Caddyfile пакета self-hosted
// его не включают, а утверждение VEX (.github/release/openvex.json) опирается
// на то, что пакета в бинаре нет: Dockerfile роняет сборку, если он вернулся.
// Список ниже сверять с modules/standard/imports.go при смене версии Caddy:
// новый пакет в нём — решение, подключать ли его, а не молчаливое наследование.
//
// Модули собираются на текущем Go из Dockerfile и на версиях из go.mod/go.sum
// этого каталога: upstream caddy:2-alpine на новом Go не пересобирается, и
// исправления Go и golang.org/x/net до образа иначе не доходят.
package main

import (
	caddycmd "github.com/caddyserver/caddy/v2/cmd"

	// Модули modules/standard (Caddy v2.11.9) без caddypki/acmeserver.
	_ "github.com/caddyserver/caddy/v2/caddyconfig/caddyfile"
	_ "github.com/caddyserver/caddy/v2/modules/caddyevents"
	_ "github.com/caddyserver/caddy/v2/modules/caddyevents/eventsconfig"
	_ "github.com/caddyserver/caddy/v2/modules/caddyfs"
	_ "github.com/caddyserver/caddy/v2/modules/caddyhttp/standard"
	_ "github.com/caddyserver/caddy/v2/modules/caddypki"
	_ "github.com/caddyserver/caddy/v2/modules/caddytls"
	_ "github.com/caddyserver/caddy/v2/modules/caddytls/distributedstek"
	_ "github.com/caddyserver/caddy/v2/modules/caddytls/standardstek"
	_ "github.com/caddyserver/caddy/v2/modules/filestorage"
	_ "github.com/caddyserver/caddy/v2/modules/logging"
	_ "github.com/caddyserver/caddy/v2/modules/metrics"
)

func main() {
	caddycmd.Main()
}
