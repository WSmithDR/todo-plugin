---
name: todo-triage
description: "Periodic review of .todo/ files to re-prioritize items, detect stale entries, and merge duplicates."
---

# TODO Triage

Re-evaluates `.todo/TODO.md` and `.todo/DOING.md` against the current state of the codebase. Corrects quadrant classifications, removes dead weight, and produces a clear "work on this next" recommendation. Also handles migration from the old single-file format (sections Urgentes / Bugs / Funcionalidades / Deuda técnica) to the Eisenhower multi-file format under `.todo/`.

## Process

### 0. Abrir ventana de escritura

Antes de cualquier otra cosa (incluida la resolución de proyecto, que puede crear archivos):

```bash
"${TODO_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}/bin/todo-guard.sh" open
```

Esto autoriza las escrituras a `.todo/` que hará este skill. El hook `todo-guard` bloquea cualquier edición de `.todo/` que no venga precedida de esta apertura.

### 0a. Resolver el proyecto (repo vs registro central)

```bash
MODE=$("${TODO_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" mode)
echo "$MODE"
```

- Si `MODE` es `repo`: continuar normalmente.
- Si `MODE` es `nonrepo`: listar proyectos y elegir cuál operar (solo existentes; este skill no crea proyectos):

```bash
"${TODO_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" list
```

Mostrar con `AskUserQuestion` un menú con una opción por proyecto (usar el `<name>`). Si la lista está vacía, informar que no hay proyectos registrados y terminar. Luego posicionarse:

```bash
cd "$("${TODO_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" path "<id elegido>")"
```

### 1. Read all TODO files

```bash
cat .todo/TODO.md 2>/dev/null
cat .todo/DOING.md 2>/dev/null
cat .todo/DONE.md 2>/dev/null
cat .todo/DISCARDED.md 2>/dev/null
```

Note: total open items per file, distribution by quadrant in TODO.md, items with/without solutions, items in DOING.md.

Also check for legacy files in the project root and migrate if found:
```bash
ls TODO.md DOING.md DONE.md DISCARDED.md 2>/dev/null
```

### 2. Detect old format and migrate if needed

**Legacy root files:** If `TODO.md`, `DOING.md`, `DONE.md`, or `DISCARDED.md` exist at the project root (not inside `.todo/`), migrate their content to `.todo/` and delete the root files.

**Legacy section format:** If any file uses the old section format (`## Urgentes (producción)`, `## Bugs / Gaps funcionales`, `## Funcionalidades incompletas`, `## Deuda técnica`), migrate to the Eisenhower format:

| Old section | Default quadrant |
|---|---|
| Urgentes (producción) | Q1 |
| Bugs / Gaps funcionales | Q2 (re-evaluate: if causing prod failures today → Q1) |
| Funcionalidades incompletas | Q2 |
| Deuda técnica | Q4 |

**Missing creator metadata:** If existing items don't have `_(creado por: ...)_` metadata, add a placeholder using `git log --format='%an' -1` (last committer for the file) as creator:

```markdown
- [ ] **[Title]** — [desc] _(creado por: unknown · YYYY-MM-DD)_
```

Also create `.todo/DOING.md`, `.todo/DONE.md`, and `.todo/DISCARDED.md` skeletons if missing. Move any `[x]` items from TODO.md:
- If marked with `✓ resuelto` → move to `.todo/DONE.md`
- If marked with `✗ descartado` → move to `.todo/DISCARDED.md` (add a `_Descartado:_` explanation line if missing)

### 3. Read the current codebase state

```bash
git log --oneline -20
git diff HEAD~5 --stat
```

Also read CLAUDE.md and any recently modified files. Goal: understand what has changed since the TODO was last updated, and whether those changes affect any open items.

### 4. Evaluate each open item on four axes

For every `- [ ]` item in `.todo/TODO.md` and `.todo/DOING.md`, assess:

| Axis | Question |
|---|---|
| **Still valid?** | Does this problem still exist in the current code? Or was it accidentally fixed, made irrelevant, or superseded? |
| **Correct quadrant?** | Has urgency or importance changed? (e.g., a Q4 item now causing prod failures → move to Q1) |
| **Duplicate?** | Is it substantially the same as another open item? If yes, merge them. |
| **Actionable?** | Does it have enough detail to implement? If not, flag it for `todo-solutions`. |

### 5. Apply changes

**Re-classify between quadrants:** Move items to the correct Q[N] section and note why:
```markdown
- [ ] **[Item]** — [desc] _(creado por: GitName · YYYY-MM-DD | movido Q4 → Q1: ahora causa fallos en producción desde el deploy de ayer)_
```

**Move to DOING.md:** If the user confirms they started working on something, move it:
```markdown
- [ ] **[Título]** — [descripción] _(creado por: GitName · YYYY-MM-DD | iniciado: YYYY-MM-DD)_
```

**Move to DONE.md:** If evidence shows an item was completed but never closed. Use git to identify responsables:
```bash
# Extract creation date from item's _(creado por: ... · YYYY-MM-DD)_ tag
CREATION_DATE="YYYY-MM-DD"
git log --format='%an' --since="$CREATION_DATE" --no-merges | sort -u
```
```markdown
- [x] **[Título]** — [descripción] _(creado por: GitName · YYYY-MM-DD)_ ✓ _resuelto: detectado como completado en triage — responsable: Name1, Name2 · YYYY-MM-DD_
```

**Move to DISCARDED.md:** If an item is no longer relevant:
```markdown
- ~~**[Título]**~~ — [descripción original] _(creado por: GitName · YYYY-MM-DD)_
  _Descartado YYYY-MM-DD: [explicación del por qué — qué cambió, qué se decidió]_
```

**Merge duplicates:** Keep the better-written item, absorb unique details, then move the duplicate to DISCARDED.md:
```markdown
- ~~**[Duplicate item]**~~ — [descripción] _(creado por: GitName · YYYY-MM-DD)_
  _Descartado YYYY-MM-DD: duplicado de "[kept item]" — los detalles únicos fueron absorbidos_
```

**Flag incomplete items:** If an item has no solutions yet:
```markdown
- [ ] **[Item]** — [desc] _(creado por: GitName · YYYY-MM-DD | pendiente: agregar opciones de solución)_
```

**Re-order within quadrants:** Put highest-impact items first within each quadrant.

### 6. Produce a "next actions" recommendation

After the triage, add or update a section at the top of `.todo/TODO.md` (below the date):

```markdown
## Próximos pasos recomendados

_Actualizado: YYYY-MM-DD_

1. **[Item title]** — [one sentence: why this first, impact/effort ratio]
2. **[Item title]** — [one sentence]
3. **[Item title]** — [one sentence]
```

Selection criteria for top 3:
- Q1 items always come first
- Among same-quadrant items: prefer high impact + low effort
- Prefer items that unblock other items
- Avoid recommending items without solution options yet (flag those separately)

### 7. Update dates

```bash
# En cada archivo modificado
_Última revisión: YYYY-MM-DD_      # .todo/TODO.md
_Última actualización: YYYY-MM-DD_ # .todo/DOING.md, .todo/DONE.md, .todo/DISCARDED.md
```

### 8. Commit

```bash
git add .todo/TODO.md .todo/DOING.md .todo/DONE.md .todo/DISCARDED.md
git commit -m "TODO: triage — re-prioritize, close N stale items, top 3 next actions"
```

Report to the user:
- How many items were re-classified, merged, or moved to other files
- The top 3 recommended next actions with one-line justification each
- Any items flagged as needing solutions before they can be worked on
- Any legacy files migrated from project root to `.todo/`
