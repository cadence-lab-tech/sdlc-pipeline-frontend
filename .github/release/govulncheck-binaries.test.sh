#!/usr/bin/env bash
# Проверка govulncheck-binaries.sh без сети: govulncheck подменён заглушкой,
# которая отвечает потоком JSON того же вида, что govulncheck v1.9.0
# -format json, а openvex.json — настоящий файл репозитория.
#   bash .github/release/govulncheck-binaries.test.sh
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
script="$here/govulncheck-binaries.sh"
vex="$here/openvex.json"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Заглушка: находки берёт из FAKE_<имя бинаря> (ID через пробел; префикс
# mod: — находка уровня модуля, без функции в trace), FAKE_FAIL=<имя> —
# govulncheck падает на этом бинаре.
cat >"$tmp/govulncheck" <<'SH'
#!/usr/bin/env bash
bin="${!#}"
name=$(basename "$bin")
[ "${FAKE_FAIL:-}" = "$name" ] && { echo "govulncheck: fetching vulnerabilities: dial tcp: i/o timeout" >&2; exit 1; }
var="FAKE_$name"
printf '{\n  "config": {\n    "scanner_name": "govulncheck",\n    "scan_mode": "binary"\n  }\n}\n'
for id in ${!var:-}; do
  case "$id" in
  mod:*) printf '{\n  "finding": {\n    "osv": "%s",\n    "trace": [\n      {\n        "module": "golang.org/x/crypto",\n        "version": "v0.58.0"\n      }\n    ]\n  }\n}\n' "${id#mod:}" ;;
  *) printf '{\n  "finding": {\n    "osv": "%s",\n    "trace": [\n      {\n        "module": "golang.org/x/crypto",\n        "version": "v0.58.0",\n        "package": "golang.org/x/crypto/openpgp",\n        "function": "*"\n      }\n    ]\n  }\n}\n' "$id" ;;
  esac
done
SH
chmod +x "$tmp/govulncheck"
for b in caddy; do : >"$tmp/$b"; done

fails=0
run() { # имя, ожидаемый код, затем переменные окружения
  local name=$1 want=$2; shift 2
  : >"$tmp/summary"
  set +e
  env GOVULNCHECK="$tmp/govulncheck" GITHUB_STEP_SUMMARY="$tmp/summary" "$@" \
    bash "$script" "$vex" "$tmp/caddy" >"$tmp/out" 2>&1
  code=$?
  set -e
  if [ "$code" != "$want" ]; then
    echo "FAIL $name: код $code, ждали $want"; cat "$tmp/out"; fails=$((fails + 1))
  fi
}
expect() { # имя, файл, шаблон
  grep -qF -- "$3" "$tmp/$2" || { echo "FAIL $1: в $2 нет «$3»"; cat "$tmp/$2"; fails=$((fails + 1)); }
}
expect_not() {
  ! grep -qF -- "$3" "$tmp/$2" || { echo "FAIL $1: в $2 есть «$3»"; cat "$tmp/$2"; fails=$((fails + 1)); }
}

# Как у v0.18.0 после подъёма x/net: GO-2026-5932 в Caddy заявлен в VEX —
# уведомление, ни одного предупреждения, сводка в файле прогона.
run vex-covered 0 FAKE_caddy=GO-2026-5932
expect vex-covered out "::notice title=govulncheck::caddy: GO-2026-5932 — заявлен в VEX"
expect_not vex-covered out "::warning"
expect vex-covered out "незаявленных находок: 0"
expect vex-covered summary "| caddy | GO-2026-5932 | заявлен |"

# Как у v0.18.0 до подъёма: x/net v0.60.0 даёт две находки вне VEX —
# предупреждения с ID, релиз не падает.
run uncovered 0 FAKE_caddy="GO-2026-5932 GO-2026-6860 GO-2026-6866"
expect uncovered out "::warning title=govulncheck::caddy: GO-2026-6860 — нет в VEX"
expect uncovered out "::warning title=govulncheck::caddy: GO-2026-6866 — нет в VEX"
expect uncovered out "https://pkg.go.dev/vuln/GO-2026-6860"
expect uncovered out "::notice title=govulncheck::caddy: GO-2026-5932"
expect uncovered out "незаявленных находок: 2"
expect uncovered summary "| caddy | GO-2026-6866 | **нет** |"

# Находок нет.
run clean 0 FAKE_caddy=
expect clean out "caddy: находок нет"
expect clean out "незаявленных находок: 0"

# Находка уровня модуля — не «affected», предупреждения нет.
run module-level 0 FAKE_caddy=mod:GO-2099-0002
expect_not module-level out "GO-2099-0002"
expect module-level out "caddy: находок нет"

# govulncheck упал (нет сети к vuln.go.dev) — предупреждение, код 0.
run tool-fails 0 FAKE_FAIL=caddy
expect tool-fails out "::warning title=govulncheck::caddy: govulncheck не отработал"
expect tool-fails out "i/o timeout"

# Без аргументов — ошибка вызова, а не тишина.
set +e
bash "$script" "$vex" >/dev/null 2>&1
code=$?
set -e
[ "$code" = 2 ] || { echo "FAIL usage: код $code, ждали 2"; fails=$((fails + 1)); }

# VEX — валидный OpenVEX: контекст, утверждение про GO-2026-5932 со
# статусом и обоснованием, которые читают сканеры.
jq -e '."@context" == "https://openvex.dev/ns/v0.2.0"
  and ([.statements[] | select(.vulnerability.name == "GO-2026-5932"
        and .status == "not_affected"
        and .justification == "vulnerable_code_not_present")] | length == 1)' "$vex" >/dev/null ||
  { echo "FAIL openvex.json: нет утверждения GO-2026-5932 not_affected/vulnerable_code_not_present"; fails=$((fails + 1)); }

if [ "$fails" -gt 0 ]; then
  echo "провалено: $fails"; exit 1
fi
echo "ok: govulncheck-binaries.sh"
