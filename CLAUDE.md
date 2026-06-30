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

## File structure

All task files live under `.todo/` in the project root — never at the root level.

**Proyectos sin repositorio git** (p.ej. un sitio WordPress operado vía MCP) no
tienen un `.todo/` local. En su lugar, el plugin mantiene un registro central:
`~/.local/share/todo/` es un único repo git con un subdirectorio `<id>/.todo/` por
proyecto. Al ejecutar un skill fuera de un repo, se elige el proyecto desde un menú
(o se crea uno nuevo). Identidad = nombre + id; el cwd no se toca.

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

### Git hook (`bin/hooks/pre-commit.sh`)

Editor-agnóstico — corre en cualquier CLI o editor. Se instala automáticamente via `SessionStart` en la primera sesión del proyecto. Bloquea `git commit` si hay tareas en DOING.md que podrían estar resueltas por los cambios en staging.

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
