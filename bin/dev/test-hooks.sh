#!/bin/bash
# Test suite para los hooks del plugin
# Uso: bash bin/dev/test-hooks.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_DIR="$SCRIPT_DIR/../hooks"
PASS=0
FAIL=0

_pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
_fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

run_in_tmpdir() {
    local dir
    dir=$(mktemp -d)
    (cd "$dir" && eval "$1")
    local rc=$?
    rm -rf "$dir"
    return $rc
}

echo ""
echo "=== session-start.sh ==="

# Caso 1: sin .todo/ → exit 0, sin output
result=$(run_in_tmpdir '
    out=$(bash '"$HOOKS_DIR"'/session-start.sh 2>&1); rc=$?
    [ $rc -eq 0 ] && [ -z "$out" ] && echo OK || echo "rc=$rc out=$out"
')
[ "$result" = "OK" ] && _pass "sin .todo/ → exit 0 silencioso" || _fail "sin .todo/ → $result"

# Caso 2: .todo/ existe + config.json existe → exit 0, sin output
result=$(run_in_tmpdir '
    mkdir -p .todo
    echo "{}" > .todo/config.json
    out=$(bash '"$HOOKS_DIR"'/session-start.sh 2>&1); rc=$?
    [ $rc -eq 0 ] && [ -z "$out" ] && echo OK || echo "rc=$rc out=$out"
')
[ "$result" = "OK" ] && _pass ".todo/ + config.json → exit 0 silencioso" || _fail ".todo/ + config.json → $result"

# Caso 3: .todo/ existe sin config.json → exit 2, stderr con mensaje
result=$(run_in_tmpdir '
    mkdir -p .todo
    err=$(bash '"$HOOKS_DIR"'/session-start.sh 2>&1); rc=$?
    [ $rc -eq 2 ] && echo "$err" | grep -q "TODO-CONFIG-MISSING" && echo OK || echo "rc=$rc err=$err"
')
[ "$result" = "OK" ] && _pass ".todo/ sin config.json → exit 2 + TODO-CONFIG-MISSING" || _fail ".todo/ sin config.json → $result"

echo ""
echo "=== pre-commit.sh ==="

# Input simulado: comando que NO es git commit → exit 0
result=$(run_in_tmpdir '
    input='"'"'{"tool_input":{"command":"echo hello"}}'"'"'
    out=$(echo "$input" | bash '"$HOOKS_DIR"'/pre-commit.sh 2>&1); rc=$?
    [ $rc -eq 0 ] && echo OK || echo "rc=$rc out=$out"
')
[ "$result" = "OK" ] && _pass "no git commit → exit 0 silencioso" || _fail "no git commit → $result"

# Input simulado: git commit sin .todo/ → exit 0
result=$(run_in_tmpdir '
    git init -q && git config user.email "t@t.com" && git config user.name "T"
    input='"'"'{"tool_input":{"command":"git commit -m test"}}'"'"'
    out=$(echo "$input" | bash '"$HOOKS_DIR"'/pre-commit.sh 2>&1); rc=$?
    [ $rc -eq 0 ] && echo OK || echo "rc=$rc out=$out"
')
[ "$result" = "OK" ] && _pass "git commit sin .todo/ → exit 0 silencioso" || _fail "git commit sin .todo/ → $result"

# Input simulado: git commit con .todo/DOING.md con tareas + staged files → exit 2
result=$(run_in_tmpdir '
    git init -q && git config user.email "t@t.com" && git config user.name "T"
    mkdir -p .todo
    echo "- [ ] **Tarea de prueba** — descripción" > .todo/DOING.md
    echo "contenido" > archivo.txt
    git add archivo.txt
    input='"'"'{"tool_input":{"command":"git commit -m feat: algo"}}'"'"'
    err=$(echo "$input" | bash '"$HOOKS_DIR"'/pre-commit.sh 2>&1); rc=$?
    [ $rc -eq 2 ] && echo "$err" | grep -q "TODO-PRE-COMMIT" && echo OK || echo "rc=$rc err=$err"
')
[ "$result" = "OK" ] && _pass "git commit con tareas en DOING + staged → exit 2 + TODO-PRE-COMMIT" || _fail "git commit con tareas → $result"

echo ""
echo "=== error-checker.sh ==="

# Input: comando exitoso → exit 0
result=$(run_in_tmpdir '
    mkdir -p .todo
    input='"'"'{"tool_input":{"command":"echo ok"},"tool_response":{"is_error":false}}'"'"'
    out=$(echo "$input" | bash '"$HOOKS_DIR"'/error-checker.sh 2>&1); rc=$?
    [ $rc -eq 0 ] && echo OK || echo "rc=$rc out=$out"
')
[ "$result" = "OK" ] && _pass "comando exitoso → exit 0 silencioso" || _fail "comando exitoso → $result"

# Input: comando fallido con .todo/ → exit 2 + mensaje
result=$(run_in_tmpdir '
    mkdir -p .todo
    input='"'"'{"tool_input":{"command":"python3 run.py"},"tool_response":{"is_error":true,"content":[{"text":"ModuleNotFoundError"}]}}'"'"'
    err=$(echo "$input" | bash '"$HOOKS_DIR"'/error-checker.sh 2>&1); rc=$?
    [ $rc -eq 2 ] && echo "$err" | grep -q "TODO-ERROR-CHECKER" && echo OK || echo "rc=$rc err=$err"
')
[ "$result" = "OK" ] && _pass "comando fallido → exit 2 + TODO-ERROR-CHECKER" || _fail "comando fallido → $result"

echo ""
echo "Resultado: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ] && exit 0 || exit 1
