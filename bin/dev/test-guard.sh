#!/bin/bash
# Test de bin/todo-guard.sh con HOME/XDG_CACHE_HOME temporales.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GUARD="$SCRIPT_DIR/todo-guard.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export XDG_CACHE_HOME="$TMP/cache"
WINDOW="$XDG_CACHE_HOME/todo-plugin/window"

fail() { echo "FAIL: $1" >&2; exit 1; }

# Helpers que arman el JSON de PreToolUse y lo pasan por stdin.
edit_payload() { printf '{"tool_name":"%s","tool_input":{"file_path":"%s"}}' "$1" "$2"; }
bash_payload() { python3 -c 'import json,sys;print(json.dumps({"tool_name":"Bash","tool_input":{"command":sys.argv[1]}}))' "$1"; }

run() {  # run <unset|on|off> <payload>; imprime el exit code
  local mode="$1"; shift
  if [ "$mode" = "off" ]; then TODO_GUARD=off bash "$GUARD" check; else env -u TODO_GUARD bash "$GUARD" check; fi <<<"$1"
  echo $?
}

# 1. Edit sobre .todo SIN ventana → bloquea (2)
[ "$(run on "$(edit_payload Edit /proj/.todo/TODO.md)")" = "2" ] || fail "Edit .todo sin ventana debía bloquear"

# 2. open + mismo Edit → permite (0)
bash "$GUARD" open
[ -f "$WINDOW" ] || fail "open no creó el sentinela"
[ "$(run on "$(edit_payload Edit /proj/.todo/TODO.md)")" = "0" ] || fail "Edit .todo con ventana debía permitir"

# 3. Edit fuera de .todo → permite (0) aun sin ventana fresca
rm -f "$WINDOW"
[ "$(run on "$(edit_payload Edit /proj/src/x.js)")" = "0" ] || fail "Edit fuera de .todo debía permitir"

# 4. Bash que escribe en .todo SIN ventana → bloquea
[ "$(run on "$(bash_payload 'sed -i s/a/b/ .todo/TODO.md')")" = "2" ] || fail "sed -i .todo sin ventana debía bloquear"

# 5. Bash que solo lee .todo → permite
[ "$(run on "$(bash_payload 'cat .todo/TODO.md')")" = "0" ] || fail "cat .todo debía permitir"

# 5b. Lectura con redirect fuera de .todo → permitido
[ "$(run on "$(bash_payload 'grep foo .todo/TODO.md > /tmp/out.txt')")" = "0" ] \
  || fail "grep .todo > /tmp: lectura con redirect fuera de .todo debía permitir"

# 5c. cat .todo con stderr redirect fuera → permite
[ "$(run on "$(bash_payload 'cat .todo/TODO.md 2>/dev/null')")" = "0" ] \
  || fail "cat .todo 2>/dev/null debía permitir"

# 5d. echo redirigido a .todo/ SIN ventana → bloquea
[ "$(run on "$(bash_payload 'echo x > .todo/TODO.md')")" = "2" ] \
  || fail "echo x > .todo/TODO.md sin ventana debía bloquear"

# 6. Bypass TODO_GUARD=off + Edit .todo sin ventana → permite
rm -f "$WINDOW"
[ "$(run off "$(edit_payload Edit /proj/.todo/TODO.md)")" = "0" ] || fail "bypass debía permitir"

# 7. Ventana vieja (>10 min) → bloquea
bash "$GUARD" open
python3 -c "import os,time; os.utime('$WINDOW', (time.time()-1200, time.time()-1200))"
[ "$(run on "$(edit_payload Edit /proj/.todo/TODO.md)")" = "2" ] || fail "ventana vieja debía bloquear"

# 8. MultiEdit sobre .todo sin ventana → bloquea
rm -f "$WINDOW"
[ "$(run on "$(edit_payload MultiEdit /proj/.todo/DOING.md)")" = "2" ] || fail "MultiEdit .todo sin ventana debía bloquear"

# 9. Payload vacío/no-JSON → permite (fail-open seguro)
[ "$(run on "")" = "0" ] || fail "payload vacío debía permitir (fail-open)"

echo "OK: todo-guard.sh"
