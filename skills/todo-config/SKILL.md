---
name: todo-config
description: "Configures todo-plugin settings for the current project. Asks interactively whether to gitignore .todo/, stores preferences in .todo/config.json. Run on first use or to change an existing setting."
---

# Todo Plugin — Config

Manages per-project plugin settings. Config file: `.todo/config.json`.

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
"${CLAUDE_PLUGIN_ROOT}/bin/todo-guard.sh" open
```

Esto autoriza las escrituras a `.todo/` que hará este skill. El hook `todo-guard` bloquea cualquier edición de `.todo/` que no venga precedida de esta apertura.

### 0b. Solo aplica en repos

```bash
MODE=$("${CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" mode)
echo "$MODE"
```

Si `MODE` es `nonrepo`, esta configuración no aplica: la única opción
(`gitignore_todo`) es irrelevante para un store privado, y `todo-store.sh create`
ya siembra un `config.json` válido. Informar al usuario que en proyectos sin repo
no hay nada que configurar y terminar sin cambios.

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
