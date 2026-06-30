# Registro de proyectos sin repo — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir gestionar tareas en proyectos sin repositorio git (p.ej. WordPress vía MCP), guardándolas en un registro central versionado y eligiendo el proyecto desde un menú.

**Architecture:** `~/.local/share/todo/` es un único repo git; cada proyecto sin repo es un subdir `<id>/.todo/`. Un script `bin/todo-store.sh` provee la lógica no interactiva (mode/list/create/path). Cada skill agrega un "paso 0" que, en contexto sin repo, muestra un menú y hace `cd` al store del proyecto elegido; el cuerpo del skill corre sin cambios.

**Tech Stack:** Bash, git, AskUserQuestion (agente). Sin dependencias nuevas (no `jq`).

## Global Constraints

- Ruta base: `${XDG_DATA_HOME:-$HOME/.local/share}/todo/` — un solo repo git.
- Layout por proyecto: `<base>/<id>/.todo/{TODO.md,DOING.md,DONE.md,DISCARDED.md,config.json}`.
- `<id>` = slug del nombre (`[a-z0-9-]`, minúsculas), desambiguado con `-2`, `-3`, …
- Sin dependencia de `jq`; parseo JSON con `grep`/`cut`.
- Scripts invocados vía `${CLAUDE_PLUGIN_ROOT}/bin/...`.
- Copy de UI en español.
- Cada commit del repo del plugin dispara autobump semver (prefijo `feat:`/`fix:`/etc.).
- El "paso 0" se agrega SIN tocar el cuerpo existente de cada skill (que sigue usando `.todo/` relativo y `git commit`).

---

### Task 1: `bin/todo-store.sh` + test

**Files:**
- Create: `bin/todo-store.sh`
- Create: `bin/dev/test-store.sh`

**Interfaces:**
- Produces: `todo-store.sh mode` (imprime `repo|nonrepo`), `todo-store.sh list` (líneas `<id>\t<name>`), `todo-store.sh create "<name>"` (imprime `<id>`), `todo-store.sh path <id>` (imprime ruta absoluta del subdir del proyecto).
- Base de datos en `${XDG_DATA_HOME:-$HOME/.local/share}/todo/`.

- [ ] **Step 1: Escribir el test que falla**

Create `bin/dev/test-store.sh`:

```bash
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
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `bash bin/dev/test-store.sh`
Expected: FAIL — `bin/todo-store.sh` no existe todavía (error de "No such file" o similar).

- [ ] **Step 3: Implementar `bin/todo-store.sh`**

Create `bin/todo-store.sh`:

```bash
#!/bin/bash
# Registro central de proyectos sin repo.
# ~/.local/share/todo/ es un único repo git; cada proyecto es <id>/.todo/.
set -euo pipefail
BASE="${XDG_DATA_HOME:-$HOME/.local/share}/todo"

ensure_repo() {
  mkdir -p "$BASE"
  [ -d "$BASE/.git" ] || git -C "$BASE" init -q
}

cmd="${1:-}"; shift || true
case "$cmd" in
  mode)
    case "$PWD/" in
      "$BASE"/*) echo nonrepo ;;
      *) git rev-parse --is-inside-work-tree >/dev/null 2>&1 && echo repo || echo nonrepo ;;
    esac
    ;;
  list)
    [ -d "$BASE" ] || exit 0
    for c in "$BASE"/*/.todo/config.json; do
      [ -f "$c" ] || continue
      id=$(grep -o '"id": *"[^"]*"'   "$c" | cut -d'"' -f4)
      nm=$(grep -o '"name": *"[^"]*"' "$c" | cut -d'"' -f4)
      printf '%s\t%s\n' "$id" "$nm"
    done
    ;;
  create)
    name="${1:?nombre requerido}"; ensure_repo
    slug=$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]' \
           | tr -cs 'a-z0-9' '-' | sed 's/^-//; s/-$//')
    [ -n "$slug" ] || slug="proyecto"
    id="$slug"; n=2
    while [ -d "$BASE/$id" ]; do id="$slug-$n"; n=$((n+1)); done
    dir="$BASE/$id/.todo"; mkdir -p "$dir"
    today=$(date +%Y-%m-%d); by=$(git config user.name 2>/dev/null || echo "")
    printf '{\n  "name": "%s",\n  "id": "%s",\n  "created_at": "%s",\n  "created_by": "%s",\n  "gitignore_todo": false\n}\n' \
      "$name" "$id" "$today" "$by" > "$dir/config.json"
    git -C "$BASE" add "$id/.todo/config.json"
    git -C "$BASE" commit -q -m "todo: registrar proyecto $name"
    printf '%s\n' "$id"
    ;;
  path)
    dir="$BASE/${1:?id requerido}"; mkdir -p "$dir/.todo"; printf '%s\n' "$dir"
    ;;
  *) echo "uso: todo-store.sh {mode|list|create <name>|path <id>}" >&2; exit 1 ;;
esac
```

Hacerlo ejecutable: `chmod +x bin/todo-store.sh`.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `bash bin/dev/test-store.sh`
Expected: `OK: todo-store.sh`

- [ ] **Step 5: Commit**

```bash
chmod +x bin/todo-store.sh bin/dev/test-store.sh
git add bin/todo-store.sh bin/dev/test-store.sh
git commit -m "feat: registro central de proyectos sin repo (todo-store.sh)"
```

---

### Task 2: Paso 0 de resolución en `todo-add` (entry con "Nuevo")

**Files:**
- Modify: `skills/todo-add/SKILL.md` (insertar nueva sección antes de "### 0. Check plugin config")

**Interfaces:**
- Consumes: `bin/todo-store.sh {mode,list,create,path}` (Task 1).
- Produces: patrón de "paso 0" reutilizado por Tasks 3 y 4.

- [ ] **Step 1: Insertar el paso de resolución**

En `skills/todo-add/SKILL.md`, inmediatamente después del encabezado `## Process` y antes de `### 0. Check plugin config`, insertar:

````markdown
### 0a. Resolver el proyecto (repo vs registro central)

Determinar el modo:

```bash
MODE=$("${CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" mode)
echo "$MODE"
```

- Si `MODE` es `repo`: continuar normalmente (las tareas viven en el `.todo/` de este repo). Saltar al paso 0.
- Si `MODE` es `nonrepo`: no hay repositorio, las tareas van al registro central. Listar proyectos:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" list
```

Mostrar con `AskUserQuestion` un menú: una opción por cada proyecto listado (usar el `<name>`), más una opción **"➕ Nuevo proyecto"**.

- Si el usuario elige **"➕ Nuevo proyecto"**: pedirle el nombre y crearlo:

```bash
NEW_ID=$("${CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" create "<nombre dado>")
```

- Si elige un proyecto existente: tomar su `<id>` de la lista.

Posicionarse en el store del proyecto (a partir de acá el resto del skill corre tal cual, con `.todo/` relativo y `git commit` sobre el repo central):

```bash
cd "$("${CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" path "<id elegido o NEW_ID>")"
```
````

- [ ] **Step 2: Verificación manual (no-repo)**

Run:
```bash
TMPDIR=$(mktemp -d); export XDG_DATA_HOME="$TMPDIR/share"
cd "$TMPDIR" && "$PWD_PLUGIN/bin/todo-store.sh" mode
```
(donde `$PWD_PLUGIN` es la raíz del plugin)
Expected: imprime `nonrepo` — confirma que el paso 0 entraría en la rama de registro central.

- [ ] **Step 3: Verificación manual (repo)**

Run: desde la raíz del propio plugin (que es un repo): `bin/todo-store.sh mode`
Expected: imprime `repo` — el paso 0 dejaría el flujo actual intacto.

- [ ] **Step 4: Commit**

```bash
git add skills/todo-add/SKILL.md
git commit -m "feat: todo-add resuelve proyecto vía menú en contexto sin repo"
```

---

### Task 3: Paso 0 en skills de tareas existentes (sin "Nuevo")

**Files:**
- Modify: `skills/todo-doing/SKILL.md`
- Modify: `skills/todo-done/SKILL.md`
- Modify: `skills/todo-item/SKILL.md`
- Modify: `skills/todo-clarify/SKILL.md`
- Modify: `skills/todo-solutions/SKILL.md`
- Modify: `skills/todo-recommend/SKILL.md`
- Modify: `skills/todo-triage/SKILL.md`

**Interfaces:**
- Consumes: `bin/todo-store.sh {mode,list,path}` (Task 1).

- [ ] **Step 1: Insertar el paso de resolución (variante sin "Nuevo")**

En cada uno de los 7 archivos, al comienzo de su sección `## Process` (antes del primer sub-paso existente), insertar:

````markdown
### 0a. Resolver el proyecto (repo vs registro central)

```bash
MODE=$("${CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" mode)
echo "$MODE"
```

- Si `MODE` es `repo`: continuar normalmente.
- Si `MODE` es `nonrepo`: listar proyectos y elegir cuál operar (solo existentes; este skill no crea proyectos):

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" list
```

Mostrar con `AskUserQuestion` un menú con una opción por proyecto (usar el `<name>`). Si la lista está vacía, informar que no hay proyectos registrados y terminar. Luego posicionarse:

```bash
cd "$("${CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" path "<id elegido>")"
```
````

- [ ] **Step 2: Verificar que se insertó en los 7**

Run:
```bash
grep -L "Resolver el proyecto" skills/todo-doing/SKILL.md skills/todo-done/SKILL.md skills/todo-item/SKILL.md skills/todo-clarify/SKILL.md skills/todo-solutions/SKILL.md skills/todo-recommend/SKILL.md skills/todo-triage/SKILL.md
```
Expected: sin salida (todos contienen el bloque).

- [ ] **Step 3: Commit**

```bash
git add skills/todo-doing skills/todo-done skills/todo-item skills/todo-clarify skills/todo-solutions skills/todo-recommend skills/todo-triage
git commit -m "feat: skills de tareas existentes resuelven proyecto en contexto sin repo"
```

---

### Task 4: Paso 0 en `todo-audit` y agentes

**Files:**
- Modify: `skills/todo-audit/SKILL.md` (variante con "Nuevo", como `todo-add`)
- Modify: `agents/todo-agent.md`
- Modify: `agents/todo-audit.md`

**Interfaces:**
- Consumes: `bin/todo-store.sh` (Task 1); patrón de Task 2 (con "Nuevo") y Task 3.

- [ ] **Step 1: `todo-audit` — insertar paso de resolución con "Nuevo"**

En `skills/todo-audit/SKILL.md`, al comienzo de `## Process`, insertar el mismo bloque de **Task 2 Step 1** (el que incluye la opción "➕ Nuevo proyecto"), ya que un audit puede generar el TODO de un proyecto nuevo desde cero.

- [ ] **Step 2: `agents/todo-agent.md` y `agents/todo-audit.md` — referenciar la resolución**

En ambos agentes, donde hoy dicen `Ensure mkdir -p .todo` / `mkdir -p .todo`, reemplazar por una directiva que invoque la resolución antes de cualquier operación de archivos:

```markdown
Antes de crear o leer archivos de tareas, resolvé el proyecto con el paso 0 de los skills:
ejecutá `"${CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" mode`. Si es `repo`, usá el `.todo/` del repo.
Si es `nonrepo`, listá proyectos (`todo-store.sh list`), pedí al usuario cuál (o "➕ Nuevo" → `create`),
y hacé `cd "$(todo-store.sh path "<id>")"` antes de continuar.
```

- [ ] **Step 3: Verificar inserción**

Run:
```bash
grep -l "todo-store.sh" skills/todo-audit/SKILL.md agents/todo-agent.md agents/todo-audit.md
```
Expected: los 3 archivos listados.

- [ ] **Step 4: Commit**

```bash
git add skills/todo-audit agents/todo-agent.md agents/todo-audit.md
git commit -m "feat: todo-audit y agentes resuelven proyecto en contexto sin repo"
```

---

### Task 5: Guard en `todo-config` para no-repo

**Files:**
- Modify: `skills/todo-config/SKILL.md`

**Interfaces:**
- Consumes: `bin/todo-store.sh mode` (Task 1).

- [ ] **Step 1: Insertar guard al inicio del proceso**

En `skills/todo-config/SKILL.md`, al comienzo de `## Process` (antes de "### 1. Read existing config"), insertar:

````markdown
### 0. Solo aplica en repos

```bash
MODE=$("${CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" mode)
echo "$MODE"
```

Si `MODE` es `nonrepo`, esta configuración no aplica: la única opción
(`gitignore_todo`) es irrelevante para un store privado, y `todo-store.sh create`
ya siembra un `config.json` válido. Informar al usuario que en proyectos sin repo
no hay nada que configurar y terminar sin cambios.
````

- [ ] **Step 2: Verificar**

Run: `grep -q "Solo aplica en repos" skills/todo-config/SKILL.md && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add skills/todo-config/SKILL.md
git commit -m "feat: todo-config no aplica en proyectos sin repo"
```

---

### Task 6: Documentación

**Files:**
- Modify: `CLAUDE.md` (sección "File structure")
- Modify: `README.md` (donde se describe la ubicación de `.todo/`)

**Interfaces:** ninguna (solo docs).

- [ ] **Step 1: Actualizar `CLAUDE.md`**

En la sección "File structure", debajo de la frase "All task files live under `.todo/` in the project root — never at the root level.", agregar:

```markdown
**Proyectos sin repositorio git** (p.ej. un sitio WordPress operado vía MCP) no
tienen un `.todo/` local. En su lugar, el plugin mantiene un registro central:
`~/.local/share/todo/` es un único repo git con un subdirectorio `<id>/.todo/` por
proyecto. Al ejecutar un skill fuera de un repo, se elige el proyecto desde un menú
(o se crea uno nuevo). Identidad = nombre + id; el cwd no se toca.
```

- [ ] **Step 2: Actualizar `README.md`**

Localizar la descripción equivalente de la ubicación de `.todo/` y agregar el mismo párrafo (adaptado al tono del README).

Run para localizar: `grep -n "\.todo/" README.md | head`

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: documentar registro central para proyectos sin repo"
```

---

## Verificación final

- [ ] `bash bin/dev/test-store.sh` → `OK: todo-store.sh`
- [ ] `bash bin/dev/test-hooks.sh` → sin regresiones (los flujos en repos siguen iguales).
- [ ] Desde la raíz del plugin (repo): `bin/todo-store.sh mode` → `repo`.
- [ ] Desde un dir temporal sin git: `bin/todo-store.sh mode` → `nonrepo`.
- [ ] Smoke no-repo manual: en un dir temporal con `XDG_DATA_HOME` propio, simular el flujo de `todo-add` (mode → list → create "Sitio Demo" → cd → escribir `.todo/TODO.md` → commit) y verificar que el archivo queda en `~/.local/share/todo/sitio-demo/.todo/TODO.md` y commiteado en el repo base.
