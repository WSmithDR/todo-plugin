# Bloqueo de edición directa de `.todo/`

**Fecha:** 2026-06-30
**Estado:** aprobado para plan

## Problema

Las tareas viven en `.todo/{TODO,DOING,DONE,DISCARDED}.md` con un formato
estricto (cuadrante Eisenhower, metadata de creador, timestamps, atribución). Si
el CLI edita esos archivos a mano en vez de usar los skills del plugin
(`todo-add`, `todo-doing`, etc.), se pierde la consistencia. Queremos **forzar**
que toda mutación de `.todo/` pase por un skill.

## Tensión central

Los skills mismos editan `.todo/` con la herramienta `Edit` (p.ej. `todo-add`
"Insert in the correct quadrant", `todo-clarify` "Edit `.todo/TODO.md`"). Un hook
no tiene forma nativa de saber "estoy dentro de un skill". Por lo tanto un bloqueo
ciego de `Edit` sobre `.todo/` rompería a los propios skills.

## Solución: ventana de escritura con sentinela

Los skills **abren una ventana de escritura** al ejecutarse; el hook PreToolUse
bloquea cualquier escritura a `.todo/` que ocurra **fuera** de una ventana fresca.
El Edit directo (sin haber invocado un skill) no tiene ventana → se bloquea, lo
que obliga al CLI a invocar el skill correspondiente.

## Componentes

### 1. `bin/todo-guard.sh` — script único (hook + apertura)

Sentinela: `${XDG_CACHE_HOME:-$HOME/.cache}/todo-plugin/window` (un archivo;
su mtime marca la última apertura).

Subcomandos:

- **`open`** — `mkdir -p` del dir y `touch` del sentinela. Lo llaman los skills.
- **`check`** (modo hook, default cuando se invoca sin `open`) — lee el JSON del
  PreToolUse por stdin, decide si la operación escribe en `.todo/`, y bloquea o no.

```sh
#!/bin/bash
set -euo pipefail
GUARD_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/todo-plugin"
WINDOW="$GUARD_DIR/window"
WINDOW_MIN=10   # minutos que la ventana se considera fresca

if [ "${1:-check}" = "open" ]; then
    mkdir -p "$GUARD_DIR"; touch "$WINDOW"; exit 0
fi

# Modo hook (check). Bypass explícito del humano.
[ "${TODO_GUARD:-on}" = "off" ] && exit 0

payload=$(cat)
tool=$(printf '%s' "$payload" | python3 -c "import json,sys;print(json.load(sys.stdin).get('tool_name',''))" 2>/dev/null || echo "")

# ¿La operación escribe en un .todo/?
writes_todo() {
  python3 - "$tool" <<'PY'
import json,sys,re
tool=sys.argv[1]
d=json.load(open(0))
ti=d.get("tool_input",{})
def is_todo_path(p): return bool(p) and "/.todo/" in ("/"+p.replace("\\","/"))
if tool in ("Edit","Write","MultiEdit"):
    p=ti.get("file_path","")
    sys.exit(0 if is_todo_path(p) else 1)
if tool=="Bash":
    cmd=ti.get("command","")
    touches=".todo/" in cmd
    writes=bool(re.search(r'(sed +-i|>>?|tee|(^|\s)(cp|mv|rm) |open\([^)]*[\'"]w)', cmd))
    sys.exit(0 if (touches and writes) else 1)
sys.exit(1)
PY
}

if printf '%s' "$payload" | writes_todo; then
    # ¿Ventana fresca?
    if [ -n "$(find "$WINDOW" -mmin "-$WINDOW_MIN" 2>/dev/null)" ]; then
        exit 0   # dentro de la ventana de un skill → permitir
    fi
    echo "TODO-GUARD: edición directa de .todo/ bloqueada. Usá el skill correspondiente \
(todo-add / todo-doing / todo-done / todo-clarify / todo-solutions / todo-recommend / \
todo-triage / todo-audit); estos abren la ventana de escritura automáticamente. \
Para editar a mano puntualmente: exportá TODO_GUARD=off." >&2
    exit 2   # bloquea la tool
fi
exit 0
```

Notas:
- El payload se lee una vez y se re-pasa a `writes_todo` por stdin (el heredoc
  lee `open(0)`), evitando depender de variables de entorno entre procesos.
- `python3` ya es dependencia del plugin (lo usan `todo-config`/`todo-health`).
- El chequeo de Bash es heurístico (no infalible); Edit/Write/MultiEdit son
  confiables porque vemos `file_path`.

### 2. Apertura de la ventana en cada skill y agente

Agregar como **primerísima acción** del proceso — **antes** de la resolución de
proyecto (paso 0 del registro sin repo), porque los bloques de migración legacy de
los skills (`sed -i … .todo/*.md`, `git mv … .todo/`) son visibles para el hook y
quedarían auto-bloqueados si corrieran antes de que la ventana esté abierta:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/todo-guard.sh" open
```

Orden en cada skill: (1) `todo-guard.sh open` → (2) resolución de proyecto
(`todo-store.sh mode/list/create/path` + `cd`) → (3) cuerpo del skill.

Skills afectados: `todo-add`, `todo-doing`, `todo-done`, `todo-clarify`,
`todo-solutions`, `todo-recommend`, `todo-triage`, `todo-item`, `todo-audit`,
`todo-config`. Agentes: `todo-agent.md`, `todo-audit.md`.
(`todo-health` es read-only → no necesita abrir ventana.)

Como la ventana dura 10 min, cubre incluso skills con menú interactivo
(selección de proyecto en contexto sin repo) sin que expire antes de escribir.

### 3. Registro en `hooks/hooks.json`

Agregar entradas **PreToolUse**:

```json
"PreToolUse": [
  {
    "matcher": "Edit|Write|MultiEdit",
    "hooks": [{ "type": "command", "command": "bash ${CLAUDE_PLUGIN_ROOT}/bin/todo-guard.sh" }]
  },
  {
    "matcher": "Bash",
    "hooks": [{ "type": "command", "command": "bash ${CLAUDE_PLUGIN_ROOT}/bin/todo-guard.sh" }]
  }
]
```

## Trade-offs aceptados

- **Leak de 10 min:** tras correr un skill, una edición directa a `.todo/` pasaría
  durante la ventana. Es el precio de no romper skills con menú interactivo. El
  caso real a bloquear (Edit directo "en frío", sin skill previo) sí queda cubierto.
- **Bash heurístico:** puede no atrapar toda forma de escritura por bash; el
  camino principal (herramienta Edit/Write) sí es confiable.
- **Bypass `TODO_GUARD=off`** para el humano; además puede editar el archivo en su
  editor fuera de Claude (no pasa por hooks).
- Aplica a todos los proyectos con `.todo/` (intencional, ship en el plugin).

## No incluido (YAGNI)

- Detección "skill activo" nativa (no existe en hooks de Claude Code).
- Cierre explícito de ventana (expira sola por mtime; sin estado colgado).
- Bloqueo infalible de bash (se acepta heurística).

## Verificación

Test nuevo `bin/dev/test-guard.sh` (con `XDG_CACHE_HOME` y `HOME` temporales),
alimentando al script JSON de PreToolUse por stdin:

- Edit sobre `proj/.todo/TODO.md` **sin** ventana → exit 2 + mensaje `TODO-GUARD`.
- `todo-guard.sh open`, luego el mismo Edit → exit 0 (ventana fresca).
- Edit sobre un archivo fuera de `.todo/` (p.ej. `src/x.js`) → exit 0.
- Bash `sed -i ... .todo/TODO.md` sin ventana → exit 2; con ventana → exit 0.
- Bash que solo lee `.todo/` (`cat .todo/TODO.md`) → exit 0.
- `TODO_GUARD=off` + Edit sobre `.todo/` sin ventana → exit 0 (bypass).
- Ventana vieja (mtime > 10 min, simulado con `touch -d`) → exit 2.
