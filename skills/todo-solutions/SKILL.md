---
name: todo-solutions
description: "Generates multiple concrete solution options for a TODO item in .todo/TODO.md or .todo/DOING.md."
---

# TODO Solutions

Adds 2–4 concrete, distinct solution options to a TODO item. Each option represents a genuinely different approach with different tradeoffs — not variations of the same idea.

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

### 1. Find the target TODO item

If the user didn't specify, list open items without solution options across all active files:

```bash
grep -n "^\- \[ \]" .todo/TODO.md .todo/DOING.md 2>/dev/null
```

Look for items that don't have an `_Opción A:_` line beneath them.

### 2. Understand the problem deeply

Before generating options, read the relevant code and answer:

- **What exactly fails?** Read the function, class, module, or config involved. Don't guess.
- **What is the current behavior?** What does it do now?
- **What is the desired behavior?** What should it do instead?
- **What constraints exist?** Check CLAUDE.md or project docs for deliberate architectural decisions that may rule out certain approaches.

### 3. Generate 2–4 options

Each option must be:

- **Genuinely different** — different mechanisms, not different phrasings of the same fix. Examples of real diversity:
  - Fix at the root cause vs. add defensive check downstream
  - Use existing infrastructure vs. introduce a new dependency
  - Quick deterministic patch vs. flexible but heavier solution
  - In-memory/temporary vs. persistent
  - Change the code vs. change the configuration

- **Concrete** — specific enough to implement without further clarification. Name the file, function, class, field, library, or API call.

- **Honest about tradeoffs** — one short note on the downside when relevant (cost, complexity, fragility, scope creep, performance).

### 4. Format and insert

Add options directly under the TODO item, indented. Preserve the `_(creado por: ...)_` metadata on the first line:

```markdown
- [ ] **[Item title]** — [description] _(creado por: GitName · YYYY-MM-DD)_
  - _Opción A:_ [concrete fix. Tradeoff note if relevant.]
  - _Opción B:_ [concrete fix. Tradeoff note if relevant.]
  - _Opción C:_ [only if genuinely different from A and B.]
```

Do not add a recommendation here — that is handled by the `todo-recommend` skill.

### 5. Commit

```bash
git add .todo/TODO.md .todo/DOING.md
git commit -m "TODO: add solution options for [item title]"
```
