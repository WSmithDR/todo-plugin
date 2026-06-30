#!/bin/bash
# Test de bin/todo-store.sh con XDG_DATA_HOME temporal.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STORE="$SCRIPT_DIR/todo-store.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export XDG_DATA_HOME="$TMP/share"
BASE="$XDG_DATA_HOME/todo"

# git necesita identidad para commitear en el repo del store
export GIT_AUTHOR_NAME="Tester" GIT_AUTHOR_EMAIL="t@e.st"
export GIT_COMMITTER_NAME="Tester" GIT_COMMITTER_EMAIL="t@e.st"

fail() { echo "FAIL: $1" >&2; exit 1; }

# create
id1=$(cd "$TMP" && "$STORE" create "Sitio A")
[ "$id1" = "sitio-a" ] || fail "esperaba id 'sitio-a', obtuve '$id1'"
[ -f "$BASE/sitio-a/.todo/config.json" ] || fail "no se creó config.json"
[ -d "$BASE/.git" ] || fail "no se inicializó el repo base"
grep -q '"name": "Sitio A"' "$BASE/sitio-a/.todo/config.json" || fail "name incorrecto en config"

# create duplicado → desambiguación
id2=$(cd "$TMP" && "$STORE" create "Sitio A")
[ "$id2" = "sitio-a-2" ] || fail "esperaba 'sitio-a-2', obtuve '$id2'"

# list
out=$(cd "$TMP" && "$STORE" list)
echo "$out" | grep -q $'sitio-a\tSitio A' || fail "list no muestra sitio-a"
echo "$out" | grep -q $'sitio-a-2\tSitio A' || fail "list no muestra sitio-a-2"

# path
p=$(cd "$TMP" && "$STORE" path sitio-a)
[ "$p" = "$BASE/sitio-a" ] || fail "path incorrecto: '$p'"
[ -d "$p/.todo" ] || fail "path no garantiza .todo/"

# mode: dentro de un repo de código (fuera del BASE)
mkdir -p "$TMP/code" && (cd "$TMP/code" && git init -q)
m=$(cd "$TMP/code" && "$STORE" mode)
[ "$m" = "repo" ] || fail "mode en repo de código esperaba 'repo', obtuve '$m'"

# mode: dentro del BASE → nonrepo
m=$(cd "$BASE/sitio-a" && "$STORE" mode)
[ "$m" = "nonrepo" ] || fail "mode dentro del store esperaba 'nonrepo', obtuve '$m'"

# mode: dir pelado sin git → nonrepo
mkdir -p "$TMP/bare"
m=$(cd "$TMP/bare" && "$STORE" mode)
[ "$m" = "nonrepo" ] || fail "mode en dir pelado esperaba 'nonrepo', obtuve '$m'"

echo "OK: todo-store.sh"
