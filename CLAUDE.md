# todo-plugin

A Claude Code plugin for task lifecycle management. Maintains `.todo/TODO.md`, `.todo/DOING.md`, `.todo/DONE.md`, and `.todo/DISCARDED.md` using the Eisenhower Q1–Q4 matrix.

## Install

**1. Registrar el marketplace (una sola vez, global):**
```bash
claude plugin marketplace add WSmithDR/todo-plugin
```

**2. Instalar en el proyecto:**
```bash
claude plugin install todo-plugin@todo-plugin --scope project
```

**Global (todos los proyectos):**
```bash
claude plugin install todo-plugin@todo-plugin
```

## Update

**Scope project:**
```bash
claude plugin update todo-plugin@todo-plugin --scope project
```

**Scope user (global):**
```bash
claude plugin update todo-plugin@todo-plugin
```

Para verificar que el update tomó efecto, ejecutar `/todo-health` — la versión mostrada debe coincidir con la última publicada. El plugin sigue semver (`MAJOR.MINOR.PATCH`) y la versión se incrementa automáticamente en cada commit según el prefijo:

| Prefijo | Bump |
|---|---|
| `feat:` | minor |
| `fix:`, `chore:`, `docs:`, `refactor:`, `style:`, `test:`, `ci:` | patch |
| `feat!:` o `BREAKING CHANGE` en el cuerpo | major |

## Código (`src/`)

En migración a TypeScript. **No hay build**: node (≥22.18) y bun ejecutan los
`.ts` directo borrando los tipos. Por eso los imports llevan extensión `.ts` y
está prohibida la sintaxis no borrable (`enum`, `namespace`, decorators) —
`erasableSyntaxOnly` en el tsconfig lo hace un error de compilación.

```bash
node --test 'src/**/*.test.ts'   # tests (bun test src/ corre los mismos)
npx tsc --noEmit                 # único typecheck del proyecto; corre en CI
```

| Path | Qué |
|---|---|
| `src/core/protocol.ts` | `ToolEvent`, `Decision` (`allow`/`deny`/`advise`), `mergeDecisions`. Lo único que importan los adapters |
| `src/core/rules/` | Las reglas, puras: reciben el estado de I/O como parámetro y devuelven una `Decision` |
| `src/core/paths.ts` | **Único** dueño de la resolución del root del plugin. No lo recalcules en otro archivo |
| `src/core/window.ts` | Ventana de escritura del guard |
| `src/core/store.ts` | Registro central de proyectos sin repo |
| `src/core/discovery.ts` | Escanea `skills/` y `agents/` leyendo frontmatter |

`core/` no sabe qué CLI está corriendo: esa traducción es de `adapters/` (fase 2).
Ver `docs/superpowers/specs/2026-08-03-migracion-typescript-multi-cli-design.md`.

Hasta que las fases 2 y 3 cableen los adapters, **lo que corre en producción sigue
siendo el bash de `bin/`**. Un fix hecho solo en `src/` todavía no llega al usuario.

## Manifiestos de los CLIs

`cli-config.yaml` es la fuente única. **No edites los manifiestos a mano** — se
regeneran desde ahí:

```bash
python3 bin/dev/generate-cli-configs.py           # regenera
python3 bin/dev/generate-cli-configs.py --check   # drift; corre en CI
python3 bin/dev/generate-cli-configs.py --list    # paths que genera
```

Genera `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` y
`opencode.json`. La versión también vive ahí y tiene un solo escritor: el hook
`post-commit` la bumpea en el YAML y regenera. Antes escribía directo en
`plugin.json` y `marketplace.json` quedó 21 minors atrás (`1.0.0` vs `1.21.11`).

Para agregar un CLI: escribí una `gen_*()` en el generador y sumala a `TARGETS`.
Solo si verificaste que el plugin funciona ahí — un manifiesto que declara
capacidades inexistentes es peor que no tenerlo.

## File structure

All task files live under `.todo/` in the project root — never at the root level.

**Proyectos sin repositorio git** (p.ej. un sitio WordPress operado vía MCP) no
tienen un `.todo/` local. En su lugar, el plugin mantiene un registro central:
`~/.local/share/todo/` es un único repo git con un subdirectorio `<id>/.todo/` por
proyecto. Al ejecutar un skill fuera de un repo, se elige el proyecto desde un menú
(o se crea uno nuevo). Identidad = nombre + id; no se crean archivos en el cwd.

| File | Purpose |
|---|---|
| `.todo/TODO.md` | Open items, sorted by Eisenhower quadrant |
| `.todo/DOING.md` | Items currently in progress |
| `.todo/DONE.md` | Completed items |
| `.todo/DISCARDED.md` | Discarded items |

## Skills

| Skill | When to use |
|---|---|
| `todo-add` | Add one or more items to TODO.md |
| `todo-triage` | Classify and prioritize existing items by quadrant |
| `todo-doing` | Move an item from TODO to DOING |
| `todo-done` | Mark an item complete and move to DONE |
| `todo-item` | Read or inspect a specific task |
| `todo-clarify` | Add detail or acceptance criteria to a task |
| `todo-recommend` | Suggest the next item to work on |
| `todo-solutions` | Attach concrete solution options to a task |
| `todo-audit` | Full codebase audit — generates TODO.md from scratch |

## Agents

- **`todo-agent`** — orchestrates multi-skill todo operations in a single session
- **`todo-audit`** — isolated subagent for full codebase analysis; delegates to plugin skills for enriched findings

## Hooks

### Claude Code hooks (`hooks/hooks.json`)

| Hook | Trigger | Acción |
|---|---|---|
| `SessionStart` | Inicio de sesión | Instala el git pre-commit hook si no existe; detecta `.todo/` sin `config.json` y solicita `todo-config` |
| `PostToolUse(Bash)` | Comando bash fallido | Evalúa si el error merece abrir una tarea en TODO.md (`error-checker.sh`) |
| `PostToolUse(Bash)` | `git switch` / `git checkout -b` a rama de feature | Recuerda mover la tarea en curso a DOING.md vía `todo-doing` (enforcement suave, `branch-doing.sh`) |
| `PreToolUse(Edit/Write/MultiEdit/Bash)` | Edición de un `.todo/` | Bloquea la edición directa fuera de un skill; los skills abren una ventana de escritura (`todo-guard.sh`). Bypass: `TODO_GUARD=off` |

### OpenCode bridge (`.opencode/plugins/todo-plugin.js`)

| Hook | Acción |
|---|---|
| `config` | Registra `skills/` en `config.skills.paths` |
| `shell.env` | Inyecta `TODO_PLUGIN_ROOT` y `CLAUDE_PLUGIN_ROOT` en el entorno de los comandos |
| `tool.execute.before` | Delega en `bin/todo-guard.sh` (equivalente del `PreToolUse`) |
| `experimental.chat.messages.transform` | Inyecta el índice de skills en el primer mensaje |

**Paridad pendiente con Claude Code:** `SessionStart`, los dos `PostToolUse` y los
agentes de `agents/` todavía no tienen puente. Ver el spec de migración a TypeScript.

### Cómo referenciar el root del plugin

Los scripts que invocan las skills se resuelven así, y en ese orden:

```bash
"${TODO_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}/bin/todo-store.sh" mode
```

`CLAUDE_PLUGIN_ROOT` la setea Claude Code; OpenCode no la conoce (su binario no la
menciona), así que la provee el hook `shell.env`. `TODO_PLUGIN_ROOT` va primero
porque OpenCode le pasa **el mismo objeto `env` a todos los plugins**: un nombre
global para un valor por-plugin se pisa entre plugins y rompe las skills del
perdedor sin ningún error visible.

Nunca resuelvas el root con `git rev-parse --show-toplevel` — devuelve el repo del
usuario, no el del plugin.

### Git hook (`bin/hooks/pre-commit.sh`)

Editor-agnóstico — corre en cualquier CLI o editor. Se instala automáticamente via `SessionStart` en la primera sesión del proyecto. Bloquea `git commit` si hay tareas en DOING.md que podrían estar resueltas por los cambios en staging.

### Guard de edición directa (`bin/todo-guard.sh`)

Para mantener la consistencia del formato, toda mutación de `.todo/` debe pasar
por un skill. Un hook `PreToolUse` bloquea ediciones directas (Edit/Write/Bash)
de `.todo/` salvo dentro de la ventana de 5 min que cada skill abre al ejecutarse.
Para editar a mano puntualmente, exportá `TODO_GUARD=off` (o editá el archivo en
tu editor, fuera de Claude).

## Task format

```markdown
- [ ] **[Title]** — [description] _(creado por: GitName · YYYY-MM-DD)_
  - _Opción A:_ concrete fix
  - _Opción B:_ alternative
  - **Recomendación: A** — one-line justification
```

## Entry point

`todo-agent` is the main orchestrator. For full audits, it delegates to the `todo-audit` subagent which runs in isolation to avoid flooding the main context.

## Catálogo de features compartido

El tooling de infraestructura de este plugin (git hooks de desarrollo, versionado
automático, hooks de Claude Code, config por proyecto, health check, convenciones de
docs) proviene del catálogo [`cli-plugin-template`](https://github.com/WSmithDR/cli-plugin-template).

- **Para integrar una mejora del catálogo acá**: leé su `CATALOG.md`, abrí el README
  del feature y adaptá los archivos.
- **Si una mejora nacida en este plugin sirve para cualquier plugin**: promovéla al
  catálogo siguiendo su `CONTRIBUTING.md`, en vez de dejarla solo acá.

Features ya derivados de este plugin: `git-hooks`, `versioning`, `docs-conventions`,
`claude-code-hooks`, `project-config`, `health-check`.
