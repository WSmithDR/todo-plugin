---
name: todo-config
description: "Configures todo-plugin settings for the current project. Asks interactively whether to gitignore .todo/, stores preferences in .todo/config.json. Run on first use or to change an existing setting."
---

# Todo Plugin — Config

Manages per-project plugin settings. Config file: `.todo/config.json`.

## Dónde viven tus tareas

- **En un repo git**: `.todo/` local, junto al código.
- **Fuera de un repo** (sitios operados por MCP, notas personales): registro central en
  `~/.local/share/todo/<proyecto>/.todo/` — un único repo git versionado solo.
  Para crear o elegir uno de estos proyectos, este mismo skill te lo ofrece en el paso 0b.

## Config schema

```json
{
  "gitignore_todo": false,
  "configured_at": "YYYY-MM-DD",
  "configured_by": "GitName"
}
```

## Process

### 0. Abrir ventana de escritura

Antes de cualquier otra cosa (incluida la resolución de proyecto, que puede crear archivos):

```bash
"${TODO_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}/bin/todo-guard.sh" open
```

Esto autoriza las escrituras a `.todo/` que hará este skill. El hook `todo-guard` bloquea cualquier edición de `.todo/` que no venga precedida de esta apertura.

### 0b. Resolver modo: repo vs store central

```bash
MODE=$("${TODO_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" mode)
echo "$MODE"
```

Además, informar el estado de la centralización y ofrecerla:

```bash
cat ~/.local/share/todo/settings.json 2>/dev/null || echo "{}"
```

Si `central_repos` no es `true`, ofrecer con `AskUserQuestion`:

```
question: "¿Centralizar también los repos git? Su .todo/ viviría en el store (~/.local/share/todo) en vez de junto al código."
header: "Store central"
options:
  - label: "Sí — centralizar y migrar este repo"
    description: "Activa central_repos y muda el .todo/ local de ESTE repo al store con todo su contenido."
  - label: "Sí — centralizar de ahora en más"
    description: "Activa central_repos; los repos existentes migran cuando se ejecute todo-store.sh adopt."
  - label: "No — dejar como está"
```

- **Activar** (en ambas opciones afirmativas):

```bash
python3 - <<EOF
import json, os
base = os.path.expanduser("~/.local/share/todo")
os.makedirs(base, exist_ok=True)
p = os.path.join(base, "settings.json")
s = {}
if os.path.exists(p):
    s = json.load(open(p))
s["central_repos"] = True
json.dump(s, open(p, "w"), indent=2)
print(f"OK: {p}")
EOF
```

- **Opción "migrar este repo"** — solo aplica si `MODE` es `repo` (en `nonrepo` ya estás en el store); ejecutar además:

```bash
"${TODO_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" adopt "$(pwd)"
```

Informar el `<id>` y la ruta del store impresos. Aclarar que el `.todo/` local fue movido (borrado del repo) y que los cambios del store quedaron commiteados ahí.

**Si `MODE` es `repo`**: continuar en el paso 1 — la configuración es por proyecto y vive en `.todo/config.json` local.

**Si `MODE` es `nonrepo`**: `gitignore_todo` no aplica (el store es privado y ya nace con config válido), pero acá se dan de alta los proyectos sin repo. Preguntar con `AskUserQuestion`:

```
question: "¿Qué querés hacer con el registro central?"
header: "Store central"
options:
  - label: "Crear un proyecto nuevo"
    description: "Da de alta una lista de tareas sin repo (p.ej. una lista personal)."
  - label: "Ver los proyectos existentes"
    description: "Lista id + nombre y la ruta de cada uno."
  - label: "Nada — salir"
```

- **Crear**: pedir el nombre, luego:

```bash
ID=$("${TODO_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" create "<nombre>")
"${TODO_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" path "$ID"
```

Confirmar al usuario con el id y la ruta impresa (ahí viven sus archivos) y terminar.

- **Ver existentes**:

```bash
"${TODO_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" list
```

Mostrar el listado y terminar.

### 1. Read existing config

```bash
mkdir -p .todo
cat .todo/config.json 2>/dev/null
```

### 2. Determine mode

- **No config found** → first-run setup: ask all settings interactively.
- **Config found** → show current values and ask which setting to change (or confirm no changes needed).

### 3. Ask: gitignore .todo/

Use `AskUserQuestion` with this exact question and options:

```
question: "¿Debe ignorarse la carpeta .todo/ en git?"
header: "Gitignore"
options:
  - label: "No — commitear .todo/ (recomendado para equipos)"
    description: "Los TODOs viajan con el repo. Todos ven el estado del proyecto."
  - label: "Sí — ignorar .todo/"
    description: "Los TODOs son locales. No aparecen en commits ni PRs."
```

### 4. Apply gitignore setting

**If `gitignore_todo: true`** — add `.todo/` to `.gitignore` if not already present:

```bash
grep -qxF '.todo/' .gitignore 2>/dev/null || echo '.todo/' >> .gitignore
```

**If `gitignore_todo: false`** — remove `.todo/` from `.gitignore` if present:

```bash
sed -i '/^\.todo\/$/d' .gitignore 2>/dev/null || true
```

Also unstage `.todo/` from gitignore if it was previously ignored:

```bash
git ls-files --others --ignored --exclude-standard .todo/ | grep -q . \
  && git rm -r --cached .todo/ 2>/dev/null || true
```

### 5. Save config

```bash
CREATOR=$(git config user.name)
TODAY=$(date +%Y-%m-%d)
```

Write `.todo/config.json`:

```json
{
  "gitignore_todo": <true|false>,
  "configured_at": "<TODAY>",
  "configured_by": "<CREATOR>"
}
```

Use `python3` to write atomically:

```bash
python3 -c "
import json
config = {
    'gitignore_todo': <true|false>,
    'configured_at': '<TODAY>',
    'configured_by': '<CREATOR>'
}
with open('.todo/config.json', 'w') as f:
    json.dump(config, f, indent=2)
print('Config guardada en .todo/config.json')
"
```

### 6. Confirm to user

```
✓ Config guardada
  gitignore_todo: <valor> → .gitignore <actualizado|sin cambios>
  configured_by: <nombre> · <fecha>
```

## Change detection

When config already exists, use `AskUserQuestion`:

```
question: "¿Qué configuración querés cambiar?"
header: "Todo config"
options:
  - label: "gitignore_todo: <valor_actual>"
    description: "Cambiar si .todo/ debe ignorarse en git."
  - label: "Nada — salir sin cambios"
    description: "La configuración actual está bien."
```

If the user selects a setting, go back to step 3 for that setting and re-apply.
