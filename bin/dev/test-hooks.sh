#!/bin/bash
# Test suite para los hooks del plugin
# Uso: bash bin/dev/test-hooks.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_DIR="$SCRIPT_DIR/../hooks"
GIT_HOOKS_DIR="$SCRIPT_DIR/git-hooks"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PASS=0
FAIL=0

_pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
_fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

# Estado y registro central AISLADOS, para toda la corrida.
#
# Sin esto, cualquier hook que corra en un directorio sin `.todo/` entra a la rama
# del store y lee el registro REAL de quien esté corriendo los tests: le consume el
# aviso del día y, si tuviera algo cerrado en años anteriores, le commitearía la
# rotación. Ya pasó tres veces, siempre por olvidarse de un archivo.
SANDBOX="$(mktemp -d)"
export XDG_CACHE_HOME="$SANDBOX/cache"
export XDG_DATA_HOME="$SANDBOX/data"
trap 'rm -rf "$SANDBOX"' EXIT

run_in_tmpdir() {
    local dir
    dir=$(mktemp -d)
    (cd "$dir" && eval "$1")
    local rc=$?
    rm -rf "$dir"
    return $rc
}

echo ""

echo "=== entrypoints (bin/run.sh → src/) ==="

# Los tests de las reglas viven en src/**/*.test.ts. Acá se prueba solo lo que
# TypeScript no puede probarse a sí mismo: que el shim encuentre el runtime, que
# resuelva su propio symlink, que el payload entre por stdin y que el exit code
# que sale sea el que Claude Code espera.

HOOK="$REPO_ROOT/src/adapters/claude-code/hook.ts"
RUN="$REPO_ROOT/bin/run.sh"

_hook() {  # _hook <modo> <payload-json>; imprime el exit code
    printf '%s' "$2" | bash "$RUN" "$HOOK" "$1" >/dev/null 2>&1
    echo $?
}
_hook_err() {  # _hook_err <modo> <payload-json>; imprime el stderr
    printf '%s' "$2" | bash "$RUN" "$HOOK" "$1" 2>&1 >/dev/null
}
_hook_out() {  # _hook_out <modo> <payload-json>; imprime el stdout
    printf '%s' "$2" | bash "$RUN" "$HOOK" "$1" 2>/dev/null
}

_check() { [ "$2" = "$3" ] && _pass "$1" || _fail "$1 (esperaba $3, dio $2)"; }

# El shim encuentra un runtime capaz de ejecutar .ts
bash "$RUN" "$REPO_ROOT/src/cli/todo-store.ts" mode >/dev/null 2>&1
_check "bin/run.sh ejecuta un .ts" "$?" "0"

# pre-tool-use
_check "pre: Edit fuera de .todo → 0" \
    "$(_hook pre-tool-use '{"tool_name":"Edit","tool_input":{"file_path":"/p/src/x.ts"}}')" "0"

_check "pre: Edit en .todo sin ventana → 2" \
    "$(_hook pre-tool-use '{"tool_name":"Edit","tool_input":{"file_path":"/p/.todo/TODO.md"}}')" "2"

case "$(_hook_err pre-tool-use '{"tool_name":"Edit","tool_input":{"file_path":"/p/.todo/TODO.md"}}')" in
    *TODO-GUARD*) _pass "pre: el mensaje del guard sale por stderr" ;;
    *) _fail "pre: no salió TODO-GUARD por stderr" ;;
esac

bash "$REPO_ROOT/bin/todo-guard.sh" open
_check "pre: con la ventana abierta → 0" \
    "$(_hook pre-tool-use '{"tool_name":"Edit","tool_input":{"file_path":"/p/.todo/TODO.md"}}')" "0"

# La ventana queda abierta para el resto de la corrida; los casos que necesitan
# verla cerrada la borran ellos.
rm -f "$XDG_CACHE_HOME/todo-plugin/window"

# Fail-open: si el adapter no entiende el payload, no bloquea
_check "payload ilegible → 0 (fail-open)" "$(_hook pre-tool-use 'no soy json')" "0"
_check "payload vacío → 0 (fail-open)"    "$(_hook pre-tool-use '')" "0"

# session-start y post-tool-use, contra un proyecto real
TMP_PROJ="$(mktemp -d)"; mkdir -p "$TMP_PROJ/.todo"
# SessionStart avisa por stdout con exit 0: es el único canal que llega al modelo.
# Con exit 2 el texto sale como "hook error" y solo lo ve el usuario.
_check "session-start: .todo sin config → 0" \
    "$(_hook session-start "{\"cwd\":\"$TMP_PROJ\"}")" "0"
case "$(_hook_out session-start "{\"cwd\":\"$TMP_PROJ\"}")" in
    *TODO-CONFIG-MISSING*) _pass "session-start: pide todo-config por stdout" ;;
    *) _fail "session-start: no pidió todo-config por stdout" ;;
esac

_check "post: comando ok → 0" \
    "$(_hook post-tool-use "{\"cwd\":\"$TMP_PROJ\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"npm run build\"},\"tool_response\":{\"exit_code\":0}}")" "0"
_check "post: comando fallido → 2" \
    "$(_hook post-tool-use "{\"cwd\":\"$TMP_PROJ\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"npm run build\"},\"tool_response\":{\"exit_code\":1,\"stderr\":\"boom\"}}")" "2"
rm -rf "$TMP_PROJ"

_check "session-end: sin commits en el medio → 0" \
    "$(_hook session-end "{\"cwd\":\"$TMP_PROJ\"}")" "0"

_check "modo desconocido → 1" \
    "$(_hook modo-inventado '{}')" "1"

echo ""
echo "=== shim del git pre-commit (symlinkeado) ==="

# El shim se instala como symlink en .git/hooks/. Sin resolver el symlink antes
# del dirname, ROOT apunta a .git/ y el hook no encuentra nada.
result=$(run_in_tmpdir "
    git init -q && git config user.email 't@t.com' && git config user.name 'T'
    mkdir -p .todo .git/hooks
    printf '# DOING\n\n- [ ] **Una tarea** — en curso\n' > .todo/DOING.md
    printf '# TODO\n' > .todo/TODO.md
    ln -sf '$REPO_ROOT/bin/hooks/pre-commit.sh' .git/hooks/pre-commit
    echo x > f.txt && git add f.txt
    out=\$(git commit -m 'fix: algo' 2>&1); rc=\$?
    case \"\$out\" in
        *TODO-PRE-COMMIT*) [ \$rc -ne 0 ] && echo OK || echo 'no bloqueó' ;;
        *) echo \"sin mensaje: \$out\" ;;
    esac
")
[ "$result" = "OK" ] && _pass "el shim resuelve su symlink y bloquea el commit" || _fail "shim symlinkeado → $result"

# '- [x]' staged → bloqueo duro
result=$(run_in_tmpdir "
    git init -q && git config user.email 't@t.com' && git config user.name 'T'
    mkdir -p .todo .git/hooks
    printf '# TODO\n' > .todo/TODO.md
    git add -A && git commit -q --no-verify -m init
    printf '# TODO\n\n- [x] **Marcado a mano**\n' > .todo/TODO.md
    ln -sf '$REPO_ROOT/bin/hooks/pre-commit.sh' .git/hooks/pre-commit
    git add .todo/TODO.md
    out=\$(git commit -m 'fix: algo' 2>&1)
    case \"\$out\" in
        *'--no-verify NO corresponde'*) echo OK ;;
        *) echo \"\$out\" ;;
    esac
")
[ "$result" = "OK" ] && _pass "'- [x]' staged → bloqueo duro" || _fail "checkbox a mano → $result"

# El hook encadenado corre primero y su falla aborta el commit
result=$(run_in_tmpdir "
    git init -q && git config user.email 't@t.com' && git config user.name 'T'
    mkdir -p .todo .git/hooks
    printf '# TODO\n' > .todo/TODO.md
    printf '#!/bin/bash\necho ENCADENADO; exit 1\n' > .git/hooks/pre-commit.local
    chmod +x .git/hooks/pre-commit.local
    ln -sf '$REPO_ROOT/bin/hooks/pre-commit.sh' .git/hooks/pre-commit
    echo x > f.txt && git add f.txt
    out=\$(git commit -m 'fix: algo' 2>&1); rc=\$?
    case \"\$out\" in
        *ENCADENADO*) [ \$rc -ne 0 ] && echo OK || echo 'no abortó' ;;
        *) echo \"el .local no corrió: \$out\" ;;
    esac
")
[ "$result" = "OK" ] && _pass "pre-commit encadena el .local y aborta si falla" || _fail "cadena pre-commit → $result"

# El registro del trabajo puede no pasar NUNCA por el índice: con .todo/ gitignoreado
# (o viviendo en el store central) DONE.md no se stagea, y el gate quedaba sin
# moneda. Se mide contra el disco: DONE.md más nuevo que el último commit = registrado.
result=$(run_in_tmpdir "
    git init -q && git config user.email 't@t.com' && git config user.name 'T'
    mkdir -p .todo .git/hooks
    printf '# TODO\n\n- [ ] **Una tarea** — abierta\n' > .todo/TODO.md
    printf '.todo/\n' > .gitignore
    git add .gitignore && git commit -q --no-verify -m init
    printf '# Completados\n\n- [x] **Algo** — cerrado acá\n' > .todo/DONE.md
    ln -sf '$REPO_ROOT/bin/hooks/pre-commit.sh' .git/hooks/pre-commit
    echo x > f.txt && git add f.txt
    out=\$(git commit -m 'fix: algo' 2>&1); rc=\$?
    [ \$rc -eq 0 ] && echo OK || echo \"bloqueó igual: \$out\"
")
[ "$result" = "OK" ] && _pass "DONE.md gitignoreado y más nuevo que HEAD → allow" || _fail "registro en disco → $result"

# La otra mitad: un DONE.md viejo no es registro de ESTE commit — si no, el allow
# quedaría pegado para siempre y el gate no volvería a pedir nada.
result=$(run_in_tmpdir "
    git init -q && git config user.email 't@t.com' && git config user.name 'T'
    mkdir -p .todo .git/hooks
    printf '# TODO\n\n- [ ] **Una tarea** — abierta\n' > .todo/TODO.md
    printf '.todo/\n' > .gitignore
    printf '# Completados\n\n- [x] **Algo viejo** — de otra sesión\n' > .todo/DONE.md
    touch -d '1 hour ago' .todo/DONE.md
    git add .gitignore && git commit -q --no-verify -m init
    ln -sf '$REPO_ROOT/bin/hooks/pre-commit.sh' .git/hooks/pre-commit
    echo x > f.txt && git add f.txt
    out=\$(git commit -m 'fix: algo' 2>&1); rc=\$?
    case \"\$out\" in
        *TODO-PRE-COMMIT*) [ \$rc -ne 0 ] && echo OK || echo 'no bloqueó' ;;
        *) echo \"sin mensaje: \$out\" ;;
    esac
")
[ "$result" = "OK" ] && _pass "DONE.md anterior al último commit → sigue pidiendo registro" || _fail "registro viejo → $result"

# --no-verify → el post-commit lo delata (con la lista retroactiva)
result=$(run_in_tmpdir "
    git init -q && git config user.email 't@t.com' && git config user.name 'T'
    mkdir -p .todo .git/hooks
    printf '# TODO\n' > .todo/TODO.md
    git add -A && git commit -q --no-verify -m init 2>/dev/null
    ln -sf '$REPO_ROOT/bin/hooks/post-commit.sh' .git/hooks/post-commit
    ln -sf '$REPO_ROOT/bin/hooks/pre-commit.sh' .git/hooks/pre-commit
    echo x > f.txt && git add f.txt
    forzado=\$(git commit --no-verify -m 'fix: forzado de entrada' 2>&1)
    # El camino sancionado: la revisión corre, aborta, y recién ahí se fuerza.
    echo y > g.txt && git add g.txt
    git commit -m 'chore: revisado' > /dev/null 2>&1
    revisado=\$(git commit --no-verify -m 'chore: revisado' 2>&1)
    case \"\$forzado\" in
        *TODO-POST-COMMIT*)
            case \"\$revisado\" in
                *TODO-POST-COMMIT*) echo 'avisó aunque la revisión se había visto' ;;
                *) echo OK ;;
            esac ;;
        *) echo \"no delató el bypass: \$forzado\" ;;
    esac
")
[ "$result" = "OK" ] && _pass "post-commit delata el --no-verify de entrada y calla si la revisión se vio" || _fail "red del --no-verify → $result"

echo ""
echo "=== CLI del store (vía shim) ==="

result=$(run_in_tmpdir "
    export XDG_DATA_HOME=\"\$PWD/data\"
    id=\$(bash '$REPO_ROOT/bin/todo-store.sh' create 'Café Central')
    listed=\$(bash '$REPO_ROOT/bin/todo-store.sh' list)
    dir=\$(bash '$REPO_ROOT/bin/todo-store.sh' path \"\$id\")
    [ \"\$id\" = 'cafe-central' ] && [ \"\$listed\" = \"\$id\"\$'\t''Café Central' ] && [ -d \"\$dir/.todo\" ] \
        && echo OK || echo \"id=\$id listed=\$listed dir=\$dir\"
")
[ "$result" = "OK" ] && _pass "create/list/path conservan el formato que parsean las skills" || _fail "store CLI → $result"

result=$(run_in_tmpdir "
    export XDG_DATA_HOME=\"\$PWD/data\"
    bash '$REPO_ROOT/bin/todo-store.sh' path '../fuera' >/dev/null 2>&1
    [ \$? -ne 0 ] && echo OK || echo 'aceptó un id con traversal'
")
[ "$result" = "OK" ] && _pass "path rechaza un id con traversal" || _fail "traversal → $result"

echo ""
echo "=== post-commit (versionado) ==="

# Se copia el cli-config.yaml real en vez de escribir uno de juguete: así el
# test valida contra el esquema que el generador consume de verdad.
SCAFFOLD="
    git init -q && git config user.email 't@t.com' && git config user.name 'T'
    mkdir -p bin/dev
    cp '$REPO_ROOT/bin/dev/generate-cli-configs.py' bin/dev/
    cp '$REPO_ROOT/cli-config.yaml' .
"
_set_version() { echo "    sed -i 's|^  version: .*|  version: \"$1\"|' cli-config.yaml"; }

_test_bump() {
    local label="$1"
    local msg="$2"
    local initial="$3"
    local expected="$4"

    result=$(run_in_tmpdir "
        $SCAFFOLD
        $(_set_version "$initial")
        python3 bin/dev/generate-cli-configs.py > /dev/null
        echo 'x' > file.txt && git add file.txt
        git commit -q --no-verify -m '$msg'
        bash '$GIT_HOOKS_DIR/post-commit' > /dev/null 2>&1
        v() { python3 -c \"import json,sys; print(json.load(open(sys.argv[1]))\$2)\" \"\$1\"; }
        plug=\$(v .claude-plugin/plugin.json \"['version']\")
        mkt=\$(v .claude-plugin/marketplace.json \"['plugins'][0]['version']\")
        meta=\$(v .claude-plugin/marketplace.json \"['metadata']['version']\")
        in_commit=\$(git show --name-only HEAD | grep -c 'cli-config.yaml' || true)
        [ \"\$plug\" = '$expected' ] && [ \"\$mkt\" = '$expected' ] && [ \"\$meta\" = '$expected' ] \
            && [ \"\$in_commit\" = '1' ] && echo OK \
            || echo \"plugin=\$plug marketplace=\$mkt metadata=\$meta in_commit=\$in_commit\"
    ")
    [ "$result" = "OK" ] && _pass "$label ($initial → $expected, proyectado a todos los manifiestos)" \
        || _fail "$label → $result"
}

_test_bump "fix: → patch"     "fix: corregir algo"        "1.0.3" "1.0.4"
_test_bump "feat: → minor"    "feat: nueva funcionalidad" "1.0.3" "1.1.0"
_test_bump "chore: → patch"   "chore: actualizar deps"    "1.2.5" "1.2.6"
_test_bump "docs: → patch"    "docs: actualizar README"   "1.0.3" "1.0.4"
_test_bump "BREAKING → major" "feat!: romper API"         "1.0.3" "2.0.0"

# La LÍNEA de la versión cambió en el commit (bump manual) → no tocar
result=$(run_in_tmpdir "
    $SCAFFOLD
    git add cli-config.yaml && git commit -q --no-verify -m 'init'
    $(_set_version "9.9.9")
    git add cli-config.yaml && git commit -q --no-verify -m 'fix: algo'
    bash '$GIT_HOOKS_DIR/post-commit' > /dev/null 2>&1
    got=\$(grep -oP '^  version: \"\\K[^\"]+' cli-config.yaml)
    [ \"\$got\" = '9.9.9' ] && echo OK || echo \"got=\$got\"
")
[ "$result" = "OK" ] && _pass "version editada a mano → sin bump" || _fail "bump manual → $result"

# cli-config.yaml en el commit pero SIN tocar la versión → bumpea igual.
# El guard viejo miraba el archivo entero: cambiar un keyword o una descripción
# se llevaba puesto el bump y nadie se enteraba.
result=$(run_in_tmpdir "
    $SCAFFOLD
    $(_set_version "1.0.0")
    git add cli-config.yaml && git commit -q --no-verify -m 'init'
    sed -i 's|^  license: .*|  license: Apache-2.0|' cli-config.yaml
    git add cli-config.yaml && git commit -q --no-verify -m 'chore: cambiar licencia'
    bash '$GIT_HOOKS_DIR/post-commit' > /dev/null 2>&1
    got=\$(grep -oP '^  version: \"\\K[^\"]+' cli-config.yaml)
    [ \"\$got\" = '1.0.1' ] && echo OK || echo \"got=\$got (esperado 1.0.1)\"
")
[ "$result" = "OK" ] && _pass "cli-config.yaml editado sin tocar la versión → bumpea" || _fail "edición sin version → $result"

# El comentario de arriba de `version:` sobrevive al bump — pyyaml lo borraría.
result=$(run_in_tmpdir "
    $SCAFFOLD
    echo 'x' > file.txt && git add file.txt
    git commit -q --no-verify -m 'fix: algo'
    bash '$GIT_HOOKS_DIR/post-commit' > /dev/null 2>&1
    grep -q '^# cli-config.yaml — fuente única' cli-config.yaml && echo OK || echo 'comentarios borrados'
")
[ "$result" = "OK" ] && _pass "el bump preserva los comentarios del YAML" || _fail "comentarios → $result"

# Hook INSTALADO + commit real → bump exactamente UNA vez (no recursión por el amend)
result=$(run_in_tmpdir "
    $SCAFFOLD
    $(_set_version "1.0.0")
    python3 bin/dev/generate-cli-configs.py > /dev/null
    mkdir -p .git/hooks
    cp '$GIT_HOOKS_DIR/post-commit' .git/hooks/post-commit
    chmod +x .git/hooks/post-commit
    echo 'x' > file.txt && git add file.txt
    git commit -q --no-verify -m 'fix: algo' > /dev/null 2>&1
    got=\$(grep -oP '^  version: \"\\K[^\"]+' cli-config.yaml)
    [ \"\$got\" = '1.0.1' ] && echo OK || echo \"got=\$got (esperado 1.0.1 — un solo bump)\"
")
[ "$result" = "OK" ] && _pass "hook instalado + commit real → bump único (sin recursión)" || _fail "recursión → $result"

# Dos hooks que escriban la versión = dos bumps por commit. Pasó de verdad:
# prepare-commit-msg quedó instalado junto a post-commit y 1.21.8 saltó a 1.21.10.
BUMPERS=$(grep -l 'cli-config.yaml' "$GIT_HOOKS_DIR"/* 2>/dev/null | wc -l)
[ "$BUMPERS" = "1" ] && _pass "un solo hook bumpea la versión" \
    || _fail "$BUMPERS hooks bumpean la versión (deben ser 1 — instalados juntos duplican el bump)"

echo ""
echo "=== entrypoint de OpenCode ==="

# Los hooks se testean en src/adapters/opencode/*.test.ts. Acá solo se verifica
# que el archivo que OpenCode carga de verdad —.opencode/plugins/todo-plugin.ts—
# resuelva sus imports y devuelva los hooks. Es lo que TypeScript no cubre: el
# entrypoint podría estar perfecto y aun así no encontrarse desde donde OpenCode
# lo busca. ankify tiene el caso opuesto: un adapter escrito y nunca cableado.
result=$(node --input-type=module -e "
import TodoPlugin from '$REPO_ROOT/.opencode/plugins/todo-plugin.ts';
const hooks = await TodoPlugin({ directory: process.cwd() });

const esperados = ['shell.env', 'config', 'tool.execute.before', 'tool.execute.after', 'experimental.chat.system.transform'];
const faltan = esperados.filter((n) => typeof hooks[n] !== 'function');
if (faltan.length) { console.log('faltan hooks: ' + faltan.join(', ')); process.exit(0); }

const out = { env: {} };
await hooks['shell.env']({}, out);
if (out.env.TODO_PLUGIN_ROOT !== '$REPO_ROOT') { console.log('root=' + out.env.TODO_PLUGIN_ROOT); process.exit(0); }

console.log('OK');
" 2>&1)
[ "$result" = "OK" ] && _pass "el entrypoint carga y expone los 5 hooks" || _fail "entrypoint OpenCode → $result"

# El plugin se registra global por ruta absoluta: los imports tienen que resolver
# desde cualquier cwd, no solo desde el repo.
result=$(cd / && node --input-type=module -e "
import TodoPlugin from '$REPO_ROOT/.opencode/plugins/todo-plugin.ts';
const hooks = await TodoPlugin({ directory: '/tmp' });
console.log(typeof hooks['tool.execute.before'] === 'function' ? 'OK' : 'sin hooks');
" 2>&1)
[ "$result" = "OK" ] && _pass "carga desde otro cwd (instalación global)" || _fail "cwd ajeno → $result"

echo ""
echo "Resultado: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ] && exit 0 || exit 1
