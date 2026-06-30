---
name: todo-doing
description: "Moves a TODO item from .todo/TODO.md into .todo/DOING.md to signal that work has started."
---

# TODO Doing

Moves an item from `.todo/TODO.md` to `.todo/DOING.md`. Signals that active work has started on it. DOING.md is the single source of truth for what's in progress — it should stay short (ideally 1–3 items at a time).

## Process

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

### 0. Detect and migrate legacy files

```bash
if [ ! -d ".todo" ] && { [ -f "TODO.md" ] || [ -f "DOING.md" ]; }; then
  mkdir -p .todo
  for f in TODO.md DOING.md DONE.md DISCARDED.md; do
    [ -f "$f" ] && git mv "$f" ".todo/$f"
  done
  CREATOR=$(git log --format='%an' -1 -- TODO.md 2>/dev/null || git config user.name)
  TODAY=$(date +%Y-%m-%d)
  for f in .todo/TODO.md .todo/DOING.md; do
    [ -f "$f" ] && sed -i -E \
      "/^\- \[ \] / { /creado por/! s/$/ _(creado por: $CREATOR · $TODAY)_/ }" "$f"
  done
  git add .todo/
  git commit -m "TODO: migrate legacy files to .todo/ + backfill creator metadata"
fi
CREATOR=$(git config user.name); TODAY=$(date +%Y-%m-%d)
for f in .todo/TODO.md .todo/DOING.md; do
  [ -f "$f" ] && sed -i -E \
    "/^\- \[ \] / { /creado por/! s/$/ _(creado por: $CREATOR · $TODAY)_/ }" "$f"
done
```

### 1. Identify the item to move

If the user specified the item, find it in `.todo/TODO.md`:

```bash
grep -n "^\- \[ \]" .todo/TODO.md
```

If the user didn't specify, show the list and ask which one they're starting.

### 2. Locate or create .todo/DOING.md

```bash
mkdir -p .todo
find .todo -maxdepth 1 -name "DOING.md" | head -1
```

If `.todo/DOING.md` doesn't exist, create it:

```markdown
# En progreso — [Project Name]

_Última actualización: YYYY-MM-DD_
```

### 3. Warn if DOING.md is crowded

If `.todo/DOING.md` already has 3 or more open items (`- [ ]`), warn the user before proceeding:

> "Ya hay N items en DOING.md. Tener demasiados en progreso en simultáneo dificulta el foco. ¿Querés mover este de todas formas?"

Proceed only if the user confirms.

### 4. Move the item

Remove the full item block from `.todo/TODO.md` (including its indented options/recommendation/clarifications) and append it to `.todo/DOING.md` preserving the creator metadata and adding an `iniciado:` timestamp (precise — con hora, para poder calcular duración después):

```bash
INICIADO=$(date -Iminutes)   # p.ej. 2026-06-26T14:32-05:00
```

```markdown
- [ ] **[Título]** — [descripción] _(creado por: GitName · YYYY-MM-DD | iniciado: 2026-06-26T14:32-05:00)_
  - _Opción A:_ [...]
  - _Opción B:_ [...]
  - **Recomendación: A** — [...]
```

If the item has no options yet:

```markdown
- [ ] **[Título]** — [descripción] _(creado por: GitName · YYYY-MM-DD | iniciado: 2026-06-26T14:32-05:00)_
```

The creator info is read from the existing item's `_(creado por: ...)_` tag — preserve it exactly. The `iniciado:` value is `date -Iminutes` (timestamp ISO con hora y zona), no solo la fecha — bitacora lo usa para estimar cuánto llevó la tarea.

### 5. Update dates

```bash
# TODO.md
_Última revisión: YYYY-MM-DD_
# DOING.md
_Última actualización: YYYY-MM-DD_
```

### 6. Commit

```bash
git add .todo/TODO.md .todo/DOING.md
git commit -m "TODO: start [item title]"
```

Confirm to the user: which item was moved, its quadrant of origin, and how many items are now in DOING.md.
