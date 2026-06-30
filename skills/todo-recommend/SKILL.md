---
name: todo-recommend
description: "Adds a concrete recommendation for which solution option to implement on a TODO item."
---

# TODO Recommend

Adds a `**Recomendación:**` line to a TODO item that already has solution options. One concrete choice with a short justification — not a list of considerations.

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

If the user didn't specify, list items with options but no recommendation across all active files:

```bash
grep -n "Opción A" .todo/TODO.md .todo/DOING.md 2>/dev/null
```

Check which of those already have a `Recomendación:` line and skip them.

### 2. Analyze the options

Read the relevant code before deciding. For each option evaluate:

- **Correctness** — does it solve the root cause or just a symptom?
- **Consistency** — does it follow patterns already used elsewhere in the codebase?
- **Cost/complexity** — is the added complexity justified by the gain?
- **Risk** — could it break something else, or is it easy to scope?
- **Reversibility** — how hard is it to undo if it turns out to be wrong?

Check CLAUDE.md for deliberate architectural decisions — some options may already be ruled out by design.

### 3. Choose and justify

Pick one option (or a combination like "A+B"). The justification must answer: **why this over the others?** One sentence is enough if it's specific to this codebase.

Good justifications (specific):
- "B evita tocar el código — un cambio en la configuración cubre todo el proyecto de una vez."
- "A mantiene consistencia con el patrón ya usado en `[other component]` y no introduce nueva infraestructura."
- "A+B: A previene el problema en origen, B es una red de seguridad barata que no agrega dependencias."

Bad justifications (vague):
- "A es la más simple." — ¿más simple que qué?
- "B tiene menos riesgo." — ¿qué riesgo específicamente?
- "C es la más robusta." — ¿robusta en qué sentido?

Special cases:
- **Options are genuinely equivalent** → recommend the one requiring fewer changes.
- **Decision depends on something external** → "**Recomendación: decidir X primero.** Si X → A. Si Y → B."
- **Combination is clearly better** → "**Recomendación: A+B**" and explain why both add value.

### 4. Format and insert

Add immediately after the last option of the item. Preserve the `_(creado por: ...)_` metadata on the first line:

```markdown
- [ ] **[Item title]** — [description] _(creado por: GitName · YYYY-MM-DD)_
  - _Opción A:_ [...]
  - _Opción B:_ [...]
  - **Recomendación: B** — [one sentence, specific to this codebase].
```

### 5. Commit

```bash
git add .todo/TODO.md .todo/DOING.md
git commit -m "TODO: add recommendation for [item title]"
```
