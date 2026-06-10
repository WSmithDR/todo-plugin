---
name: todo-audit
description: "Analyzes a codebase and generates a complete, prioritized .todo/TODO.md from scratch. For large codebases (10+ files), prefer the todo-audit subagent (Agent tool) to avoid flooding main context."
---

# TODO Audit

Analyzes the project and produces a complete `.todo/TODO.md` organized with the Eisenhower Matrix. Also initializes `.todo/DOING.md`, `.todo/DONE.md`, and `.todo/DISCARDED.md` if they don't exist. Each item is fully formed: description, solution options, recommendation, and term clarifications.

## Process

### 0. Detect and migrate legacy files

If `.todo/` doesn't exist but root files do, migrate them before auditing:

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
```

If `.todo/` already exists, skip to Step 1 and avoid duplicating tracked items.

### 1. Understand the project

Read in this order, stopping when you have enough context:

1. `CLAUDE.md` or `README.md` — architecture, constraints, deliberate decisions
2. Entry points: `main.py`, `index.ts`, `app.js`, `Makefile`, primary config file, workflow JSON, etc.
3. Any existing `.todo/TODO.md` — to avoid duplicating already-tracked items
4. Key modules based on what you find above

### 2. Get creator identity

```bash
git config user.name
```

Use this for all items created during this audit.

### 3. Find all issues

Go through every major component systematically. For each, ask:

**Silent failures:** undefined/null used without checking, missing error handling on I/O calls, timezone or encoding assumptions, unvalidated inputs.

**Logic gaps:** empty collection edge cases, first-time user edge cases, external service failures, race conditions, index out-of-bounds.

**Missing features:** unanswered `TODO`/`FIXME`/`HACK` comments in the code, stub functions, missing notifications or deduplication for idempotent operations.

**Tech debt:** dead code, unused fields, disconnected components, inconsistent patterns across similar components, shared resources with conflicting requirements.

**Performance:** independent sequential calls that could run in parallel, repeated queries that could be cached.

### 4. Classify each finding into the Eisenhower Matrix

Answer two questions for each finding:

**¿Es urgente?** → ¿Está roto o bloqueando algo hoy, en producción o en el flujo principal?

**¿Es importante?** → ¿Tiene impacto real en el usuario, la integridad de datos, o el roadmap?

| Urgente | Importante | Cuadrante | Criterio típico |
|---|---|---|---|
| Sí | Sí | **Q1** | Fallo silencioso hoy, pérdida de datos, sin respuesta al usuario |
| No | Sí | **Q2** | Feature relevante, bug real no bloqueante, mejora arquitectónica |
| Sí | No | **Q3** | Fix menor urgente, pedido de bajo valor que no puede esperar |
| No | No | **Q4** | Deuda técnica, refactoring cosmético, nice-to-have |

Within each quadrant, order by impact descending.

### 5. Write .todo/TODO.md

Ensure the `.todo/` directory exists:
```bash
mkdir -p .todo
```

Use this structure:

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

For each item, apply the full `todo-item` sequence. Every item entry must include creator metadata:

```markdown
- [ ] **[Short title]** — [description] _(creado por: GitName · YYYY-MM-DD)_
  - _Opción A:_ [...]
  - _Opción B:_ [...]
  - **Recomendación: A** — [justification]
```

The `GitName` is from `git config user.name`, `YYYY-MM-DD` is today's date.

### 6. Initialize companion files

If `.todo/DOING.md` does not exist, create it:

```markdown
# En progreso — [Project Name]

_Última actualización: YYYY-MM-DD_
```

If `.todo/DONE.md` does not exist, create it:

```markdown
# Completados — [Project Name]

_Última actualización: YYYY-MM-DD_
```

If `.todo/DISCARDED.md` does not exist, create it:

```markdown
# Descartados — [Project Name]

_Última actualización: YYYY-MM-DD_
```

### 7. Commit

```bash
git add .todo/TODO.md .todo/DOING.md .todo/DONE.md .todo/DISCARDED.md
git commit -m "TODO: initial audit — N items across Q1/Q2/Q3/Q4"
```

Report: total items, breakdown by quadrant, top 3 most critical.

## Quality bar

- At least one item per major component
- No vague items ("improve error handling") — always name the specific file or function
- Every Q1 item implementable in under 2 hours
- No duplicates with an existing `.todo/TODO.md`
- Every item has `_(creado por: ...)_` metadata
