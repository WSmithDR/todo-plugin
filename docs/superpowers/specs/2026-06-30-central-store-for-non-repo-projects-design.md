# Registro de proyectos sin repo

**Fecha:** 2026-06-30
**Estado:** aprobado para plan

## Problema

El plugin asume que `.todo/` vive en la raíz del cwd y que existe `.git` (para
instalar el git hook y para commitear los TODOs del equipo). Hay proyectos sin
repositorio — p.ej. un sitio WordPress operado vía MCP — donde:

- no hay `.git`, así que el flujo de "commitear `.todo/` para el equipo" no aplica;
- la carpeta donde se abre la consola es circunstancial: **no** debe ser la
  identidad del proyecto ni recibir archivos de tareas.

Para esos casos queremos un **registro de proyectos** propio del plugin,
CLI-agnóstico: cada proyecto tiene nombre e id único, los archivos viven en un
almacén central, y al operar una tarea se elige el proyecto de un menú.

## Decisión de arquitectura

Dos modos, según el contexto del cwd:

- **Repo (`.git` presente) → `.todo/` real en la raíz del repo (como hoy).**
  Preserva la feature de commitear `.todo/` para el equipo. No participa del
  registro central ni del menú.
- **No-repo → registro central, en un único repo git.**
  `${XDG_DATA_HOME:-$HOME/.local/share}/todo/` es **un solo repositorio git**;
  cada proyecto es un subdirectorio `<id>/` que contiene su propio `.todo/`.
  **Cero acoplamiento con el cwd**: no se crea nada en la carpeta actual, sin
  symlink. Al operar una tarea se elige el proyecto de un menú (registrados +
  "➕ Nuevo") y la resolución hace `cd` al store del proyecto, de modo que **el
  cuerpo de cada skill corre sin cambios** (sigue usando `.todo/` relativo,
  `git commit`, atribución). Historial de tareas unificado para todos los
  proyectos sin repo.

  La idea de un repo de persistencia compartido entre *varios* plugins se
  descartó para este spec (acoplamiento invertido); queda como posible feature
  del catálogo `cli-plugin-template`.

## Componentes

### 1. Almacén central (XDG, CLI-agnóstico, un solo repo git)

Ruta base / raíz del repo: `${XDG_DATA_HOME:-$HOME/.local/share}/todo/`
(un único `git init`).

Un subdirectorio por proyecto, con su propio `.todo/` adentro — mismo layout que
un repo normal, para que el cuerpo de los skills no cambie:

```
~/.local/share/todo/                 ← repo git único
  .git/
  wordpress-cliente-x/
    .todo/
      TODO.md  DOING.md  DONE.md  DISCARDED.md  config.json
```

`config.json` por proyecto (sirve a la vez como metadata del registro y como el
`.todo/config.json` que los skills ya chequean — por eso incluye
`gitignore_todo` aunque sea irrelevante en el store):

```json
{
  "name": "WordPress Cliente X",
  "id": "wordpress-cliente-x",
  "created_at": "YYYY-MM-DD",
  "created_by": "GitName",
  "gitignore_todo": false
}
```

`<id>` = slug del nombre (minúsculas, espacios→`-`, se quitan caracteres no
`[a-z0-9-]`). Si el slug ya existe, se desambigua con sufijo numérico
(`-2`, `-3`, …). El id es estable; el `name` es editable para mostrar.

### 2. `bin/todo-store.sh` — toda la lógica no interactiva

Subcomandos:

- `mode` → imprime `repo` o `nonrepo` según el `$PWD` actual (detección testeable).
- `list` → una línea por proyecto: `<id>\t<name>`. Vacío si no hay ninguno.
- `create "<name>"` → asegura el repo base, genera slug, desambigua, crea
  `<id>/.todo/`, escribe `config.json`, lo commitea, imprime el `<id>`.
- `path <id>` → imprime la ruta absoluta del subdir del proyecto (para hacer `cd`).

```sh
#!/bin/bash
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
    name="$1"; ensure_repo
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
    dir="$BASE/$1"; mkdir -p "$dir/.todo"; printf '%s\n' "$dir"
    ;;
  *) echo "uso: todo-store.sh {mode|list|create <name>|path <id>}" >&2; exit 1 ;;
esac
```

El parseo de JSON con `grep` alcanza para archivos chicos escritos por el propio
plugin; no se agrega dependencia de `jq`.

### 3. Resolución del proyecto en los skills

Cada skill agrega un **paso 0** (ejecutado por el agente, porque el menú es
interactivo) que NO cambia el cuerpo del skill — solo deja el `cwd` apuntando al
lugar correcto antes de que el resto corra con `.todo/` relativo:

1. `MODE=$("${CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" mode)`.
2. **Repo** (`MODE=repo`): no hacer nada; seguir como hoy (`.todo/` del repo).
3. **No-repo** (`MODE=nonrepo`):
   - `"${CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" list` → arma el menú.
   - `AskUserQuestion`: una opción por proyecto (`name`) **+ "➕ Nuevo proyecto"**.
     - En skills que solo operan sobre tareas existentes (`todo-done`,
       `todo-doing`, `todo-item`, `todo-clarify`, `todo-solutions`,
       `todo-recommend`, `todo-triage`) la opción "Nuevo" se omite.
   - Si "Nuevo": pedir el nombre → `id=$("…/todo-store.sh" create "<name>")`.
   - `cd "$("${CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" path "<id>")"`.

Tras el `cd`, el cuerpo del skill escribe en `.todo/…` y commitea exactamente
como en un repo — el repo activo es ahora el store central.
`# ponytail: el cd mueve el cwd de la sesión al store; si molesta, restaurar cwd al final.`

El menú se muestra en **cada** operación no-repo (no se recuerda un "proyecto
activo"). Es la consecuencia directa del cero-acoplamiento.
`# ponytail: menú cada vez; si molesta, agregar puntero "último proyecto" global después.`

### 4. Skills y agentes afectados

Agregar el paso 0 de resolución a:

`skills/todo-add`, `todo-doing`, `todo-done`, `todo-recommend`, `todo-solutions`,
`todo-clarify`, `todo-item`, `todo-triage`, `todo-audit`;
`agents/todo-agent.md`, `agents/todo-audit.md`.

Solo `todo-add` y `todo-audit` (genera desde cero) ofrecen "➕ Nuevo proyecto".

### 5. `todo-config` y `session-start.sh`

- **`todo-config`** es relevante solo en repos (su única setting, `gitignore_todo`,
  no aplica a un store privado). En `MODE=nonrepo`, `create` ya siembra un
  `config.json` válido, así que los skills no disparan `todo-config`. Se agrega un
  guard al inicio de `todo-config`: si `MODE=nonrepo`, informar que no aplica y salir.
- **`session-start.sh`** queda **sin cambios funcionales**: opera sobre el cwd,
  instala el git hook solo si hay `.git`, y avisa de `config.json` faltante solo
  si hay un `.todo/` real en el cwd (repos). Los proyectos del registro no tocan
  el cwd, así que los ignora — correcto: sin auto-bootstrap en carpetas
  circunstanciales.

## Flujo (no-repo)

1. En una carpeta sin repo, el usuario invoca `todo-add`.
2. Paso 0: `mode` → `nonrepo`; `list` arma el menú: proyectos + "➕ Nuevo".
3. Usuario elige "➕ Nuevo" → nombre "WordPress Cliente X" → `create` crea
   `~/.local/share/todo/wordpress-cliente-x/.todo/` y commitea el registro.
4. `cd ~/.local/share/todo/wordpress-cliente-x`; el cuerpo del skill escribe en
   `.todo/TODO.md` y commitea como siempre.
5. Próxima vez: el menú ya lista "WordPress Cliente X" para reutilizarlo.

## No incluido (YAGNI)

- Puntero de "proyecto activo" / memoria por carpeta; restaurar el cwd tras el `cd`.
- Symlinks de visibilidad (se eligió cero acoplamiento).
- Repo de persistencia compartido entre varios plugins (candidato a feature del catálogo).
- Mezclar repos de código en el registro/menú (un repo se opera estando dentro de él).
- Migración de `.todo/` existentes al registro.
- Dependencia de `jq`.

## Verificación

Test con `XDG_DATA_HOME` temporal (script nuevo `bin/dev/test-store.sh`):

- `create "Sitio A"` → crea `sitio-a/.todo/config.json` con `name`/`id` correctos
  y el repo base `~/.local/share/todo/.git` inicializado.
- `create "Sitio A"` repetido → segundo id `sitio-a-2` (desambiguación).
- `list` → lista `sitio-a` y `sitio-a-2` con sus nombres.
- `path sitio-a` → ruta absoluta existente que contiene `.todo/`.
- `mode`: dentro de un `git init` temporal fuera de `$BASE` → `repo`; dentro de
  `$BASE/<id>` → `nonrepo`; en un dir pelado sin git → `nonrepo`.
