---
name: todo-item
description: "Creates a complete TODO entry in one shot: add → solutions → recommend → clarify."
---

# TODO Item

Orchestrates four skills in sequence for a single new item. Run them in order — each step builds on the previous.

## Process

### 0. Abrir ventana de escritura

Antes de cualquier otra cosa (incluida la resolución de proyecto, que puede crear archivos):

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/todo-guard.sh" open
```

Esto autoriza las escrituras a `.todo/` que hará este skill. El hook `todo-guard` bloquea cualquier edición de `.todo/` que no venga precedida de esta apertura.

### 0a. Resolver el proyecto (repo vs registro central)

Determinar el modo:

```bash
MODE=$("${CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" mode)
echo "$MODE"
```

- Si `MODE` es `repo`: continuar normalmente (las tareas viven en el `.todo/` de este repo).
- Si `MODE` es `nonrepo`: no hay repositorio, las tareas van al registro central. Listar proyectos:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" list
```

Mostrar con `AskUserQuestion` un menú: una opción por cada proyecto listado (usar el `<name>`), más una opción **"➕ Nuevo proyecto"**.

- Si el usuario elige **"➕ Nuevo proyecto"**: pedirle el nombre y crearlo:

```bash
NEW_ID=$("${CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" create "<nombre dado>")
```

- Si elige un proyecto existente: tomar su `<id>` de la lista.

Posicionarse en el store del proyecto:

```bash
cd "$("${CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" path "<id elegido o NEW_ID>")"
```

> Resolvé el proyecto UNA SOLA VEZ acá. Al delegar a todo-add / todo-solutions / todo-recommend / todo-clarify NO vuelvas a mostrar el menú de proyectos: ya estás posicionado en el store del proyecto y esos skills operan sobre el `.todo/` del directorio actual.

## Sequence

1. **`todo-add`** — write and insert the item in the correct section of `.todo/TODO.md`, including `_(creado por: GitName · YYYY-MM-DD)_` metadata
2. **`todo-solutions`** — add 2–4 concrete, distinct solution options to that item
3. **`todo-recommend`** — read the options and add a justified recommendation
4. **`todo-clarify`** — scan only the newly added text and add inline clarifications for non-obvious terms

Follow each skill's own rules. No need to repeat them here.

## When to use individual skills instead

Use `todo-item` for **new items** that deserve full treatment immediately.

Use individual skills when:
- Enriching an existing item that already has a description
- The user wants to review options before a recommendation is added
- Working in batch and deciding per item
