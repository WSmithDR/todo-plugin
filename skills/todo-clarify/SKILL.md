---
name: todo-clarify
description: "Adds inline clarifications to technical terms in .todo/TODO.md and .todo/DOING.md."
---

# TODO Clarify

Adds inline clarifications to technical terms in `.todo/TODO.md` and `.todo/DOING.md`. Goal: a reader unfamiliar with the stack or domain should understand every sentence without leaving the files.

## Process

### 0. Abrir ventana de escritura

Antes de cualquier otra cosa (incluida la resolución de proyecto, que puede crear archivos):

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/todo-guard.sh" open
```

Esto autoriza las escrituras a `.todo/` que hará este skill. El hook `todo-guard` bloquea cualquier edición de `.todo/` que no venga precedida de esta apertura.

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

### 1. Read all active files

```bash
cat .todo/TODO.md 2>/dev/null
cat .todo/DOING.md 2>/dev/null
```

Read both files fully. As you go, build a list of candidate terms.

### 2. Identify terms that need clarification

Flag a term when it meets any of these conditions:

- **Acronym or abbreviation** not universally known: FSM, LLM, ORM, JWT, CQRS, TTL, ETL, CDN, etc.
- **Technical concept** requiring background: upsert, webhook, memoization, debounce, idempotency, race condition, lazy loading, etc.
- **Tool/framework-specific term** only meaningful if you know the tool: migration in Django, resolver in GraphQL, hook in React, action in Redux, pipeline in GitLab CI, etc.
- **Domain jargon** specific to the project's business domain: efemérides in astrology, invitee in Calendly, chargeback in payments, covenant in finance, etc.
- **Pattern names** that aren't self-explanatory: negative-first, guard clause, optimistic update, circuit breaker, fan-out, etc.

Do NOT clarify:
- Words any developer knows: `null`, `array`, `endpoint`, `token`, `JSON`, `API`, `commit`, `query`
- Terms the user clearly understands (inferred from their messages or CLAUDE.md)
- Terms already clarified earlier in either file
- Metadata fields like `creado por`, `iniciado`, `responsable` — these are self-explanatory

### 3. Write clarifications

Format: append `(clarification)` immediately after the term's first occurrence.

Rules:
- Max 15 words per clarification
- Plain language — no jargon inside the clarification
- Contextual — explain what it means *in this specific project*, not a dictionary definition
- One clarification per term across both files combined (don't repeat in DOING.md a term already clarified in TODO.md)

Good examples:
- `upsert (operación de BD que inserta el registro si no existe, o lo actualiza si ya existe)`
- `idempotente (que ejecutarlo dos veces produce el mismo resultado que ejecutarlo una vez)`
- `debounce (retrasar una acción hasta que el usuario deja de hacer algo por N ms, evita llamadas excesivas)`
- `migration (script SQL que modifica el schema de la base de datos de forma controlada y reversible)`
- `guard clause (verificación al inicio de una función que sale temprano si la condición no se cumple)`

Bad examples:
- `ORM (Object-Relational Mapping)` — expande el acrónimo sin explicar qué hace
- `webhook (a webhook is an HTTP callback)` — usa jerga en la aclaración
- `temperatura (el parámetro de temperatura)` — no agrega información

### 4. Apply changes

Edit `.todo/TODO.md` and `.todo/DOING.md` inserting clarifications inline. Don't move text, don't reformat unrelated lines, don't alter the `_(creado por: ...)_` metadata.

### 5. Commit

```bash
git add .todo/TODO.md .todo/DOING.md
git commit -m "TODO: add term clarifications"
```

Tell the user how many terms were clarified and list them briefly.
