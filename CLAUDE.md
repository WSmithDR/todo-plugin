# todo-plugin

A Claude Code plugin for task lifecycle management. Maintains `.todo/TODO.md`, `.todo/DOING.md`, `.todo/DONE.md`, and `.todo/DISCARDED.md` using the Eisenhower Q1–Q4 matrix.

## Install

**Per-project (recommended):**
```bash
claude plugin install github:WSmithDR/todo-plugin --scope project
```

**Global:**
```bash
claude plugin install github:WSmithDR/todo-plugin
```

**Local (development):**
```bash
claude plugin install /path/to/todo-plugin --scope project
```

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

- **PreToolUse(Bash)**: before `git commit`, checks DOING.md for tasks that may have been resolved
- **PostToolUse(Bash)**: after a failing bash command, evaluates whether to open a task in TODO.md

## Task format

```markdown
- [ ] **[Title]** — [description] _(creado por: GitName · YYYY-MM-DD)_
  - _Opción A:_ concrete fix
  - _Opción B:_ alternative
  - **Recomendación: A** — one-line justification
```

## Entry point

`todo-agent` is the main orchestrator. For full audits, it delegates to the `todo-audit` subagent which runs in isolation to avoid flooding the main context.
