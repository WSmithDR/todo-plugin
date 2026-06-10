---
name: todo-add
description: "Adds one or more TODO items to .todo/TODO.md in the current project."
---

# TODO Add

Adds a new item to `.todo/TODO.md` with proper formatting, including creator metadata from git. The result is a well-written TODO entry ready to be expanded with solutions and clarifications later.

## Process

### 0. Check plugin config

```bash
cat .todo/config.json 2>/dev/null
```

If `.todo/config.json` does not exist, invoke `todo-config` before continuing. Do not proceed until config is saved.

### 1. Detect and migrate legacy files

Run before anything else:

```bash
# Migrate root-level files to .todo/
if [ ! -d ".todo" ] && { [ -f "TODO.md" ] || [ -f "DOING.md" ]; }; then
  mkdir -p .todo
  for f in TODO.md DOING.md DONE.md DISCARDED.md; do
    [ -f "$f" ] && git mv "$f" ".todo/$f"
  done
  # Backfill creator on items missing it
  CREATOR=$(git log --format='%an' -1 -- TODO.md 2>/dev/null || git config user.name)
  TODAY=$(date +%Y-%m-%d)
  for f in .todo/TODO.md .todo/DOING.md; do
    [ -f "$f" ] && sed -i -E \
      "/^\- \[ \] / { /creado por/! s/$/ _(creado por: $CREATOR · $TODAY)_/ }" "$f"
  done
  git add .todo/
  git commit -m "TODO: migrate legacy files to .todo/ + backfill creator metadata"
fi
# Backfill items missing metadata in already-migrated files
CREATOR=$(git config user.name); TODAY=$(date +%Y-%m-%d)
for f in .todo/TODO.md .todo/DOING.md; do
  [ -f "$f" ] && sed -i -E \
    "/^\- \[ \] / { /creado por/! s/$/ _(creado por: $CREATOR · $TODAY)_/ }" "$f"
done
```

### 1. Locate or create .todo/TODO.md

```bash
# Ensure .todo/ directory exists
mkdir -p .todo

find .todo -maxdepth 1 -name "TODO.md" | head -1
```

If no `.todo/TODO.md` exists, create it with this skeleton:

```markdown
# TODOs — [Project Name]

_Última revisión: YYYY-MM-DD_

## Q1 — Urgente e Importante
> Hacer ahora. Fallos en producción, pérdida de datos, sin respuesta al usuario.

## Q2 — No urgente e Importante
> Planificar. Features críticas, bugs no bloqueantes, mejoras arquitectónicas.

## Q3 — Urgente y No importante
> Hacer rápido o delegar. Cambios de bajo impacto que no pueden esperar.

## Q4 — No urgente y No importante
> Diferir o eliminar. Deuda técnica, cosméticos, nice-to-haves.
```

### 2. Get creator identity

```bash
git config user.name
```

Use this value as the creator name in the entry metadata.

### 3. Classify into the Eisenhower quadrant

Answer two questions about the item:

**¿Es urgente?** → ¿Está roto o bloqueando algo hoy, en producción o en el flujo principal de trabajo?

**¿Es importante?** → ¿Tiene impacto real en el usuario, la integridad de los datos, o el roadmap del proyecto?

| Urgente | Importante | Cuadrante |
|---|---|---|
| Sí | Sí | **Q1** — fallos silenciosos, pérdida de datos, sistema caído |
| No | Sí | **Q2** — features clave, bugs reales no bloqueantes, arquitectura |
| Sí | No | **Q3** — cambios menores urgentes, pedidos de bajo valor urgentes |
| No | No | **Q4** — deuda técnica, refactoring cosmético, nice-to-haves |

Heurística: si la respuesta a urgente y a importante no es clara, default a Q2.

### 4. Write the TODO entry

```markdown
- [ ] **[Short title]** — [One sentence: what breaks, when it breaks, what the user experiences.] _(creado por: GitName · YYYY-MM-DD)_
```

Rules:
- Title: noun phrase, max 6 words, no verbs
- Description: explains the problem, not the solution
- Name the specific file, function, class, or component involved
- If it causes a user-facing failure, say so explicitly ("el usuario queda sin respuesta", "falla silenciosamente", "devuelve datos incorrectos")
- `GitName` comes from `git config user.name`, `YYYY-MM-DD` is today's date

### 5. Insert in the correct quadrant

Insert after the last existing item under the target `## Q[N]` heading, before the next `##` heading.

### 6. Update the date

Update `_Última revisión:_` to today's date.

### 7. Commit

```bash
git add .todo/TODO.md
git commit -m "TODO: add [short title]"
```

Confirm to the user: what was added, which quadrant and why, commit hash.
