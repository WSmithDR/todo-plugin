#!/bin/bash
# Test suite para los hooks del plugin
# Uso: bash bin/dev/test-hooks.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_DIR="$SCRIPT_DIR/../hooks"
GIT_HOOKS_DIR="$SCRIPT_DIR/git-hooks"
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

# Sin .todo/ → exit 0 silencioso
result=$(run_in_tmpdir '
    out=$(bash '"$HOOKS_DIR"'/session-start.sh 2>&1); rc=$?
    [ $rc -eq 0 ] && [ -z "$out" ] && echo OK || echo "rc=$rc out=$out"
')
[ "$result" = "OK" ] && _pass "sin .todo/ → exit 0 silencioso" || _fail "sin .todo/ → $result"

# .todo/ + config.json → exit 0 silencioso (sin .git, CLAUDE_PLUGIN_ROOT vacío)
result=$(run_in_tmpdir '
    mkdir -p .todo && echo "{}" > .todo/config.json
    out=$(CLAUDE_PLUGIN_ROOT="" bash '"$HOOKS_DIR"'/session-start.sh 2>&1); rc=$?
    [ $rc -eq 0 ] && [ -z "$out" ] && echo OK || echo "rc=$rc out=$out"
')
[ "$result" = "OK" ] && _pass ".todo/ + config.json → exit 0 silencioso" || _fail ".todo/ + config.json → $result"

# .todo/ sin config.json → exit 2 + TODO-CONFIG-MISSING
result=$(run_in_tmpdir '
    mkdir -p .todo
    err=$(CLAUDE_PLUGIN_ROOT="" bash '"$HOOKS_DIR"'/session-start.sh 2>&1); rc=$?
    [ $rc -eq 2 ] && echo "$err" | grep -q "TODO-CONFIG-MISSING" && echo OK || echo "rc=$rc err=$err"
')
[ "$result" = "OK" ] && _pass ".todo/ sin config.json → exit 2 + TODO-CONFIG-MISSING" || _fail ".todo/ sin config.json → $result"

# .git/ + CLAUDE_PLUGIN_ROOT set + hook no instalado → instala el hook
result=$(run_in_tmpdir '
    mkdir -p .todo .git/hooks && echo "{}" > .todo/config.json
    FAKE_ROOT=$(mktemp -d)
    mkdir -p "$FAKE_ROOT/bin/hooks"
    touch "$FAKE_ROOT/bin/hooks/pre-commit.sh"
    out=$(CLAUDE_PLUGIN_ROOT="$FAKE_ROOT" bash '"$HOOKS_DIR"'/session-start.sh 2>&1); rc=$?
    [ $rc -eq 0 ] && [ -L ".git/hooks/pre-commit" ] && echo "$out" | grep -q "TODO-SETUP" && echo OK || echo "rc=$rc out=$out link=$(readlink .git/hooks/pre-commit 2>/dev/null || echo none)"
    rm -rf "$FAKE_ROOT"
')
[ "$result" = "OK" ] && _pass ".git/ + CLAUDE_PLUGIN_ROOT → hook instalado" || _fail ".git/ + CLAUDE_PLUGIN_ROOT → $result"

# Hook ya instalado correctamente → sin reinstalar
result=$(run_in_tmpdir '
    mkdir -p .todo .git/hooks && echo "{}" > .todo/config.json
    FAKE_ROOT=$(mktemp -d)
    mkdir -p "$FAKE_ROOT/bin/hooks"
    touch "$FAKE_ROOT/bin/hooks/pre-commit.sh"
    ln -sf "$FAKE_ROOT/bin/hooks/pre-commit.sh" .git/hooks/pre-commit
    out=$(CLAUDE_PLUGIN_ROOT="$FAKE_ROOT" bash '"$HOOKS_DIR"'/session-start.sh 2>&1); rc=$?
    [ $rc -eq 0 ] && [ -z "$out" ] && echo OK || echo "rc=$rc out=$out"
    rm -rf "$FAKE_ROOT"
')
[ "$result" = "OK" ] && _pass "hook ya instalado → sin reinstalar" || _fail "hook ya instalado → $result"

echo ""
echo "=== pre-commit.sh ==="

# Sin .todo/ → exit 0
result=$(run_in_tmpdir '
    git init -q && git config user.email "t@t.com" && git config user.name "T"
    out=$(bash '"$HOOKS_DIR"'/pre-commit.sh 2>&1); rc=$?
    [ $rc -eq 0 ] && [ -z "$out" ] && echo OK || echo "rc=$rc out=$out"
')
[ "$result" = "OK" ] && _pass "sin .todo/ → exit 0 silencioso" || _fail "sin .todo/ → $result"

# .todo/ sin tareas abiertas → exit 0
result=$(run_in_tmpdir '
    git init -q && git config user.email "t@t.com" && git config user.name "T"
    mkdir -p .todo && touch .todo/DOING.md .todo/TODO.md
    out=$(bash '"$HOOKS_DIR"'/pre-commit.sh 2>&1); rc=$?
    [ $rc -eq 0 ] && [ -z "$out" ] && echo OK || echo "rc=$rc out=$out"
')
[ "$result" = "OK" ] && _pass ".todo/ sin tareas → exit 0 silencioso" || _fail ".todo/ sin tareas → $result"

# Tareas en DOING + staged files → exit 1 + mensaje
result=$(run_in_tmpdir '
    git init -q && git config user.email "t@t.com" && git config user.name "T"
    mkdir -p .todo
    echo "- [ ] **Tarea de prueba** — descripción" > .todo/DOING.md
    echo "contenido" > archivo.txt && git add archivo.txt
    err=$(bash '"$HOOKS_DIR"'/pre-commit.sh 2>&1); rc=$?
    [ $rc -eq 1 ] && echo "$err" | grep -q "TODO-PRE-COMMIT" && echo OK || echo "rc=$rc err=$err"
')
[ "$result" = "OK" ] && _pass "tareas en DOING + staged → exit 1 + TODO-PRE-COMMIT" || _fail "tareas en DOING + staged → $result"

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
echo "=== commit-msg (versionado) ==="

_test_bump() {
    local label="$1"
    local msg="$2"
    local initial="$3"
    local expected="$4"

    result=$(run_in_tmpdir "
        git init -q && git config user.email 't@t.com' && git config user.name 'T'
        mkdir -p .claude-plugin
        echo '{\"version\":\"$initial\"}' > .claude-plugin/plugin.json
        echo 'x' > file.txt && git add file.txt
        msg_file=\$(mktemp)
        echo '$msg' > \"\$msg_file\"
        out=\$(bash '$GIT_HOOKS_DIR/commit-msg' \"\$msg_file\" 2>&1); rc=\$?
        got=\$(python3 -c \"import json; print(json.load(open('.claude-plugin/plugin.json'))['version'])\")
        [ \$rc -eq 0 ] && [ \"\$got\" = '$expected' ] && echo OK || echo \"rc=\$rc got=\$got out=\$out\"
    ")
    [ "$result" = "OK" ] && _pass "$label ($initial → $expected)" || _fail "$label → $result"
}

_test_bump "fix: → patch"    "fix: corregir algo"          "1.0.3" "1.0.4"
_test_bump "feat: → minor"   "feat: nueva funcionalidad"   "1.0.3" "1.1.0"
_test_bump "chore: → patch"  "chore: actualizar deps"      "1.2.5" "1.2.6"
_test_bump "docs: → patch"   "docs: actualizar README"     "1.0.3" "1.0.4"
_test_bump "BREAKING → major" "feat!: romper API"          "1.0.3" "2.0.0"

# Si plugin.json ya fue staged manualmente, no tocar
result=$(run_in_tmpdir "
    git init -q && git config user.email 't@t.com' && git config user.name 'T'
    mkdir -p .claude-plugin
    echo '{\"version\":\"9.9.9\"}' > .claude-plugin/plugin.json
    git add .claude-plugin/plugin.json
    echo 'x' > file.txt && git add file.txt
    msg_file=\$(mktemp)
    echo 'fix: algo' > \"\$msg_file\"
    bash '$GIT_HOOKS_DIR/commit-msg' \"\$msg_file\" 2>&1
    got=\$(python3 -c \"import json; print(json.load(open('.claude-plugin/plugin.json'))['version'])\")
    [ \"\$got\" = '9.9.9' ] && echo OK || echo \"got=\$got\"
")
[ "$result" = "OK" ] && _pass "plugin.json staged manualmente → sin cambios" || _fail "plugin.json staged manualmente → $result"

echo ""
echo "Resultado: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ] && exit 0 || exit 1
