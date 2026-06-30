# Bloqueo de edición directa de `.todo/` — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Forzar que toda mutación de `.todo/` pase por un skill del plugin, bloqueando la edición directa vía un hook PreToolUse con ventana de escritura.

**Architecture:** Un script `bin/todo-guard.sh` con dos modos: `open` (los skills lo llaman para abrir una ventana de 5 min vía `touch` de un sentinela) y `check` (modo hook: lee el JSON de PreToolUse por stdin, y si la operación escribe en `.todo/` fuera de una ventana fresca, bloquea con exit 2). Se registra como PreToolUse sobre `Edit|Write|MultiEdit` y `Bash`, y cada skill/agente abre la ventana como primera acción.

**Tech Stack:** Bash, python3 (ya es dependencia del plugin), hooks de Claude Code.

## Global Constraints

- Sentinela: `${XDG_CACHE_HOME:-$HOME/.cache}/todo-plugin/window` (mtime = última apertura).
- Ventana fresca = mtime < 5 minutos (`find -mmin -5`).
- Bloqueo = `exit 2` con mensaje en stderr que empieza con `TODO-GUARD:`.
- Detección de escritura: Edit/Write/MultiEdit → `file_path` contiene `/.todo/`; Bash → el comando contiene `.todo/` Y un token de escritura (`sed -i`, `>`, `>>`, `tee`, `cp`, `mv`, `rm`, `open(...'w')`).
- Bypass: variable de entorno `TODO_GUARD=off` → el hook deja pasar (exit 0).
- Apertura de ventana: `"${CLAUDE_PLUGIN_ROOT}/bin/todo-guard.sh" open` como PRIMERA acción del skill, ANTES de la resolución de proyecto (que puede llamar `todo-store.sh create`, el cual escribe `.todo/config.json`).
- `todo-health` es read-only → NO abre ventana.
- Sin dependencias nuevas. Scripts invocados vía `${CLAUDE_PLUGIN_ROOT}/bin/...`.
- Cada commit del repo dispara autobump semver.

---

### Task 1: `bin/todo-guard.sh` + test

**Files:**
- Create: `bin/todo-guard.sh`
- Create: `bin/dev/test-guard.sh`

**Interfaces:**
- Produces: `todo-guard.sh open` (abre ventana, exit 0); `todo-guard.sh` sin args / `check` (modo hook: lee JSON de PreToolUse por stdin, exit 2 si bloquea, exit 0 si permite).
- Sentinela en `${XDG_CACHE_HOME:-$HOME/.cache}/todo-plugin/window`.

- [ ] **Step 1: Escribir el test que falla**

Create `bin/dev/test-guard.sh`:

```bash
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

# 6. Bypass TODO_GUARD=off + Edit .todo sin ventana → permite
rm -f "$WINDOW"
[ "$(run off "$(edit_payload Edit /proj/.todo/TODO.md)")" = "0" ] || fail "bypass debía permitir"

# 7. Ventana vieja (>5 min) → bloquea
bash "$GUARD" open
touch -d '10 minutes ago' "$WINDOW"
[ "$(run on "$(edit_payload Edit /proj/.todo/TODO.md)")" = "2" ] || fail "ventana vieja debía bloquear"

# 8. MultiEdit sobre .todo sin ventana → bloquea
rm -f "$WINDOW"
[ "$(run on "$(edit_payload MultiEdit /proj/.todo/DOING.md)")" = "2" ] || fail "MultiEdit .todo sin ventana debía bloquear"

echo "OK: todo-guard.sh"
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `bash bin/dev/test-guard.sh`
Expected: FAIL — `bin/todo-guard.sh` no existe (error "No such file").

- [ ] **Step 3: Implementar `bin/todo-guard.sh`**

Create `bin/todo-guard.sh`:

```bash
#!/bin/bash
# Guard de .todo/: 'open' abre una ventana de escritura; sin args (o 'check')
# corre como hook PreToolUse y bloquea escrituras directas a .todo/.
set -uo pipefail
GUARD_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/todo-plugin"
WINDOW="$GUARD_DIR/window"
WINDOW_MIN=5

if [ "${1:-check}" = "open" ]; then
    mkdir -p "$GUARD_DIR"; touch "$WINDOW"; exit 0
fi

# Modo hook. Bypass explícito.
[ "${TODO_GUARD:-on}" = "off" ] && exit 0

payload="$(cat)"

# ¿La operación escribe en un .todo/? (exit 0 = sí escribe)
if printf '%s' "$payload" | python3 -c '
import json,sys,re
try:
    d=json.load(sys.stdin)
except Exception:
    sys.exit(1)
tool=d.get("tool_name","")
ti=d.get("tool_input",{}) or {}
if tool in ("Edit","Write","MultiEdit"):
    p=(ti.get("file_path","") or "").replace("\\","/")
    sys.exit(0 if "/.todo/" in "/"+p else 1)
if tool=="Bash":
    cmd=ti.get("command","") or ""
    touches=".todo/" in cmd
    writes=bool(re.search(r"sed +-i|>>?|tee|(^|\s)(cp|mv|rm)\s|open\([^)]*[\x27\x22]w", cmd))
    sys.exit(0 if (touches and writes) else 1)
sys.exit(1)
'; then
    if [ -n "$(find "$WINDOW" -mmin "-$WINDOW_MIN" 2>/dev/null)" ]; then
        exit 0
    fi
    echo "TODO-GUARD: edición directa de .todo/ bloqueada. Usá el skill correspondiente (todo-add / todo-doing / todo-done / todo-clarify / todo-solutions / todo-recommend / todo-triage / todo-audit), que abren la ventana de escritura automáticamente. Para editar a mano: exportá TODO_GUARD=off." >&2
    exit 2
fi
exit 0
```

Hacer ejecutables ambos scripts.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `chmod +x bin/todo-guard.sh bin/dev/test-guard.sh && bash bin/dev/test-guard.sh`
Expected: `OK: todo-guard.sh`

- [ ] **Step 5: Commit**

```bash
git add bin/todo-guard.sh bin/dev/test-guard.sh
git commit -m "feat: guard que bloquea edición directa de .todo/ (todo-guard.sh)"
```

---

### Task 2: Registrar el hook PreToolUse

**Files:**
- Modify: `hooks/hooks.json`

**Interfaces:**
- Consumes: `bin/todo-guard.sh` (Task 1).

- [ ] **Step 1: Agregar las entradas PreToolUse**

En `hooks/hooks.json`, dentro del objeto `"hooks"`, agregar una clave `"PreToolUse"` (hermana de `"SessionStart"` y `"PostToolUse"`):

```json
    "PreToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "bash ${CLAUDE_PLUGIN_ROOT}/bin/todo-guard.sh"
          }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash ${CLAUDE_PLUGIN_ROOT}/bin/todo-guard.sh"
          }
        ]
      }
    ]
```

- [ ] **Step 2: Verificar que el JSON es válido**

Run: `python3 -c "import json; d=json.load(open('hooks/hooks.json')); print(sorted(d['hooks'].keys()))"`
Expected: `['PostToolUse', 'PreToolUse', 'SessionStart']`

- [ ] **Step 3: Commit**

```bash
git add hooks/hooks.json
git commit -m "feat: registrar todo-guard como hook PreToolUse"
```

---

### Task 3: Abrir la ventana en skills y agentes

**Files:**
- Modify: `skills/todo-add/SKILL.md`, `skills/todo-doing/SKILL.md`, `skills/todo-done/SKILL.md`, `skills/todo-clarify/SKILL.md`, `skills/todo-solutions/SKILL.md`, `skills/todo-recommend/SKILL.md`, `skills/todo-triage/SKILL.md`, `skills/todo-item/SKILL.md`, `skills/todo-audit/SKILL.md`, `skills/todo-config/SKILL.md`
- Modify: `agents/todo-agent.md`, `agents/todo-audit.md`

**Interfaces:**
- Consumes: `bin/todo-guard.sh open` (Task 1).

- [ ] **Step 1: Insertar la apertura de ventana como primera acción**

En cada uno de los 10 skills, al inicio de su sección `## Process` — **antes** del bloque `### 0a. Resolver el proyecto` (si existe) o de cualquier otro paso — insertar:

````markdown
### 0. Abrir ventana de escritura

Antes de cualquier otra cosa (incluida la resolución de proyecto, que puede crear archivos):

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/todo-guard.sh" open
```

Esto autoriza las escrituras a `.todo/` que hará este skill. El hook `todo-guard` bloquea cualquier edición de `.todo/` que no venga precedida de esta apertura.
````

Leer cada archivo primero para ubicar el inicio de `## Process` y respetar el estilo de encabezados. NO modificar el resto del cuerpo.

En los 2 agentes (`agents/todo-agent.md`, `agents/todo-audit.md`), agregar al inicio de sus instrucciones una directiva equivalente:

```markdown
Antes de cualquier operación sobre archivos `.todo/`, ejecutá una sola vez `"${CLAUDE_PLUGIN_ROOT}/bin/todo-guard.sh" open` para abrir la ventana de escritura; el hook todo-guard bloquea ediciones directas de `.todo/` sin esa apertura.
```

- [ ] **Step 2: Verificar que los 10 skills + 2 agentes la contienen**

Run:
```bash
grep -L "todo-guard.sh\" open" \
  skills/todo-add/SKILL.md skills/todo-doing/SKILL.md skills/todo-done/SKILL.md \
  skills/todo-clarify/SKILL.md skills/todo-solutions/SKILL.md skills/todo-recommend/SKILL.md \
  skills/todo-triage/SKILL.md skills/todo-item/SKILL.md skills/todo-audit/SKILL.md \
  skills/todo-config/SKILL.md agents/todo-agent.md agents/todo-audit.md
```
Expected: sin salida (todos contienen la apertura).

- [ ] **Step 3: Confirmar que `todo-health` NO la tiene (es read-only)**

Run: `grep -c "todo-guard.sh" skills/todo-health/SKILL.md`
Expected: `0`

- [ ] **Step 4: Commit**

```bash
git add skills/ agents/
git commit -m "feat: skills y agentes abren la ventana de escritura de todo-guard"
```

---

### Task 4: Documentación

**Files:**
- Modify: `CLAUDE.md` (sección "Hooks")
- Modify: `README.md` (sección de hooks, si existe)

**Interfaces:** ninguna.

- [ ] **Step 1: Documentar en `CLAUDE.md`**

En la tabla de "Claude Code hooks (`hooks/hooks.json`)" de `CLAUDE.md`, agregar una fila:

```markdown
| `PreToolUse(Edit/Write/MultiEdit/Bash)` | Edición de un `.todo/` | Bloquea la edición directa fuera de un skill; los skills abren una ventana de escritura (`todo-guard.sh`). Bypass: `TODO_GUARD=off` |
```

Y bajo la sección de Git hook, agregar un párrafo breve:

```markdown
### Guard de edición directa (`bin/todo-guard.sh`)

Para mantener la consistencia del formato, toda mutación de `.todo/` debe pasar
por un skill. Un hook `PreToolUse` bloquea ediciones directas (Edit/Write/Bash)
de `.todo/` salvo dentro de la ventana de 5 min que cada skill abre al ejecutarse.
Para editar a mano puntualmente, exportá `TODO_GUARD=off` (o editá el archivo en
tu editor, fuera de Claude).
```

- [ ] **Step 2: Documentar en `README.md`**

Run para localizar la sección de hooks: `grep -n -i "hook" README.md | head`
Si hay una sección de hooks, agregar una mención equivalente (adaptada al tono). Si no existe, omitir este paso (no crear una sección nueva solo para esto).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: documentar el guard de edición directa de .todo/"
```

---

## Verificación final

- [ ] `bash bin/dev/test-guard.sh` → `OK: todo-guard.sh`
- [ ] `bash bin/dev/test-store.sh` → `OK: todo-store.sh` (sin regresión)
- [ ] `bash bin/dev/test-hooks.sh` → 21 passed (sin regresión)
- [ ] `hooks/hooks.json` válido con claves `PreToolUse`, `PostToolUse`, `SessionStart`.
- [ ] Smoke manual: sin ventana, alimentar al guard un payload Edit de `.todo/TODO.md` → exit 2; correr `todo-guard.sh open` y repetir → exit 0.
- [ ] Smoke de no-regresión del flujo real: en un dir temporal con `XDG_CACHE_HOME`/`XDG_DATA_HOME` propios, simular el orden de un skill (open → escribir `.todo/TODO.md`) y confirmar que la escritura se permite.
