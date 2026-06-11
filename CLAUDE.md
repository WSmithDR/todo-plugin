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

- **SessionStart**: detects `.todo/` without `config.json` and prompts to run `todo-config`
- **PostToolUse(Bash)**: after a failing bash command, evaluates whether to open a task in TODO.md
- **Git pre-commit** (editor-agnostic): checks DOING.md before every commit — installed by `todo-config`

## Task format

```markdown
- [ ] **[Title]** — [description] _(creado por: GitName · YYYY-MM-DD)_
  - _Opción A:_ concrete fix
  - _Opción B:_ alternative
  - **Recomendación: A** — one-line justification
```

## Entry point

`todo-agent` is the main orchestrator. For full audits, it delegates to the `todo-audit` subagent which runs in isolation to avoid flooding the main context.
