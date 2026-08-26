---
name: todo-add
description: "Adds one or more TODO items to .todo/TODO.md in the current project."
---

# TODO Add

Adds a new item to `.todo/TODO.md` with proper formatting, including creator metadata from git. The result is a well-written TODO entry ready to be expanded with solutions and clarifications later.

## Process

### 0. Abrir ventana de escritura

Antes de cualquier otra cosa (incluida la resolución de proyecto, que puede crear archivos):

```bash
"${TODO_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}/bin/todo-guard.sh" open
```

Esto autoriza las escrituras a `.todo/` que hará este skill. El hook `todo-guard` bloquea cualquier edición de `.todo/` que no venga precedida de esta apertura.

### 0a. Resolver el proyecto (repo vs registro central)

Determinar el modo:

```bash
MODE=$("${TODO_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" mode)
echo "$MODE"
```

- Si `MODE` es `repo`: continuar normalmente (las tareas viven en el `.todo/` de este repo). Saltar al paso 0.
- Si `MODE` es `nonrepo`: no hay repositorio, las tareas van al registro central. Listar proyectos:

```bash
"${TODO_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" list
```

Mostrar con `AskUserQuestion` un menú: una opción por cada proyecto listado (usar el `<name>`), más una opción **"➕ Nuevo proyecto"**.

- Si el usuario elige **"➕ Nuevo proyecto"**: pedirle el nombre y crearlo:

```bash
NEW_ID=$("${TODO_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" create "<nombre dado>")
```

- Si elige un proyecto existente: tomar su `<id>` de la lista.

Posicionarse en el store del proyecto (a partir de acá el resto del skill corre tal cual, con `.todo/` relativo y `git commit` sobre el repo central):

```bash
cd "$("${TODO_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" path "<id elegido o NEW_ID>")"
```

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
  CREADO=$(date -Iminutes)
  for f in .todo/TODO.md .todo/DOING.md; do
    [ -f "$f" ] && sed -i -E \
      "/^\- \[ \] / { /creado por/! s/$/ _(creado por: $CREATOR · $CREADO)_/ }" "$f"
  done
  git add .todo/
  git commit -m "TODO: migrate legacy files to .todo/ + backfill creator metadata"
fi
# Backfill items missing metadata in already-migrated files
CREATOR=$(git config user.name); CREADO=$(date -Iminutes)
for f in .todo/TODO.md .todo/DOING.md; do
  [ -f "$f" ] && sed -i -E \
    "/^\- \[ \] / { /creado por/! s/$/ _(creado por: $CREATOR · $CREADO)_/ }" "$f"
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

### 1b. ¿Esto ya está registrado? (obligatorio, antes de escribir nada)

Un item duplicado no es solo ruido: parte la historia en dos y ninguna de las dos
versiones queda con el registro completo. Buscá en **los cuatro archivos**, más los
archivos de años anteriores:

```bash
grep -in "<2 o 3 palabras clave del item>" .todo/*.md
```

Usá palabras del problema, no de la solución (`popup`, `SMS`, `timezone`), y probá
más de una. Según dónde aparezca:

| Aparece en | Qué hacer |
|---|---|
| `TODO.md` | **No agregues nada.** Enriquecé el item existente: sumá lo que sepas ahora a su descripción, y decíselo al usuario ("ya estaba, le agregué X"). |
| `DOING.md` | Ya está en curso. Igual que arriba, y aclaralo — el usuario quizás no sabía. |
| `DONE.md` / `DONE-<año>.md` | **Ya se resolvió.** Mostrá la fecha y la narrativa del `✓ resuelto:`. Si el problema volvió, agregalo como item NUEVO y decí explícitamente que es una **regresión** de esa tarea, citándola: sin eso parece un bug nuevo y se vuelve a diagnosticar desde cero. |
| `DISCARDED.md` / `DISCARDED-<año>.md` | Se descartó **a propósito**. Mostrá el motivo y **preguntá al usuario si algo cambió** antes de re-agregarlo. DISCARDED.md existe para que una decisión tomada no se vuelva a discutir sin querer. |
| En ninguno | Seguí normalmente. |

Si el usuario pidió agregar varios items, hacé esta verificación **por item**: que uno
sea nuevo no dice nada de los otros.

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
- [ ] **[Short title]** — [One sentence: what breaks, when it breaks, what the user experiences.] _(creado por: GitName · 2026-08-25T10:30-05:00)_
```

Rules:
- Title: noun phrase, max 6 words, no verbs
- Description: explains the problem, not the solution
- Name the specific file, function, class, or component involved
- If it causes a user-facing failure, say so explicitly ("el usuario queda sin respuesta", "falla silenciosamente", "devuelve datos incorrectos")
- `GitName` comes from `git config user.name`, the timestamp after `·` comes from `date -Iminutes`

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

### 8. Escalar a `todo-item` si el item nace flojo

Si lo que se agregó es una sola cosa y el "cómo" no es obvio —el problema está claro pero hay más de un enfoque razonable, o la descripción quedó vaga porque falta entender el código—, ofrecé `todo-item`, que encadena solutions → recommend → clarify sobre lo recién agregado. Es el momento barato: el contexto de por qué se agregó todavía está fresco.

No lo ofrezcas cuando entraron varios items de una (ahí primero va `todo-triage`), ni cuando el item es evidente de una línea.
