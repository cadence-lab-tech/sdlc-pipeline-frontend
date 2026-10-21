// Caddy образа интерфейса, собранный из исходников (CLAB-234, решение 0056).
//
// Тот же набор модулей, что у официального дистрибутива (modules/standard),
// но на текущем Go из Dockerfile и на версиях модулей из go.mod/go.sum этого
// каталога: upstream caddy:2-alpine на новом Go не пересобирается, и
// исправления Go и golang.org/x/net до образа иначе не доходят.
package main

import (
	caddycmd "github.com/caddyserver/caddy/v2/cmd"

	_ "github.com/caddyserver/caddy/v2/modules/standard"
)

func main() {
	caddycmd.Main()
}
